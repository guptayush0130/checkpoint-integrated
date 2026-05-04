import Link from 'next/link';
import { Section } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { listRuns } from '@/lib/storage';
import { formatRelative } from '@/lib/format';
import { Plus } from 'lucide-react';
import { StatusBadge } from '@/components/ui/status-badge';
import { DeleteButton } from '@/components/ui/delete-button';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const runs = await listRuns();
  return (
    <div className="container-fixed">
      <Section
        marker="§ 030  Runs"
        title="Audit history"
        description="Every run is reproducible: the schema seed, agent definition, generated test cases, and judge transcripts are all preserved."
        actions={
          <Link href="/runs/new">
            <Button variant="primary">
              <Plus className="h-4 w-4" /> New run
            </Button>
          </Link>
        }
      >
        {runs.length === 0 ? (
          <EmptyState
            marker="No runs yet"
            title="Launch your first audit"
            description="Pick an agent, attach a schema, and Checkpoint orchestrates the rest."
            ctaLabel="Start a run"
            ctaHref="/runs/new"
          />
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
                  <th className="table-cell text-right">Started</th>
                  <th className="table-cell text-right" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
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
                    <td className="table-cell text-right text-xs text-ink-50">
                      {formatRelative(run.startedAt)}
                    </td>
                    <td className="table-cell text-right">
                      <DeleteButton
                        endpoint={`/api/runs/${run.id}`}
                        label={`run ${run.id.slice(0, 8)}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}
