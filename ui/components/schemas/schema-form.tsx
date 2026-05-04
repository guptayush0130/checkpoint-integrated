'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, Sparkles, Trash2, Wand2, AlertCircle } from 'lucide-react';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import type { DataDensity, SchemaRecord } from '@/lib/types';
import { TEMPLATE_LIBRARY } from './schema-templates';

interface SchemaFormProps {
  initial?: SchemaRecord;
}

export function SchemaForm({ initial }: SchemaFormProps) {
  const router = useRouter();
  const [name, setName] = useState(initial?.name || '');
  const [description, setDescription] = useState(initial?.description || '');
  const [ddlSql, setDdlSql] = useState(initial?.ddlSql || '');
  const [seedSql, setSeedSql] = useState(initial?.seedSql || '');
  const [density, setDensity] = useState<DataDensity>(initial?.density || 'medium');
  const [aiDescription, setAiDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [seedBusy, setSeedBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  function applyTemplate(id: string) {
    const tpl = TEMPLATE_LIBRARY.find((t) => t.id === id);
    if (!tpl) return;
    if (!name) setName(tpl.name);
    setDescription(tpl.description);
    setDdlSql(tpl.ddlSql);
    setSeedSql(tpl.seedSql);
  }

  async function generateSchema() {
    if (!aiDescription) {
      setAiError('Describe what you want first.');
      return;
    }
    setAiError(null);
    setAiBusy(true);
    try {
      const res = await fetch('/api/generate/schema', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: aiDescription })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || 'Failed');
      }
      const data = await res.json();
      setDdlSql(data.ddlSql);
      setSeedSql(data.seedSql || '');
    } catch (err: any) {
      setAiError(err?.message || String(err));
    } finally {
      setAiBusy(false);
    }
  }

  async function regenerateSeed() {
    if (!ddlSql) {
      setAiError('Paste DDL first.');
      return;
    }
    setAiError(null);
    setSeedBusy(true);
    try {
      const res = await fetch('/api/generate/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ddlSql, density })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || 'Failed');
      }
      const data = await res.json();
      setSeedSql(data.seedSql || '');
    } catch (err: any) {
      setAiError(err?.message || String(err));
    } finally {
      setSeedBusy(false);
    }
  }

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const payload: Partial<SchemaRecord> = {
        name,
        description,
        ddlSql,
        seedSql,
        density
      };
      const url = initial ? `/api/schemas/${initial.id}` : '/api/schemas';
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
      const { schema } = await res.json();
      router.push(`/schemas/${schema.id}`);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!initial) return;
    if (!confirm(`Delete schema "${initial.name}"? This cannot be undone.`)) return;
    await fetch(`/api/schemas/${initial.id}`, { method: 'DELETE' });
    router.push('/schemas');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Link href="/schemas" className="inline-flex items-center gap-1 text-sm text-ink-100 hover:text-ink-500">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to schemas
        </Link>
        <div className="flex items-center gap-2">
          {initial && (
            <Button variant="danger" type="button" onClick={remove}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
          <Button variant="primary" type="button" onClick={save} disabled={busy || !name || !ddlSql}>
            <Save className="h-4 w-4" /> {busy ? 'Saving…' : initial ? 'Save changes' : 'Create schema'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="surface-flat border-accent-400/30 bg-accent-50 px-4 py-2 text-sm text-accent-600">
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Identity & density</CardTitle>
            <CardSubtitle>Name your schema and pick how dense the seed data should be.</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Test management v1" />
            </Field>
            <Field label="Description">
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Data density" hint="Used by AI seed generation and run summaries.">
              <Select value={density} onChange={(e) => setDensity(e.target.value as DataDensity)}>
                <option value="sparse">Sparse — 3–5 rows per table</option>
                <option value="medium">Medium — 20–50 rows per table</option>
                <option value="dense">Dense — 100–200 rows per table</option>
                <option value="custom">Custom — leave seed as-is</option>
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Quick start</CardTitle>
            <CardSubtitle>Pick a template, generate from a description, or paste your own DDL below.</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody className="space-y-5">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TEMPLATE_LIBRARY.map((tpl) => (
              <button
                key={tpl.id}
                type="button"
                onClick={() => applyTemplate(tpl.id)}
                className="surface-flat px-4 py-4 text-left transition-colors hover:bg-cream-100"
              >
                <div className="editorial-mark">{tpl.marker}</div>
                <div className="mt-1 font-medium">{tpl.name}</div>
                <div className="mt-1 text-xs text-ink-100 leading-relaxed">{tpl.description}</div>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-[1fr,auto] sm:items-end">
            <Field
              label="Or describe what you want"
              hint="Checkpoint will draft DDL + seed data with gpt-5-nano."
            >
              <Input
                value={aiDescription}
                onChange={(e) => setAiDescription(e.target.value)}
                placeholder="e.g. SaaS billing app with workspaces, members, plans, invoices, audit_logs"
              />
            </Field>
            <Button type="button" onClick={generateSchema} disabled={aiBusy} variant="accent" size="lg">
              <Sparkles className="h-4 w-4" /> {aiBusy ? 'Generating…' : 'Generate'}
            </Button>
          </div>
          {aiError && (
            <div className="flex items-start gap-2 rounded-md bg-accent-50 px-3 py-2 text-xs text-accent-600">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5" /> {aiError}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>DDL</CardTitle>
            <CardSubtitle>Postgres-compatible CREATE TABLE / INDEX / FUNCTION statements.</CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          <Textarea rows={18} value={ddlSql} onChange={(e) => setDdlSql(e.target.value)} placeholder="CREATE TABLE..." />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Seed data</CardTitle>
            <CardSubtitle>INSERT statements that populate the sandbox before each run.</CardSubtitle>
          </div>
          <Button type="button" variant="secondary" onClick={regenerateSeed} disabled={seedBusy || !ddlSql}>
            <Wand2 className="h-4 w-4" /> {seedBusy ? 'Generating…' : 'Generate seed'}
          </Button>
        </CardHeader>
        <CardBody>
          <Textarea rows={14} value={seedSql} onChange={(e) => setSeedSql(e.target.value)} placeholder="INSERT INTO ..." />
        </CardBody>
      </Card>
    </div>
  );
}
