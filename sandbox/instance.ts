/**
 * SandboxInstance — top-level lifecycle for the in-process Supabase sandbox.
 *
 * Boots a real Postgres (PGlite) behind a hand-rolled PostgREST/Auth/Storage
 * HTTP shim. The target agent's `createClient(URL, KEY)` points here as
 * "URL 2"; every query the target makes is intercepted, executed against
 * PGlite, and returned in PostgREST shape. The target cannot tell it isn't
 * talking to real Supabase.
 *
 * Phase 0 contract:
 *   - `setup()` — start the HTTP server, apply DDL + seed once.
 *   - `reset()` — TRUNCATE all tables and re-apply the seed (used by the MCTS
 *     replay-from-root loop in core_engine; called once per iteration before
 *     the conversation is replayed).
 *   - `teardown()` — drop all tables and shut down the HTTP server.
 *
 * Snapshot/restore semantics were removed in Phase 0 by design: we cannot
 * snapshot the external target agent's internal state, so we don't pretend
 * we can snapshot ours. State recovery is via reset + replay, not snapshots.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { MockDatabase } from './database';
import { AuthHandler } from './auth';
import { StorageHandler } from './storage';
import { MockSupabaseServer, SandboxInterceptEvent } from './server';

export interface SchemaInput {
  /** Path to a SQL file with DDL + optional seed data. */
  file?: string;
  /** Inline SQL string (DDL + optional seed data). */
  sql?: string;
}

export interface SeedInput {
  file?: string;
  sql?: string;
}

export interface StorageBucketSeed {
  name: string;
  public?: boolean;
  files?: Array<{ path: string; body: string | Buffer; contentType?: string }>;
}

export interface SandboxOptions {
  /** SQL DDL/DML applied once on `setup()`. */
  schema?: SchemaInput | SchemaInput[];
  /** SQL DML applied after schema and on every `reset()`. */
  seed?: SeedInput | SeedInput[];
  /** Storage buckets/files to provision and re-create on `reset()`. */
  storage?: StorageBucketSeed[];
  /** HTTP port (0 = random open port). */
  port?: number;
  /** Hostname (default 127.0.0.1). */
  host?: string;
  /** Optional human label. */
  name?: string;
  /**
   * Per-request interception callback. Wired into the underlying http.Server
   * by `setup()`. Used by the run pool to fan out tool-call events to SSE
   * subscribers and to record full transcripts for the dashboard.
   */
  onIntercept?: (event: SandboxInterceptEvent) => void;
}

export interface RuntimeEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

export class SandboxInstance {
  readonly db: MockDatabase;
  readonly auth: AuthHandler;
  readonly storage: StorageHandler;
  readonly server: MockSupabaseServer;
  private schemaSqls: string[] = [];
  private seedSqls: string[] = [];
  private storageSeeds: StorageBucketSeed[];
  private port?: number;
  private host?: string;
  private url: string | null = null;
  private started = false;

  constructor(private opts: SandboxOptions = {}) {
    this.db = new MockDatabase();
    this.auth = new AuthHandler(opts.name || 'default');
    this.storage = new StorageHandler();
    this.server = new MockSupabaseServer(this.db, this.auth, this.storage);
    this.storageSeeds = opts.storage || [];
    this.port = opts.port;
    this.host = opts.host;
  }

  /** Start the HTTP server, apply schema + seed + storage. Idempotent. */
  async setup(): Promise<RuntimeEnv> {
    if (this.started) {
      return this.runtimeEnv();
    }
    if (this.opts.onIntercept) this.server.setInterceptor(this.opts.onIntercept);
    this.url = await this.server.start({ port: this.port, host: this.host });
    await this.db.waitReady();

    this.schemaSqls = await loadSqlInputs(this.opts.schema);
    this.seedSqls = await loadSqlInputs(this.opts.seed);

    for (const sql of this.schemaSqls) {
      if (sql.trim()) await this.db.exec(sql);
    }
    for (const sql of this.seedSqls) {
      if (sql.trim()) await this.db.exec(sql);
    }
    this.applyStorageSeeds();

    this.started = true;
    return this.runtimeEnv();
  }

  /**
   * Wipe all DB rows and re-apply seeds. DDL is preserved.
   *
   * This is the primitive the MCTS replay-from-root loop calls before
   * replaying a conversation: rewind data state without paying the full
   * server-restart cost.
   */
  async reset(): Promise<void> {
    if (!this.started) {
      await this.setup();
      return;
    }
    const tables = await this.db.listTables();
    if (tables.length) {
      await this.db.resetData(tables);
    }
    for (const sql of this.seedSqls) {
      if (sql.trim()) await this.db.exec(sql);
    }
    this.storage.reset();
    this.applyStorageSeeds();
  }

  /** Drop all tables and shut down. */
  async teardown(): Promise<void> {
    try {
      await this.db.dropAll();
    } catch {
      // best-effort
    }
    await this.server.stop();
    await this.db.close();
    this.started = false;
    this.url = null;
  }

  /**
   * Update or clear the per-request interception callback. Used by the
   * pool when a new SSE subscriber attaches mid-run.
   */
  setInterceptor(fn: ((event: SandboxInterceptEvent) => void) | undefined): void {
    this.server.setInterceptor(fn);
  }

  runtimeEnv(): RuntimeEnv {
    if (!this.url) throw new Error('SandboxInstance not started');
    return {
      SUPABASE_URL: this.url,
      SUPABASE_ANON_KEY: this.auth.anonKey,
      SUPABASE_SERVICE_ROLE_KEY: this.auth.serviceRoleKey
    };
  }

  private applyStorageSeeds() {
    for (const bucket of this.storageSeeds) {
      this.storage.ensureBucket(bucket.name, bucket.public);
      for (const file of bucket.files || []) {
        this.storage.handle({
          method: 'POST',
          path: `object/${bucket.name}/${file.path}`,
          headers: { 'content-type': file.contentType || 'application/octet-stream' },
          body: typeof file.body === 'string' ? Buffer.from(file.body) : file.body,
          query: new URLSearchParams()
        });
      }
    }
  }
}

async function loadSqlInputs(input?: SchemaInput | SchemaInput[]): Promise<string[]> {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  const out: string[] = [];
  for (const item of list) {
    if (item.sql) out.push(item.sql);
    if (item.file) {
      const resolved = path.resolve(item.file);
      const sql = await fs.readFile(resolved, 'utf8');
      out.push(sql);
    }
  }
  return out;
}
