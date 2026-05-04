import { Section } from '@/components/ui/card';
import { SchemaForm } from '@/components/schemas/schema-form';

export default function NewSchemaPage() {
  return (
    <div className="container-fixed">
      <Section
        marker="§ 021  New schema"
        title="Author a sandbox schema"
        description="Use a template, generate from a description, or paste DDL directly. Seed data is optional."
      >
        <SchemaForm />
      </Section>
    </div>
  );
}
