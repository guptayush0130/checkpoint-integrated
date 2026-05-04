import { notFound } from 'next/navigation';
import { Section } from '@/components/ui/card';
import { LiveRun } from '@/components/runs/live-run';
import { getRun, readRunEvents, readRunReportJson } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) notFound();
  const [events, report] = await Promise.all([readRunEvents(id), readRunReportJson(id)]);
  return (
    <div className="container-fixed">
      <Section
        marker={`§ 032  Run / ${run.id.slice(0, 6)}`}
        title="Audit telemetry"
        description="Live agent reasoning, tool calls, sandbox state, and rubric scoring — preserved for re-inspection."
      >
        <LiveRun initialRun={run} initialEvents={events} initialReport={report} />
      </Section>
    </div>
  );
}
