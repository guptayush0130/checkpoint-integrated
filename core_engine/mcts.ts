/**
 * MCTS engine — UCB1 selection + replay-from-root state recovery.
 *
 * The target agent is external HTTP. We can't snapshot its memory, only the
 * sandbox DB. So every iteration's "selection" step does:
 *
 *   1. Walk the tree from root by UCB1, pick a leaf.
 *   2. sandbox.reset()   — wipe DB, reapply seed.
 *   3. For each ancestor on the path: targetClient.send(prompt, history)
 *      — the target hits the sandbox at URL 2, real DB state accumulates.
 *   4. Expand: tester.branchPrompts(b) → new candidate children.
 *   5. Simulate: pick the first new child, send it; rollout if not terminal.
 *   6. Evaluate: hard signals + LLM judge → reward.
 *   7. Backprop visits + reward up the path.
 *
 * Cost guardrail counts target.send() calls AND tester LLM calls together.
 * Convergence: stop early when root_value/visits has changed by < eps over
 * the last `convergenceWindow` iterations.
 */
import { randomUUID } from 'node:crypto';
import { evaluate, isTerminalVerdict } from './evaluator';
import { branchPrompts, rolloutPrompt } from './tester';
import {
  ConversationTurn,
  Evaluation,
  HardSignalPredicate,
  MCTSNode
} from './engine_types';
import type { TargetClient } from '@/clients/target';
import type { MockDatabase } from '@/sandbox/database';

export interface MCTSConfig {
  maxIterations: number;
  maxDepth: number;
  branching: number;
  ucbC: number;
  nearMissBonus: number;
  convergenceWindow: number;
  convergenceEps: number;
  /** Stop after this many target.send() + tester LLM calls combined. */
  maxLlmCallsPerCase: number;
}

export const DEFAULT_MCTS_CONFIG: MCTSConfig = {
  maxIterations: 12,
  maxDepth: 4,
  branching: 3,
  ucbC: 1.41,
  nearMissBonus: 0.35,
  convergenceWindow: 6,
  convergenceEps: 0.01,
  maxLlmCallsPerCase: 60
};

export interface MCTSContext {
  /** Wipes sandbox state (TRUNCATE + reapply seed). Called every iteration. */
  resetSandbox: () => Promise<void>;
  /** Used by the evaluator to introspect post-conversation DB state. */
  db: MockDatabase;
  /** External target agent. Always called with strategyOverride='replay-history'. */
  target: TargetClient;
  /** Stable conversation id reused for the whole MCTS run. */
  conversationId: string;
  /** Tester config (persona + objective + tool hints). */
  persona: string;
  objective: string;
  toolHints?: Record<string, any>;
  testerModel?: string;
  judgeModel?: string;
  hardSignals?: HardSignalPredicate[];
  cfg?: Partial<MCTSConfig>;
  /** Live progress callback. Drives the SSE stream the dashboard reads. */
  onEvent?: (event: MCTSEvent) => void;
}

export type MCTSEvent =
  | { type: 'iteration_start'; iteration: number }
  | { type: 'replay_start'; iteration: number; depth: number }
  | { type: 'node_expanded'; iteration: number; nodeId: string; childCount: number }
  | { type: 'node_executed'; iteration: number; nodeId: string; reply: string; verdict?: string }
  | { type: 'simulation_complete'; iteration: number; depth: number; reward: number }
  | { type: 'iteration_end'; iteration: number; rootValue: number }
  | { type: 'budget_exhausted'; iteration: number; calls: number }
  | { type: 'converged'; iteration: number };

interface NodeRunData {
  prompt: string;
  reply: string;
  toolCalls: MCTSNode['toolCalls'];
  evaluation?: Evaluation;
}

export interface MCTSResult {
  root: MCTSNode;
  iterations: number;
  llmCalls: number;
  bestReward: number;
  failingPath: ConversationTurn[];
}

// ---------------------------------------------------------------------------
// UCB + progressive widening
// ---------------------------------------------------------------------------

function ucbScore(child: MCTSNode, parentVisits: number, c: number, nearMissBonus: number): number {
  if (child.visits === 0) return Number.POSITIVE_INFINITY;
  const exploit = child.value / child.visits;
  const explore = c * Math.sqrt(Math.log(Math.max(parentVisits, 1)) / child.visits);
  let bonus = 0;
  if (child.evaluation?.verdict === 'near_miss') {
    bonus = nearMissBonus / Math.sqrt(child.visits + 1);
  }
  return exploit + explore + bonus;
}

function selectChild(node: MCTSNode, c: number, nearMissBonus: number): MCTSNode {
  let best = node.children[0];
  let bestScore = -Infinity;
  for (const child of node.children) {
    const s = ucbScore(child, node.visits, c, nearMissBonus);
    if (s > bestScore) {
      bestScore = s;
      best = child;
    }
  }
  return best;
}

function progressiveWideningTarget(visits: number, base: number): number {
  return Math.max(base, Math.ceil(1.5 * Math.sqrt(visits + 1)));
}

// ---------------------------------------------------------------------------
// run loop
// ---------------------------------------------------------------------------

export async function runMcts(ctx: MCTSContext): Promise<MCTSResult> {
  const cfg = { ...DEFAULT_MCTS_CONFIG, ...(ctx.cfg || {}) };
  const root: MCTSNode = {
    id: randomUUID().slice(0, 10),
    parentId: null,
    prompt: '',
    reply: '',
    toolCalls: [],
    visits: 0,
    value: 0,
    depth: 0,
    children: [],
    isTerminal: false
  };

  const rootValueHistory: number[] = [];
  let llmCalls = 0;
  let iterations = 0;
  let testerCallIndex = 0;

  for (let it = 0; it < cfg.maxIterations; it++) {
    iterations = it + 1;
    if (llmCalls >= cfg.maxLlmCallsPerCase) {
      ctx.onEvent?.({ type: 'budget_exhausted', iteration: it, calls: llmCalls });
      break;
    }
    ctx.onEvent?.({ type: 'iteration_start', iteration: it });

    // ---- A. Selection — walk to a leaf
    let leaf = root;
    while (leaf.children.length > 0 && !leaf.isTerminal) {
      leaf = selectChild(leaf, cfg.ucbC, cfg.nearMissBonus);
    }

    const path = pathFromRoot(root, leaf);
    ctx.onEvent?.({ type: 'replay_start', iteration: it, depth: leaf.depth });

    // ---- B. Replay the conversation from root through `leaf`
    await ctx.resetSandbox();
    let history: ConversationTurn[] = [];
    for (const node of path.slice(1)) {
      // path[0] is root; skip it (no prompt)
      const reply = await sendToTarget(ctx, history, node.prompt);
      llmCalls++;
      history = [
        ...history,
        { role: 'tester', content: node.prompt },
        { role: 'agent', content: reply }
      ];
      // Update node's reply with the latest replay (the target may differ run-to-run).
      node.reply = reply;
    }

    // ---- C. Expansion
    let target: MCTSNode;
    const wantChildren = progressiveWideningTarget(leaf.visits, cfg.branching);
    const need = leaf.isTerminal ? 0 : Math.max(1, wantChildren - leaf.children.length);
    if (need > 0 && leaf.depth < cfg.maxDepth) {
      const newPrompts = await branchPrompts(
        {
          persona: ctx.persona,
          objective: ctx.objective,
          toolHints: ctx.toolHints,
          model: ctx.testerModel,
          callIndex: testerCallIndex++
        },
        history,
        need
      );
      llmCalls += newPrompts.length; // each prompt counts as one LLM call (or one mock)
      for (const p of newPrompts) {
        leaf.children.push({
          id: randomUUID().slice(0, 10),
          parentId: leaf.id,
          prompt: p,
          reply: '',
          toolCalls: [],
          visits: 0,
          value: 0,
          depth: leaf.depth + 1,
          children: [],
          isTerminal: false
        });
      }
      ctx.onEvent?.({
        type: 'node_expanded',
        iteration: it,
        nodeId: leaf.id,
        childCount: leaf.children.length
      });
      target = leaf.children[leaf.children.length - need]; // first newly added
    } else {
      target = leaf;
    }

    // ---- D. Simulate target child
    let reward: number;
    if (target === leaf && leaf.evaluation) {
      // already terminal; just reuse its reward
      reward = leaf.evaluation.reward;
    } else {
      const reply = await sendToTarget(ctx, history, target.prompt);
      llmCalls++;
      history = [
        ...history,
        { role: 'tester', content: target.prompt },
        { role: 'agent', content: reply }
      ];
      target.reply = reply;

      const ev = await evaluate({
        objective: ctx.objective,
        transcript: history,
        db: ctx.db,
        hardSignals: ctx.hardSignals,
        judgeModel: ctx.judgeModel
      });
      target.evaluation = ev;
      target.isTerminal = isTerminalVerdict(ev) || target.depth >= cfg.maxDepth;
      reward = ev.reward;
      ctx.onEvent?.({
        type: 'node_executed',
        iteration: it,
        nodeId: target.id,
        reply,
        verdict: ev.verdict
      });

      // Light rollout — extend conversation up to maxDepth in search of a
      // terminal verdict. Each rollout step is one tester + one target call.
      let depth = target.depth;
      while (!target.isTerminal && depth < cfg.maxDepth) {
        if (llmCalls >= cfg.maxLlmCallsPerCase) break;
        const next = await rolloutPrompt(
          {
            persona: ctx.persona,
            objective: ctx.objective,
            toolHints: ctx.toolHints,
            model: ctx.testerModel,
            callIndex: testerCallIndex++
          },
          history
        );
        llmCalls++;
        const nextReply = await sendToTarget(ctx, history, next);
        llmCalls++;
        history = [
          ...history,
          { role: 'tester', content: next },
          { role: 'agent', content: nextReply }
        ];
        depth++;
        const ev2 = await evaluate({
          objective: ctx.objective,
          transcript: history,
          db: ctx.db,
          hardSignals: ctx.hardSignals,
          judgeModel: ctx.judgeModel
        });
        if (isTerminalVerdict(ev2) || depth >= cfg.maxDepth) {
          target.isTerminal = true;
          target.evaluation = ev2;
          reward = ev2.reward;
          break;
        }
      }
      ctx.onEvent?.({
        type: 'simulation_complete',
        iteration: it,
        depth,
        reward
      });
    }

    // ---- E. Backprop
    backpropagate(pathFromRoot(root, target), reward);

    const rootAvg = root.visits > 0 ? root.value / root.visits : 0;
    rootValueHistory.push(rootAvg);
    ctx.onEvent?.({ type: 'iteration_end', iteration: it, rootValue: rootAvg });

    if (rootValueHistory.length > cfg.convergenceWindow) {
      const window = rootValueHistory.slice(-cfg.convergenceWindow);
      if (Math.max(...window) - Math.min(...window) < cfg.convergenceEps) {
        ctx.onEvent?.({ type: 'converged', iteration: it });
        break;
      }
    }
  }

  return {
    root,
    iterations,
    llmCalls,
    bestReward: walkMaxReward(root),
    failingPath: extractDamningPath(root)
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

async function sendToTarget(
  ctx: MCTSContext,
  history: ConversationTurn[],
  userMessage: string
): Promise<string> {
  const reply = await ctx.target.send({
    conversationId: ctx.conversationId,
    userMessage,
    history,
    strategyOverride: 'replay-history'
  });
  return reply.response;
}

function pathFromRoot(root: MCTSNode, target: MCTSNode): MCTSNode[] {
  // DFS to find target by id.
  const stack: Array<[MCTSNode, MCTSNode[]]> = [[root, [root]]];
  while (stack.length) {
    const [node, path] = stack.pop()!;
    if (node.id === target.id) return path;
    for (const c of node.children) stack.push([c, [...path, c]]);
  }
  return [root];
}

function backpropagate(path: MCTSNode[], reward: number): void {
  for (const n of path) {
    n.visits++;
    n.value += reward;
  }
}

function walkMaxReward(root: MCTSNode): number {
  let best = 0;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n.evaluation && n.evaluation.reward > best) best = n.evaluation.reward;
    stack.push(...n.children);
  }
  return best;
}

function extractDamningPath(root: MCTSNode): ConversationTurn[] {
  // Walk down children with the highest mean value (the path the tester
  // would replay to "break" the agent again).
  const out: ConversationTurn[] = [];
  let cur: MCTSNode = root;
  while (cur.children.length) {
    let best = cur.children[0];
    let bestScore = -Infinity;
    for (const ch of cur.children) {
      const s =
        ch.visits > 0
          ? ch.value / ch.visits
          : ch.evaluation?.reward ?? 0;
      if (s > bestScore) {
        bestScore = s;
        best = ch;
      }
    }
    if (best.prompt) {
      out.push({ role: 'tester', content: best.prompt });
      if (best.reply) out.push({ role: 'agent', content: best.reply });
    }
    cur = best;
  }
  return out;
}
