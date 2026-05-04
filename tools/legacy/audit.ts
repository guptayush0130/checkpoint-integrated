#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import * as dotenv from 'dotenv';
import { MockSupabaseInstance, MockSupabaseInstanceOptions } from '../mock';
import {
  AuditHarness,
  CustomAgentDefinition,
  OpenAIResponsesClient,
  renderAuditReport
} from '../harness';

dotenv.config();

interface CliArgs {
  agent?: string;
  schema?: string;
  environment?: string;
  cases?: string;
  report?: string;
  model?: string;
  targetModel?: string;
  auditorModel?: string;
  judgeModel?: string;
  tests?: number;
  maxToolIterations?: number;
  tables?: string;
  noReset?: boolean;
  noColor?: boolean;
  silent?: boolean;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if ((args as any).help || (args as any).h) {
    printHelp();
    return;
  }

  const projectRoot = path.resolve(__dirname, '..', '..');
  const targetAgent = await loadTargetAgent(args.agent || './examples/agents/test-management-agent.ts');

  if (args.targetModel) {
    targetAgent.model = args.targetModel;
    targetAgent.config = { ...(targetAgent.config || {}), model: args.targetModel };
  }

  const defaultModel = args.model || process.env.MOCK_DEFAULT_MODEL || 'gpt-5-nano';
  const instance = await buildInstance(projectRoot, args);
  const env = await instance.setup();

  log(args, '──────── Mock Supabase ────────');
  log(args, `URL:               ${env.SUPABASE_URL}`);
  log(args, `anon key:          ${truncate(env.SUPABASE_ANON_KEY, 32)}…`);
  log(args, `service role key:  ${truncate(env.SUPABASE_SERVICE_ROLE_KEY, 32)}…`);
  log(args, `Tables:            ${(await instance.db.listTables()).join(', ') || '(none)'}`);
  log(args, '');

  const llmClient = new OpenAIResponsesClient();

  const harness = new AuditHarness({
    llmClient,
    targetAgent,
    instance,
    defaultModel,
    auditorModel: args.auditorModel,
    judgeModel: args.judgeModel,
    testCount: args.tests ?? 5,
    maxToolIterations: args.maxToolIterations ?? 10,
    resetBeforeEach: !args.noReset,
    fixedCases: args.cases ? await loadFixedCases(args.cases) : undefined,
    tables: args.tables ? args.tables.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
    onProgress: (event, payload) => {
      if (args.silent) return;
      log(args, `[${event}] ${payload ? JSON.stringify(payload) : ''}`);
    }
  });

  let report;
  try {
    report = await harness.run();
  } finally {
    await instance.teardown();
  }

  const reportRel =
    args.report ||
    path.join('reports', `agent-audit-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  const reportPath = path.resolve(projectRoot, reportRel);
  const jsonPath = reportPath.replace(/\.md$/i, '.json');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  const markdown = renderAuditReport(report);
  await fs.writeFile(reportPath, markdown, 'utf8');
  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');

  log(args, '');
  log(args, '──────── Run summary ────────');
  log(args, `Tests run:      ${report.testCount}`);
  log(args, `Passed:         ${report.passCount}`);
  log(args, `Failed:         ${report.failCount}`);
  log(args, `Average score:  ${report.averageScore.toFixed(1)} / 100`);
  log(args, `Duration:       ${(report.totalDurationMs / 1000).toFixed(2)}s`);
  log(args, '');
  log(args, `Markdown report: ${reportPath}`);
  log(args, `JSON report:     ${jsonPath}`);
}

async function buildInstance(
  projectRoot: string,
  args: CliArgs
): Promise<MockSupabaseInstance> {
  if (args.environment) {
    const text = await fs.readFile(path.resolve(projectRoot, args.environment), 'utf8');
    const manifest = JSON.parse(text) as MockSupabaseInstanceOptions & {
      schemaFile?: string;
      seedFile?: string;
    };
    return new MockSupabaseInstance(normalizeManifestPaths(projectRoot, manifest));
  }

  const schemaPath = args.schema || './examples/schemas/test-management.sql';
  const resolvedSchema = path.resolve(projectRoot, schemaPath);
  return new MockSupabaseInstance({
    name: 'audit',
    schema: { file: resolvedSchema },
    seed: { file: resolvedSchema }
  });
}

function normalizeManifestPaths(
  projectRoot: string,
  manifest: MockSupabaseInstanceOptions & { schemaFile?: string; seedFile?: string }
): MockSupabaseInstanceOptions {
  const schema = Array.isArray(manifest.schema)
    ? manifest.schema
    : manifest.schema
    ? [manifest.schema]
    : [];
  const seed = Array.isArray(manifest.seed) ? manifest.seed : manifest.seed ? [manifest.seed] : [];

  if (manifest.schemaFile) schema.push({ file: path.resolve(projectRoot, manifest.schemaFile) });
  if (manifest.seedFile) seed.push({ file: path.resolve(projectRoot, manifest.seedFile) });

  for (const item of schema) {
    if (item.file && !path.isAbsolute(item.file)) {
      item.file = path.resolve(projectRoot, item.file);
    }
  }
  for (const item of seed) {
    if (item.file && !path.isAbsolute(item.file)) {
      item.file = path.resolve(projectRoot, item.file);
    }
  }

  return {
    name: manifest.name,
    schema,
    seed,
    storage: manifest.storage,
    snapshotTables: manifest.snapshotTables,
    port: manifest.port,
    host: manifest.host
  };
}

async function loadTargetAgent(agentPath: string): Promise<CustomAgentDefinition> {
  const resolved = path.isAbsolute(agentPath) ? agentPath : path.resolve(process.cwd(), agentPath);
  // Use a runtime require so the user can supply .ts (via ts-node hook) or .js.
  // ts-node is the typical entry point.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const moduleExports = require(resolved);
  const candidate = moduleExports.default || moduleExports;
  const agent: CustomAgentDefinition = {
    name: candidate.name || candidate.agentName || path.basename(resolved, path.extname(resolved)),
    description: candidate.description,
    config: candidate.config || {},
    model: candidate.model,
    systemPrompt: candidate.systemPrompt,
    tools: candidate.tools,
    tables: candidate.tables
  };
  if (!agent.systemPrompt || !Array.isArray(agent.tools)) {
    throw new Error(`Agent module at ${resolved} must export systemPrompt and tools[].`);
  }
  return agent;
}

async function loadFixedCases(casesPath: string) {
  const resolved = path.isAbsolute(casesPath) ? casesPath : path.resolve(process.cwd(), casesPath);
  const text = await fs.readFile(resolved, 'utf8');
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed.testCases)) return parsed.testCases;
  return [];
}

function parseArgs(argv: string[]): CliArgs {
  const args: any = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  if (args.tests) args.tests = Number(args.tests);
  if (args.maxToolIterations) args.maxToolIterations = Number(args.maxToolIterations);
  if (args['no-reset']) args.noReset = true;
  return args;
}

function log(args: CliArgs, msg: string) {
  if (args.silent) return;
  // eslint-disable-next-line no-console
  console.log(msg);
}

function truncate(str: string, n: number) {
  return str.length <= n ? str : str.slice(0, n);
}

function printHelp() {
  console.log(`mock-supabase audit — run an agent audit against the in-process Supabase mock.

Usage:
  ts-node src/cli/audit.ts [options]

Options:
  --agent <path>            TypeScript/JS file exporting a CustomAgentDefinition.
                            Default: ./examples/agents/test-management-agent.ts
  --schema <path>           SQL file with DDL + (optional) seed data.
                            Default: ./examples/schemas/test-management.sql
  --environment <path>      JSON manifest (overrides --schema). See README.
  --cases <path>            JSON file with predefined test cases (skips auditor LLM).
  --report <path>           Output markdown path. JSON written alongside.
                            Default: reports/agent-audit-<ISO>.md
  --model <name>            Default model used for auditor/target/judge.
                            Default: gpt-5-nano  (env: MOCK_DEFAULT_MODEL)
  --auditorModel <name>     Override auditor model.
  --targetModel <name>      Override target model.
  --judgeModel <name>       Override judge model.
  --tests <int>             How many test cases to generate (default 5).
  --maxToolIterations <int> Max LLM⇄tool turns per case (default 10).
  --tables <a,b,c>          Comma-separated tables to snapshot.
  --no-reset                Don't reset the sandbox between cases.
  --silent                  Suppress progress logs.
  --help, -h                Show this help.

Environment:
  OPENAI_API_KEY     Required.
  OPENAI_BASE_URL    Optional override (any OpenAI-compatible Responses API).
  MOCK_DEFAULT_MODEL Default model name (overridden by --model).

Examples:
  ts-node src/cli/audit.ts --tests 6
  ts-node src/cli/audit.ts --agent ./my-agent.ts --schema ./my.sql --tests 10
  ts-node src/cli/audit.ts --environment ./environments/prod-mirror.json
`);
}

main().catch((err) => {
  console.error('Audit run failed:', err?.stack || err?.message || err);
  process.exit(1);
});
