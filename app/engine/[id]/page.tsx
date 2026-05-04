/**
 * /engine/[id] — live MCTS run dashboard.
 *
 * Server component fetches the initial run summary + persisted events, then
 * hands off to <LiveEngineRun /> which opens an EventSource against
 * /api/engine/runs/[id]/events for live updates.
 */
import { notFound } from 'next/navigation';
import { LiveEngineRun } from '@/components/engine/live-run';
import { getRun, readRunEvents, readRunReportJson } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function EngineRunPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const summary = await getRun(id);
  if (!summary) notFound();

  const [events, report] = await Promise.all([readRunEvents(id), readRunReportJson(id)]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <LiveEngineRun
        runId={id}
        initialSummary={summary}
        initialEvents={events}
        initialReport={report}
      />
    </div>
  );
}
