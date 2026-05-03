"""Phase 5 — Test-suite execution.

Orchestrates: matrix row -> sandbox session -> MCTS -> result aggregation.
Improvements:

  * Per-test cost guardrail using `LLMUsage`.
  * Records the *failing path* (root -> leaf with highest reward) so the UI can
    show the actual conversation that broke the agent.
  * Captures evaluator rationales — much more useful than just a number.
"""
from __future__ import annotations

from typing import Callable
from uuid import uuid4

from .config import settings
from .llm import LLMUsage, llm
from .matrix import (
    assignment_objective,
    assignment_persona,
    assignment_to_db_config,
    assignment_tool_hints,
)
from .mcts import MCTSConfig, run_mcts
from .models import (
    AgentSpec,
    ConversationTurn,
    MCTSNode,
    SuiteResult,
    TestCaseResult,
    TestMatrix,
    Verdict,
)
from .sandbox.mock import MockSandbox


def _best_path(root: MCTSNode) -> list[MCTSNode]:
    """Walk down the children with the highest mean value to find the most damning path."""
    path = [root]
    cur = root
    while cur.children:
        scored = [
            (
                (ch.value / ch.visits) if ch.visits else (ch.evaluation.reward if ch.evaluation else 0),
                ch,
            )
            for ch in cur.children
        ]
        scored.sort(key=lambda x: x[0], reverse=True)
        best = scored[0][1]
        path.append(best)
        cur = best
    return path


def _path_to_transcript(path: list[MCTSNode]) -> list[ConversationTurn]:
    out: list[ConversationTurn] = []
    for n in path:
        if not n.text_prompt or n.text_prompt == "<root>":
            continue
        out.append(ConversationTurn(role="tester", content=n.text_prompt))
        if n.agent_response:
            out.append(
                ConversationTurn(
                    role="agent", content=n.agent_response, tool_calls=n.tool_calls
                )
            )
    return out


def _max_reward(root: MCTSNode) -> float:
    best = 0.0
    stack = [root]
    while stack:
        n = stack.pop()
        if n.evaluation:
            best = max(best, n.evaluation.reward)
        stack.extend(n.children)
    return best


def _has_verdict(root: MCTSNode, verdict: Verdict) -> bool:
    stack = [root]
    while stack:
        n = stack.pop()
        if n.evaluation and n.evaluation.verdict == verdict:
            return True
        stack.extend(n.children)
    return False


def run_suite(
    *,
    agent_spec: AgentSpec,
    matrix: TestMatrix,
    cfg: MCTSConfig | None = None,
    progress: Callable[[str, dict], None] | None = None,
) -> SuiteResult:
    cfg = cfg or MCTSConfig()
    suite_id = uuid4().hex[:8]
    case_results: list[TestCaseResult] = []

    for idx, row in enumerate(matrix.rows):
        if progress:
            progress(
                "case_started",
                {"i": idx, "total": len(matrix.rows), "test_id": row.id, "assignments": row.assignments},
            )

        sandbox = MockSandbox(agent_spec=agent_spec)
        db_config = assignment_to_db_config(row.assignments, matrix.factors)
        session_id = sandbox.initialize(db_config)

        persona = assignment_persona(row.assignments)
        objective = assignment_objective(row.assignments)
        tool_hints = assignment_tool_hints(row.assignments, matrix.factors)

        baseline_calls = llm.usage.calls

        def cost_check(_baseline=baseline_calls):
            return (llm.usage.calls - _baseline) >= settings.max_llm_calls_per_test

        def on_iter(i, root, evaluation):
            if progress:
                progress(
                    "iteration",
                    {
                        "test_id": row.id,
                        "iteration": i,
                        "root_visits": root.visits,
                        "root_value": (root.value / root.visits) if root.visits else 0.0,
                        "verdict": evaluation.verdict.value if evaluation else None,
                    },
                )

        root = run_mcts(
            sandbox=sandbox,
            session_id=session_id,
            persona=persona,
            objective=objective,
            tool_hints=tool_hints,
            cfg=cfg,
            on_iteration=on_iter,
            cost_check=cost_check,
        )

        path = _best_path(root)
        result = TestCaseResult(
            test_id=row.id,
            assignments=row.assignments,
            iterations=root.visits,
            best_reward=_max_reward(root),
            failure_found=_has_verdict(root, Verdict.FAILURE),
            near_miss_found=_has_verdict(root, Verdict.NEAR_MISS),
            failing_path=_path_to_transcript(path),
            tree=root,
            cost_estimate_usd=llm.usage.estimate_cost_usd(settings.tester_model),
            llm_calls=llm.usage.calls - baseline_calls,
        )
        case_results.append(result)

        if progress:
            progress(
                "case_completed",
                {
                    "test_id": row.id,
                    "failure_found": result.failure_found,
                    "near_miss_found": result.near_miss_found,
                    "best_reward": result.best_reward,
                    "iterations": result.iterations,
                },
            )

    summary = {
        "total_cases": len(case_results),
        "failures": sum(1 for c in case_results if c.failure_found),
        "near_misses": sum(1 for c in case_results if c.near_miss_found and not c.failure_found),
        "successes": sum(1 for c in case_results if not c.failure_found and not c.near_miss_found),
        "total_llm_calls": llm.usage.calls,
        "estimated_cost_usd": round(llm.usage.estimate_cost_usd(settings.tester_model), 4),
        "offline_mode": settings.offline_mode,
    }
    return SuiteResult(suite_id=suite_id, cases=case_results, summary=summary)
