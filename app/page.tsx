import Link from 'next/link';
import { Section } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { listAgents, listRuns, listSchemas } from '@/lib/storage';
import { formatRelative } from '@/lib/format';
import { ArrowRight, FlaskConical, Database, BotMessageSquare } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [runs, agents, schemas] = await Promise.all([listRuns(), listAgents(), listSchemas()]);
  const recent = runs.slice(0, 6);
  const completed = runs.filter((r) => r.status === 'completed');
  const passRate = completed.length
    ? (completed.reduce((s, r) => s + r.passCount, 0) /
        Math.max(1, completed.reduce((s, r) => s + r.testCount, 0))) *
      100
    : null;
  const avgScore = completed.length
    ? completed.reduce((s, r) => s + r.averageScore, 0) / completed.length
    : null;

  return (
    <div className="container-fixed space-y-12">
      <Hero />

      <section className="grid gap-4 md:grid-cols-3">
        <Stat marker="01 Agents" label="defined agents" value={agents.length} sublabel="System prompts + tool catalogs you can run" href="/agents" />
        <Stat marker="02 Schemas" label="sandbox schemas" value={schemas.length} sublabel="Postgres DDL + seed data baselines" href="/schemas" />
        <Stat marker="03 Runs" label="audit runs" value={runs.length} sublabel="Auditor → target → judge evaluations" href="/runs" />
      </section>

      <Section
        marker="§ 002  Telemetry"
        title="Latest evaluations"
        description="Every run captures the auditor’s test cases, the target agent’s tool calls, the database diff, and the judge’s rubric scores. Click through to see the full transcript."
        actions={
          <Link href="/runs/new">
            <Button variant="primary">Start a new run</Button>
          </Link>
        }
      >
        {recent.length === 0 ? (
          <div className="surface px-8 py-14 text-center">
            <div className="editorial-mark">No runs yet</div>
            <h3 className="mt-2 text-2xl">Run your first audit in under a minute.</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink-100 leading-relaxed">
              Define an agent, attach a schema, and Checkpoint will generate a structured suite, run it inside an in-process Supabase sandbox, and score every trace.
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Link href="/agents/new">
                <Button variant="primary">Create an agent</Button>
              </Link>
              <Link href="/schemas/new">
                <Button variant="secondary">Author a schema</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="surface overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-cream-100 text-2xs uppercase tracking-[0.16em] text-ink-50">
                <tr>
                  <th className="table-cell text-left">Run</th>
                  <th className="table-cell text-left">Agent</th>
                  <th className="table-cell text-left">Schema</th>
                  <th className="table-cell text-left">Status</th>
                  <th className="table-cell text-right">Pass / Total</th>
                  <th className="table-cell text-right">Score</th>
                  <th className="table-cell text-right">When</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((run) => (
                  <tr key={run.id} className="border-t border-cream-300 hover:bg-cream-100">
                    <td className="table-cell font-mono text-2xs text-ink-100">
                      <Link href={`/runs/${run.id}`} className="hover:text-accent-500">
                        {run.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="table-cell">{run.agentName}</td>
                    <td className="table-cell text-ink-100">{run.schemaName}</td>
                    <td className="table-cell">
                      <StatusBadge status={run.status} />
                    </td>
                    <td className="table-cell text-right tabular-nums">
                      {run.testCount > 0 ? `${run.passCount} / ${run.testCount}` : '—'}
                    </td>
                    <td className="table-cell text-right tabular-nums">
                      {run.averageScore ? run.averageScore.toFixed(1) : '—'}
                    </td>
                    <td className="table-cell text-right text-ink-50 text-xs">
                      {formatRelative(run.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section
        marker="§ 003  Quick actions"
        title="Three building blocks"
        description="Each piece composes — define an agent, attach a sandbox, then run."
      >
        <div className="grid gap-4 md:grid-cols-3">
          <QuickCard
            icon={<BotMessageSquare className="h-5 w-5" />}
            number="01"
            title="Author an agent"
            description="System prompt, tool catalog, and model settings. Tools are declarative — pick a table and operation."
            href="/agents/new"
          />
          <QuickCard
            icon={<Database className="h-5 w-5" />}
            number="02"
            title="Build a sandbox schema"
            description="Paste DDL, seed data, or describe what you want and let Checkpoint generate it."
            href="/schemas/new"
          />
          <QuickCard
            icon={<FlaskConical className="h-5 w-5" />}
            number="03"
            title="Run an audit"
            description="Generate or import test cases, watch live progress, and read a rubric-scored report."
            href="/runs/new"
          />
        </div>
      </Section>

      <Section marker="§ 004  Aggregate" title="Performance across runs" description="Computed from completed runs only.">
        <div className="grid gap-4 md:grid-cols-3">
          <KPI label="Total runs" value={runs.length.toString()} />
          <KPI
            label="Average pass rate"
            value={passRate === null ? '—' : `${passRate.toFixed(1)}%`}
          />
          <KPI label="Average score" value={avgScore === null ? '—' : avgScore.toFixed(1)} />
        </div>
      </Section>
    </div>
  );
}

function Hero() {
  return (
    <section className="border-b border-cream-300 pb-10">
      <div className="grid gap-10 lg:grid-cols-[1.4fr,1fr] lg:items-end">
        <div className="space-y-5">
          <div className="editorial-mark">§ 001  The test layer</div>
          <h1 className="text-5xl sm:text-6xl leading-[1.05]">
            Ship the agent.<br />
            <span className="italic text-ink-200">Not the incident.</span>
          </h1>
          <p className="max-w-xl text-base text-ink-100 leading-relaxed">
            Checkpoint generates a structured test suite for your Supabase agent — happy paths, edge cases, adversarial prompts, policy boundaries — runs it in a synthetic in-process Supabase environment, and scores every trace with an LLM judge.
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Link href="/engine">
              <Button variant="accent" size="lg">
                New MCTS run (external target) <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/runs/new">
              <Button variant="secondary" size="lg">
                Legacy embedded-target run
              </Button>
            </Link>
          </div>
          <p className="text-xs text-ink-100">
            The MCTS run is the new Phase 3+ engine — it tests an external agent over HTTP at URL 1 while
            proxying its Supabase calls through our sandbox at URL 2. The legacy flow is preserved here
            for reference until Phase 5 cleanup.
          </p>
        </div>
        <FigureCard />
      </div>
    </section>
  );
}

function FigureCard() {
  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between border-b border-cream-300 pb-3">
        <span className="editorial-mark">Fig. 01 — How a run flows</span>
        <span className="font-mono text-2xs text-ink-50">live</span>
      </div>
      <ol className="mt-4 space-y-3 text-sm">
        {[
          ['01', 'Sandbox boots', 'PGlite + PostgREST + Auth + Storage running on localhost in-process.'],
          ['02', 'Auditor generates cases', 'Diverse personas grounded in your schema and tool catalog.'],
          ['03', 'Target executes tools', 'Real @supabase/supabase-js calls — agent has no idea it’s a mock.'],
          ['04', 'Judge scores trace', 'Rubric-based score with deterministic DB-diff verification.']
        ].map(([num, title, body]) => (
          <li key={num} className="grid grid-cols-[auto,1fr] gap-3">
            <span className="font-mono text-2xs text-ink-50">{num}</span>
            <div>
              <div className="font-medium">{title}</div>
              <div className="text-ink-100 text-xs leading-relaxed">{body}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Stat({
  marker,
  label,
  value,
  sublabel,
  href
}: {
  marker: string;
  label: string;
  value: number;
  sublabel?: string;
  href?: string;
}) {
  const inner = (
    <div className="surface p-6 transition-colors hover:bg-cream-100">
      <div className="editorial-mark">{marker}</div>
      <div className="mt-3 flex items-baseline justify-between gap-3">
        <span className="font-serif text-5xl tabular-nums">{value}</span>
        <span className="text-xs uppercase tracking-[0.12em] text-ink-50">{label}</span>
      </div>
      {sublabel && <p className="mt-3 text-xs text-ink-100 leading-relaxed">{sublabel}</p>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function QuickCard({
  icon,
  number,
  title,
  description,
  href
}: {
  icon: React.ReactNode;
  number: string;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <Link href={href} className="surface block p-6 transition-colors hover:bg-cream-100">
      <div className="flex items-center justify-between">
        <span className="font-mono text-2xs text-ink-50 uppercase tracking-[0.16em]">Step / {number}</span>
        <span className="text-ink-100">{icon}</span>
      </div>
      <h3 className="mt-3 text-xl">{title}</h3>
      <p className="mt-2 text-sm text-ink-100 leading-relaxed">{description}</p>
      <div className="mt-4 inline-flex items-center gap-1 text-sm text-accent-500">
        Open <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </Link>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface px-6 py-5">
      <div className="editorial-mark">{label}</div>
      <div className="mt-2 font-serif text-4xl">{value}</div>
    </div>
  );
}

