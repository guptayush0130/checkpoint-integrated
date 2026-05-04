/**
 * Sandbox public surface — the in-process Supabase replica that target
 * agents talk to as "URL 2".
 *
 * The sandbox is the only stateful component the framework owns. Anything
 * that reads or mutates DB state (the target agent, the evaluator) goes
 * through here. The MCTS engine in core_engine/ orchestrates reset() +
 * conversation replay between iterations.
 */
export { MockDatabase, quoteIdent } from './database';
export { PostgrestHandler } from './postgrest';
export { AuthHandler } from './auth';
export { StorageHandler } from './storage';
export { MockSupabaseServer } from './server';
export type { SandboxInterceptEvent } from './server';
export { SandboxInstance } from './instance';
export type {
  SandboxOptions,
  RuntimeEnv,
  SchemaInput,
  SeedInput,
  StorageBucketSeed
} from './instance';
