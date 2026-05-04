# AI Agent Testing Framework

> Combinatorial coverage × MCTS adversarial search for stress-testing conversational AI agents.

This is the initial (`v0.1`) implementation of the architecture in
[`architecture.md`](./architecture.md). It runs end-to-end **without an API
key** thanks to a deterministic offline LLM mock — so you can play with the UI
and the algorithms before paying for tokens.

## Quick start

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# (optional) point to a real OpenAI-compatible endpoint
cp .env.example .env
# edit OPENAI_API_KEY=...   and pick TESTER_MODEL / JUDGE_MODEL

uvicorn backend.main:app --reload --port 8000
# open http://localhost:8000
```

In the UI:

1. **Load example** → pre-fills the customer-support test suite.
2. **Create suite** → returns a `suite_id`.
3. **Generate 3-way matrix** → shows discovered factors (persona, objective,
   DB vars, tool params with BVA buckets) and the greedy-coverage matrix.
4. **Run with MCTS** → spawns Tester Agents, streams progress events, and
   renders results: a ranked list of test cases with the *most-damning
   conversation path* and a collapsible search tree per case.

## Project layout

```
backend/
  main.py          # FastAPI app
  config.py        # env-driven settings
  models.py        # Pydantic schemas
  parsing.py       # Phase 1: inputs → TestVariables (BVA + invalid sentinels)
  matrix.py        # Phase 2: greedy 3-way combinatorial generation
  tester_agent.py  # Phase 2/4: adversarial branching + rollout
  evaluator.py     # Phase 4: rule-based + LLM-as-judge
  mcts.py          # Phase 4: UCB1 + near-miss bonus + progressive widening
  runner.py        # Phase 5: orchestrator
  llm.py           # OpenAI client + offline mock
  sandbox/         # Phase 3: pluggable Sandbox interface + MockSandbox
frontend/
  index.html       # UI shell
  app.js           # client logic
  styles.css
examples/
  customer_support_suite.json
```

## Improvements over the spec

See the changelog at the top of each module — a few highlights:

* **LLM-as-judge** evaluator (the spec only defines the reward table, not the
  detector).
* **Hard-signal short-circuit**: if a forbidden tool is actually called, we
  immediately award reward=1.0 without spending judge tokens.
* **Diverse branching**: the tester is told to produce *stylistically distinct*
  candidates per expansion, so MCTS exploration doesn't collapse.
* **Progressive widening** in MCTS (k(n) ≈ ⌈1.5·√visits⌉, with `b` as a floor).
* **Per-test cost guardrail** (`MAX_LLM_CALLS_PER_TEST`).
* **Greedy maximum-coverage matrix** with reported `coverage_percent`, so you
  can see the trade-off when capping `max_rows`.
* **"Most-damning path" extraction** in results, so engineers see the actual
  conversation that broke the agent — not just an abstract reward number.

## Roadmap

* Real (Docker-backed) sandbox with snapshot/restore.
* SQLite persistence + multi-user.
* IPOG-F instead of randomized greedy for tighter matrices.
* Cost-aware budget allocation across cases (give more iterations to "promising"
  cases that produced near-misses).
