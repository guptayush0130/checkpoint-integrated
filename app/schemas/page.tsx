import Link from 'next/link';
import { Section } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { listSchemas } from '@/lib/storage';
import { formatRelative } from '@/lib/format';
import { Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { DeleteButton } from '@/components/ui/delete-button';

export const dynamic = 'force-dynamic';

export default async function SchemasPage() {
  const schemas = await listSchemas();
  return (
    <div className="container-fixed">
      <Section
        marker="§ 020  Schemas"
        title="Sandbox schemas"
        description="Each schema is a Postgres DDL + seed-data pair. Runs use a fresh in-process database loaded from this baseline."
        actions={
          <Link href="/schemas/new">
            <Button variant="primary">
              <Plus className="h-4 w-4" /> New schema
            </Button>
          </Link>
        }
      >
        {schemas.length === 0 ? (
          <EmptyState
            marker="No schemas yet"
            title="Author your first sandbox schema"
            description="Pick a template, paste DDL, or describe what you want — Checkpoint can generate it for you."
            ctaLabel="Create a schema"
            ctaHref="/schemas/new"
          />
        ) : (
          <div className="surface overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-cream-100 text-2xs uppercase tracking-[0.16em] text-ink-50">
                <tr>
                  <th className="table-cell text-left">Name</th>
                  <th className="table-cell text-left">Density</th>
                  <th className="table-cell text-left">Description</th>
                  <th className="table-cell text-right">Updated</th>
                  <th className="table-cell text-right" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {schemas.map((schema) => (
                  <tr key={schema.id} className="border-t border-cream-300 hover:bg-cream-100">
                    <td className="table-cell">
                      <Link href={`/schemas/${schema.id}`} className="font-medium hover:text-accent-500">
                        {schema.name}
                      </Link>
                    </td>
                    <td className="table-cell">
                      <Badge tone="neutral" className="font-mono uppercase">
                        {schema.density}
                      </Badge>
                    </td>
                    <td className="table-cell text-ink-100 max-w-md truncate">
                      {schema.description || ''}
                    </td>
                    <td className="table-cell text-right text-xs text-ink-50">
                      {formatRelative(schema.updatedAt)}
                    </td>
                    <td className="table-cell text-right">
                      <DeleteButton
                        endpoint={`/api/schemas/${schema.id}`}
                        label={`schema "${schema.name}"`}
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
