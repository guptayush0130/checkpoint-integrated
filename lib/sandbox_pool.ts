/**
 * Per-run sandbox pool. Each run gets one `SandboxInstance` keyed by `runId`,
 * its own intercept event log, and its own subscriber set for SSE fan-out.
 *
 * Lifecycle owned by:
 *   - createSandbox(runId, opts)  — boot, wire interception
 *   - getSandbox(runId)           — accessor
 *   - subscribe(runId, fn)        — attach an SSE subscriber, returns unsubscribe
 *   - getEvents(runId)            — replay past intercepts (for SSE replay)
 *   - resetSandbox(runId)         — wipe DB + reseed without tearing down server
 *   - disposeSandbox(runId)       — teardown server + drop tables, free the slot
 *
 * Process-global state (a module-level Map). The whole framework runs in one
 * Node process; this is the right scope for a local-first dev tool.
 */

import { SandboxInstance, SandboxOptions, RuntimeEnv, SandboxInterceptEvent } from '@/sandbox';

interface PoolEntry {
  instance: SandboxInstance;
  env: RuntimeEnv;
  events: SandboxInterceptEvent[];
  subscribers: Set<(event: SandboxInterceptEvent) => void>;
  createdAt: string;
}

const pool = new Map<string, PoolEntry>();

/** Cap retained intercept history per run. UI replay never needs more. */
const MAX_RETAINED_EVENTS = 5000;

/**
 * Boot a new SandboxInstance for `runId`. Interception is wired automatically
 * — every PostgREST/Auth/Storage call the target agent makes will be appended
 * to the run's event log AND fanned out to current subscribers.
 *
 * Throws if the run already has a sandbox; call disposeSandbox first or use a
 * different runId.
 */
export async function createSandbox(
  runId: string,
  opts: SandboxOptions = {}
): Promise<{ env: RuntimeEnv; entry: PoolEntry }> {
  if (pool.has(runId)) {
    throw new Error(`Sandbox for run ${runId} already exists.`);
  }
  const events: SandboxInterceptEvent[] = [];
  const subscribers = new Set<(event: SandboxInterceptEvent) => void>();

  const onIntercept = (event: SandboxInterceptEvent) => {
    events.push(event);
    if (events.length > MAX_RETAINED_EVENTS) {
      events.splice(0, events.length - MAX_RETAINED_EVENTS);
    }
    for (const sub of subscribers) {
      try {
        sub(event);
      } catch {
        // never let a subscriber error break interception
      }
    }
  };

  const instance = new SandboxInstance({ ...opts, onIntercept });
  const env = await instance.setup();
  const entry: PoolEntry = {
    instance,
    env,
    events,
    subscribers,
    createdAt: new Date().toISOString()
  };
  pool.set(runId, entry);
  return { env, entry };
}

export function getSandbox(runId: string): PoolEntry | undefined {
  return pool.get(runId);
}

export function getEvents(runId: string): SandboxInterceptEvent[] {
  return pool.get(runId)?.events.slice() || [];
}

export function subscribe(
  runId: string,
  fn: (event: SandboxInterceptEvent) => void
): () => void {
  const entry = pool.get(runId);
  if (!entry) return () => {};
  entry.subscribers.add(fn);
  return () => {
    entry.subscribers.delete(fn);
  };
}

export async function resetSandbox(runId: string): Promise<boolean> {
  const entry = pool.get(runId);
  if (!entry) return false;
  await entry.instance.reset();
  return true;
}

export async function disposeSandbox(runId: string): Promise<boolean> {
  const entry = pool.get(runId);
  if (!entry) return false;
  pool.delete(runId);
  entry.subscribers.clear();
  await entry.instance.teardown();
  return true;
}

export function listSandboxes(): Array<{ runId: string; createdAt: string; eventCount: number }> {
  return Array.from(pool.entries()).map(([runId, entry]) => ({
    runId,
    createdAt: entry.createdAt,
    eventCount: entry.events.length
  }));
}
