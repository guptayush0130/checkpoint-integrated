// ----- Agents -----

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'in'
  | 'is';

export interface FilterSpec {
  column: string;
  op: FilterOp;
  /** Literal value, OR a `{{params.x}}` template that pulls from the agent call. */
  value: string;
}

export interface ParamSpec {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  enum?: any[];
}

export type ToolImplementation =
  | {
      kind: 'select';
      table: string;
      columns?: string;
      filters?: FilterSpec[];
      orderBy?: string;
      orderAsc?: boolean;
      limit?: number;
      single?: boolean;
      maybeSingle?: boolean;
    }
  | {
      kind: 'insert';
      table: string;
      values: Record<string, string>;
      returnRow?: boolean;
    }
  | {
      kind: 'update';
      table: string;
      values: Record<string, string>;
      filters: FilterSpec[];
      returnRow?: boolean;
    }
  | {
      kind: 'delete';
      table: string;
      filters: FilterSpec[];
      returnRow?: boolean;
    }
  | {
      kind: 'upsert';
      table: string;
      values: Record<string, string>;
      onConflict?: string;
      returnRow?: boolean;
    }
  | {
      kind: 'rpc';
      function: string;
      args: Record<string, string>;
    }
  | {
      kind: 'sql';
      sql: string;
      /** Optional named bindings: `:title` in SQL maps to params.title or a literal */
      bindings?: Record<string, string>;
    };

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, ParamSpec>;
  implementation: ToolImplementation;
}

export interface AgentRecord {
  id: string;
  name: string;
  description?: string;
  systemPrompt: string;
  model?: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  maxOutputTokens?: number;
  tools: ToolSpec[];
  tables?: string[];
  createdAt: string;
  updatedAt: string;
  /** Shipped with the app under `predefined/agents/`. User saves in `data/agents/` override by id. */
  predefined?: boolean;
}

// ----- Schemas -----

export type DataDensity = 'sparse' | 'medium' | 'dense' | 'custom';

export interface SchemaRecord {
  id: string;
  name: string;
  description?: string;
  ddlSql: string;
  seedSql: string;
  density: DataDensity;
  /** Tables to snapshot for verification (defaults to all). */
  snapshotTables?: string[];
  createdAt: string;
  updatedAt: string;
}

// ----- Runs -----

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface RunConfig {
  agentId: string;
  schemaId: string;
  testCount: number;
  /** "auto" lets the auditor decide based on tools (default 5). */
  autoTestCount?: boolean;
  defaultModel: string;
  auditorModel?: string;
  targetModel?: string;
  judgeModel?: string;
  maxToolIterations?: number;
}

export interface RunSummary {
  id: string;
  status: RunStatus;
  config: RunConfig;
  agentName: string;
  schemaName: string;
  startedAt: string;
  completedAt?: string;
  testCount: number;
  passCount: number;
  failCount: number;
  averageScore: number;
  errorMessage?: string;
}

export interface RunEvent {
  id: number;
  ts: string;
  type: string;
  payload?: any;
}
