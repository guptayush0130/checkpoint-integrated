'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Sparkles, AlertCircle, Database, BotMessageSquare, Settings } from 'lucide-react';
import Link from 'next/link';
import { Field, Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { AgentRecord, SchemaRecord } from '@/lib/types';

interface Props {
  agents: AgentRecord[];
  schemas: SchemaRecord[];
  openaiConfigured: boolean;
  defaultModel: string;
}

export function RunWizard({ agents, schemas, openaiConfigured, defaultModel }: Props) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(agents[0]?.id || '');
  const [schemaId, setSchemaId] = useState(schemas[0]?.id || '');
  const [testCount, setTestCount] = useState(5);
  const [autoTestCount, setAutoTestCount] = useState(false);
  const [chosenDefault, setChosenDefault] = useState(defaultModel);
  const [auditorModel, setAuditorModel] = useState('');
  const [targetModel, setTargetModel] = useState('');
  const [judgeModel, setJudgeModel] = useState('');
  const [maxToolIterations, setMaxToolIterations] = useState(10);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agent = agents.find((a) => a.id === agentId);
  const schema = schemas.find((s) => s.id === schemaId);

  const recommended = useMemo(() => {
    if (!agent) return 5;
    return Math.min(20, Math.max(3, agent.tools.length * 2));
  }, [agent]);

  async function launch() {
    if (!agentId || !schemaId) return;
    setError(null);
    setBusy(true);
    try {
      const body = {
        agentId,
        schemaId,
        testCount: autoTestCount ? recommended : testCount,
        autoTestCount,
        defaultModel: chosenDefault || defaultModel,
        auditorModel: auditorModel || undefined,
        targetModel: targetModel || undefined,
        judgeModel: judgeModel || undefined,
        maxToolIterations
      };
      const res = await fetch('/api/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || 'Launch failed');
      }
      const { run } = await res.json();
      router.push(`/runs/${run.id}`);
      router.refresh();
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {!openaiConfigured && (
        <div className="surface-flat border-warning-400/40 bg-warning-400/10 px-4 py-3 text-sm text-warning-500">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          OPENAI_API_KEY isn’t configured. Add it to <code className="font-mono">.env</code> and restart to launch real runs.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <BotMessageSquare className="h-4 w-4" />
              <CardTitle>1. Pick the agent</CardTitle>
            </div>
            <Link href="/agents/new" className="text-xs text-accent-500 hover:underline">
              + New agent
            </Link>
          </CardHeader>
          <CardBody className="space-y-3">
            <Field label="Agent">
              <Select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            {agent && (
              <div className="rounded-md border border-cream-300 bg-cream-50 px-3 py-3 text-xs text-ink-100">
                <div className="font-medium text-ink-500">{agent.name}</div>
                {agent.description && <div className="mt-1">{agent.description}</div>}
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone="neutral" className="font-mono uppercase">
                    {agent.tools.length} tools
                  </Badge>
                  {agent.model && (
                    <Badge tone="neutral" className="font-mono uppercase">
                      {agent.model}
                    </Badge>
                  )}
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4" />
              <CardTitle>2. Attach a schema</CardTitle>
            </div>
            <Link href="/schemas/new" className="text-xs text-accent-500 hover:underline">
              + New schema
            </Link>
          </CardHeader>
          <CardBody className="space-y-3">
            <Field label="Schema">
              <Select value={schemaId} onChange={(e) => setSchemaId(e.target.value)}>
                {schemas.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            {schema && (
              <div className="rounded-md border border-cream-300 bg-cream-50 px-3 py-3 text-xs text-ink-100">
                <div className="font-medium text-ink-500">{schema.name}</div>
                {schema.description && <div className="mt-1">{schema.description}</div>}
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone="neutral" className="font-mono uppercase">
                    density · {schema.density}
                  </Badge>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            <CardTitle>3. Test coverage</CardTitle>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Test count"
              hint={
                autoTestCount
                  ? `Auto: recommended ${recommended} based on tool count.`
                  : 'How many test cases should the auditor generate?'
              }
            >
              <Input
                type="number"
                min={1}
                max={50}
                value={autoTestCount ? recommended : testCount}
                onChange={(e) => setTestCount(Math.max(1, Math.min(50, Number(e.target.value || 1))))}
                disabled={autoTestCount}
              />
            </Field>
            <Field label="Mode" hint="Auto picks a smart count based on tools.">
              <div className="flex gap-2 rounded-md border border-cream-300 bg-white p-1">
                <button
                  type="button"
                  onClick={() => setAutoTestCount(false)}
                  className={`flex-1 rounded px-3 py-1.5 text-xs font-medium ${
                    !autoTestCount ? 'bg-ink-500 text-cream-50' : 'text-ink-100'
                  }`}
                >
                  Custom
                </button>
                <button
                  type="button"
                  onClick={() => setAutoTestCount(true)}
                  className={`flex-1 rounded px-3 py-1.5 text-xs font-medium ${
                    autoTestCount ? 'bg-ink-500 text-cream-50' : 'text-ink-100'
                  }`}
                >
                  Auto
                </button>
              </div>
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4" />
            <CardTitle>4. Models & limits</CardTitle>
          </div>
        </CardHeader>
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Default model" hint="Used unless overridden below.">
              <Input
                value={chosenDefault}
                onChange={(e) => setChosenDefault(e.target.value)}
                placeholder="gpt-5-nano"
              />
            </Field>
            <Field label="Auditor model" hint="Generates test cases.">
              <Input value={auditorModel} onChange={(e) => setAuditorModel(e.target.value)} placeholder="(default)" />
            </Field>
            <Field label="Target model" hint="The agent under test.">
              <Input value={targetModel} onChange={(e) => setTargetModel(e.target.value)} placeholder="(agent default)" />
            </Field>
            <Field label="Judge model" hint="Scores rubrics.">
              <Input value={judgeModel} onChange={(e) => setJudgeModel(e.target.value)} placeholder="(default)" />
            </Field>
            <Field label="Max tool iterations" hint="Cap on tool calls per test.">
              <Input
                type="number"
                value={maxToolIterations}
                onChange={(e) => setMaxToolIterations(Math.max(1, Number(e.target.value || 1)))}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      {error && (
        <div className="surface-flat border-accent-400/30 bg-accent-50 px-4 py-2 text-sm text-accent-600">
          {error}
        </div>
      )}

      <div className="flex justify-end">
        <Button
          variant="accent"
          size="lg"
          type="button"
          onClick={launch}
          disabled={busy || !agentId || !schemaId || !openaiConfigured}
        >
          {busy ? 'Launching…' : 'Launch run'} <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
