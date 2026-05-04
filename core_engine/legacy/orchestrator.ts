/**
 * Run orchestrator. Owns the lifecycle of an audit run:
 *   - Boots a `MockSupabaseInstance` with the chosen schema/seed
 *   - Compiles the agent's declarative tools into runnable `ToolDefinition`s
 *   - Wires up the `AuditHarness` with progress callbacks that stream into
 *     a per-run event log + an in-memory bus for live SSE subscribers
 *   - Persists the final report (Markdown + JSON) and run summary
 *
 * The orchestrator runs in the same Node process as Next.js. State for
 * in-flight runs lives in a module-level `Map`; subscribers connect over
 * `/api/runs/:id/events` and replay any persisted events before tailing the
 * live stream.
 */

import { v4 as uuidv4 } from 'uuid';
import { MockSupabaseInstance } from '@/src/mock';
import { AuditHarness, OpenAIResponsesClient } from '@/src/harness';
import { renderAuditReport } from '@/src/harness/reporter';
import {
  appendRunEvent,
  ensureStorageReady,
  getAgent,
  getRun,
  getSchema,
  saveRunSummary,
  saveSchema,
  writeRunReport
} from './storage';
import { compileTools } from './compile-tools';
import { ensureSchemaIsLoadable } from './generators';
import type {
  AgentRecord,
  RunConfig,
  RunEvent,
  RunStatus,
  RunSummary,
  SchemaRecord
} from './types';

type Subscriber = (event: RunEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();
const inflight = new Set<string>();

function emit(runId: string, event: RunEvent) {
  const subs = subscribers.get(runId);
  if (!subs) return;
  for (const sub of subs) {
    try {
      sub(event);
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribe(runId: string, subscriber: Subscriber): () => void {
  let set = subscribers.get(runId);
  if (!set) {
    set = new Set();
    subscribers.set(runId, set);
  }
  set.add(subscriber);
  return () => {
    set!.delete(subscriber);
    if (!set!.size) subscribers.delete(runId);
  };
}

export function isInflight(runId: string): boolean {
  return inflight.has(runId);
}

export async function startRun(config: RunConfig): Promise<RunSummary> {
  await ensureStorageReady();

  const agent = await getAgent(config.agentId);
  const schema = await getSchema(config.schemaId);
  if (!agent) throw new Error(`Agent ${config.agentId} not found`);
  if (!schema) throw new Error(`Schema ${config.schemaId} not found`);

  const id = uuidv4();
  const startedAt = new Date().toISOString();
  const summary: RunSummary = {
    id,
    status: 'pending',
    config,
    agentName: agent.name,
    schemaName: schema.name,
    startedAt,
    testCount: 0,
    passCount: 0,
    failCount: 0,
    averageScore: 0
  };
  await saveRunSummary(summary);
  inflight.add(id);

  // Fire and forget. Errors are captured into the persisted summary.
  void executeRun(id, summary, agent, schema, config);
  return summary;
}

let eventCounter = 0;

async function executeRun(
  id: string,
  summary: RunSummary,
  agent: AgentRecord,
  schema: SchemaRecord,
  config: RunConfig
) {
  let instance: MockSupabaseInstance | null = null;
  try {
    await pushEvent(id, 'run.created', {
      agentId: agent.id,
      agentName: agent.name,
      schemaId: schema.id,
      schemaName: schema.name,
      testCount: config.testCount,
      models: {
        default: config.defaultModel,
        auditor: config.auditorModel || config.defaultModel,
        target: config.targetModel || agent.model || config.defaultModel,
        judge: config.judgeModel || config.defaultModel
      }
    });

    summary.status = 'running';
    await saveRunSummary(summary);

    // 1. Pre-flight: validate (and if needed, LLM-repair) the schema/seed against
    //    the same Postgres engine the run will use, so we never boot the real
    //    sandbox with SQL that is known to fail.
    const preflight = await ensureSchemaIsLoadable(
      schema.ddlSql,
      schema.seedSql || '',
      config.defaultModel
    );
    await pushEvent(id, 'schema.validate', {
      valid: preflight.valid,
      changed: preflight.changed,
      repairAttempts: preflight.repairAttempts,
      error: preflight.error
    });
    if (!preflight.valid) {
      throw new Error(
        `Schema "${schema.name}" failed Postgres validation: ${preflight.error}`
      );
    }
    let activeDdl = preflight.ddlSql;
    let activeSeed = preflight.seedSql;
    if (preflight.changed) {
      const updated = {
        ...schema,
        ddlSql: activeDdl,
        seedSql: activeSeed,
        updatedAt: new Date().toISOString()
      };
      await saveSchema(updated);
      await pushEvent(id, 'schema.repaired', {
        schemaId: schema.id,
        schemaName: schema.name,
        repairAttempts: preflight.repairAttempts
      });
    }

    // 2. Boot the mock instance.
    await pushEvent(id, 'sandbox.boot', { schema: schema.name, density: schema.density });
    instance = new MockSupabaseInstance({
      name: `run-${id}`,
      schema: { sql: activeDdl },
      seed: activeSeed ? { sql: activeSeed } : undefined,
      snapshotTables: schema.snapshotTables
    });
    await instance.setup();
    const tables = await instance.db.listTables();
    await pushEvent(id, 'sandbox.ready', { tables, url: instance.runtimeEnv().SUPABASE_URL });

    // 3. Compile tools.
    const tools = compileTools(agent.tools);
    await pushEvent(id, 'agent.compiled', {
      toolCount: tools.length,
      toolNames: tools.map((t) => t.name)
    });

    // 4. Run harness.
    const llmClient = new OpenAIResponsesClient();
    const harness = new AuditHarness({
      llmClient,
      targetAgent: {
        name: agent.name,
        systemPrompt: agent.systemPrompt,
        config: {
          model: config.targetModel || agent.model,
          reasoning_effort: agent.reasoningEffort,
          max_output_tokens: agent.maxOutputTokens
        },
        model: config.targetModel || agent.model,
        tools,
        tables: agent.tables
      },
      instance,
      defaultModel: config.defaultModel,
      auditorModel: config.auditorModel,
      judgeModel: config.judgeModel,
      testCount: config.testCount,
      maxToolIterations: config.maxToolIterations,
      onTestStart: (testCase, index, total) => {
        void pushEvent(id, 'test.start', {
          index: index + 1,
          total,
          testCase
        });
      },
      onTestComplete: (record, index, total) => {
        void pushEvent(id, 'test.completed', {
          index: index + 1,
          total,
          caseId: record.testCase.id,
          title: record.testCase.title,
          persona: record.testCase.persona,
          taskCategory: record.testCase.taskCategory,
          userMessage: record.testCase.userMessage,
          finalResponse: record.targetRun.finalResponse,
          judge: {
            passed: record.judge.passed,
            score: record.judge.score,
            breakdown: record.judge.breakdown,
            summary: record.judge.summary,
            whatWentWell: record.judge.whatWentWell,
            failures: record.judge.failures,
            idealBehavior: record.judge.idealBehavior,
            actionVerification: record.judge.actionVerification,
            couldDoBetter: record.judge.couldDoBetter
          },
          toolCalls: record.targetRun.toolCalls.map((tc) => ({
            name: tc.toolName,
            ok: !tc.error,
            duration: tc.duration,
            params: tc.params,
            error: tc.error
          })),
          verification: {
            successfulToolCallCount: record.verification.successfulToolCallCount,
            failedToolCallCount: record.verification.failedToolCallCount,
            changedTableCount: record.verification.changedTableCount,
            addedRowCount: record.verification.addedRowCount,
            changedRowCount: record.verification.changedRowCount,
            removedRowCount: record.verification.removedRowCount
          }
        });
      },
      onProgress: (event, payload) => {
        // Forward the harness-emitted lifecycle events directly.
        void pushEvent(id, event, payload);
      }
    });

    const report = await harness.run();
    const markdown = renderAuditReport(report);
    await writeRunReport(id, markdown, report);

    summary.status = 'completed';
    summary.completedAt = new Date().toISOString();
    summary.testCount = report.testCount;
    summary.passCount = report.passCount;
    summary.failCount = report.failCount;
    summary.averageScore = report.averageScore;
    await saveRunSummary(summary);
    await pushEvent(id, 'run.completed', {
      passCount: report.passCount,
      failCount: report.failCount,
      averageScore: report.averageScore
    });
  } catch (err: any) {
    summary.status = 'failed';
    summary.completedAt = new Date().toISOString();
    summary.errorMessage = err?.message || String(err);
    await saveRunSummary(summary);
    await pushEvent(id, 'run.failed', { message: summary.errorMessage });
  } finally {
    inflight.delete(id);
    if (instance) {
      try {
        await instance.teardown();
      } catch {
        // best-effort cleanup
      }
    }
  }
}

async function pushEvent(runId: string, type: string, payload?: any) {
  eventCounter++;
  const event: RunEvent = {
    id: eventCounter,
    ts: new Date().toISOString(),
    type,
    payload
  };
  // Fan out to live SSE subscribers FIRST so the UI updates instantly,
  // then persist to disk in the background. Persistence failures are logged
  // but never block live telemetry.
  emit(runId, event);
  appendRunEvent(runId, event).catch((err) => {
    console.warn('[orchestrator] appendRunEvent failed', err);
  });
}

export async function getRunStatus(id: string): Promise<RunStatus | null> {
  const summary = await getRun(id);
  return summary?.status ?? null;
}
