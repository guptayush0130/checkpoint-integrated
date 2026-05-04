# core_engine/

Pure logic: test-case generation, MCTS search, evaluation, judgment. **No HTTP, no React, no DB driver.** The engine talks to the outside world through two seams:

- the **Sandbox** at `@/sandbox` (PGlite-backed Supabase shim) — for DB state inspection
- the **URL 1 client** at `@/clients/target` — for sending prompts to the external target agent

## Phase 0 contents

| File | Status | Purpose |
| --- | --- | --- |
| `types.ts` | ✅ kept | Shared engine types (TestCase, RunReport, Verdict, etc.) — will gain MCTSNode + matrix types in Phase 3 |
| `judge.ts` | ✅ kept | LLM-as-judge with rubric anchors and hard-rule capping. Derives `passed` deterministically from breakdown + DB diff |
| `openai_client.ts` | ✅ kept | Thin Responses API wrapper. Used by judge, generators, and (Phase 3) tester |
| `schema_introspect.ts` | ✅ kept | PGlite introspection for grounding test generation in the actual schema |
| `reporter.ts` | ✅ kept | Markdown report renderer |
| `generators.ts` | ✅ kept | LLM-backed schema/seed/tool authoring (used by `app/api/generate/*`) |
| `json_utils.ts` | ✅ new | Tolerant JSON parsing for LLM outputs (extracted from legacy auditor) |
| `orchestrator.ts` | 🟡 Phase 0 stub | Will own the run lifecycle (boot sandbox → MCTS → persist report) in Phase 3 |
| `legacy/` | ❌ excluded | Frozen Mark1 code; do not import |

## Phase 3 deliverables

```
core_engine/
├── parsing.ts      — SDK spec + personas + objectives + schemas → TestVariables (factors)
├── matrix.ts       — Greedy 3-way combinatorial coverage matrix (port of the Python implementation)
├── tester.ts       — Adversarial prompt generation: branch_prompts(b) for MCTS expansion, rollout_prompt() for simulation
├── evaluator.ts    — Hard-signal short-circuit + LLM judge wrapper. Verdict + reward.
├── mcts.ts         — UCB1 + near-miss bonus + progressive widening. Replay-from-root selection.
├── orchestrator.ts — Wires SandboxInstance + TargetClient + matrix + MCTS into a single run.
└── index.ts        — Public surface
```

## Replay-from-root semantics

The target agent is external. We cannot snapshot its internal state, only the DB. Every MCTS selection step:

1. Walk the tree to a leaf using UCB1.
2. `sandbox.reset()` — TRUNCATE all tables, re-apply seed.
3. For each ancestor `n` from root to leaf: `targetClient.send(conversationId, n.text_prompt)` — replays the conversation. The target hits URL 2; sandbox state accumulates.
4. Expand from the leaf: generate `b` candidate next prompts; execute one; evaluate.

This is more expensive than classic MCTS-with-snapshots (each iteration is O(depth) HTTP roundtrips on selection), but it's the only honest way to drive a black-box target. Per-test budgets in `RunConfig.maxIterationsPerCase` should account for the multiplier.
