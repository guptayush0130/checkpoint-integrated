# sandbox/

The in-process Supabase replica. **This is "URL 2"** in the Checkpoint architecture — the HTTP surface the target agent's `createClient(URL, KEY)` points at.

## How it works

PGlite (Postgres-in-WASM) is the truth store. A hand-rolled Node `http.Server` listens on `127.0.0.1:<auto>` and serves three subtrees:

- `/rest/v1/*` → PostgREST translation in `postgrest.ts` (filters, prefer headers, count, upsert, rpc, FTS, JSON ops)
- `/auth/v1/*` → JWT-based mock in `auth.ts` (signup, signin, refresh, user)
- `/storage/v1/*` → in-memory bucket/object store in `storage.ts`

The target agent's `@supabase/supabase-js` cannot tell the difference from production for the supported feature surface (see `tests/mock.test.ts`).

## Public surface

```ts
import { SandboxInstance } from '@/sandbox';

const sandbox = new SandboxInstance({ schema: { sql: ddl }, seed: { sql: seed } });
const env = await sandbox.setup();          // env.SUPABASE_URL is URL 2
// ... target agent uses env to talk to us ...
await sandbox.reset();                       // wipe + reseed for next MCTS iteration
await sandbox.teardown();
```

## Phase 0 changes from Mark1

- Renamed `MockSupabaseInstance` → `SandboxInstance`. The "mock" framing was misleading: the engine is real Postgres, real PostgREST semantics. It's a sandbox, not a mock.
- Removed `snapshot()`, `diff()`, `snapshotTables`, and all before/after diff machinery. The MCTS engine in `core_engine/` recovers state via `reset()` + conversation replay-from-root, never via snapshots.
- `database.ts` lost its `snapshot()` method for the same reason. `resetData()` (TRUNCATE + RESTART IDENTITY CASCADE) is the only state-mutation primitive used by the engine.
- `sql_validate.ts` moved here from `lib/` — it's a sandbox-side concern (does this DDL/seed actually load into PGlite?).

## Phase 3 plans

- **Tool-call interception telemetry.** The `MockSupabaseServer` will tee every PostgREST request into an SSE stream at `app/api/runs/[id]/sandbox-events` so the UI can render "the target agent just called `select * from users where id=…`" in real-time.
- **Per-run isolated instance.** Currently each run boots a fresh PGlite. Phase 3 will keep a process-global pool keyed by `(ddl_hash, seed_hash)` to avoid PGlite warmup costs for back-to-back runs of the same schema.
