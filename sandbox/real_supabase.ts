/**
 * Real-Supabase backend (Phase 5 stub).
 *
 * Drop-in replacement for `SandboxInstance` that talks to a real cloud
 * Supabase project instead of in-process PGlite. The contract matches
 * `instance.ts` exactly so the orchestrator can swap implementations via a
 * config flag without any changes to the engine.
 *
 * **Not yet implemented** — `setup()` throws. Switch on this backend once:
 *   - we have a story for per-run isolated namespaces (one Postgres schema
 *     per run, dropped on teardown)
 *   - tool-call interception on cloud Supabase (the proxy must remain in
 *     front; clients should be configured to point at our shim, which then
 *     forwards to cloud Supabase rather than PGlite)
 *   - a fast reset path (truncate every table inside the run's schema)
 *
 * Use:
 *   process.env.CHECKPOINT_SANDBOX_BACKEND = 'real-supabase'
 *   process.env.CHECKPOINT_SUPABASE_URL = 'https://<project>.supabase.co'
 *   process.env.CHECKPOINT_SUPABASE_SERVICE_KEY = '<service-role-key>'
 */

import type { RuntimeEnv, SandboxOptions } from './instance';

export interface RealSupabaseConfig {
  /** e.g. https://xyz.supabase.co */
  baseUrl: string;
  /** Service-role JWT — needed for DDL and per-run schema management. */
  serviceRoleKey: string;
  /** Anon key handed to the target agent. */
  anonKey: string;
}

export class RealSupabaseSandbox {
  constructor(_cfg: RealSupabaseConfig, _opts: SandboxOptions = {}) {
    // intentionally empty; this is a stub.
  }

  async setup(): Promise<RuntimeEnv> {
    throw new Error(
      'RealSupabaseSandbox is not implemented. Phase 0–4 ships PGlite-only ' +
        '(see sandbox/instance.ts). Open an issue when you need real-Supabase ' +
        'mode and we’ll prioritize the schema-isolation + interception-shim work.'
    );
  }

  async reset(): Promise<void> {
    throw new Error('RealSupabaseSandbox not implemented');
  }

  async teardown(): Promise<void> {
    throw new Error('RealSupabaseSandbox not implemented');
  }

  runtimeEnv(): RuntimeEnv {
    throw new Error('RealSupabaseSandbox not implemented');
  }
}

/**
 * The orchestrator will call this in Phase 5+. For now it returns the
 * PGlite-backed `SandboxInstance` from `./instance` regardless of env.
 */
export function pickBackend(): 'pglite' | 'real-supabase' {
  if (process.env.CHECKPOINT_SANDBOX_BACKEND === 'real-supabase') {
    return 'real-supabase';
  }
  return 'pglite';
}
