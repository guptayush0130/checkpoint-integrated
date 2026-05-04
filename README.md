# Checkpoint

> Black-box AI agent test harness. We act as the user *and* the database, so production agents can be stress-tested without ever knowing they're under test.

Checkpoint drives an external agent through two integration points:

- **URL 1** — the target agent's text endpoint. Our **Tester** (MCTS-driven, search-guided over a 3-way combinatorial matrix of personas × objectives × DB-state factors) sends prompts here and reads replies.
- **URL 2** — our exposed Supabase-compatible HTTP surface. The target's `createClient(URL, KEY)` is configured to point at us. Every PostgREST/Auth/Storage call the agent makes is intercepted, executed against in-process Postgres (PGlite), and returned in the exact shape Supabase would return.

The target's code is unchanged from production. It cannot detect the harness.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the full design and the Phase 0 → Phase 5 trajectory.

---

## Status: Phase 5 (all phases shipped)

All five phases are in. The dashboard at `/engine` drives the full pipeline against an external target.

| Phase | Status | What landed |
| --- | --- | --- |
| 0 — Foundation | ✅ | New `/ui`, `/core_engine`, `/sandbox`, `/api_clients` layout; legacy code archived |
| 1 — Sandbox proxy | ✅ | Per-run sandbox pool, intercept-event SSE, password/JWT redaction |
| 2 — URL 1 client | ✅ | `TargetClient` with default / openai-chat / custom profiles + auth + timeout |
| 3 — MCTS engine | ✅ | parsing → matrix → tester → evaluator → MCTS (replay-from-root) → orchestrator |
| 4 — Dashboard UI | ✅ | New-run wizard, live matrix view, recursive MCTS tree, intercepted-call panel |
| 5 — Polish | ✅ | Mermaid sequence diagrams in [`ARCHITECTURE.md`](./ARCHITECTURE.md), deployment notes, real-Supabase backend stub |

---

## Quick start

```bash
npm install
cp .env.example .env             # add OPENAI_API_KEY (optional — engine has offline mocks)
npm run dev                       # http://localhost:3000

# Then open http://localhost:3000/engine and launch a run against your
# external target agent. The default profile expects a POST to {target_url}
# with body { conversation_id, user_message } returning { response, done }.
```

### What works today

- The Next.js dashboard boots; `/engine` loads with demo data pre-filled.
- `POST /api/engine/runs` accepts a full engine config and kicks off an MCTS run.
- `GET /api/engine/runs/[id]/events` streams every event live (sandbox intercepts, MCTS expansion, judge verdicts).
- The PGlite-backed sandbox boots in milliseconds; target's `createClient(URL, KEY)` against URL 2 is indistinguishable from production Supabase.
- Hard-signal predicates short-circuit verdicts when the target writes to specific tables.
- Reports persist to `data/runs/<id>.{json,events.jsonl,report.md}`.

### Test suite

```bash
npm run test:sandbox             # Phase 1: 7 tests
npx ts-node --project tsconfig.cli.json -r tsconfig-paths/register tests/target_client.test.ts   # Phase 2: 14 tests
npx ts-node --project tsconfig.cli.json -r tsconfig-paths/register tests/engine_e2e.test.ts      # Phase 3: e2e against a fixture target
```

### Known scope gaps (intentional — out of MVP)

- Real-Supabase backend is a stub at `sandbox/real_supabase.ts`; throws on `setup()` until you implement per-run schema isolation.
- `tools/legacy/` and `tests/legacy/` are excluded from the build — they referenced the removed snapshot/diff API.
- The legacy `/runs` and `/agents` UI still works as agent/schema CRUD but the run runner there is the embedded-target Mark1 path; it now throws "Phase 3" if you click Launch. Use `/engine` instead.

---

## Repo layout (top-level)

```
app/             Next.js routes (UI pages + thin API handlers)
ui/              React components
core_engine/     Pure logic — types, judge, MCTS (Phase 3), tester, evaluator
sandbox/         PGlite + PostgREST/Auth/Storage HTTP shim ("URL 2")
api_clients/     External-service HTTP clients (URL 1 lives here in Phase 2)
lib/             Shared utilities — types, storage, formatters
tests/           Integration tests (legacy under tests/legacy/)
tools/           CLI utilities (legacy under tools/legacy/)
predefined/      Built-in agent definitions
examples/        Reference DDL + agent
data/            Runtime — agents, schemas, runs (gitignored)
legacy_python/   Archived Python+FastAPI v0.1 — reference only
```

Each engine directory has its own `README.md` describing its surface and Phase trajectory.

---

## License

MIT
