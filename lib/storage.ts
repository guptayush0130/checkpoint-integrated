import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentRecord, RunEvent, RunSummary, SchemaRecord } from './types';

const DATA_ROOT = path.resolve(process.cwd(), 'data');
/** Committed built-in agent definitions (read-only on disk; forked into `data/agents` on save). */
const PREDEFINED_AGENTS_DIR = path.resolve(process.cwd(), 'predefined', 'agents');
const AGENTS_DIR = path.join(DATA_ROOT, 'agents');
const SCHEMAS_DIR = path.join(DATA_ROOT, 'schemas');
const RUNS_DIR = path.join(DATA_ROOT, 'runs');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureStorageReady() {
  await Promise.all([ensureDir(AGENTS_DIR), ensureDir(SCHEMAS_DIR), ensureDir(RUNS_DIR)]);
}

async function readJsonSafe<T>(file: string): Promise<T | null> {
  try {
    const text = await fs.readFile(file, 'utf8');
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/**
 * Reads top-level summary JSON files from a directory. Auxiliary files such
 * as `<id>.report.json` or `<id>.events.jsonl` (used by the run orchestrator)
 * are skipped — only files whose name is exactly `<uuid>.json` are loaded.
 */
async function listJson<T extends { id: string; updatedAt?: string; createdAt?: string }>(
  dir: string
): Promise<T[]> {
  await ensureDir(dir);
  const files = await fs.readdir(dir);
  const summaries = files.filter((f) => /^[a-f0-9-]+\.json$/.test(f));
  const raw = await Promise.all(summaries.map((f) => readJsonSafe<T>(path.join(dir, f))));
  const items: T[] = [];
  for (const item of raw) if (item && item.id) items.push(item);
  return items.sort((a, b) => {
    const aT = a.updatedAt || a.createdAt || '';
    const bT = b.updatedAt || b.createdAt || '';
    return bT.localeCompare(aT);
  });
}

// ---------- Agents ----------

async function listPredefinedAgents(): Promise<AgentRecord[]> {
  let files: string[] = [];
  try {
    files = await fs.readdir(PREDEFINED_AGENTS_DIR);
  } catch {
    return [];
  }
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const items: AgentRecord[] = [];
  for (const f of jsonFiles) {
    const rec = await readJsonSafe<AgentRecord>(path.join(PREDEFINED_AGENTS_DIR, f));
    if (rec?.id) items.push({ ...rec, predefined: true });
  }
  return items.sort((a, b) => a.name.localeCompare(b.name));
}

export async function listAgents(): Promise<AgentRecord[]> {
  const [builtIn, userAgents] = await Promise.all([
    listPredefinedAgents(),
    listJson<AgentRecord>(AGENTS_DIR)
  ]);
  const byId = new Map<string, AgentRecord>();
  for (const a of builtIn) byId.set(a.id, a);
  for (const a of userAgents) byId.set(a.id, { ...a, predefined: false });
  const merged = Array.from(byId.values());
  merged.sort((a, b) => {
    const ap = a.predefined ? 0 : 1;
    const bp = b.predefined ? 0 : 1;
    if (ap !== bp) return ap - bp;
    const aT = a.updatedAt || a.createdAt || '';
    const bT = b.updatedAt || b.createdAt || '';
    return bT.localeCompare(aT);
  });
  return merged;
}

export async function getAgent(id: string): Promise<AgentRecord | null> {
  const user = await readJsonSafe<AgentRecord>(path.join(AGENTS_DIR, `${id}.json`));
  if (user) return { ...user, predefined: false };
  const builtIn = await readJsonSafe<AgentRecord>(path.join(PREDEFINED_AGENTS_DIR, `${id}.json`));
  if (builtIn) return { ...builtIn, predefined: true };
  return null;
}

export async function saveAgent(record: AgentRecord): Promise<AgentRecord> {
  await ensureDir(AGENTS_DIR);
  await fs.writeFile(path.join(AGENTS_DIR, `${record.id}.json`), JSON.stringify(record, null, 2));
  return record;
}

export async function deleteAgent(id: string): Promise<void> {
  await fs.rm(path.join(AGENTS_DIR, `${id}.json`), { force: true });
}

// ---------- Schemas ----------

export async function listSchemas(): Promise<SchemaRecord[]> {
  return listJson<SchemaRecord>(SCHEMAS_DIR);
}

export async function getSchema(id: string): Promise<SchemaRecord | null> {
  return readJsonSafe<SchemaRecord>(path.join(SCHEMAS_DIR, `${id}.json`));
}

export async function saveSchema(record: SchemaRecord): Promise<SchemaRecord> {
  await ensureDir(SCHEMAS_DIR);
  await fs.writeFile(path.join(SCHEMAS_DIR, `${record.id}.json`), JSON.stringify(record, null, 2));
  return record;
}

export async function deleteSchema(id: string): Promise<void> {
  await fs.rm(path.join(SCHEMAS_DIR, `${id}.json`), { force: true });
}

// ---------- Runs ----------

export async function listRuns(): Promise<RunSummary[]> {
  return listJson<RunSummary>(RUNS_DIR);
}

export async function getRun(id: string): Promise<RunSummary | null> {
  return readJsonSafe<RunSummary>(path.join(RUNS_DIR, `${id}.json`));
}

export async function saveRunSummary(record: RunSummary): Promise<RunSummary> {
  await ensureDir(RUNS_DIR);
  await fs.writeFile(path.join(RUNS_DIR, `${record.id}.json`), JSON.stringify(record, null, 2));
  return record;
}

export async function deleteRun(id: string): Promise<void> {
  await fs.rm(path.join(RUNS_DIR, `${id}.json`), { force: true });
  await fs.rm(path.join(RUNS_DIR, `${id}.events.jsonl`), { force: true });
  await fs.rm(path.join(RUNS_DIR, `${id}.report.md`), { force: true });
  await fs.rm(path.join(RUNS_DIR, `${id}.report.json`), { force: true });
}

// ---------- Run events (jsonl) + report files ----------

export function eventsFile(id: string) {
  return path.join(RUNS_DIR, `${id}.events.jsonl`);
}
export function reportMarkdownFile(id: string) {
  return path.join(RUNS_DIR, `${id}.report.md`);
}
export function reportJsonFile(id: string) {
  return path.join(RUNS_DIR, `${id}.report.json`);
}

export async function appendRunEvent(id: string, event: RunEvent): Promise<void> {
  await ensureDir(RUNS_DIR);
  await fs.appendFile(eventsFile(id), JSON.stringify(event) + '\n', 'utf8');
}

export async function readRunEvents(id: string): Promise<RunEvent[]> {
  try {
    const text = await fs.readFile(eventsFile(id), 'utf8');
    return text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RunEvent);
  } catch {
    return [];
  }
}

export async function writeRunReport(id: string, markdown: string, json: any): Promise<void> {
  await ensureDir(RUNS_DIR);
  await fs.writeFile(reportMarkdownFile(id), markdown, 'utf8');
  await fs.writeFile(reportJsonFile(id), JSON.stringify(json, null, 2), 'utf8');
}

export async function readRunMarkdown(id: string): Promise<string | null> {
  try {
    return await fs.readFile(reportMarkdownFile(id), 'utf8');
  } catch {
    return null;
  }
}

export async function readRunReportJson(id: string): Promise<any | null> {
  try {
    const text = await fs.readFile(reportJsonFile(id), 'utf8');
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function newId(): string {
  return randomUUID();
}
