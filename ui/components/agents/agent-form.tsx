'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { ToolEditor } from './tool-editor';
import type { AgentRecord, SchemaRecord } from '@/lib/types';

interface AgentFormProps {
  initial?: AgentRecord;
}

export function AgentForm({ initial }: AgentFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt || DEFAULT_PROMPT);
  const [model, setModel] = useState(initial?.model || 'gpt-5-nano');
  const [reasoningEffort, setReasoningEffort] = useState(initial?.reasoningEffort || 'low');
  const [maxOutputTokens, setMaxOutputTokens] = useState(initial?.maxOutputTokens || 4000);
  const [tools, setTools] = useState(initial?.tools || []);
  const [schemas, setSchemas] = useState<SchemaRecord[]>([]);
  const [contextSchemaId, setContextSchemaId] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/schemas')
      .then((r) => r.json())
      .then((d) => setSchemas(d.schemas || []))
      .catch(() => {});
  }, []);

  const ddlContext = schemas.find((s) => s.id === contextSchemaId)?.ddlSql;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const payload: Partial<AgentRecord> = {
        name,
        description,
        systemPrompt,
        model: model || undefined,
        reasoningEffort: (reasoningEffort as any) || undefined,
        maxOutputTokens: maxOutputTokens || undefined,
        tools
      };
      const url = initial ? `/api/agents/${initial.id}` : '/api/agents';
      const method = initial ? 'PATCH' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || 'Save failed');
      }
      const { agent } = await res.json();
      router.push(`/agents/${agent.id}`);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial) return;
    if (!confirm(`Delete agent "${initial.name}"? This cannot be undone.`)) return;
    await fetch(`/api/agents/${initial.id}`, { method: 'DELETE' });
    router.push('/agents');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href="/agents" className="inline-flex items-center gap-1 text-sm text-ink-100 hover:text-ink-500">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to agents
        </Link>
        <div className="flex items-center gap-2">
          {initial && !initial.predefined && (
            <Button variant="danger" type="button" onClick={remove} size="md">
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          <Button variant="primary" type="button" onClick={save} disabled={busy || !name}>
            <Save className="h-4 w-4" />{' '}
            {busy
              ? 'Saving…'
              : initial?.predefined
                ? 'Save to workspace'
                : initial
                  ? 'Save changes'
                  : 'Create agent'}
          </Button>
        </div>
      </div>

      {initial?.predefined && (
        <div className="surface-flat border-cream-400 bg-cream-100 px-4 py-3 text-sm text-ink-100">
          <span className="font-medium text-ink-500">Built-in agent.</span> Saving stores your copy under{' '}
          <code className="font-mono text-xs">data/agents/</code> and uses it for runs. The original definition
          in the app cannot be deleted.
        </div>
      )}

      {error && (
        <div className="surface-flat border-accent-400/30 bg-accent-50 px-4 py-2 text-sm text-accent-600">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Identity</CardTitle>
            <CardSubtitle>Name, description, and persona prompt your target agent runs with.</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required htmlFor="agent-name">
              <Input
                id="agent-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Test management agent"
              />
            </Field>
            <Field label="Description" htmlFor="agent-desc">
              <Input
                id="agent-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional one-liner shown in lists"
              />
            </Field>
          </div>
          <Field
            label="System prompt"
            required
            htmlFor="agent-prompt"
            hint="The persona, capabilities, and operating principles for the target agent."
          >
            <Textarea
              id="agent-prompt"
              rows={10}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Model settings</CardTitle>
            <CardSubtitle>Per-agent overrides — runs can still override these.</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Model" htmlFor="agent-model">
              <Input id="agent-model" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-5-nano" />
            </Field>
            <Field label="Reasoning effort" htmlFor="agent-reasoning">
              <Select id="agent-reasoning" value={reasoningEffort} onChange={(e) => setReasoningEffort(e.target.value as any)}>
                <option value="minimal">minimal</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
              </Select>
            </Field>
            <Field label="Max output tokens" htmlFor="agent-max-tokens">
              <Input
                id="agent-max-tokens"
                type="number"
                value={maxOutputTokens}
                onChange={(e) => setMaxOutputTokens(Number(e.target.value || 0))}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Tool catalog</CardTitle>
            <CardSubtitle>
              Each tool maps to a Supabase operation. Use {`{{params.x}}`} to bind agent arguments.
            </CardSubtitle>
          </div>
          {schemas.length > 0 && (
            <Field label="Reference schema" htmlFor="ddl-ctx">
              <Select
                id="ddl-ctx"
                value={contextSchemaId}
                onChange={(e) => setContextSchemaId(e.target.value)}
                className="!w-56"
              >
                <option value="">(no AI context)</option>
                {schemas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </CardHeader>
        <CardBody>
          <ToolEditor tools={tools} onChange={setTools} ddlContext={ddlContext} />
        </CardBody>
      </Card>
    </div>
  );
}

const DEFAULT_PROMPT = `You are a helpful agent operating against a Supabase database.

Operating principles:
1. Always prefer calling a tool over guessing or fabricating data.
2. Resolve foreign keys (user IDs, category IDs, etc.) by querying first if not provided.
3. Never claim a write succeeded without confirming the tool returned data.
4. Be concise and cite IDs you actually saw. If data is missing, say so.
`;
