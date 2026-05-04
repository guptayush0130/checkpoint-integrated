import { notFound } from 'next/navigation';
import { Section } from '@/components/ui/card';
import { SchemaForm } from '@/components/schemas/schema-form';
import { getSchema } from '@/lib/storage';

export const dynamic = 'force-dynamic';

export default async function EditSchemaPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const schema = await getSchema(id);
  if (!schema) notFound();
  return (
    <div className="container-fixed">
      <Section
        marker={`§ 022  Schema / ${schema.id.slice(0, 6)}`}
        title={schema.name}
        description={schema.description || 'Edit DDL, seed data, and density.'}
      >
        <SchemaForm initial={schema} />
      </Section>
    </div>
  );
}
