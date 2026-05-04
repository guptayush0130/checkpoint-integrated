/**
 * SQL validation + repair pipeline for generated schemas and seed data.
 *
 * The LLM is good at sketching realistic schemas, but its output frequently:
 *   - emits UUID literals with non-hex characters (g, h, i, …),
 *   - duplicates `INSERT` statements with the same UNIQUE column values,
 *   - reorders FK-dependent inserts incorrectly.
 *
 * This module runs every generated artifact through a real Postgres (PGlite) so
 * we catch any constraint violation before it hits a run, then attempts a
 * bounded LLM-driven repair using the actual Postgres error message as the
 * grounding signal.
 */
import { MockDatabase } from './database';
import { OpenAIResponsesClient } from '@/core/openai_client';
import { parseJsonValue } from '@/core/json_utils';

/**
 * Maps non-hex letters to a deterministic hex digit so FK references that
 * share an invalid UUID before sanitization still match afterwards.
 */
const HEX_REPAIR: Record<string, string> = {
  g: '0', h: '1', i: '2', j: '3', k: '4', l: '5', m: '6', n: '7',
  o: '8', p: '9', q: 'a', r: 'b', s: 'c', t: 'd', u: 'e', v: 'f',
  w: '0', x: '1', y: '2', z: '3'
};

const UUID_TOKEN =
  /\b([0-9a-zA-Z]{8})-([0-9a-zA-Z]{4})-([0-9a-zA-Z]{4})-([0-9a-zA-Z]{4})-([0-9a-zA-Z]{12})\b/g;

const STRICT_HEX = /^[0-9a-f]+$/;

/**
 * Replaces UUID-shaped tokens with non-hex chars by deterministic valid hex.
 * Tokens that are already valid hex are lowercased but otherwise untouched, so
 * any FK that previously referenced an invalid UUID resolves to the same
 * sanitized literal as the inserted row.
 */
export function sanitizeUuidLiterals(sql: string): string {
  if (!sql) return sql;
  return sql.replace(UUID_TOKEN, (match: string, ...rest: any[]) => {
    const segs = rest.slice(0, 5).map((s) => String(s));
    const lowered = segs.map((s) => s.toLowerCase());
    const allHex = lowered.every((s) => STRICT_HEX.test(s));
    if (allHex) return lowered.join('-');
    return lowered
      .map((seg) =>
        seg
          .split('')
          .map((c) => (STRICT_HEX.test(c) ? c : HEX_REPAIR[c] ?? '0'))
          .join('')
      )
      .join('-');
  });
}

export interface SqlValidationFailure {
  ok: false;
  error: string;
  phase: 'ddl' | 'seed';
}

export interface SqlValidationSuccess {
  ok: true;
}

export type SqlValidationResult = SqlValidationSuccess | SqlValidationFailure;

/**
 * Boots a throwaway PGlite, applies DDL then seed, and reports the first
 * Postgres error encountered (with the phase that produced it).
 */
export async function validateSql(
  ddlSql: string,
  seedSql: string
): Promise<SqlValidationResult> {
  const db = new MockDatabase();
  try {
    await db.waitReady();
    if (ddlSql && ddlSql.trim()) {
      try {
        await db.exec(ddlSql);
      } catch (err: any) {
        return { ok: false, phase: 'ddl', error: err?.message || String(err) };
      }
    }
    if (seedSql && seedSql.trim()) {
      try {
        await db.exec(seedSql);
      } catch (err: any) {
        return { ok: false, phase: 'seed', error: err?.message || String(err) };
      }
    }
    return { ok: true };
  } finally {
    try {
      await db.close();
    } catch {
      // best-effort
    }
  }
}

const REPAIR_DDL_INSTRUCTIONS = [
  'You repair Postgres DDL. Reply ONLY with JSON: { "ddlSql": "..." }.',
  'Constraints:',
  '- Use `CREATE TABLE IF NOT EXISTS` only.',
  '- Do not create extensions; `gen_random_uuid()` is built in (Postgres 13+).',
  '- Each table must have an `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` and `created_at timestamptz DEFAULT now()`.',
  '- Resolve the reported error directly; do not invent unrelated changes.',
  '- No commentary, no markdown.'
].join('\n');

const REPAIR_SEED_INSTRUCTIONS = [
  'You repair Postgres seed data so it loads without errors.',
  'Reply ONLY with JSON: { "seedSql": "..." }.',
  'Hard constraints:',
  '- Output INSERT statements only — no DDL, no DROP, no comments suggesting alternatives.',
  '- UUID literals MUST be valid hex only [0-9a-f]; format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.',
  '- Honor every UNIQUE / PRIMARY KEY constraint — do not duplicate values across rows.',
  '- Honor foreign keys: any referenced UUID must appear as the `id` of a row inserted earlier in this same script.',
  '- Insert parents before children (e.g. customers before orders before refunds).',
  '- Do NOT include duplicate INSERT blocks for the same logical row set.',
  '- Quote text with single quotes; escape inner quotes by doubling them.'
].join('\n');

export async function repairDdlViaLLM(
  ddlSql: string,
  errorMessage: string,
  model = 'gpt-5-nano'
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const client = new OpenAIResponsesClient();
    const res = await client.createResponse({
      model,
      instructions: REPAIR_DDL_INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: `Current DDL:\n${ddlSql}\n\nPostgres error:\n${errorMessage}\n\nReturn corrected ddlSql JSON.`
        }
      ],
      max_output_tokens: 6000,
      reasoning_effort: 'minimal',
      json_mode: true
    });
    const parsed = parseJsonValue(res.outputText);
    if (!parsed?.ddlSql) return null;
    return String(parsed.ddlSql);
  } catch {
    return null;
  }
}

export async function repairSeedViaLLM(
  ddlSql: string,
  seedSql: string,
  errorMessage: string,
  model = 'gpt-5-nano'
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const client = new OpenAIResponsesClient();
    const res = await client.createResponse({
      model,
      instructions: REPAIR_SEED_INSTRUCTIONS,
      input: [
        {
          role: 'user',
          content: [
            'DDL (authoritative — match column names and constraints exactly):',
            ddlSql,
            '',
            'Current (broken) seed SQL:',
            seedSql,
            '',
            'Postgres error when loading the seed:',
            errorMessage,
            '',
            'Return corrected seedSql JSON.'
          ].join('\n')
        }
      ],
      max_output_tokens: 8000,
      reasoning_effort: 'minimal',
      json_mode: true
    });
    const parsed = parseJsonValue(res.outputText);
    if (!parsed?.seedSql) return null;
    return String(parsed.seedSql);
  } catch {
    return null;
  }
}

export interface ValidateAndRepairOptions {
  /** Number of LLM repair attempts on top of the initial validation. */
  maxAttempts?: number;
  model?: string;
  onAttempt?: (info: {
    phase: 'ddl' | 'seed';
    attempt: number;
    error: string;
    repaired: boolean;
  }) => void;
}

export interface ValidateAndRepairResult {
  ddlSql: string;
  seedSql: string;
  valid: boolean;
  /** Final Postgres error message if `valid` is false. */
  error?: string;
  /** Number of LLM repair calls actually performed. */
  repairAttempts: number;
  /** True if sanitization changed the input UUID literals. */
  sanitized: boolean;
}

/**
 * Validates a (ddl, seed) pair against PGlite. On failure runs at most
 * `maxAttempts` LLM repair passes, re-validating after each one.
 */
export async function validateAndRepair(
  input: { ddlSql: string; seedSql: string },
  opts: ValidateAndRepairOptions = {}
): Promise<ValidateAndRepairResult> {
  const maxAttempts = opts.maxAttempts ?? 2;
  const model = opts.model ?? 'gpt-5-nano';

  const sanitizedDdl = sanitizeUuidLiterals(input.ddlSql || '');
  const sanitizedSeed = sanitizeUuidLiterals(input.seedSql || '');
  const sanitized =
    sanitizedDdl !== input.ddlSql || sanitizedSeed !== input.seedSql;

  let ddlSql = sanitizedDdl;
  let seedSql = sanitizedSeed;
  let repairAttempts = 0;
  let lastError: string | undefined;

  for (let attempt = 0; attempt <= maxAttempts; attempt++) {
    const result = await validateSql(ddlSql, seedSql);
    if (result.ok) {
      return { ddlSql, seedSql, valid: true, repairAttempts, sanitized };
    }
    lastError = result.error;
    if (attempt === maxAttempts) {
      opts.onAttempt?.({
        phase: result.phase,
        attempt: attempt + 1,
        error: result.error,
        repaired: false
      });
      break;
    }
    const repaired =
      result.phase === 'ddl'
        ? await repairDdlViaLLM(ddlSql, result.error, model)
        : await repairSeedViaLLM(ddlSql, seedSql, result.error, model);
    repairAttempts++;
    opts.onAttempt?.({
      phase: result.phase,
      attempt: attempt + 1,
      error: result.error,
      repaired: Boolean(repaired)
    });
    if (!repaired) break;
    if (result.phase === 'ddl') ddlSql = sanitizeUuidLiterals(repaired);
    else seedSql = sanitizeUuidLiterals(repaired);
  }

  return {
    ddlSql,
    seedSql,
    valid: false,
    error: lastError,
    repairAttempts,
    sanitized
  };
}
