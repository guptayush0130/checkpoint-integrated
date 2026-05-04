import { MockDatabase } from '@/sandbox/database';
import { SchemaSummary } from './types';

/**
 * Introspect the live mock DB so the auditor can ground test cases in the
 * actual user schema. We intentionally include row counts so the auditor
 * knows whether a "read existing data" case is even possible.
 */
export async function introspectSchema(
  db: MockDatabase,
  tables?: string[]
): Promise<SchemaSummary> {
  const tableNames = tables && tables.length ? tables : await db.listTables();
  const fks = await db.listForeignKeys();

  const result: SchemaSummary = {
    tables: [],
    foreignKeys: fks
      .filter((fk) => fk.table_schema === 'public' && fk.foreign_table_schema === 'public')
      .map((fk) => ({
        fromTable: fk.table_name,
        fromColumn: fk.column_name,
        toTable: fk.foreign_table_name,
        toColumn: fk.foreign_column_name
      }))
  };

  for (const table of tableNames) {
    const cols = await db.listColumns(table);
    const count = await db.query<{ count: string | number }>(
      `SELECT COUNT(*)::bigint AS count FROM ${quote(table)}`
    );
    result.tables.push({
      name: table,
      columns: cols.map((col) => ({
        name: col.name,
        type: col.type,
        nullable: col.nullable === 'YES'
      })),
      rowCount: Number(count.rows[0]?.count || 0)
    });
  }
  return result;
}

function quote(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * Pull real primary-key UUIDs from seeded tables so the auditor can replace
 * hallucinated invalid UUID tokens in user messages (common LLM mistake:
 * non-hex characters like `g7777777-7777-...`).
 */
export async function collectSampleUuids(db: MockDatabase, tables: string[]): Promise<string[]> {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const table of tables) {
    let cols;
    try {
      cols = await db.listColumns(table);
    } catch {
      continue;
    }
    const idCol = cols.find((c) => c.name === 'id');
    if (!idCol || !String(idCol.type || '').toLowerCase().includes('uuid')) continue;
    try {
      const r = await db.query<{ id: string }>(
        `SELECT id::text AS id FROM ${quote(table)} WHERE id IS NOT NULL LIMIT 8`
      );
      for (const row of r.rows || []) {
        const id = String(row.id || '').trim();
        if (!id || seen.has(id)) continue;
        if (!isStrictUuid(id)) continue;
        seen.add(id);
        out.push(id);
      }
    } catch {
      continue;
    }
  }
  return out;
}

/** Canonical UUID string check (hex groups only). */
export function isStrictUuid(s: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s);
}

/**
 * One representative seeded row per table — chosen so the auditor can build
 * personas that map to a real customer/user/etc. We deliberately pick the
 * FIRST row by created_at (or id) for stable, reproducible test cases.
 */
export interface SeedIdentity {
  table: string;
  /** Most-significant identifier columns (id, email, name, slug, …). */
  fields: Record<string, any>;
}

/**
 * Sample seeded data so the auditor can ground personas in real rows.
 * For each table we collect:
 *   - up to 5 "identity" rows (id + the most descriptive scalar columns),
 *   - distinct sample values for any text column whose name screams "human"
 *     (email, name, full_name, first_name, last_name, username, subject, title, slug).
 *
 * Returned shape stays compact (max ~5 rows × ~6 fields per table) so we don't
 * blow the auditor model's context window.
 */
export interface SeedSampleSummary {
  identities: SeedIdentity[];
  /** Per-table distinct sample values for human-meaningful columns. */
  byTable: Record<
    string,
    {
      identities: SeedIdentity[];
      sampleValues: Record<string, string[]>;
    }
  >;
}

const HUMAN_COLUMN_HINTS = [
  'email',
  'name',
  'full_name',
  'first_name',
  'last_name',
  'username',
  'handle',
  'subject',
  'title',
  'slug',
  'phone',
  'company',
  'company_name'
];

const IDENTITY_COLUMN_PREFERENCE = [
  'id',
  'email',
  'name',
  'full_name',
  'first_name',
  'last_name',
  'username',
  'subject',
  'title',
  'company_name',
  'status'
];

const MAX_ROWS_PER_TABLE = 5;
const MAX_DISTINCT_VALUES_PER_COLUMN = 6;

export async function collectSeedSamples(
  db: MockDatabase,
  tables: string[]
): Promise<SeedSampleSummary> {
  const summary: SeedSampleSummary = { identities: [], byTable: {} };

  for (const table of tables) {
    let cols;
    try {
      cols = await db.listColumns(table);
    } catch {
      continue;
    }
    const colNames = cols.map((c) => c.name);
    if (!colNames.length) continue;

    // 1) pick the most useful columns for an "identity" row.
    const identityCols = IDENTITY_COLUMN_PREFERENCE.filter((c) => colNames.includes(c));
    if (!identityCols.length) {
      identityCols.push(...colNames.slice(0, 3));
    }

    const orderClause = colNames.includes('created_at')
      ? 'ORDER BY created_at ASC'
      : colNames.includes('id')
        ? 'ORDER BY id ASC'
        : '';

    const selectList = identityCols.map(quote).join(', ');
    let identityRows: any[] = [];
    try {
      const r = await db.query(
        `SELECT ${selectList} FROM ${quote(table)} ${orderClause} LIMIT ${MAX_ROWS_PER_TABLE}`
      );
      identityRows = r.rows || [];
    } catch {
      identityRows = [];
    }

    const identities: SeedIdentity[] = identityRows.map((row: any) => {
      const fields: Record<string, any> = {};
      for (const col of identityCols) {
        if (row[col] === undefined || row[col] === null) continue;
        const v = row[col];
        // Stringify uuids and dates; keep numbers/booleans as-is.
        fields[col] = typeof v === 'object' ? String(v) : v;
      }
      return { table, fields };
    });

    // 2) collect distinct values for human-meaningful text columns
    const sampleValues: Record<string, string[]> = {};
    for (const hint of HUMAN_COLUMN_HINTS) {
      if (!colNames.includes(hint)) continue;
      try {
        const r = await db.query<{ v: string }>(
          `SELECT DISTINCT ${quote(hint)}::text AS v FROM ${quote(table)} WHERE ${quote(
            hint
          )} IS NOT NULL LIMIT ${MAX_DISTINCT_VALUES_PER_COLUMN}`
        );
        const values = (r.rows || [])
          .map((row) => String(row.v ?? '').trim())
          .filter(Boolean);
        if (values.length) sampleValues[hint] = values;
      } catch {
        // skip unreadable columns
      }
    }

    summary.identities.push(...identities);
    summary.byTable[table] = { identities, sampleValues };
  }

  return summary;
}
