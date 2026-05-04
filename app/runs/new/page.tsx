import { Section } from '@/components/ui/card';
import { listAgents, listSchemas } from '@/lib/storage';
import { RunWizard } from '@/components/runs/run-wizard';
import { EmptyState } from '@/components/ui/empty-state';

export const dynamic = 'force-dynamic';

export default async function NewRunPage() {
  const [agents, schemas] = await Promise.all([listAgents(), listSchemas()]);
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
  const defaultModel = process.env.MOCK_DEFAULT_MODEL || 'gpt-5-nano';

  if (!agents.length || !schemas.length) {
    return (
      <div className="container-fixed">
        <Section
          marker="§ 031  New run"
          title="A run needs an agent and a schema"
          description="Set those up first — they take less than a minute each."
        >
          <EmptyState
            marker={!agents.length ? 'No agents yet' : 'No schemas yet'}
            title={!agents.length ? 'Create an agent first' : 'Create a schema first'}
            description={
              !agents.length
                ? 'An agent is the system prompt + tool catalog you want to test.'
                : 'A schema is the DDL + seed data your sandbox will boot with.'
            }
            ctaLabel={!agents.length ? 'New agent' : 'New schema'}
            ctaHref={!agents.length ? '/agents/new' : '/schemas/new'}
          />
        </Section>
      </div>
    );
  }

  return (
    <div className="container-fixed">
      <Section
        marker="§ 031  New run"
        title="Configure a new audit"
        description="Pick an agent and a sandbox, decide how many test cases the auditor should generate, and launch."
      >
        <RunWizard
          agents={agents}
          schemas={schemas}
          openaiConfigured={openaiConfigured}
          defaultModel={defaultModel}
        />
      </Section>
    </div>
  );
}
