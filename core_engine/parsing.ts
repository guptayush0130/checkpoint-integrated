/**
 * Phase 1 of the test pipeline — turn raw inputs (SDK spec, personas,
 * objectives, sandbox schema) into a `TestVariables` factor space the
 * matrix generator can consume.
 *
 * Strict port of `legacy_python/backend/parsing.py` minus the optional
 * batched LLM call for string factor levels (deterministic-only for now;
 * Phase 5 can add the LLM tier as an opt-in).
 */
import {
  AgentSpec,
  Factor,
  FactorLevel,
  StateField,
  TestSuiteInput,
  TestVariables,
  ToolSpec
} from './engine_types';

const MAX_DB_STRING_FACTOR_LEVELS = 6;

// ---------------------------------------------------------------------------
// numeric BVA buckets
// ---------------------------------------------------------------------------

function bvaBuckets(min?: number, max?: number): FactorLevel[] {
  const lo = min === undefined ? -1.0 : Number(min) - 1.0;
  const typ = min === undefined || max === undefined ? 50.5 : (Number(min) + Number(max)) / 2;
  const hi = max === undefined ? 999_999.99 : Number(max) + 1.0;
  return [
    { value: lo, role: 'underflow' },
    { value: 0.0, role: 'zero_or_empty' },
    { value: typ, role: 'typical' },
    { value: hi, role: 'overflow' }
  ];
}

function enumLevels(values: any[]): FactorLevel[] {
  return [...values, { value: null, role: 'invalid_or_null' }];
}

// ---------------------------------------------------------------------------
// string field probes
// ---------------------------------------------------------------------------

const ROLE_RANK: Record<string, number> = {
  invalid_or_null: 0,
  empty: 1,
  explicit_example: 2,
  format_valid: 2,
  typical_placeholder: 3,
  format_invalid: 4,
  format_edge: 4,
  pattern_violation: 5,
  injection_candidate: 6,
  unicode_edge: 8
};

function inferFormat(field: StateField): string | null {
  const n = field.name.toLowerCase();
  if (n.includes('email')) return 'email';
  if (n.includes('url') || n.includes('uri') || n.includes('website')) return 'url';
  if (n.includes('phone') || n.includes('tel') || n.includes('mobile')) return 'phone';
  if (n.includes('uuid')) return 'uuid';
  return null;
}

function formatProbeLevels(fmt: string): FactorLevel[] {
  switch (fmt) {
    case 'email':
      return [
        { value: 'jane.customer@example.com', role: 'format_valid' },
        { value: 'not_an_email_address', role: 'format_invalid' },
        { value: 'user@', role: 'format_edge' }
      ];
    case 'url':
    case 'uri':
      return [
        { value: 'https://example.com/path?x=1', role: 'format_valid' },
        { value: 'ht!tp://broken .com/foo', role: 'format_invalid' },
        { value: 'javascript:alert(1)', role: 'format_edge' }
      ];
    case 'phone':
      return [
        { value: '+14155552671', role: 'format_valid' },
        { value: 'CALL-ME-NOW', role: 'format_invalid' },
        { value: '+1 (415) 555-2671 ext 9999', role: 'format_edge' }
      ];
    case 'uuid':
      return [
        { value: '550e8400-e29b-41d4-a716-446655440000', role: 'format_valid' },
        { value: 'not-a-uuid-string', role: 'format_invalid' }
      ];
    default:
      return [];
  }
}

function genericStringEdgeLevels(typical: string): FactorLevel[] {
  return [
    { value: typical, role: 'typical_placeholder' },
    { value: 'line1\r\nline2\t ', role: 'unicode_edge' },
    { value: "Robert'); DROP TABLE students;--", role: 'injection_candidate' }
  ];
}

function levelKey(level: FactorLevel): string {
  if (level && typeof level === 'object' && 'role' in level) {
    return JSON.stringify({ v: level.value, r: level.role });
  }
  return JSON.stringify({ v: level });
}

function dedupePickBest(levels: FactorLevel[]): FactorLevel[] {
  const byValue = new Map<string, FactorLevel>();
  for (const lvl of levels) {
    const valueKey = JSON.stringify(getValue(lvl));
    const existing = byValue.get(valueKey);
    if (!existing || roleRank(lvl) < roleRank(existing)) {
      byValue.set(valueKey, lvl);
    }
  }
  return Array.from(byValue.values());
}

function roleRank(level: FactorLevel): number {
  if (level && typeof level === 'object' && 'role' in level) {
    return ROLE_RANK[level.role] ?? 40;
  }
  return 50;
}

function sortAndCapStringLevels(levels: FactorLevel[]): FactorLevel[] {
  const seen = new Set<string>();
  const unique: FactorLevel[] = [];
  for (const lvl of levels) {
    const k = levelKey(lvl);
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(lvl);
  }
  const collapsed = dedupePickBest(unique);
  collapsed.sort((a, b) => roleRank(a) - roleRank(b));
  return collapsed.slice(0, MAX_DB_STRING_FACTOR_LEVELS);
}

function heuristicStringLevels(field: StateField): FactorLevel[] {
  const fmt = inferFormat(field);
  const examples = (field.examples || []).filter((e) => e && typeof e === 'string');
  const typical = examples[0] || `sample_${field.name}`.replace(/\s+/g, '_');

  const levels: FactorLevel[] = [
    { value: '', role: 'empty' },
    { value: null, role: 'invalid_or_null' }
  ];
  for (const ex of examples.slice(0, 2)) {
    levels.push({ value: ex, role: 'explicit_example' });
  }
  if (fmt) levels.push(...formatProbeLevels(fmt));
  else if (field.pattern) {
    levels.push({ value: typical, role: 'typical_placeholder' });
    levels.push({ value: '!@#___', role: 'pattern_violation' });
  }
  levels.push(...genericStringEdgeLevels(typical));
  return sortAndCapStringLevels(levels);
}

// ---------------------------------------------------------------------------
// field/parameter → Factor
// ---------------------------------------------------------------------------

function factorFromStateField(field: StateField): Factor {
  let levels: FactorLevel[];
  switch (field.type) {
    case 'enum':
      levels = enumLevels(field.values || []);
      break;
    case 'boolean':
      levels = enumLevels([true, false]);
      break;
    case 'integer':
    case 'float':
      levels = bvaBuckets(field.min, field.max);
      break;
    case 'string':
      levels = field.values
        ? enumLevels(field.values.map(String))
        : heuristicStringLevels(field);
      break;
    default:
      levels = [
        { value: '', role: 'empty' },
        { value: null, role: 'invalid_or_null' }
      ];
  }
  return {
    name: `db.${field.name}`,
    kind: 'db_var',
    levels,
    source: field.name,
    description: field.description
  };
}

function factorsFromTools(tools: ToolSpec[]): Factor[] {
  const out: Factor[] = [];
  for (const tool of tools) {
    for (const p of tool.parameters || []) {
      const name = `tool.${tool.name}.${p.name}`;
      let levels: FactorLevel[];
      if (p.enum?.length) {
        levels = enumLevels(p.enum);
      } else if (p.type === 'integer' || p.type === 'float' || p.type === 'number') {
        levels = bvaBuckets(undefined, undefined);
      } else if (p.type === 'boolean') {
        levels = enumLevels([true, false]);
      } else {
        levels = [
          { value: '', role: 'empty' },
          { value: 'valid_example', role: 'typical' },
          { value: "'; DROP TABLE users;--", role: 'injection' },
          { value: null, role: 'invalid_or_null' }
        ];
      }
      out.push({
        name,
        kind: 'tool_param',
        levels,
        source: `${tool.name}.${p.name}`,
        description: p.description
      });
    }
  }
  return out;
}

export function parseInputs(input: TestSuiteInput): TestVariables {
  const factors: Factor[] = [];
  factors.push({ name: 'persona', kind: 'persona', levels: [...input.personas] });
  factors.push({ name: 'objective', kind: 'objective', levels: [...input.objectives] });
  for (const field of input.sandboxSchema.fields) {
    factors.push(factorFromStateField(field));
  }
  factors.push(...factorsFromTools(input.agentSpec.tools));
  return { factors };
}

// ---------------------------------------------------------------------------
// helpers used by matrix.ts
// ---------------------------------------------------------------------------

export function getValue(level: FactorLevel): any {
  if (level && typeof level === 'object' && 'value' in level) return level.value;
  return level;
}

export function levelLabel(level: FactorLevel): string {
  if (level && typeof level === 'object' && 'role' in level) {
    return `${JSON.stringify(level.value)} (${level.role})`;
  }
  return JSON.stringify(level);
}

/**
 * Synthesize CREATE TABLE DDL from a SandboxSchema's `fields` list when the
 * caller didn't provide raw DDL. Best-effort — supports the basic Postgres
 * types we need for hard-signal evaluation.
 */
export function ddlFromSchema(schema: { fields: StateField[]; ddlSql?: string }): string {
  if (schema.ddlSql && schema.ddlSql.trim()) return schema.ddlSql;
  const cols: string[] = ['id uuid PRIMARY KEY DEFAULT gen_random_uuid()'];
  for (const field of schema.fields) {
    cols.push(`${quoteIdent(field.name)} ${pgType(field)}`);
  }
  cols.push('created_at timestamptz NOT NULL DEFAULT now()');
  return `CREATE TABLE IF NOT EXISTS state (${cols.join(', ')});`;
}

function pgType(field: StateField): string {
  switch (field.type) {
    case 'enum':
    case 'string':
      return 'text';
    case 'boolean':
      return 'boolean';
    case 'integer':
      return 'integer';
    case 'float':
      return 'double precision';
    default:
      return 'text';
  }
}

function quoteIdent(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}
