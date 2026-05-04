import type { SupabaseClient } from '@supabase/supabase-js';

// ---------- Tool definitions ----------

export interface ToolDefinition {
  name: string;
  description: string;
  parameters?: Record<string, any>;
  /**
   * Implementation invoked when the agent calls this tool. Returns the value
   * passed back to the model as the tool result.
   */
  execute: (supabase: SupabaseClient, params: Record<string, any>) => Promise<any>;
}

export interface ToolCallRecord {
  toolName: string;
  params: Record<string, any>;
  result?: any;
  error?: string;
  duration: number;
  timestamp: string;
}

// ---------- Custom agent definition ----------

export interface ModelSettings {
  model?: string;
  temperature?: number;
  max_output_tokens?: number;
  max_tokens?: number;
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
}

export interface CustomAgentDefinition {
  name?: string;
  description?: string;
  config?: ModelSettings;
  /** Convenience: top-level model override (wins over config.model). */
  model?: string;
  /** System prompt the target agent runs with. */
  systemPrompt: string;
  /** Tool implementations + schemas. */
  tools: ToolDefinition[];
  /** Tables to snapshot for verification. Defaults to all public tables. */
  tables?: string[];
}

// ---------- LLM client interface ----------

export interface LLMToolSchema {
  type: 'function';
  name: string;
  description: string;
  parameters: Record<string, any>;
  strict?: boolean;
}

export interface LLMResponseRequest {
  model: string;
  instructions?: string;
  input: any;
  tools?: LLMToolSchema[];
  temperature?: number;
  max_output_tokens?: number;
  reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';
  /** Request JSON-shaped output (uses Responses API `text.format`). */
  json_mode?: boolean;
}

export interface LLMResponseResult {
  model: string;
  outputText: string;
  output: any[];
  raw: any;
}

export interface LLMClient {
  createResponse(request: LLMResponseRequest): Promise<LLMResponseResult>;
}

// ---------- Auditor / target / judge records ----------

export interface AuditPersonaTestCase {
  id: string;
  title: string;
  persona: string;
  personaBackground: string;
  /**
   * Concrete identifiers the persona uses when interacting with the target.
   * For grounded cases this maps to a seeded row; for not-found edge cases it
   * may include `notFound: true`.
   */
  personaIdentity?: Record<string, any>;
  userMessage: string;
  taskCategory: string;
  expectedBehavior: string;
  successCriteria: string[];
  expectedStateChanges?: string[];
  riskAreas: string[];
}

export interface TargetTurnRecord {
  iteration: number;
  responseText: string;
  rawOutput: any[];
  functionCalls: Array<{
    callId: string;
    name: string;
    arguments: Record<string, any>;
  }>;
}

export interface TargetRunResult {
  finalResponse: string;
  turns: TargetTurnRecord[];
  toolCalls: ToolCallRecord[];
  reasoningSummaries: string[];
  reachedMaxToolIterations: boolean;
}

export interface VerificationSummary {
  tables: string[];
  diff: Record<string, { added: any[]; removed: any[]; changed: any[] }>;
  changedTableCount: number;
  addedRowCount: number;
  removedRowCount: number;
  changedRowCount: number;
  successfulToolCallCount: number;
  failedToolCallCount: number;
  toolCallErrors: string[];
}

export interface JudgeScoreBreakdown {
  taskCompletion: number;
  toolSelection: number;
  dataVerification: number;
  communication: number;
  safety: number;
}

export interface JudgeAssessment {
  passed: boolean;
  score: number;
  breakdown: JudgeScoreBreakdown;
  summary: string;
  whatWentWell: string[];
  failures: string[];
  idealBehavior: string;
  actionVerification: string;
  couldDoBetter: string[];
}

export interface AuditTestRecord {
  testCase: AuditPersonaTestCase;
  targetRun: TargetRunResult;
  verification: VerificationSummary;
  judge: JudgeAssessment;
  beforeSnapshot: Record<string, any[]>;
  afterSnapshot: Record<string, any[]>;
  durationMs: number;
}

export interface AuditRunReport {
  runId: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  targetAgentName: string;
  auditorModel: string;
  targetModel: string;
  judgeModel: string;
  testCount: number;
  averageScore: number;
  passCount: number;
  failCount: number;
  schemaSummary: SchemaSummary;
  records: AuditTestRecord[];
}

export interface SchemaSummary {
  tables: Array<{
    name: string;
    columns: Array<{ name: string; type: string; nullable: boolean }>;
    rowCount: number;
  }>;
  foreignKeys: Array<{
    fromTable: string;
    fromColumn: string;
    toTable: string;
    toColumn: string;
  }>;
}
