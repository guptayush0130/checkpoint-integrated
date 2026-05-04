# Checkpoint

> Ship the agent. Not the incident.

Checkpoint is the test layer for AI agents. It generates a structured test suite for your Supabase agent — happy paths, edge cases, adversarial prompts, policy boundaries — runs it inside a synthetic in-process Supabase environment, and scores every trace with an LLM judge. Find every failure before a customer does.

This repository is a self-contained, local-first MVP that runs entirely on your laptop:

- A **Next.js web app** for authoring agents and schemas, launching runs, and reading reports.
- An **in-process Supabase mock** (PGlite + PostgREST/Auth/Storage shims) — zero external dependencies.
- An **agent audit harness** (auditor → target → judge) that you can drive from the UI or the CLI.
- Fully declarative tool definitions that compile into real `@supabase/supabase-js` calls, so anything Supabase can express can be tested.

## Quick start

```bash
npm install
cp .env.example .env             # Add your OPENAI_API_KEY
npm run dev                       # http://localhost:3000
```

Open the dashboard, create a schema, define an agent, then launch a run.

### Built-in agents

Three ready-made agents ship under `predefined/agents/` and appear automatically in **Agents** with a **Built-in** badge:

| Agent | Use with schema template |
|-------|---------------------------|
| Test management assistant | **Test management baseline** |
| Customer support assistant | **Customer support agent** |
| CRM workspace assistant | **Workspace CRM** |

Pair the matching template on **Schemas → New schema** (quick-start cards), then start a run from **Runs → New run**.

## What you get

### Web app (`npm run dev`)

| Path | What it does |
|------|--------------|
| `/` | Dashboard with recent runs, KPIs, and three-step onboarding |
| `/agents` | List, create, and edit custom agents (system prompt + declarative tool catalog + model settings) |
| `/schemas` | List, create, and edit Postgres DDL + seed data baselines (with density controls and AI generation) |
| `/runs/new` | Four-step wizard: pick agent → attach schema → choose test count → launch |
| `/runs/[id]` | **Live telemetry**: sandbox boot, tool calls, judge scores, plus a per-test scorecard once finished |

The visual identity follows [usecheckpoint.dev](https://usecheckpoint.dev/): warm cream backdrop, Instrument Serif headlines, Inter body, JetBrains Mono code, refined rust accents, editorial section markers (`§ 001`, `Fig. 01`).

### CLI (still supported)

| Command | Purpose |
|---------|---------|
| `npm run demo` | Boots the mock Supabase and exercises it with `supabase-js` (no OpenAI key needed). |
| `npm run audit` | Runs an audit from the bundled example agent + schema. |
| `npm test` | Integration tests for the mock backend. |
| `npm run test:harness` | End-to-end harness test using a fake LLM. |

## Architecture

```
app/                  Next.js App Router pages and API routes
components/           UI primitives + agent/schema/run composers
lib/
  storage.ts          File-based persistence under data/
  compile-tools.ts    Declarative tool → supabase-js executor
  generators.ts       LLM-backed schema/seed/tool authoring helpers
  run-orchestrator.ts Boots a run, streams events to SSE subscribers
src/
  mock/               PGlite + PostgREST/Auth/Storage HTTP shims
  harness/            Auditor / target / judge harness with reporting
  cli/                CLI entry points (demo, audit)
data/                 Saved agents, schemas, runs (gitignored)
```

### How a run flows

```
01  Sandbox boots                 PGlite + PostgREST + Auth + Storage on localhost
02  Auditor generates cases       Diverse personas grounded in your schema and tools
03  Target executes tools         Real @supabase/supabase-js calls — agent has no idea it’s a mock
04  Judge scores trace            Rubric-based score + deterministic DB-diff verification
```

### Declarative tools

Tools are JSON, not code. Each tool maps to a Supabase operation:

```jsonc
{
  "name": "get-test-case-by-id",
  "description": "Fetch a single test case by id.",
  "parameters": { "id": { "type": "string", "required": true } },
  "implementation": {
    "kind": "select",
    "table": "test_cases",
    "columns": "*",
    "single": true,
    "filters": [{ "column": "id", "op": "eq", "value": "{{params.id}}" }]
  }
}
```

Supported kinds: `select`, `insert`, `update`, `upsert`, `delete`, `rpc`. Filter operators: `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `like`, `ilike`, `in`, `is`. Use `{{params.x}}` to bind tool-call arguments anywhere a string is accepted; values are coerced to numbers/booleans/null automatically.

This means the sandbox can execute *any* Supabase tool the user defines — no agent code lives in the web app, and the underlying PGlite engine is real Postgres so the semantics match production exactly.

## Sandbox capabilities

The in-process mock implements the full Supabase surface needed by `@supabase/supabase-js`:

- **PostgREST** — `select` (with column lists, filters, ordering, pagination, single/maybeSingle), `insert`, `update`, `delete`, `upsert` (`onConflict`), `rpc`, prefer headers (`return=representation`, `count`).
- **Auth** — signup, signin, JWT issuance, session/user endpoints.
- **Storage** — buckets and objects, in memory.
- **Snapshots & diffs** — every test case captures a before/after snapshot of the relevant tables and the harness produces a deterministic diff for the judge.

## Reports

Each run is reproducible. We persist:

- `data/runs/<id>.json` — run summary
- `data/runs/<id>.events.jsonl` — full event stream
- `data/runs/<id>.report.json` — structured report (test cases, tool calls, snapshots, judge scores)
- `data/runs/<id>.report.md` — Markdown report with per-case breakdowns, sandbox verification, and judge assessments

Reports are downloadable from the run detail page.

## Models

- Default model is `gpt-5-nano`. Override per-run via the wizard, per-agent in the agent editor, or globally via `MOCK_DEFAULT_MODEL` in `.env`.
- The auditor and judge run with `reasoning_effort: minimal` to keep the JSON output budget healthy. Target agents can use any reasoning level.

## Configuration

```bash
# .env
OPENAI_API_KEY=sk-...
MOCK_DEFAULT_MODEL=gpt-5-nano
```

No cloud, no auth, no database to provision — everything runs locally.

## License

MIT
