import { v4 as uuidv4 } from 'uuid';
import { MockSupabaseInstance } from '../mock/instance';
import { collectSampleUuids, collectSeedSamples, introspectSchema } from './schema-introspect';
import { AuditorAgent } from './auditor';
import { JudgeAgent } from './judge';
import { TargetAgentRunner } from './target';
import {
  AuditPersonaTestCase,
  AuditRunReport,
  AuditTestRecord,
  CustomAgentDefinition,
  LLMClient,
  TargetRunResult,
  ToolCallRecord,
  VerificationSummary
} from './types';

const DEFAULT_MODEL = 'gpt-5-nano';

export interface AuditHarnessOptions {
  llmClient: LLMClient;
  targetAgent: CustomAgentDefinition;
  instance: MockSupabaseInstance;
  defaultModel?: string;
  auditorModel?: string;
  judgeModel?: string;
  testCount?: number;
  maxToolIterations?: number;
  /** Tables to snapshot. Defaults: agent.tables → instance.snapshotTables → all tables. */
  tables?: string[];
  /** If true, reset the sandbox between tests. Default: true. */
  resetBeforeEach?: boolean;
  /** Inject explicit test cases (skips auditor LLM generation). */
  fixedCases?: AuditPersonaTestCase[];
  /** Live progress hooks. */
  onTestStart?: (testCase: AuditPersonaTestCase, index: number, total: number) => void;
  onTestComplete?: (record: AuditTestRecord, index: number, total: number) => void;
  onProgress?: (event: string, payload?: any) => void;
}

export class AuditHarness {
  private opts: AuditHarnessOptions;
  private targetModel: string;
  private auditorModel: string;
  private judgeModel: string;

  constructor(opts: AuditHarnessOptions) {
    this.opts = opts;
    const defaultModel = opts.defaultModel || DEFAULT_MODEL;
    this.targetModel = opts.targetAgent.model || opts.targetAgent.config?.model || defaultModel;
    this.auditorModel = opts.auditorModel || defaultModel;
    this.judgeModel = opts.judgeModel || defaultModel;
  }

  async run(): Promise<AuditRunReport> {
    const runId = uuidv4();
    const runStarted = Date.now();
    const startedAt = new Date(runStarted).toISOString();

    this.emit('harness.start', { runId, targetModel: this.targetModel, auditorModel: this.auditorModel, judgeModel: this.judgeModel });

    // Make sure the sandbox is up before we introspect anything.
    await this.opts.instance.setup();
    const tables = await this.resolveTables();
    const schemaSummary = await introspectSchema(this.opts.instance.db, tables);
    const referenceUuids = await collectSampleUuids(this.opts.instance.db, tables);
    const seedSamples = await collectSeedSamples(this.opts.instance.db, tables);

    this.emit('auditor.seed_samples', {
      identityCount: seedSamples.identities.length,
      tables: Object.keys(seedSamples.byTable),
      byTable: seedSamples.byTable
    });

    const auditor = new AuditorAgent({
      llmClient: this.opts.llmClient,
      model: this.auditorModel,
      count: this.opts.testCount || 5,
      agent: this.opts.targetAgent,
      schemaSummary,
      referenceUuids,
      seedSamples,
      onUuidSanitized: (info) => {
        if (info.totalTokensReplaced > 0) {
          console.info(
            `[checkpoint] Auditor replaced ${info.totalTokensReplaced} invalid UUID token(s) across ${info.caseCount} test case(s) (reference pool: ${info.referencePoolSize} ids).`
          );
        }
        this.emit('auditor.uuid_sanitized', info);
      },
      onAuditorTelemetry: (event, payload) => this.emit(event, payload),
      fixedCases: this.opts.fixedCases
    });

    this.emit('auditor.start', { count: this.opts.testCount || 5 });
    const cases = await auditor.generateTestCases();
    this.emit('auditor.cases', { count: cases.length });
    if (!cases.length) {
      throw new Error('No audit test cases were generated. Provide fixedCases or a working LLM.');
    }

    const judge = new JudgeAgent({ llmClient: this.opts.llmClient, model: this.judgeModel });
    const records: AuditTestRecord[] = [];

    for (let i = 0; i < cases.length; i++) {
      const testCase = cases[i];
      const total = cases.length;
      const caseStart = Date.now();

      this.opts.onTestStart?.(testCase, i, total);

      if (this.opts.resetBeforeEach !== false) {
        await this.opts.instance.reset();
      }

      const env = this.opts.instance.runtimeEnv();
      const beforeSnapshot = await this.opts.instance.snapshot(tables);
      this.emit('test.snapshot.before', {
        index: i + 1,
        total,
        caseId: testCase.id,
        title: testCase.title,
        tables: summarizeSnapshot(beforeSnapshot)
      });

      const runner = new TargetAgentRunner({
        llmClient: this.opts.llmClient,
        agent: this.opts.targetAgent,
        supabaseUrl: env.SUPABASE_URL,
        supabaseKey: env.SUPABASE_ANON_KEY,
        model: this.targetModel,
        maxToolIterations: this.opts.maxToolIterations,
        onTurn: (turn) =>
          this.emit('target.turn', { iteration: turn.iteration, calls: turn.functionCalls.length }),
        onToolCall: (call) =>
          this.emit('target.tool', { name: call.toolName, ok: !call.error })
      });

      let targetRun: TargetRunResult;
      try {
        targetRun = await runner.run(this.renderUserMessage(testCase));
      } catch (err: any) {
        targetRun = {
          finalResponse: `Target agent threw: ${err?.message || String(err)}`,
          turns: [],
          toolCalls: [],
          reasoningSummaries: [],
          reachedMaxToolIterations: false
        };
        this.emit('target.error', { message: err?.message });
      }

      const afterSnapshot = await this.opts.instance.snapshot(tables);
      const diff = this.opts.instance.diff(beforeSnapshot, afterSnapshot);
      const verification = buildVerificationSummary(tables, diff, targetRun.toolCalls);
      this.emit('test.snapshot.after', {
        index: i + 1,
        total,
        caseId: testCase.id,
        title: testCase.title,
        tables: summarizeSnapshot(afterSnapshot),
        diff: summarizeDiff(diff)
      });

      let judgement;
      try {
        judgement = await judge.judge(testCase, targetRun, verification);
      } catch (err: any) {
        this.emit('judge.error', { message: err?.message });
        judgement = await judge.judge(testCase, targetRun, verification).catch(() =>
          // graceful fallback if judge fully fails
          ({
            passed: false,
            score: verification.failedToolCallCount > 0 ? 30 : 60,
            breakdown: {
              taskCompletion: 8,
              toolSelection: 8,
              dataVerification: 8,
              communication: 8,
              safety: 12
            },
            summary: 'Judge failed to respond; assessment is degraded.',
            whatWentWell: [],
            failures: [`Judge call failed: ${err?.message}`],
            idealBehavior: '',
            actionVerification: '',
            couldDoBetter: []
          })
        );
      }

      const record: AuditTestRecord = {
        testCase,
        targetRun,
        verification,
        judge: judgement,
        beforeSnapshot,
        afterSnapshot,
        durationMs: Date.now() - caseStart
      };
      records.push(record);
      this.opts.onTestComplete?.(record, i, total);
    }

    const completedAt = new Date().toISOString();
    const totalDurationMs = Date.now() - runStarted;
    const passCount = records.filter((r) => r.judge.passed).length;
    const averageScore =
      records.length > 0
        ? records.reduce((sum, r) => sum + r.judge.score, 0) / records.length
        : 0;

    this.emit('harness.done', { passCount, failCount: records.length - passCount, averageScore });

    return {
      runId,
      startedAt,
      completedAt,
      totalDurationMs,
      targetAgentName: this.opts.targetAgent.name || 'custom-agent',
      auditorModel: this.auditorModel,
      targetModel: this.targetModel,
      judgeModel: this.judgeModel,
      testCount: records.length,
      averageScore,
      passCount,
      failCount: records.length - passCount,
      schemaSummary,
      records
    };
  }

  private async resolveTables(): Promise<string[]> {
    if (this.opts.tables?.length) return this.opts.tables;
    if (this.opts.targetAgent.tables?.length) return this.opts.targetAgent.tables;
    return this.opts.instance.resolveSnapshotTables();
  }

  private renderUserMessage(testCase: AuditPersonaTestCase): string {
    const lines: string[] = [
      `[Auditor persona: ${testCase.persona}]`,
      `[Background: ${testCase.personaBackground}]`
    ];
    // If the auditor bound this persona to real seeded identifiers, surface
    // them so the target agent has a concrete account/context to work with —
    // mirroring how a real chat session has a logged-in user.
    const ident = testCase.personaIdentity || {};
    const identKeys = Object.keys(ident).filter((k) => k !== 'notFound');
    if (identKeys.length) {
      const pairs = identKeys.map((k) => `${k}=${String(ident[k])}`);
      lines.push(`[Persona identity (real seeded values): ${pairs.join(', ')}]`);
    }
    if (ident.notFound) {
      lines.push(
        '[Note: this persona deliberately uses identifiers that are NOT in the database — this is a not-found edge case.]'
      );
    }
    lines.push('', testCase.userMessage);
    return lines.join('\n');
  }

  private emit(event: string, payload?: any) {
    this.opts.onProgress?.(event, payload);
  }
}

export function buildVerificationSummary(
  tables: string[],
  diff: Record<string, { added: any[]; removed: any[]; changed: any[] }>,
  toolCalls: ToolCallRecord[]
): VerificationSummary {
  let addedRowCount = 0;
  let removedRowCount = 0;
  let changedRowCount = 0;
  let changedTableCount = 0;

  for (const table of tables) {
    const tableDiff = diff[table] || { added: [], removed: [], changed: [] };
    const total = tableDiff.added.length + tableDiff.removed.length + tableDiff.changed.length;
    if (total > 0) changedTableCount++;
    addedRowCount += tableDiff.added.length;
    removedRowCount += tableDiff.removed.length;
    changedRowCount += tableDiff.changed.length;
  }

  const failed = toolCalls.filter((call) => call.error);

  return {
    tables,
    diff,
    changedTableCount,
    addedRowCount,
    removedRowCount,
    changedRowCount,
    successfulToolCallCount: toolCalls.length - failed.length,
    failedToolCallCount: failed.length,
    toolCallErrors: failed.map((call) => call.error || 'Unknown tool error')
  };
}

/** Compact, SSE-friendly snapshot summary: just row counts and a tiny preview. */
export function summarizeSnapshot(
  snapshot: Record<string, any[]>
): Array<{ name: string; rowCount: number; preview: any[] }> {
  return Object.entries(snapshot).map(([name, rows]) => ({
    name,
    rowCount: rows.length,
    preview: rows.slice(0, 3)
  }));
}

/** Compact diff: per-table counts plus 1-2 examples for each bucket. */
export function summarizeDiff(
  diff: Record<string, { added: any[]; removed: any[]; changed: any[] }>
): Array<{
  name: string;
  added: number;
  removed: number;
  changed: number;
  addedSample: any[];
  removedSample: any[];
  changedSample: any[];
}> {
  return Object.entries(diff)
    .map(([name, d]) => ({
      name,
      added: d.added.length,
      removed: d.removed.length,
      changed: d.changed.length,
      addedSample: d.added.slice(0, 2),
      removedSample: d.removed.slice(0, 2),
      changedSample: d.changed.slice(0, 2)
    }))
    .filter((row) => row.added + row.removed + row.changed > 0);
}
