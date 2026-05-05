'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import type { RunEvent, RunSummary } from '@/lib/types';
import { MatrixView } from './matrix-view';
import { McTsTreeView } from './mcts-tree';
import { InterceptPanel } from './intercept-panel';

interface Props {
  runId: string;
  initialSummary: RunSummary;
  initialEvents: RunEvent[];
  initialReport: any | null;
}

export function LiveEngineRun({ runId, initialSummary, initialEvents, initialReport }: Props) {
  const [summary, setSummary] = useState(initialSummary);
  const [events, setEvents] = useState<RunEvent[]>(initialEvents);
  const [report, setReport] = useState(initialReport);
  const seenIds = useRef(new Set(initialEvents.map((e) => e.id)));

  useEffect(() => {
    if (summary.status !== 'running' && summary.status !== 'pending') return;
    const es = new EventSource(`/api/engine/runs/${runId}/events`);
    es.onmessage = (msg) => {
      try {
        const ev: RunEvent = JSON.parse(msg.data);
        if (seenIds.current.has(ev.id)) return;
        seenIds.current.add(ev.id);
        setEvents((prev) => [...prev, ev]);
        if (ev.type === 'run.completed' || ev.type === 'run.failed') {
          es.close();
          fetch(`/api/engine/runs/${runId}`)
            .then((r) => r.json())
            .then((data) => {
              if (data.run) setSummary(data.run);
              if (data.report) setReport(data.report);
            })
            .catch(() => {});
        }
      } catch {}
    };
    es.onerror = () => {
      // EventSource auto-retries; nothing to do.
    };
    return () => es.close();
  }, [runId, summary.status]);

  const matrix = useMemo(() => extractMatrix(events), [events]);
  const cases = useMemo(() => extractCases(events, report), [events, report]);
  const intercepts = useMemo(() => events.filter((e) => e.type === 'sandbox.intercept'), [events]);

  // Live tile stats. The persisted RunSummary only updates on run.completed,
  // so while the run is in flight we derive case counts from case.completed
  // events as they arrive.
  const liveStats = useMemo(() => {
    const completed = events.filter((e) => e.type === 'case.completed');
    let failures = 0;
    let heldLine = 0;
    for (const e of completed) {
      if (e.payload?.failureFound) failures++;
      else if (!e.payload?.nearMissFound) heldLine++;
    }
    return { cases: completed.length, failures, heldLine };
  }, [events]);

  return (
    <div className="space-y-6">
      <Header
        summary={summary}
        runId={runId}
        eventCount={events.length}
        liveStats={liveStats}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {matrix && <MatrixView matrix={matrix} />}
          {cases.length > 0 && (
            <section className="rounded-lg border border-cream-300 bg-white">
              <h2 className="border-b border-cream-300 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
                MCTS trees
              </h2>
              <div className="divide-y divide-cream-300">
                {cases.map((c) => (
                  <CaseRow key={c.testId} caseRecord={c} />
                ))}
              </div>
            </section>
          )}
        </div>
        <aside className="space-y-6">
          <InterceptPanel events={intercepts} />
          <EventLog events={events.slice(-20).reverse()} />
        </aside>
      </div>
      <div className="text-xs text-ink-100">
        <Link href="/engine" className="hover:text-ink-500">
          ← New run
        </Link>
      </div>
    </div>
  );
}

function Header({
  summary,
  runId,
  eventCount,
  liveStats
}: {
  summary: RunSummary;
  runId: string;
  eventCount: number;
  liveStats: { cases: number; failures: number; heldLine: number };
}) {
  return (
    <header className="rounded-lg border border-cream-300 bg-white p-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-3xl text-ink-500">{summary.agentName}</h1>
          <p className="mt-1 text-xs font-mono text-ink-100">
            run {runId.slice(0, 8)} · {summary.schemaName}
          </p>
        </div>
        <StatusBadge status={summary.status} />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Cases" value={pickCount(summary.testCount, liveStats.cases)} />
        <Stat
          label="Agent failures"
          value={pickCount(summary.failCount, liveStats.failures)}
          tone={pickCount(summary.failCount, liveStats.failures) > 0 ? 'fail' : 'neutral'}
        />
        <Stat
          label="Held the line"
          value={pickCount(summary.passCount, liveStats.heldLine)}
          tone="pass"
        />
        <Stat label="Events" value={eventCount} />
      </div>
      {summary.errorMessage && (
        <div className="mt-4 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700">
          {summary.errorMessage}
        </div>
      )}
    </header>
  );
}

function Stat({
  label,
  value,
  tone = 'neutral'
}: {
  label: string;
  value: number | string;
  tone?: 'neutral' | 'pass' | 'fail';
}) {
  const cls =
    tone === 'fail'
      ? 'text-red-600'
      : tone === 'pass'
      ? 'text-emerald-600'
      : 'text-ink-500';
  return (
    <div className="rounded-md border border-cream-300 bg-cream-50 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-ink-100">{label}</div>
      <div className={`mt-0.5 text-2xl font-mono font-medium ${cls}`}>{value}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'completed'
      ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
      : status === 'failed'
      ? 'bg-red-100 text-red-700 border-red-300'
      : status === 'running'
      ? 'bg-amber-100 text-amber-700 border-amber-300'
      : 'bg-cream-100 text-ink-100 border-cream-300';
  return (
    <span
      className={`inline-block rounded-full border px-3 py-1 text-xs font-mono uppercase tracking-wide ${cls}`}
    >
      {status}
    </span>
  );
}

interface CaseRecord {
  testId: string;
  assignments: Record<string, any>;
  bestReward: number | null;
  failureFound: boolean | null;
  nearMissFound: boolean | null;
  iterations: number | null;
  tree: any | null;
  failingPath: any[] | null;
}

function CaseRow({ caseRecord }: { caseRecord: CaseRecord }) {
  const [open, setOpen] = useState(caseRecord.failureFound === true);
  const verdictClass = caseRecord.failureFound
    ? 'bg-red-100 text-red-700 border-red-300'
    : caseRecord.nearMissFound
    ? 'bg-amber-100 text-amber-700 border-amber-300'
    : caseRecord.bestReward !== null
    ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
    : 'bg-cream-100 text-ink-100 border-cream-300';
  const verdictLabel = caseRecord.failureFound
    ? 'FAILURE'
    : caseRecord.nearMissFound
    ? 'NEAR MISS'
    : caseRecord.bestReward !== null
    ? 'OK'
    : 'RUNNING';

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left hover:bg-cream-50"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-ink-100">case {caseRecord.testId}</span>
          {Object.entries(caseRecord.assignments)
            .slice(0, 3)
            .map(([k, v]) => (
              <span
                key={k}
                className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-[11px] text-ink-500"
              >
                {k}={previewLevel(v)}
              </span>
            ))}
        </div>
        <div className="flex items-center gap-2">
          {caseRecord.iterations !== null && (
            <span className="font-mono text-xs text-ink-100">
              {caseRecord.iterations} iter
            </span>
          )}
          <span
            className={`inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-mono uppercase ${verdictClass}`}
          >
            {verdictLabel}
          </span>
        </div>
      </button>
      {open && caseRecord.tree && (
        <div className="border-t border-cream-300 bg-cream-50 px-5 py-4">
          {caseRecord.failingPath && caseRecord.failingPath.length > 0 && (
            <div className="mb-4">
              <div className="mb-2 text-xs uppercase tracking-wide text-ink-100">
                Most-damning conversation path
              </div>
              <div className="space-y-2 rounded border border-cream-300 bg-white p-3">
                {caseRecord.failingPath.map((turn, i) => (
                  <div key={i} className="text-xs">
                    <span
                      className={`mr-2 font-mono uppercase ${
                        turn.role === 'tester' ? 'text-amber-600' : 'text-blue-600'
                      }`}
                    >
                      {turn.role}:
                    </span>
                    <span className="text-ink-500 whitespace-pre-wrap">{turn.content}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="mb-1 text-xs uppercase tracking-wide text-ink-100">Search tree</div>
          <McTsTreeView root={caseRecord.tree} />
        </div>
      )}
    </div>
  );
}

function previewLevel(v: any): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object' && 'value' in v) {
    const inner =
      typeof v.value === 'string' && v.value.length > 12 ? `${v.value.slice(0, 12)}…` : v.value;
    return `${JSON.stringify(inner)}(${v.role})`;
  }
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 18 ? `${s.slice(0, 18)}…` : s;
}

function EventLog({ events }: { events: RunEvent[] }) {
  return (
    <section className="rounded-lg border border-cream-300 bg-white">
      <h2 className="border-b border-cream-300 px-5 py-3 text-sm font-semibold uppercase tracking-wide text-ink-500">
        Recent events
      </h2>
      <div className="max-h-[400px] overflow-auto px-5 py-3 font-mono text-[11px] text-ink-500">
        {events.length === 0 && (
          <div className="text-ink-100">Waiting for events…</div>
        )}
        {events.map((ev) => (
          <div key={ev.id} className="border-t border-cream-300 py-1 first:border-t-0">
            <span className="text-ink-100">{ev.ts.slice(11, 19)} </span>
            <span className="text-ink-500">{ev.type}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// derive matrix + cases from event stream + report
// ---------------------------------------------------------------------------

function extractMatrix(events: RunEvent[]): any | null {
  const ev = [...events].reverse().find((e) => e.type === 'matrix.generated');
  if (!ev) return null;
  return ev.payload;
}

function extractCases(events: RunEvent[], report: any | null): CaseRecord[] {
  // Use report for tree+failingPath if available; events for live state.
  if (report?.cases?.length) {
    return report.cases.map((c: any) => ({
      testId: c.testId,
      assignments: c.assignments,
      bestReward: c.bestReward,
      failureFound: c.failureFound,
      nearMissFound: c.nearMissFound,
      iterations: c.iterations,
      tree: c.tree,
      failingPath: c.failingPath
    }));
  }
  const byId = new Map<string, CaseRecord>();
  for (const e of events) {
    if (e.type === 'case.started') {
      const p = e.payload;
      byId.set(p.testId, {
        testId: p.testId,
        assignments: p.assignments,
        bestReward: null,
        failureFound: null,
        nearMissFound: null,
        iterations: null,
        tree: null,
        failingPath: null
      });
    }
    if (e.type === 'case.completed') {
      const p = e.payload;
      const cur = byId.get(p.testId);
      if (cur) {
        cur.bestReward = p.bestReward;
        cur.failureFound = p.failureFound;
        cur.nearMissFound = p.nearMissFound;
        cur.iterations = p.iterations;
      }
    }
  }
  return Array.from(byId.values());
}

/**
 * Persisted summary counts only update on run.completed. While the run is
 * in flight, prefer the live event-derived count (which is non-zero as soon
 * as the first case completes). On a finished run both should agree, so the
 * server value wins to avoid showing a stale tab's earlier snapshot.
 */
function pickCount(persisted: number, live: number): number {
  if (persisted > 0) return persisted;
  return live;
}
