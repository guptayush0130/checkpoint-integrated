import { PGlite } from '@electric-sql/pglite';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
  fields: Array<{ name: string; dataTypeID: number }>;
}

/**
 * Thin wrapper around PGlite that gives us a stable, test-friendly Postgres
 * surface. PGlite is real Postgres compiled to WASM, so SQL semantics match
 * a Supabase Docker container exactly for everything we need.
 */
export class MockDatabase {
  private db: PGlite;
  private ready: Promise<void>;

  constructor() {
    this.db = new PGlite();
    this.ready = this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    // PGlite ships Postgres 17, where `gen_random_uuid()` is available in
    // core. No extension setup required for our supported feature set.
  }

  async waitReady(): Promise<void> {
    await this.ready;
  }

  async query<T = any>(sql: string, params: any[] = []): Promise<QueryResult<T>> {
    await this.ready;
    const res = await this.db.query<T>(sql, params);
    return {
      rows: (res.rows as T[]) || [],
      rowCount: (res as any).affectedRows ?? (res.rows?.length ?? 0),
      fields: (res.fields as any) || []
    };
  }

  async exec(sql: string): Promise<void> {
    await this.ready;
    await this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: TxClient) => Promise<T>): Promise<T> {
    await this.ready;
    return this.db.transaction(async (tx) => {
      const wrapped: TxClient = {
        query: async (sql: string, params: any[] = []) => {
          const res = await tx.query(sql, params);
          return {
            rows: (res.rows as any[]) || [],
            rowCount: (res as any).affectedRows ?? (res.rows?.length ?? 0),
            fields: (res.fields as any) || []
          };
        },
        exec: async (sql: string) => {
          await tx.exec(sql);
        }
      };
      return fn(wrapped);
    }) as Promise<T>;
  }

  async listTables(schema = 'public'): Promise<string[]> {
    const res = await this.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = $1 ORDER BY tablename`,
      [schema]
    );
    return res.rows.map((row) => row.tablename);
  }

  async listColumns(table: string, schema = 'public'): Promise<ColumnInfo[]> {
    const res = await this.query<ColumnInfo>(
      `
        SELECT column_name as name, data_type as type, is_nullable as nullable, column_default as "default"
        FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = $2
        ORDER BY ordinal_position
      `,
      [schema, table]
    );
    return res.rows;
  }

  async listForeignKeys(): Promise<ForeignKey[]> {
    const res = await this.query<ForeignKey>(
      `
        SELECT
          tc.table_schema as table_schema,
          tc.table_name as table_name,
          kcu.column_name as column_name,
          ccu.table_schema as foreign_table_schema,
          ccu.table_name as foreign_table_name,
          ccu.column_name as foreign_column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
         AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
      `
    );
    return res.rows;
  }

  async listProcedures(schema = 'public'): Promise<ProcedureInfo[]> {
    const res = await this.query<ProcedureInfo>(
      `
        SELECT routine_name as name, data_type as return_type
        FROM information_schema.routines
        WHERE routine_schema = $1 AND routine_type = 'FUNCTION'
        ORDER BY routine_name
      `,
      [schema]
    );
    return res.rows;
  }

  async resetData(tables?: string[]): Promise<void> {
    const list = tables && tables.length ? tables : await this.listTables();
    if (!list.length) {
      return;
    }
    const quoted = list.map(quoteIdent).join(', ');
    await this.exec(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE;`);
  }

  async dropAll(): Promise<void> {
    await this.exec(`
      DO $$ DECLARE r record;
      BEGIN
        FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
          EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
        END LOOP;
      END $$;
    `);
  }

  async close(): Promise<void> {
    await this.db.close();
  }
}

export interface TxClient {
  query<T = any>(sql: string, params?: any[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: string;
  default: string | null;
}

export interface ForeignKey {
  table_schema: string;
  table_name: string;
  column_name: string;
  foreign_table_schema: string;
  foreign_table_name: string;
  foreign_column_name: string;
}

export interface ProcedureInfo {
  name: string;
  return_type: string;
}

export function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: any): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  if (typeof value === 'object') {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}
