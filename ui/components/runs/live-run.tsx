'use client';
import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Database,
  FileDown,
  Hammer,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  XCircle
} from 'lucide-react';
import Link from 'next/link';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDuration, formatUtcClock } from '@/lib/format';
import { ClientRelativeTime } from '@/components/ui/client-relative-time';
import type { RunEvent, RunSummary } from '@/lib/types';
import { StatusBadge } from '@/components/ui/status-badge';
import { DeleteButton } from '@/components/ui/delete-button';

interface Props {
  initialRun: RunSummary;
  initialEvents: RunEvent[];
  initialReport: any | null;
}

export function LiveRun({ initialRun, initialEvents, initialReport }: Props) {
  const [run, setRun] = useState(initialRun);
  const [events, setEvents] = useState<RunEvent[]>(initialEvents);
  const [report, setReport] = useState(initialReport);
  const [follow, setFollow] = useState(true);
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (run.status !== 'running' && run.status !== 'pending') return;
    const es = new EventSource(`/api/runs/${run.id}/events`);
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data) as RunEvent;
        setEvents((prev) => {
          if (prev.some((e) => e.id === event.id)) return prev;
          return [...prev, event];
        });
        if (event.type === 'run.completed' || event.type === 'run.failed') {
          es.close();
          // Refresh run + report
          void refresh(run.id, setRun, setReport);
        }
      } catch {}
    };
    es.addEventListener('done', () => es.close());
    es.onerror = () => {
      // EventSource auto-retries; nothing to do
    };
    return () => es.close();
  }, [run.id, run.status]);

  useEffect(() => {
    if (follow && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [events, follow]);

  const stats = computeStats(events, report);
  const phase = currentPhase(events);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <CardTitle>{run.agentName}</CardTitle>
              <StatusBadge status={run.status} />
              {phase && run.status === 'running' && (
                <span className="font-mono text-2xs uppercase tracking-[0.16em] text-ink-50">
                  · {phase}
                </span>
              )}
            </div>
            <CardSubtitle>
              <span className="font-mono">{run.id.slice(0, 8)}</span>
              {' · '}
              <span>schema: {run.schemaName}</span>
              {' · '}
              <span>
                started <ClientRelativeTime iso={run.startedAt} />
              </span>
            </CardSubtitle>
          </div>
          <div className="flex items-center gap-2">
            {report && (
              <a
                href={`/api/runs/${run.id}/report`}
                target="_blank"
                rel="noreferrer"
                className="button-base border border-cream-300 bg-white text-ink-500 hover:bg-cream-100 px-4 py-2 text-sm"
              >
                <FileDown className="h-4 w-4" /> Markdown
              </a>
            )}
            <DeleteButton
              endpoint={`/api/runs/${run.id}`}
              label="this run"
              redirectTo="/runs"
              variant="button"
            />
          </div>
        </CardHeader>
        <CardBody>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat icon={<Activity className="h-3.5 w-3.5" />} label="Tests" value={stats.testCount.toString()} />
            <Stat
              icon={<CheckCircle2 className="h-3.5 w-3.5 text-success-500" />}
              label="Pass"
              value={stats.passCount.toString()}
            />
            <Stat
              icon={<XCircle className="h-3.5 w-3.5 text-accent-500" />}
              label="Fail"
              value={stats.failCount.toString()}
            />
            <Stat
              icon={<ShieldCheck className="h-3.5 w-3.5" />}
              label="Avg score"
              value={stats.avgScore !== null ? stats.avgScore.toFixed(1) : '—'}
            />
          </div>
          {run.errorMessage && (
            <div className="mt-4 rounded-md border border-accent-400/40 bg-accent-50 px-4 py-3 text-sm text-accent-600">
              <AlertTriangle className="mr-2 inline h-4 w-4" /> {run.errorMessage}
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr,1fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ScrollText className="h-4 w-4" />
              <CardTitle>Live activity</CardTitle>
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-100">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} />
              follow tail
            </label>
          </CardHeader>
          <CardBody className="p-0">
            <div ref={feedRef} className="event-feed max-h-[520px] overflow-auto">
              {events.length === 0 ? (
                <div className="px-6 py-10 text-center text-sm text-ink-50">
                  Waiting for the run to emit events…
                </div>
              ) : (
                <ol>
                  {events.map((event) => (
                    <li key={event.id} className="border-t border-cream-300 px-5 py-3 text-sm first:border-t-0">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <EventIcon type={event.type} />
                          <span className="font-mono text-2xs uppercase tracking-[0.12em] text-ink-50">
                            {event.type}
                          </span>
                        </div>
                        <span className="font-mono text-2xs text-ink-50">
                          {formatUtcClock(event.ts)}
                        </span>
                      </div>
                      <EventBody event={event} />
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Cpu className="h-4 w-4" />
              <CardTitle>Sandbox</CardTitle>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <ConfigRow label="Default model" value={run.config.defaultModel} mono />
            <ConfigRow label="Test count" value={run.config.testCount.toString()} mono />
            <ConfigRow label="Tool iterations cap" value={String(run.config.maxToolIterations || 10)} mono />
            <Divider />
            <SandboxState events={events} />
          </CardBody>
        </Card>
      </div>

      {report?.records?.length > 0 && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Test scorecard</CardTitle>
              <CardSubtitle>Per-case pass/fail and score breakdown.</CardSubtitle>
            </div>
          </CardHeader>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead className="bg-cream-100 text-2xs uppercase tracking-[0.16em] text-ink-50">
                <tr>
                  <th className="table-cell text-left">#</th>
                  <th className="table-cell text-left">Case</th>
                  <th className="table-cell text-left">Persona</th>
                  <th className="table-cell text-right">Score</th>
                  <th className="table-cell text-left">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {report.records.map((tr: any, i: number) => (
                  <tr key={tr.testCase?.id || i} className="border-t border-cream-300 align-top">
                    <td className="table-cell font-mono text-2xs text-ink-100">
                      {(i + 1).toString().padStart(2, '0')}
                    </td>
                    <td className="table-cell">
                      <div className="font-medium">{tr.testCase?.title || tr.testCase?.id}</div>
                      <div className="mt-1 text-xs text-ink-100 leading-relaxed">
                        {tr.testCase?.userMessage}
                      </div>
                      {tr.testCase?.personaIdentity && (
                        <div className="mt-1 flex flex-wrap gap-1 text-2xs text-ink-50">
                          {Object.entries<any>(tr.testCase.personaIdentity)
                            .filter(([, v]) => v !== undefined && v !== null && v !== '')
                            .map(([k, v]) => (
                              <code
                                key={k}
                                className="rounded bg-cream-100 px-1.5 py-0.5 font-mono"
                              >
                                {k}={String(v)}
                              </code>
                            ))}
                        </div>
                      )}
                    </td>
                    <td className="table-cell text-xs text-ink-100">
                      {tr.testCase?.persona || '—'}
                    </td>
                    <td className="table-cell text-right tabular-nums">
                      {tr.judge?.score?.toFixed(0) ?? '—'}
                    </td>
                    <td className="table-cell">
                      {tr.judge?.passed ? (
                        <Badge tone="pass">PASS</Badge>
                      ) : (
                        <Badge tone="fail">FAIL</Badge>
                      )}
                      {tr.judge?.summary && (
                        <div className="mt-1 max-w-md text-xs text-ink-100 leading-relaxed">
                          {tr.judge.summary}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}

      <div className="flex items-center justify-between text-xs text-ink-50">
        <Link href="/runs" className="hover:text-ink-500">
          ← All runs
        </Link>
        {run.completedAt && (
          <span>
            Completed <ClientRelativeTime iso={run.completedAt} />
            {' · '}
            took {formatDuration(new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime())}
          </span>
        )}
      </div>
    </div>
  );
}

async function refresh(
  id: string,
  setRun: (r: RunSummary) => void,
  setReport: (r: any | null) => void
) {
  try {
    const res = await fetch(`/api/runs/${id}`, { cache: 'no-store' });
    if (!res.ok) return;
    const { run, report } = await res.json();
    setRun(run);
    setReport(report);
  } catch {}
}

function computeStats(events: RunEvent[], report: any | null) {
  if (report) {
    return {
      testCount: report.testCount || 0,
      passCount: report.passCount || 0,
      failCount: report.failCount || 0,
      avgScore: report.averageScore ?? null
    };
  }
  let testCount = 0;
  const scores: number[] = [];
  // De-dup by caseId so a flaky harness double-emit can never inflate counts.
  const seen = new Map<string, { passed: boolean; score: number }>();
  for (const e of events) {
    if (e.type === 'run.created') testCount = e.payload?.testCount || 0;
    if (e.type !== 'test.completed' && e.type !== 'test.complete') continue;
    const judge = e.payload?.judge;
    const passed = e.payload?.passed ?? judge?.passed;
    const score = e.payload?.score ?? judge?.score;
    const caseId =
      e.payload?.caseId ||
      e.payload?.testCase?.id ||
      `idx-${e.payload?.index ?? e.id}`;
    seen.set(caseId, {
      passed: !!passed,
      score: typeof score === 'number' ? score : 0
    });
  }
  let passCount = 0;
  let failCount = 0;
  for (const v of seen.values()) {
    if (v.passed) passCount++;
    else failCount++;
    scores.push(v.score);
  }
  return {
    testCount,
    passCount,
    failCount,
    avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
  };
}

function currentPhase(events: RunEvent[]): string | null {
  if (!events.length) return null;
  const last = events[events.length - 1];
  switch (last.type) {
    case 'schema.validate':
      return last.payload?.valid
        ? last.payload?.changed
          ? 'schema repaired'
          : 'schema validated'
        : 'schema invalid';
    case 'schema.repaired':
      return 'schema repaired';
    case 'sandbox.boot':
      return 'sandbox booting';
    case 'sandbox.ready':
      return 'sandbox ready';
    case 'agent.compiled':
      return 'tools compiled';
    case 'auditor.start':
      return 'auditor generating cases';
    case 'auditor.seed_samples':
      return 'auditor sampling seeded data';
    case 'auditor.cases':
      return 'auditor finished';
    case 'auditor.uuid_sanitized':
      return 'auditor fixed invalid UUIDs';
    case 'auditor.invalid_uuids_detected':
      return 'auditor validation';
    case 'auditor.uuid_repair_attempt':
      return 'auditor repair pass';
    case 'auditor.uuid_repair_complete':
      return 'auditor repair done';
    case 'test.start':
      return `running test ${last.payload?.index || ''}`;
    case 'test.snapshot.before':
      return 'snapshot (before)';
    case 'test.snapshot.after':
      return 'snapshot (after)';
    case 'target.tool':
      return `tool: ${last.payload?.name || ''}`;
    case 'target.turn':
      return `target turn ${last.payload?.iteration || ''}`;
    case 'test.complete':
    case 'test.completed':
      return 'test scored';
    case 'harness.done':
      return 'finalizing';
    case 'run.completed':
      return 'completed';
    case 'run.failed':
      return 'failed';
    default:
      return last.type;
  }
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-md border border-cream-300 bg-cream-50 px-4 py-3">
      <div className="flex items-center gap-2 text-2xs uppercase tracking-[0.12em] text-ink-50">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-serif text-3xl tabular-nums">{value}</div>
    </div>
  );
}

function ConfigRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-2xs uppercase tracking-[0.12em] text-ink-50">{label}</span>
      <span className={mono ? 'font-mono text-xs' : ''}>{value}</span>
    </div>
  );
}

function Divider() {
  return <div className="border-t border-cream-300" />;
}

function SandboxState({ events }: { events: RunEvent[] }) {
  const ready = events.find((e) => e.type === 'sandbox.ready');
  const compiled = events.find((e) => e.type === 'agent.compiled');
  // Latest snapshot known so far → drives the live row counts.
  const lastSnapshot = [...events]
    .reverse()
    .find((e) => e.type === 'test.snapshot.after' || e.type === 'test.snapshot.before');
  const seedSamples = events.find((e) => e.type === 'auditor.seed_samples');

  if (!ready) {
    return (
      <div className="text-sm text-ink-100">
        <Clock className="mr-2 inline h-3.5 w-3.5" /> Waiting for the in-process Supabase to boot…
      </div>
    );
  }

  const liveTables: Array<{ name: string; rowCount: number; preview?: any[] }> =
    Array.isArray(lastSnapshot?.payload?.tables) && lastSnapshot!.payload.tables.length
      ? lastSnapshot!.payload.tables
      : (ready.payload?.tables || []).map((name: string) => ({ name, rowCount: 0 }));

  return (
    <div className="space-y-3 text-sm">
      <div>
        <div className="flex items-center justify-between">
          <div className="text-2xs uppercase tracking-[0.12em] text-ink-50">
            Live tables ({liveTables.length})
          </div>
          {lastSnapshot && (
            <span className="text-2xs text-ink-50">
              snapshot{' '}
              {lastSnapshot.type === 'test.snapshot.after' ? 'after' : 'before'} test #
              {lastSnapshot.payload?.index ?? '—'}
            </span>
          )}
        </div>
        <SnapshotTablesView tables={liveTables} />
      </div>
      {seedSamples?.payload?.byTable && (
        <details className="rounded border border-cream-300 bg-cream-50 px-2 py-1.5 text-xs">
          <summary className="cursor-pointer text-2xs uppercase tracking-[0.12em] text-ink-50">
            Seed identities passed to auditor
          </summary>
          <div className="mt-2 space-y-2">
            {Object.entries<any>(seedSamples.payload.byTable).map(([table, info]) => (
              <div key={table}>
                <div className="font-mono text-2xs text-ink-500">{table}</div>
                {Array.isArray(info?.identities) && info.identities.length > 0 && (
                  <pre className="mt-1 max-h-48 overflow-auto rounded bg-cream-100 p-2 font-mono text-2xs leading-relaxed text-ink-500">
                    {JSON.stringify(
                      info.identities.map((i: any) => i.fields ?? i),
                      null,
                      2
                    )}
                  </pre>
                )}
              </div>
            ))}
          </div>
        </details>
      )}
      {compiled && compiled.payload?.toolNames?.length > 0 && (
        <div>
          <div className="text-2xs uppercase tracking-[0.12em] text-ink-50">
            Tools ({compiled.payload.toolNames.length})
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {compiled.payload.toolNames.map((t: string) => (
              <Badge key={t} tone="neutral" className="font-mono text-2xs">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}
      <details className="text-xs">
        <summary className="cursor-pointer text-2xs uppercase tracking-[0.12em] text-ink-50">
          Diagnostics
        </summary>
        <div className="mt-1.5 space-y-1.5">
          <div>
            <div className="text-2xs text-ink-50">Sandbox URL</div>
            <code className="mt-0.5 block break-all rounded-md bg-cream-100 px-2 py-1 font-mono text-2xs">
              {ready.payload?.url || 'http://localhost:auto'}
            </code>
            <div className="mt-0.5 text-2xs text-ink-50">
              Internal mock — health check endpoint only.
            </div>
          </div>
        </div>
      </details>
    </div>
  );
}

function EventIcon({ type }: { type: string }) {
  if (type === 'schema.validate' || type === 'schema.repaired' || type === 'schema.repair_persist_failed') {
    return <Database className="h-3.5 w-3.5 text-ink-100" />;
  }
  if (type.startsWith('sandbox')) return <Database className="h-3.5 w-3.5 text-ink-100" />;
  if (type === 'test.snapshot.before' || type === 'test.snapshot.after') {
    return <Database className="h-3.5 w-3.5 text-ink-100" />;
  }
  if (type === 'auditor.uuid_sanitized') return <AlertTriangle className="h-3.5 w-3.5 text-warning-500" />;
  if (type === 'auditor.invalid_uuids_detected') return <AlertTriangle className="h-3.5 w-3.5 text-warning-500" />;
  if (type === 'auditor.uuid_repair_attempt') return <RefreshCw className="h-3.5 w-3.5 text-ink-100" />;
  if (type === 'auditor.uuid_repair_complete') return <CheckCircle2 className="h-3.5 w-3.5 text-ink-100" />;
  if (type.startsWith('auditor')) return <ScrollText className="h-3.5 w-3.5 text-ink-100" />;
  if (type === 'target.tool') return <Hammer className="h-3.5 w-3.5 text-warning-500" />;
  if (type.startsWith('target')) return <BotIcon />;
  if (type.startsWith('judge')) return <ShieldCheck className="h-3.5 w-3.5 text-ink-100" />;
  if (type === 'run.completed' || type === 'harness.done') return <CheckCircle2 className="h-3.5 w-3.5 text-success-500" />;
  if (type === 'run.failed') return <XCircle className="h-3.5 w-3.5 text-accent-500" />;
  if (type === 'test.completed' || type === 'test.complete') return <CheckCircle2 className="h-3.5 w-3.5 text-success-500" />;
  return <Activity className="h-3.5 w-3.5 text-ink-100" />;
}

function BotIcon() {
  return (
    <svg className="h-3.5 w-3.5 text-ink-100" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="6" width="16" height="12" rx="2" />
      <circle cx="9" cy="12" r="1" />
      <circle cx="15" cy="12" r="1" />
    </svg>
  );
}

function EventBody({ event }: { event: RunEvent }) {
  const p = event.payload || {};
  switch (event.type) {
    case 'run.created':
      return (
        <div className="mt-1 text-xs text-ink-100">
          {p.testCount} test cases queued · models{' '}
          <span className="font-mono">
            auditor={p.models?.auditor} target={p.models?.target} judge={p.models?.judge}
          </span>
        </div>
      );
    case 'schema.validate':
      return (
        <div className="mt-1 text-xs text-ink-100">
          {p.valid ? (
            p.changed ? (
              <span className="text-success-500">
                Schema sanitized/repaired in {p.repairAttempts ?? 0} attempt(s) and loads cleanly.
              </span>
            ) : (
              <span>Schema and seed loaded cleanly into PGlite.</span>
            )
          ) : (
            <span className="text-accent-500">
              Schema validation failed: {String(p.error || 'unknown error')}
            </span>
          )}
        </div>
      );
    case 'schema.repaired':
      return (
        <div className="mt-1 text-xs text-ink-100">
          Persisted repaired schema (attempts: {p.repairAttempts ?? 0}).
        </div>
      );
    case 'sandbox.ready':
      return (
        <div className="mt-1 text-xs text-ink-100">
          Booted with {p.tables?.length || 0} tables.
        </div>
      );
    case 'auditor.cases':
      return (
        <div className="mt-1 text-xs text-ink-100">
          Generated {p.count || 0} test cases.
        </div>
      );
    case 'auditor.invalid_uuids_detected':
      return (
        <div className="mt-1 text-xs text-ink-100">
          {p.caseCount} case(s) contain invalid UUID-shaped token(s):{' '}
          <code className="font-mono text-2xs text-accent-500">
            {Array.isArray(p.invalidTokens) ? p.invalidTokens.slice(0, 4).join(', ') : '—'}
          </code>
          {Array.isArray(p.invalidTokens) && p.invalidTokens.length > 4 && '…'}
        </div>
      );
    case 'auditor.uuid_repair_attempt':
      return (
        <div className="mt-1 text-xs text-ink-100">
          Running a second LLM pass to fix persona messages (invalid token count: {p.invalidTokenCount ?? '—'}
          ).
        </div>
      );
    case 'auditor.uuid_repair_complete':
      return (
        <div className="mt-1 text-xs">
          {p.allValid ? (
            <span className="text-success-500">All persona messages pass UUID validation.</span>
          ) : (
            <span className="text-warning-500">
              {p.remainingInvalidCases ?? 0} case(s) still invalid — substitution fallback may run.
            </span>
          )}
        </div>
      );
    case 'auditor.uuid_sanitized':
      return (
        <div className="mt-1 space-y-2 text-xs">
          <div className="text-ink-100">
            Replaced <span className="font-semibold tabular-nums">{p.totalTokensReplaced}</span> invalid
            UUID-like token{p.totalTokensReplaced === 1 ? '' : 's'} in{' '}
            <span className="tabular-nums">{p.caseCount}</span> persona message
            {p.caseCount === 1 ? '' : 's'} · reference pool{' '}
            <span className="tabular-nums">{p.referencePoolSize}</span> real id
            {p.referencePoolSize === 1 ? '' : 's'}.
          </div>
          {Array.isArray(p.cases) &&
            p.cases.slice(0, 5).map((c: any, idx: number) => (
              <div key={idx} className="rounded border border-cream-300 bg-cream-50 px-2 py-1.5 font-mono text-2xs text-ink-100">
                <span className="text-ink-50">{c.title || c.caseId}</span>
                {c.replaced > 0 && (
                  <span className="ml-2 text-warning-500">×{c.replaced}</span>
                )}
                {Array.isArray(c.samples) &&
                  c.samples.slice(0, 2).map((s: any, j: number) => (
                    <div key={j} className="mt-1 break-all">
                      <span className="text-accent-500 line-through">{s.from}</span>
                      <span className="mx-1 text-ink-50">→</span>
                      <span className="text-success-500">{s.to}</span>
                    </div>
                  ))}
              </div>
            ))}
          {Array.isArray(p.cases) && p.cases.length > 5 && (
            <div className="text-2xs text-ink-50">+ {p.cases.length - 5} more case(s) with replacements</div>
          )}
        </div>
      );
    case 'test.start':
      return (
        <div className="mt-1 text-xs text-ink-100">
          {p.index ? `#${p.index} · ` : ''}
          <span className="font-medium">{p.title || p.testCase?.title}</span>
          {p.testCase?.persona && (
            <div className="mt-0.5 text-2xs text-ink-50">
              persona: <span className="text-ink-100">{p.testCase.persona}</span>
            </div>
          )}
          {p.testCase?.personaIdentity && (
            <div className="mt-0.5 flex flex-wrap gap-1 text-2xs text-ink-50">
              {Object.entries<any>(p.testCase.personaIdentity)
                .filter(([, v]) => v !== undefined && v !== null && v !== '')
                .map(([k, v]) => (
                  <code key={k} className="rounded bg-cream-100 px-1.5 py-0.5 font-mono">
                    {k}={String(v)}
                  </code>
                ))}
            </div>
          )}
          {p.testCase?.userMessage && (
            <Expandable
              className="mt-1 max-w-2xl rounded bg-cream-50 px-2 py-1 text-2xs italic text-ink-100"
              previewLength={240}
              text={`“${p.testCase.userMessage}”`}
            />
          )}
        </div>
      );
    case 'auditor.seed_samples':
      return (
        <div className="mt-1 text-xs text-ink-100">
          Sampled <span className="tabular-nums">{p.identityCount ?? 0}</span> identity row(s)
          across {Array.isArray(p.tables) ? p.tables.length : 0} table(s).
          {p.byTable && (
            <details className="mt-1">
              <summary className="cursor-pointer text-2xs text-ink-50">show samples</summary>
              <pre className="mt-1 max-h-64 overflow-auto rounded bg-cream-100 p-2 font-mono text-2xs leading-relaxed text-ink-500">
                {JSON.stringify(p.byTable, null, 2)}
              </pre>
            </details>
          )}
        </div>
      );
    case 'test.snapshot.before':
      return (
        <div className="mt-1 text-2xs text-ink-100">
          <div className="text-ink-50">
            #{p.index} · before · {(p.tables || []).length} table
            {(p.tables || []).length === 1 ? '' : 's'}
          </div>
          <SnapshotTablesView tables={p.tables || []} />
        </div>
      );
    case 'test.snapshot.after':
      return (
        <div className="mt-1 text-2xs text-ink-100">
          <div className="text-ink-50">
            #{p.index} · after · {(p.tables || []).length} table
            {(p.tables || []).length === 1 ? '' : 's'} ·{' '}
            {(p.diff || []).length === 0 ? 'no row changes' : `${(p.diff || []).length} table(s) changed`}
          </div>
          <DiffView diff={p.diff || []} />
          <details className="mt-2">
            <summary className="cursor-pointer text-ink-50">tables (after)</summary>
            <div className="mt-1">
              <SnapshotTablesView tables={p.tables || []} />
            </div>
          </details>
        </div>
      );
    case 'target.turn':
      return (
        <div className="mt-1 text-xs text-ink-100">
          Iteration {p.iteration} · {p.calls || 0} tool call{p.calls === 1 ? '' : 's'}
        </div>
      );
    case 'target.tool':
      return (
        <div className="mt-1 text-xs">
          <code className="rounded bg-cream-100 px-1.5 py-0.5 font-mono text-2xs">{p.name}</code>{' '}
          <span className="text-ink-50">→</span>{' '}
          <span className={!p.ok ? 'text-accent-500' : 'text-success-500'}>
            {p.ok ? 'ok' : 'failed'}
          </span>
        </div>
      );
    case 'target.error':
      return <div className="mt-1 text-xs text-accent-600">{p.message}</div>;
    case 'test.complete':
    case 'test.completed': {
      const passed = p.passed ?? p.judge?.passed;
      const score = p.score ?? p.judge?.score;
      return (
        <div className="mt-1 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            {passed ? <Badge tone="pass">pass</Badge> : <Badge tone="fail">fail</Badge>}
            <span className="text-ink-100">
              score {typeof score === 'number' ? score.toFixed(0) : '—'}
            </span>
            {typeof p.toolCalls?.length === 'number' && (
              <span className="text-ink-50">· {p.toolCalls.length} tool calls</span>
            )}
            {p.title && <span className="text-ink-50">· {p.title}</span>}
          </div>
          <JudgeBreakdownPills breakdown={p.judge?.breakdown} />
          {p.judge?.summary && (
            <Expandable
              className="text-ink-100 leading-relaxed"
              previewLength={220}
              text={p.judge.summary}
            />
          )}
          {(p.judge?.failures?.length || p.judge?.couldDoBetter?.length) && (
            <details className="text-ink-100">
              <summary className="cursor-pointer text-ink-50">judge details</summary>
              <div className="mt-2 space-y-2">
                {p.judge?.idealBehavior && (
                  <div>
                    <div className="text-2xs uppercase tracking-[0.12em] text-ink-50">
                      Ideal behavior
                    </div>
                    <Expandable text={p.judge.idealBehavior} previewLength={300} />
                  </div>
                )}
                {p.judge?.actionVerification && (
                  <div>
                    <div className="text-2xs uppercase tracking-[0.12em] text-ink-50">
                      Action verification
                    </div>
                    <Expandable text={p.judge.actionVerification} previewLength={300} />
                  </div>
                )}
                {Array.isArray(p.judge?.whatWentWell) && p.judge.whatWentWell.length > 0 && (
                  <div>
                    <div className="text-2xs uppercase tracking-[0.12em] text-ink-50">
                      What went well
                    </div>
                    <ul className="mt-0.5 list-disc pl-4 text-2xs">
                      {p.judge.whatWentWell.map((line: string, i: number) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(p.judge?.failures) && p.judge.failures.length > 0 && (
                  <div>
                    <div className="text-2xs uppercase tracking-[0.12em] text-accent-500">
                      Failures
                    </div>
                    <ul className="mt-0.5 list-disc pl-4 text-2xs text-ink-100">
                      {p.judge.failures.map((line: string, i: number) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {Array.isArray(p.judge?.couldDoBetter) && p.judge.couldDoBetter.length > 0 && (
                  <div>
                    <div className="text-2xs uppercase tracking-[0.12em] text-ink-50">
                      Could do better
                    </div>
                    <ul className="mt-0.5 list-disc pl-4 text-2xs text-ink-100">
                      {p.judge.couldDoBetter.map((line: string, i: number) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </details>
          )}
          {p.finalResponse && (
            <details className="text-ink-100">
              <summary className="cursor-pointer text-ink-50">target final response</summary>
              <Expandable
                className="mt-2 rounded bg-cream-50 px-2 py-1 leading-relaxed"
                previewLength={400}
                text={p.finalResponse}
              />
            </details>
          )}
        </div>
      );
    }
    case 'harness.done':
      return (
        <div className="mt-1 text-xs text-ink-100">
          {p.passCount}/{(p.passCount || 0) + (p.failCount || 0)} passed · avg{' '}
          {(p.averageScore || 0).toFixed(1)}
        </div>
      );
    case 'run.completed':
      return (
        <div className="mt-1 text-xs text-ink-100">
          {p.passCount}/{(p.passCount || 0) + (p.failCount || 0)} passed · avg{' '}
          {(p.averageScore || 0).toFixed(1)}
        </div>
      );
    case 'run.failed':
      return <div className="mt-1 text-xs text-accent-600">{p.message}</div>;
    default:
      if (p && Object.keys(p).length) {
        return (
          <details className="mt-1 text-xs text-ink-100">
            <summary className="cursor-pointer text-ink-50">payload</summary>
            <pre className="mt-1 overflow-auto rounded bg-cream-100 p-2 text-2xs">
              {JSON.stringify(p, null, 2)}
            </pre>
          </details>
        );
      }
      return null;
  }
}

function truncate(s: string, n: number) {
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * Inline collapse/expand for long text. Renders a soft preview of the first
 * `previewLength` characters and a "Show more" toggle to reveal the full
 * content. Avoids the historical UX problem of permanently cropping telemetry.
 */
function Expandable({
  text,
  previewLength = 200,
  className = ''
}: {
  text: string;
  previewLength?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const isLong = text.length > previewLength;
  const display = !open && isLong ? text.slice(0, previewLength) + '…' : text;
  return (
    <div className={className}>
      <span className="whitespace-pre-wrap break-words">{display}</span>
      {isLong && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="ml-2 inline text-2xs uppercase tracking-[0.12em] text-ink-50 hover:text-ink-500"
        >
          {open ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

function SnapshotTablesView({
  tables
}: {
  tables: Array<{ name: string; rowCount: number; preview?: any[] }>;
}) {
  if (!Array.isArray(tables) || !tables.length) return null;
  return (
    <div className="mt-1 grid gap-1.5 sm:grid-cols-2">
      {tables.map((t) => (
        <details key={t.name} className="rounded border border-cream-300 bg-cream-50 px-2 py-1.5">
          <summary className="flex cursor-pointer items-center justify-between gap-2 text-2xs">
            <code className="font-mono text-ink-500">{t.name}</code>
            <span className="text-ink-50 tabular-nums">
              {t.rowCount} row{t.rowCount === 1 ? '' : 's'}
            </span>
          </summary>
          {Array.isArray(t.preview) && t.preview.length > 0 && (
            <pre className="mt-2 max-h-64 overflow-auto rounded bg-cream-100 p-2 font-mono text-2xs leading-relaxed text-ink-500">
              {JSON.stringify(t.preview, null, 2)}
            </pre>
          )}
        </details>
      ))}
    </div>
  );
}

function DiffView({
  diff
}: {
  diff: Array<{
    name: string;
    added: number;
    removed: number;
    changed: number;
    addedSample?: any[];
    removedSample?: any[];
    changedSample?: any[];
  }>;
}) {
  if (!Array.isArray(diff) || !diff.length) {
    return (
      <div className="mt-1 text-2xs text-ink-50">No row changes detected after this test.</div>
    );
  }
  return (
    <div className="mt-1 space-y-1.5">
      {diff.map((row) => (
        <details
          key={row.name}
          className="rounded border border-cream-300 bg-cream-50 px-2 py-1.5"
        >
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-2xs">
            <code className="font-mono text-ink-500">{row.name}</code>
            {row.added > 0 && <Badge tone="pass">+{row.added}</Badge>}
            {row.changed > 0 && <Badge tone="warning">~{row.changed}</Badge>}
            {row.removed > 0 && <Badge tone="fail">−{row.removed}</Badge>}
          </summary>
          <div className="mt-2 space-y-2 font-mono text-2xs leading-relaxed">
            {row.added > 0 && (
              <SamplePane label="added" tone="success" rows={row.addedSample || []} />
            )}
            {row.changed > 0 && (
              <SamplePane label="changed" tone="warning" rows={row.changedSample || []} />
            )}
            {row.removed > 0 && (
              <SamplePane label="removed" tone="accent" rows={row.removedSample || []} />
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function SamplePane({
  label,
  tone,
  rows
}: {
  label: string;
  tone: 'success' | 'warning' | 'accent';
  rows: any[];
}) {
  if (!rows.length) return null;
  const toneClass =
    tone === 'success'
      ? 'text-success-500'
      : tone === 'warning'
        ? 'text-warning-500'
        : 'text-accent-500';
  return (
    <div>
      <div className={`uppercase tracking-[0.12em] ${toneClass}`}>{label}</div>
      <pre className="mt-1 max-h-48 overflow-auto rounded bg-cream-100 p-2 text-ink-500">
        {JSON.stringify(rows, null, 2)}
      </pre>
    </div>
  );
}

function JudgeBreakdownPills({
  breakdown
}: {
  breakdown?: Record<string, number>;
}) {
  if (!breakdown || typeof breakdown !== 'object') return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1 text-2xs">
      {Object.entries(breakdown).map(([dim, val]) => (
        <span
          key={dim}
          className="rounded border border-cream-300 bg-cream-50 px-2 py-0.5 font-mono text-ink-500"
        >
          <span className="text-ink-50">{dim}</span>{' '}
          <span className="tabular-nums">{Number(val).toFixed(0)}</span>
          <span className="text-ink-50">/20</span>
        </span>
      ))}
    </div>
  );
}
