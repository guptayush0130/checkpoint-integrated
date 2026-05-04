# core_engine/legacy/

Frozen Mark1 code preserved for reference during the Phase 3 rewrite. **Do not import from this directory in new code.**

| File | What it was | Replaced by |
| --- | --- | --- |
| `auditor.ts` | LLM-driven persona generator grounded in seed data | `core_engine/parsing.ts` + `core_engine/matrix.ts` (3-way combinatorial test cases) |
| `harness.ts` | Sequential auditor → target → judge runner with snapshot/diff verification | `core_engine/orchestrator.ts` + `core_engine/mcts.ts` (replay-from-root MCTS loop) |
| `index.ts` | Barrel export of the old harness module | n/a — engine surface will be re-exported from `core_engine/index.ts` |
| `compile_tools.ts` | Declarative `ToolSpec` → `@supabase/supabase-js` executor for the embedded target | n/a — external black-box targets execute their own tools; we only intercept at URL 2 |
| `orchestrator.ts` | Run lifecycle that booted MockSupabaseInstance and drove the harness | `core_engine/orchestrator.ts` (currently a Phase 0 stub) |

These files have **broken imports** by design (they reference `@/src/mock`, `@/src/harness`, snapshot/diff APIs that no longer exist). `tsconfig.json` excludes this directory from the build. When Phase 3 lands, cannibalize what's useful, then delete the directory.

---

`api_clients/embedded_target.ts.legacy` (sibling) is the same story — the `.legacy` suffix prevents TypeScript from compiling it. Replaced by an HTTP client to the external target's "URL 1" in Phase 2.
