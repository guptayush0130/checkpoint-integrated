import { notFound } from 'next/navigation';
import { Section } from '@/components/ui/card';
import { AgentForm } from '@/components/agents/agent-form';
import { getAgent } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function EditAgentPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) notFound();
  return (
    <div className="container-fixed">
      <Section
        marker={`§ 012  Agent / ${agent.id.slice(0, 6)}`}
        title={agent.name}
        description={agent.description || 'Edit prompt, tools, and model settings.'}
      >
        <AgentForm initial={agent} />
      </Section>
    </div>
  );
}
