import Link from 'next/link';
import { listAgents } from '@/lib/storage';
import { Section } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { formatRelative } from '@/lib/format';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DeleteButton } from '@/components/ui/delete-button';

export const dynamic = 'force-dynamic';

export default async function AgentsPage() {
  const agents = await listAgents();

  return (
    <div className="container-fixed">
      <Section
        marker="§ 010  Agents"
        title="Agent definitions"
        description="Built-in agents ship with the install and pair with the matching schema templates. Create your own any time — tools are declarative Supabase mappings."
        actions={
          <Link href="/agents/new">
            <Button variant="primary">
              <Plus className="h-4 w-4" /> New agent
            </Button>
          </Link>
        }
      >
        {agents.length === 0 ? (
          <EmptyState
            marker="No agents yet"
            title="Define your first agent"
            description="Paste a system prompt and design tool calls in a few clicks. No code required."
            ctaLabel="Create an agent"
            ctaHref="/agents/new"
          />
        ) : (
          <div className="surface overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-cream-100 text-2xs uppercase tracking-[0.16em] text-ink-50">
                <tr>
                  <th className="table-cell text-left">Name</th>
                  <th className="table-cell text-left">Tools</th>
                  <th className="table-cell text-left">Model</th>
                  <th className="table-cell text-left">Description</th>
                  <th className="table-cell text-right">Updated</th>
                  <th className="table-cell text-right" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => (
                  <tr key={agent.id} className="border-t border-cream-300 hover:bg-cream-100">
                    <td className="table-cell">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/agents/${agent.id}`} className="font-medium hover:text-accent-500">
                          {agent.name}
                        </Link>
                        {agent.predefined && (
                          <Badge tone="neutral" className="font-mono text-2xs uppercase">
                            Built-in
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="table-cell tabular-nums text-ink-100">
                      {agent.tools.length}
                    </td>
                    <td className="table-cell font-mono text-xs text-ink-100">
                      {agent.model || '—'}
                    </td>
                    <td className="table-cell text-ink-100 max-w-md truncate">
                      {agent.description || ''}
                    </td>
                    <td className="table-cell text-right text-xs text-ink-50">
                      {formatRelative(agent.updatedAt)}
                    </td>
                    <td className="table-cell text-right">
                      {agent.predefined ? (
                        <span className="text-2xs text-ink-50">protected</span>
                      ) : (
                        <DeleteButton
                          endpoint={`/api/agents/${agent.id}`}
                          label={`agent "${agent.name}"`}
                        />
                      )}
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
