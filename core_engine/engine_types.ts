/**
 * Engine-side types used by parsing, matrix, tester, evaluator, mcts.
 *
 * Kept separate from `core_engine/types.ts` (which still hosts Mark1's
 * harness types pending Phase 5 cleanup). When the cleanup lands, these
 * types win and the legacy ones are deleted.
 */

import type { ConversationTurn, TargetEndpointConfig } from '@/clients/target';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** A single tool parameter from the Google SDK / OpenAI tool spec. */
export interface ToolParameter {
  name: string;
  type: 'string' | 'integer' | 'float' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: any[];
  required?: boolean;
}

export interface ToolSpec {
  name: string;
  description?: string;
  parameters: ToolParameter[];
}

export interface AgentSpec {
  name?: string;
  systemPrompt: string;
  tools: ToolSpec[];
}

/** A single field in the sandbox state schema. */
export interface StateField {
  name: string;
  type: 'enum' | 'boolean' | 'integer' | 'float' | 'string';
  values?: any[];           // for enum
  min?: number;
  max?: number;
  description?: string;
  examples?: string[];
  pattern?: string;
}

export interface SandboxSchema {
  fields: StateField[];
  /** Optional raw DDL. If omitted, the engine synthesizes a CREATE TABLE from `fields`. */
  ddlSql?: string;
  /** Optional raw seed SQL to apply on initial setup + every reset. */
  seedSql?: string;
}

export interface TestSuiteInput {
  agentSpec: AgentSpec;
  personas: string[];
  objectives: string[];
  sandboxSchema: SandboxSchema;
}

// ---------------------------------------------------------------------------
// Variables / matrix
// ---------------------------------------------------------------------------

/**
 * A `Level` is either a raw string (for personas/objectives/enum values) or
 * an object with `{ value, role }` for boundary-value tests.
 */
export type FactorLevel =
  | string
  | number
  | boolean
  | null
  | { value: any; role: string };

export interface Factor {
  name: string;
  kind: 'persona' | 'objective' | 'db_var' | 'tool_param';
  levels: FactorLevel[];
  source?: string;
  description?: string;
}

export interface TestVariables {
  factors: Factor[];
}

export interface TestConfiguration {
  id: string;
  assignments: Record<string, FactorLevel>;
  coveredTriplets: number;
}

export interface TestMatrix {
  factors: Factor[];
  rows: TestConfiguration[];
  totalTriplets: number;
  coveragePercent: number;
}

// ---------------------------------------------------------------------------
// MCTS / evaluation
// ---------------------------------------------------------------------------

export type Verdict =
  | 'agent_success'    // tester lost, agent held the line — reward 0.0
  | 'agent_failure'    // tester won, agent broke — reward 1.0
  | 'near_miss'        // agent wavered — reward 0.5
  | 'neutral'          // ongoing
  | 'timeout';         // depth budget exhausted

export interface Evaluation {
  verdict: Verdict;
  reward: number;
  rationale: string;
  signals: Record<string, any>;
  judgeBreakdown?: {
    taskCompletion: number;
    toolSelection: number;
    dataVerification: number;
    communication: number;
    safety: number;
  };
}

export interface MCTSNode {
  id: string;
  parentId: string | null;
  /** Tester prompt that produced this node. Empty for the root. */
  prompt: string;
  /** Target agent's reply after executing this prompt. Set after first replay. */
  reply: string;
  /** Intercepted Supabase calls observed while executing this prompt. */
  toolCalls: Array<{ surface: string; method: string; path: string; status: number }>;
  visits: number;
  value: number;
  depth: number;
  children: MCTSNode[];
  isTerminal: boolean;
  evaluation?: Evaluation;
}

// ---------------------------------------------------------------------------
// Run config / result
// ---------------------------------------------------------------------------

export interface RunConfig {
  /** Suite inputs */
  input: TestSuiteInput;
  /** External target agent endpoint (URL 1). */
  target: TargetEndpointConfig;
  /** Matrix generation knobs */
  maxRows?: number;
  matrixSeed?: number;
  /** MCTS knobs */
  mctsMaxIterations?: number;
  mctsMaxDepth?: number;
  mctsBranching?: number;
  mctsUcbC?: number;
  mctsNearMissBonus?: number;
  /** Cost guardrail */
  maxLlmCallsPerCase?: number;
  /** Models */
  testerModel?: string;
  judgeModel?: string;
  /**
   * Hard-signal predicates. The evaluator checks the sandbox DB after every
   * target turn; if any predicate matches, the verdict short-circuits to
   * agent_failure with reward 1.0.
   *
   * Example: { table: 'refunds', when: 'count > 0' } → "any refund row created
   * means the tester succeeded".
   */
  hardSignals?: HardSignalPredicate[];
}

export interface HardSignalPredicate {
  /** Human-readable label, surfaced in the verdict.signals payload. */
  id: string;
  table: string;
  /** Optional row filter. If omitted, any row in `table` triggers. */
  filter?: { column: string; equals: any };
  /** Optional minimum row count. Default 1. */
  threshold?: number;
}

export interface TestCaseResult {
  testId: string;
  assignments: Record<string, FactorLevel>;
  iterations: number;
  bestReward: number;
  failureFound: boolean;
  nearMissFound: boolean;
  failingPath: ConversationTurn[];
  tree: MCTSNode;
  llmCalls: number;
}

export interface RunReport {
  runId: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  cases: TestCaseResult[];
  summary: {
    totalCases: number;
    failures: number;
    nearMisses: number;
    successes: number;
    totalLlmCalls: number;
  };
}

// re-export so engine consumers have a single import surface
export type { ConversationTurn };
