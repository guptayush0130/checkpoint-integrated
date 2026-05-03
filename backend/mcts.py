"""Phase 4 — MCTS engine.

Implements Selection / Expansion / Simulation / Backpropagation against the
Sandbox + Tester + Evaluator. Improvements over the spec:

  * **Near-miss bonus** in UCB1 favours re-expanding nodes whose latest reward
    was 0.5, exactly as the spec asks but with the bonus *decayed* by visits so
    we don't get stuck.
  * **Progressive widening**: when a node has been visited many times we allow it
    to spawn additional children (k = ceil(alpha * visits**beta)). This keeps the
    branching factor adaptive instead of a hard b=3.
  * Selection stops at any node with no children OR is_terminal — and unvisited
    children are preferred (visits == 0 yields infinite UCB).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Callable

from .config import settings
from .evaluator import evaluate, is_terminal
from .models import (
    ConversationTurn,
    Evaluation,
    MCTSNode,
    ToolCall,
    Verdict,
)
from .sandbox.base import Sandbox
from . import tester_agent


# ---------------------------------------------------------------------------
# UCB1 with near-miss bonus and progressive widening
# ---------------------------------------------------------------------------


def _ucb_score(child: MCTSNode, parent_visits: int, c: float, near_miss_bonus: float) -> float:
    if child.visits == 0:
        return math.inf
    exploit = child.value / child.visits
    explore = c * math.sqrt(math.log(max(parent_visits, 1)) / child.visits)
    bonus = 0.0
    if child.evaluation and child.evaluation.verdict == Verdict.NEAR_MISS:
        bonus = near_miss_bonus / math.sqrt(child.visits + 1)
    return exploit + explore + bonus


def _select_child(node: MCTSNode, c: float, near_miss_bonus: float) -> MCTSNode:
    return max(
        node.children,
        key=lambda ch: _ucb_score(ch, node.visits, c, near_miss_bonus),
    )


def _progressive_widening_target(visits: int, base: int = 3) -> int:
    # k(n) = max(base, ceil(1.5 * sqrt(n)))
    return max(base, math.ceil(1.5 * math.sqrt(visits + 1)))


# ---------------------------------------------------------------------------
# Backpropagation
# ---------------------------------------------------------------------------


def _path_to(node_id: str, root: MCTSNode) -> list[MCTSNode]:
    """DFS to find path from root to node_id."""
    stack: list[tuple[MCTSNode, list[MCTSNode]]] = [(root, [root])]
    while stack:
        cur, path = stack.pop()
        if cur.node_id == node_id:
            return path
        for ch in cur.children:
            stack.append((ch, path + [ch]))
    return []


def _backpropagate(root: MCTSNode, leaf_id: str, reward: float) -> None:
    for n in _path_to(leaf_id, root):
        n.visits += 1
        n.value += reward


# ---------------------------------------------------------------------------
# Main engine
# ---------------------------------------------------------------------------


@dataclass
class MCTSConfig:
    max_iterations: int = settings.mcts_max_iterations
    max_depth: int = settings.mcts_max_depth
    branching: int = settings.mcts_branching
    ucb_c: float = settings.mcts_ucb_c
    near_miss_bonus: float = settings.mcts_near_miss_bonus
    convergence_window: int = 15
    convergence_eps: float = 0.01


@dataclass
class MCTSContext:
    sandbox: Sandbox
    session_id: str
    persona: str
    objective: str
    tool_hints: dict[str, Any]
    cfg: MCTSConfig


def _execute_and_record(
    ctx: MCTSContext, node: MCTSNode
) -> tuple[Evaluation, list[ConversationTurn]]:
    """Execute `node.text_prompt` in the sandbox and store the response on the node."""
    turn = ctx.sandbox.execute_turn(ctx.session_id, node.text_prompt)
    node.agent_response = turn.agent_response
    node.tool_calls = turn.tools_called
    node.snapshot_id = ctx.sandbox.create_snapshot(ctx.session_id)

    transcript = ctx.sandbox.get_history(ctx.session_id)
    state = ctx.sandbox.get_state(ctx.session_id)
    ev = evaluate(objective=ctx.objective, transcript=transcript, state=state)
    node.evaluation = ev
    node.is_terminal = is_terminal(ev) or node.depth >= ctx.cfg.max_depth
    return ev, transcript


def _simulate_rollout(ctx: MCTSContext, depth_start: int) -> float:
    """Continue the conversation with cheap single-turn rollouts to a terminal."""
    depth = depth_start
    while depth < ctx.cfg.max_depth:
        history = ctx.sandbox.get_history(ctx.session_id)
        prompt = tester_agent.rollout_prompt(
            persona=ctx.persona,
            objective=ctx.objective,
            tool_hints=ctx.tool_hints,
            history=history,
        )
        ctx.sandbox.execute_turn(ctx.session_id, prompt)
        depth += 1
        state = ctx.sandbox.get_state(ctx.session_id)
        transcript = ctx.sandbox.get_history(ctx.session_id)
        ev = evaluate(objective=ctx.objective, transcript=transcript, state=state)
        if is_terminal(ev):
            return ev.reward
    transcript = ctx.sandbox.get_history(ctx.session_id)
    state = ctx.sandbox.get_state(ctx.session_id)
    ev = evaluate(
        objective=ctx.objective, transcript=transcript, state=state, timeout_reached=True
    )
    return ev.reward


def _expand(ctx: MCTSContext, node: MCTSNode) -> MCTSNode:
    history = ctx.sandbox.get_history(ctx.session_id)
    target_k = _progressive_widening_target(node.visits, base=ctx.cfg.branching)
    needed = max(1, target_k - len(node.children))
    new_prompts = tester_agent.branch_prompts(
        persona=ctx.persona,
        objective=ctx.objective,
        tool_hints=ctx.tool_hints,
        history=history,
        b=needed,
    )
    for p in new_prompts:
        node.children.append(
            MCTSNode(parent_id=node.node_id, text_prompt=p, depth=node.depth + 1)
        )
    return node.children[-needed]  # first newly-added


def run_mcts(
    *,
    sandbox: Sandbox,
    session_id: str,
    persona: str,
    objective: str,
    tool_hints: dict[str, Any],
    cfg: MCTSConfig | None = None,
    on_iteration: Callable[[int, MCTSNode, Evaluation | None], None] | None = None,
    cost_check: Callable[[], bool] | None = None,
) -> MCTSNode:
    cfg = cfg or MCTSConfig()
    ctx = MCTSContext(
        sandbox=sandbox,
        session_id=session_id,
        persona=persona,
        objective=objective,
        tool_hints=tool_hints,
        cfg=cfg,
    )

    initial_snapshot = sandbox.create_snapshot(session_id)
    root = MCTSNode(text_prompt="<root>", snapshot_id=initial_snapshot, depth=0)

    history_root_value: list[float] = []

    for it in range(cfg.max_iterations):
        if cost_check and cost_check():
            break

        # ---- A. Selection
        node = root
        while node.children and not node.is_terminal:
            node = _select_child(node, cfg.ucb_c, cfg.near_miss_bonus)

        # Restore the sandbox to the selected node's parent state, then either
        # execute its prompt (if it hasn't been executed yet) or expand from here.
        anchor_snapshot = (
            node.snapshot_id
            if node.snapshot_id and node.node_id == root.node_id
            else _ancestor_snapshot(root, node.node_id) or initial_snapshot
        )
        sandbox.restore_snapshot(session_id, anchor_snapshot)

        if node is root:
            # Expand root; pick first child for simulation.
            child = _expand(ctx, node)
            _execute_and_record(ctx, child)
            leaf = child
        else:
            if node.snapshot_id is None:
                # First visit: replay the prompt that produced this node.
                _execute_and_record(ctx, node)

            if node.is_terminal:
                leaf = node
            else:
                # Expand: add children from this node, then descend into one.
                child = _expand(ctx, node)
                # Restore to *this* node's state before executing the new child.
                if node.snapshot_id:
                    sandbox.restore_snapshot(session_id, node.snapshot_id)
                _execute_and_record(ctx, child)
                leaf = child

        # ---- C. Simulation (only if leaf isn't already terminal)
        if leaf.is_terminal and leaf.evaluation is not None:
            reward = leaf.evaluation.reward
        else:
            # rollout from leaf
            if leaf.snapshot_id:
                sandbox.restore_snapshot(session_id, leaf.snapshot_id)
            reward = _simulate_rollout(ctx, leaf.depth)

        # ---- D. Backpropagation
        _backpropagate(root, leaf.node_id, reward)

        if on_iteration:
            on_iteration(it, root, leaf.evaluation)

        # Convergence check
        root_avg = root.value / root.visits if root.visits else 0.0
        history_root_value.append(root_avg)
        if len(history_root_value) > cfg.convergence_window:
            window = history_root_value[-cfg.convergence_window:]
            if max(window) - min(window) < cfg.convergence_eps:
                break

    return root


def _ancestor_snapshot(root: MCTSNode, node_id: str) -> str | None:
    """Walk ancestors of node_id and return the closest snapshot_id we have."""
    stack: list[tuple[MCTSNode, list[MCTSNode]]] = [(root, [root])]
    while stack:
        cur, path = stack.pop()
        if cur.node_id == node_id:
            for n in reversed(path[:-1]):
                if n.snapshot_id:
                    return n.snapshot_id
            return None
        for ch in cur.children:
            stack.append((ch, path + [ch]))
    return None
