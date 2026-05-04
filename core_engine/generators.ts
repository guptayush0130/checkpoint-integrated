/**
 * LLM-backed authoring helpers.
 *
 * - `generateSchemaFromDescription` writes idempotent Postgres DDL.
 * - `generateSeedSql` produces realistic INSERT statements at the requested
 *   density.
 * - `suggestToolImplementation` proposes a declarative tool spec given a user
 *   description and the current schema.
 *
 * Generation is gated by `validateAndRepair` from `lib/sql-validate.ts`: we
 * dry-run the produced SQL against PGlite and re-prompt the model with the
 * actual Postgres error if it fails, so callers always receive SQL that is
 * proven to load on the same engine the run sandbox uses.
 *
 * All helpers fail soft — they return `null` if the LLM call errors out or the
 * SQL cannot be repaired within the attempt budget.
 */

import type { DataDensity } from '@/lib/types';
import { OpenAIResponsesClient } from './openai_client';
import { parseJsonValue } from './json_utils';
import { validateAndRepair, validateSql, sanitizeUuidLiterals } from '@/sandbox/sql_validate';

export const DENSITY_HINTS: Record<DataDensity, string> = {
  sparse: '3-5 rows per table; just enough to exercise basic flows.',
  medium: '20-50 rows per table; include realistic variety in columns.',
  dense: '100-200 rows per table; reflect real-world distributions and edge cases.',
  custom: '50 rows per table by default; balance variety and runtime.'
};

const SCHEMA_PROMPT = [
  'You are a senior Postgres engineer designing a schema for a Supabase project.',
  'Reply ONLY with JSON: { "ddlSql": "...", "seedSql": "..." }. No markdown, no commentary.',
  '',
  'DDL rules:',
  '- Use `CREATE TABLE IF NOT EXISTS` only.',
  '- Every table has `id uuid PRIMARY KEY DEFAULT gen_random_uuid()` and `created_at timestamptz DEFAULT now()`.',
  '- Do NOT create extensions; `gen_random_uuid()` is built in (Postgres 13+).',
  '- Use lower_snake_case for table and column names.',
  '',
  'Seed rules (these are non-negotiable — violating them breaks the run):',
  '- INSERT statements only. Never include DDL, comments, or "we will replace" notes.',
  '- UUID literals MUST be valid hex only [0-9a-f]; format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.',
  '- Honor every UNIQUE / PRIMARY KEY constraint — every email, slug, etc. must be distinct across rows.',
  '- Insert parents before children. Foreign-key UUIDs must match an `id` you inserted earlier in the same script.',
  '- One INSERT per logical row set; do not re-insert the same rows under different IDs.',
  '- Quote text with single quotes; escape inner quotes by doubling them.'
].join('\n');

const SEED_PROMPT_PREFIX = [
  'You are a senior Postgres engineer producing realistic seed data as INSERT statements.',
  'Reply ONLY with JSON: { "seedSql": "..." }. No markdown.',
  '',
  'Hard constraints:',
  '- INSERT statements only — no DDL, no DROP, no comments suggesting alternatives.',
  '- Match the existing schema exactly: column names, types, constraints.',
  '- UUID literals MUST be valid hex only [0-9a-f]; format `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.',
  '- Honor every UNIQUE / PRIMARY KEY constraint — never duplicate values across rows.',
  '- Honor foreign keys: any referenced UUID must appear as the `id` of a row inserted earlier in this script.',
  '- Insert parents before children. One INSERT per logical row set; do not duplicate INSERT blocks.',
  '- Quote text with single quotes; escape inner quotes by doubling them.'
].join('\n');

export async function generateSchemaFromDescription(
  description: string,
  model = 'gpt-5-nano'
): Promise<{ ddlSql: string; seedSql: string } | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const client = new OpenAIResponsesClient();
    const res = await client.createResponse({
      model,
      instructions: SCHEMA_PROMPT,
      input: [
        {
          role: 'user',
          content: `Generate a Postgres schema as JSON for: ${description}\n\nReturn JSON only.`
        }
      ],
      max_output_tokens: 6000,
      reasoning_effort: 'minimal',
      json_mode: true
    });
    const parsed = parseJsonValue(res.outputText);
    if (!parsed?.ddlSql) return null;
    const validated = await validateAndRepair(
      { ddlSql: String(parsed.ddlSql), seedSql: String(parsed.seedSql || '') },
      { model }
    );
    if (!validated.valid) return null;
    return { ddlSql: validated.ddlSql, seedSql: validated.seedSql };
  } catch {
    return null;
  }
}

export async function generateSeedSql(
  ddlSql: string,
  density: DataDensity,
  model = 'gpt-5-nano'
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const client = new OpenAIResponsesClient();
    const res = await client.createResponse({
      model,
      instructions: `${SEED_PROMPT_PREFIX}\n\nVolume target: ${DENSITY_HINTS[density]}`,
      input: [
        {
          role: 'user',
          content: `Schema DDL:\n\n${ddlSql}\n\nGenerate seed data as JSON.`
        }
      ],
      max_output_tokens: 8000,
      reasoning_effort: 'minimal',
      json_mode: true
    });
    const parsed = parseJsonValue(res.outputText);
    if (!parsed?.seedSql) return null;
    const validated = await validateAndRepair(
      { ddlSql, seedSql: String(parsed.seedSql) },
      { model }
    );
    if (!validated.valid) return null;
    return validated.seedSql;
  } catch {
    return null;
  }
}

/**
 * Sanitize + validate (and optionally LLM-repair) a previously persisted
 * schema record. Used by the run orchestrator to ensure a run never boots
 * against SQL that is known not to load.
 */
export async function ensureSchemaIsLoadable(
  ddlSql: string,
  seedSql: string,
  model = 'gpt-5-nano'
): Promise<{
  ddlSql: string;
  seedSql: string;
  valid: boolean;
  error?: string;
  changed: boolean;
  repairAttempts: number;
}> {
  const sanitized = {
    ddlSql: sanitizeUuidLiterals(ddlSql || ''),
    seedSql: sanitizeUuidLiterals(seedSql || '')
  };
  const quick = await validateSql(sanitized.ddlSql, sanitized.seedSql);
  if (quick.ok) {
    const changed =
      sanitized.ddlSql !== (ddlSql || '') || sanitized.seedSql !== (seedSql || '');
    return {
      ddlSql: sanitized.ddlSql,
      seedSql: sanitized.seedSql,
      valid: true,
      changed,
      repairAttempts: 0
    };
  }
  const result = await validateAndRepair(sanitized, { model });
  const changed =
    result.ddlSql !== (ddlSql || '') || result.seedSql !== (seedSql || '');
  return {
    ddlSql: result.ddlSql,
    seedSql: result.seedSql,
    valid: result.valid,
    error: result.error,
    changed,
    repairAttempts: result.repairAttempts
  };
}

export async function suggestToolImplementation(
  description: string,
  ddlSql: string,
  model = 'gpt-5-nano'
): Promise<any | null> {
  if (!process.env.OPENAI_API_KEY) return null;
  try {
    const client = new OpenAIResponsesClient();
    const res = await client.createResponse({
      model,
      instructions: [
        'You design declarative Supabase tool specs. Reply ONLY with JSON.',
        'Schema for the JSON object:',
        `{ "name": "kebab-case", "description": "...", "parameters": { "<key>": { "type": "string|number|boolean|object|array", "description": "...", "required": true|false } }, "implementation": { "kind": "select|insert|update|delete|upsert|rpc", "table": "...", "columns": "...", "filters": [{ "column": "...", "op": "eq|neq|gt|gte|lt|lte|like|ilike|in|is", "value": "{{params.x}}" }], "values": { "col": "{{params.x}}" }, "single": true, "limit": 50, "orderBy": "created_at", "orderAsc": false } }`,
        'Use `{{params.x}}` to bind to call arguments. Only reference real columns from the supplied DDL.',
        'No commentary, just the JSON object.'
      ].join('\n'),
      input: [
        {
          role: 'user',
          content: `Schema DDL:\n${ddlSql}\n\nDesired tool: ${description}\n\nReturn the JSON tool spec.`
        }
      ],
      max_output_tokens: 4000,
      reasoning_effort: 'minimal',
      json_mode: true
    });
    return parseJsonValue(res.outputText) || null;
  } catch {
    return null;
  }
}
