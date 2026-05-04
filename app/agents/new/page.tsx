import { Section } from '@/components/ui/card';
import { AgentForm } from '@/components/agents/agent-form';

export default function NewAgentPage() {
  return (
    <div className="container-fixed">
      <Section
        marker="§ 011  New agent"
        title="Define a custom agent"
        description="Compose the system prompt and tool catalog. You can refine everything later."
      >
        <AgentForm />
      </Section>
    </div>
  );
}
