'use client';
import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  Sparkles,
  AlertCircle
} from 'lucide-react';
import { Field, Input, Select, Textarea } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import type {
  FilterOp,
  FilterSpec,
  ParamSpec,
  ToolImplementation,
  ToolSpec
} from '@/lib/types';

const OPS: FilterOp[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is'];

interface ToolEditorProps {
  tools: ToolSpec[];
  onChange: (tools: ToolSpec[]) => void;
  /** Current schema DDL to use for AI-generated tool implementations. */
  ddlContext?: string;
}

export function ToolEditor({ tools, onChange, ddlContext }: ToolEditorProps) {
  const update = (index: number, next: ToolSpec) => {
    const copy = tools.slice();
    copy[index] = next;
    onChange(copy);
  };
  const remove = (index: number) => {
    onChange(tools.filter((_, i) => i !== index));
  };
  const add = (preset?: Partial<ToolSpec>) => {
    onChange([
      ...tools,
      preset
        ? sanitize(preset)
        : sanitize({
            name: 'new-tool',
            description: '',
            parameters: {},
            implementation: { kind: 'select', table: '', columns: '*' }
          })
    ]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" type="button" onClick={() => add()}>
          <Plus className="h-3.5 w-3.5" /> Add tool
        </Button>
        <span className="text-xs text-ink-50">
          {tools.length} {tools.length === 1 ? 'tool' : 'tools'} defined
        </span>
      </div>

      {tools.length === 0 && (
        <div className="surface px-6 py-8 text-center">
          <div className="editorial-mark">No tools yet</div>
          <p className="mt-2 text-sm text-ink-100">
            Tools map agent intent to Supabase operations. Add a select for queries, an insert for
            creates, an update or delete for mutations.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {tools.map((tool, index) => (
          <ToolCard
            key={index}
            tool={tool}
            ddlContext={ddlContext}
            onChange={(next) => update(index, next)}
            onRemove={() => remove(index)}
          />
        ))}
      </div>
    </div>
  );
}

function ToolCard({
  tool,
  onChange,
  onRemove,
  ddlContext
}: {
  tool: ToolSpec;
  onChange: (next: ToolSpec) => void;
  onRemove: () => void;
  ddlContext?: string;
}) {
  const [open, setOpen] = useState(true);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const setField = <K extends keyof ToolSpec>(key: K, value: ToolSpec[K]) =>
    onChange({ ...tool, [key]: value });

  const setImpl = (impl: ToolImplementation) => onChange({ ...tool, implementation: impl });

  const onChangeKind = (kind: ToolImplementation['kind']) => {
    const base = { kind } as any;
    switch (kind) {
      case 'select':
        setImpl({ kind: 'select', table: getTable(tool), columns: '*' });
        break;
      case 'insert':
        setImpl({ kind: 'insert', table: getTable(tool), values: {}, returnRow: true });
        break;
      case 'update':
        setImpl({ kind: 'update', table: getTable(tool), values: {}, filters: [], returnRow: true });
        break;
      case 'delete':
        setImpl({ kind: 'delete', table: getTable(tool), filters: [], returnRow: true });
        break;
      case 'upsert':
        setImpl({ kind: 'upsert', table: getTable(tool), values: {}, returnRow: true });
        break;
      case 'rpc':
        setImpl({ kind: 'rpc', function: '', args: {} });
        break;
      case 'sql':
        setImpl({ kind: 'sql', sql: '' });
        break;
    }
  };

  async function generateWithAi() {
    if (!tool.description) {
      setAiError('Add a description first so the model knows what to design.');
      return;
    }
    setAiError(null);
    setAiBusy(true);
    try {
      const res = await fetch('/api/generate/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: tool.description, ddlSql: ddlContext || '' })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.error || 'Generation failed');
      }
      const { tool: suggested } = await res.json();
      const merged: ToolSpec = sanitize({
        ...tool,
        ...suggested,
        name: tool.name || suggested?.name || 'generated-tool'
      });
      onChange(merged);
    } catch (err: any) {
      setAiError(err?.message || String(err));
    } finally {
      setAiBusy(false);
    }
  }

  return (
    <div className="surface-flat">
      <div className="flex items-start gap-3 border-b border-cream-300 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-ink-100 hover:text-ink-500"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-[1.2fr,2fr]">
          <Input
            value={tool.name}
            onChange={(e) => setField('name', e.target.value)}
            placeholder="kebab-case-tool-name"
            className="font-mono text-xs"
          />
          <Input
            value={tool.description}
            onChange={(e) => setField('description', e.target.value)}
            placeholder="What does this tool do? (LLM sees this)"
          />
        </div>
        <div className="flex items-center gap-1">
          <Badge tone="neutral" className="font-mono uppercase">
            {tool.implementation.kind}
          </Badge>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={generateWithAi}
            disabled={aiBusy}
            title="Generate implementation from description"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {aiBusy ? 'Thinking…' : 'AI'}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5 text-accent-500" />
          </Button>
        </div>
      </div>

      {aiError && (
        <div className="flex items-start gap-2 border-b border-cream-300 bg-accent-50 px-4 py-2 text-xs text-accent-600">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5" /> {aiError}
        </div>
      )}

      {open && (
        <div className="space-y-5 px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Operation kind" htmlFor={`kind-${tool.name}`}>
              <Select
                id={`kind-${tool.name}`}
                value={tool.implementation.kind}
                onChange={(e) => onChangeKind(e.target.value as ToolImplementation['kind'])}
              >
                <option value="select">select — read rows</option>
                <option value="insert">insert — create row</option>
                <option value="update">update — change rows</option>
                <option value="upsert">upsert — insert or merge</option>
                <option value="delete">delete — remove rows</option>
                <option value="rpc">rpc — call a Postgres function</option>
              </Select>
            </Field>
            {tool.implementation.kind !== 'rpc' && tool.implementation.kind !== 'sql' && (
              <Field label="Table" htmlFor={`table-${tool.name}`}>
                <Input
                  id={`table-${tool.name}`}
                  value={(tool.implementation as any).table || ''}
                  onChange={(e) => setImpl({ ...(tool.implementation as any), table: e.target.value })}
                  placeholder="public_table_name"
                  className="font-mono"
                />
              </Field>
            )}
            {tool.implementation.kind === 'rpc' && (
              <Field label="Function name" htmlFor={`fn-${tool.name}`}>
                <Input
                  id={`fn-${tool.name}`}
                  value={(tool.implementation as any).function || ''}
                  onChange={(e) =>
                    setImpl({ ...(tool.implementation as any), function: e.target.value })
                  }
                  placeholder="my_postgres_function"
                  className="font-mono"
                />
              </Field>
            )}
          </div>

          <ParametersEditor
            value={tool.parameters}
            onChange={(next) => setField('parameters', next)}
          />

          <ImplementationEditor
            implementation={tool.implementation}
            onChange={setImpl}
          />
        </div>
      )}
    </div>
  );
}

function ParametersEditor({
  value,
  onChange
}: {
  value: Record<string, ParamSpec>;
  onChange: (next: Record<string, ParamSpec>) => void;
}) {
  const entries = Object.entries(value || {});
  const setEntry = (oldKey: string, newKey: string, spec: ParamSpec) => {
    const next: Record<string, ParamSpec> = {};
    for (const [k, v] of entries) {
      if (k === oldKey) next[newKey || oldKey] = spec;
      else next[k] = v;
    }
    onChange(next);
  };
  const removeKey = (k: string) => {
    const next = { ...value };
    delete next[k];
    onChange(next);
  };
  const addKey = () => {
    const k = nextParamName(value);
    onChange({ ...value, [k]: { type: 'string' } });
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="editorial-mark">Parameters</div>
          <p className="text-xs text-ink-100">Inputs the LLM passes to this tool when calling it.</p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={addKey}>
          <Plus className="h-3.5 w-3.5" /> Add parameter
        </Button>
      </div>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-cream-300 px-4 py-3 text-xs text-ink-50">
          No parameters. The LLM will call this tool with an empty argument object.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, spec]) => (
            <div
              key={key}
              className="grid gap-2 sm:grid-cols-[1fr,140px,2fr,80px,auto] sm:items-center"
            >
              <Input
                value={key}
                onChange={(e) => setEntry(key, e.target.value, spec)}
                placeholder="param_name"
                className="font-mono text-xs"
              />
              <Select
                value={spec.type}
                onChange={(e) => setEntry(key, key, { ...spec, type: e.target.value as ParamSpec['type'] })}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="boolean">boolean</option>
                <option value="object">object</option>
                <option value="array">array</option>
              </Select>
              <Input
                value={spec.description || ''}
                onChange={(e) => setEntry(key, key, { ...spec, description: e.target.value })}
                placeholder="What this parameter is for (LLM sees this)"
              />
              <label className="flex items-center gap-2 text-xs text-ink-100">
                <input
                  type="checkbox"
                  checked={!!spec.required}
                  onChange={(e) => setEntry(key, key, { ...spec, required: e.target.checked })}
                />
                required
              </label>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeKey(key)}>
                <Trash2 className="h-3.5 w-3.5 text-accent-500" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImplementationEditor({
  implementation,
  onChange
}: {
  implementation: ToolImplementation;
  onChange: (next: ToolImplementation) => void;
}) {
  switch (implementation.kind) {
    case 'select':
      return <SelectEditor impl={implementation} onChange={onChange} />;
    case 'insert':
      return <ValueEditor impl={implementation} onChange={onChange} kind="insert" />;
    case 'update':
      return (
        <>
          <ValueEditor impl={implementation} onChange={onChange} kind="update" />
          <FilterEditor
            filters={implementation.filters || []}
            onChange={(filters) => onChange({ ...implementation, filters })}
          />
        </>
      );
    case 'upsert':
      return (
        <>
          <ValueEditor impl={implementation} onChange={onChange} kind="upsert" />
          <Field
            label="On conflict columns"
            hint="Comma-separated columns that define a duplicate (e.g. id or email)."
          >
            <Input
              value={implementation.onConflict || ''}
              onChange={(e) => onChange({ ...implementation, onConflict: e.target.value })}
              placeholder="id"
              className="font-mono text-xs"
            />
          </Field>
        </>
      );
    case 'delete':
      return (
        <FilterEditor
          filters={implementation.filters || []}
          onChange={(filters) => onChange({ ...implementation, filters })}
        />
      );
    case 'rpc':
      return <ValueEditor impl={implementation} onChange={onChange} kind="rpc" />;
    case 'sql':
      return (
        <Field
          label="SQL"
          hint="Plain SQL. Note: SQL escape hatch is read-only and bypasses the agent surface."
        >
          <Textarea rows={6} value={implementation.sql} onChange={(e) => onChange({ ...implementation, sql: e.target.value })} />
        </Field>
      );
    default:
      return null;
  }
}

function SelectEditor({
  impl,
  onChange
}: {
  impl: Extract<ToolImplementation, { kind: 'select' }>;
  onChange: (next: ToolImplementation) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Columns" hint="Comma-separated, or * for all.">
          <Input
            value={impl.columns || '*'}
            onChange={(e) => onChange({ ...impl, columns: e.target.value })}
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Order by">
          <Input
            value={impl.orderBy || ''}
            onChange={(e) => onChange({ ...impl, orderBy: e.target.value })}
            placeholder="created_at"
            className="font-mono text-xs"
          />
        </Field>
        <Field label="Limit">
          <Input
            type="number"
            value={impl.limit ?? ''}
            onChange={(e) => onChange({ ...impl, limit: e.target.value ? Number(e.target.value) : undefined })}
            placeholder="50"
          />
        </Field>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex items-center gap-2 text-xs text-ink-100">
          <input
            type="checkbox"
            checked={impl.orderAsc !== false}
            onChange={(e) => onChange({ ...impl, orderAsc: e.target.checked })}
          />
          ascending
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-100">
          <input
            type="checkbox"
            checked={!!impl.single}
            onChange={(e) => onChange({ ...impl, single: e.target.checked, maybeSingle: false })}
          />
          single() — fail if 0 or many
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-100">
          <input
            type="checkbox"
            checked={!!impl.maybeSingle}
            onChange={(e) =>
              onChange({ ...impl, maybeSingle: e.target.checked, single: false })
            }
          />
          maybeSingle() — null if missing
        </label>
      </div>
      <FilterEditor
        filters={impl.filters || []}
        onChange={(filters) => onChange({ ...impl, filters })}
      />
    </div>
  );
}

function ValueEditor({
  impl,
  onChange,
  kind
}: {
  impl: any;
  onChange: (next: ToolImplementation) => void;
  kind: 'insert' | 'update' | 'upsert' | 'rpc';
}) {
  const valueKey = kind === 'rpc' ? 'args' : 'values';
  const values: Record<string, string> = impl[valueKey] || {};
  const entries = Object.entries(values);
  const setEntry = (oldKey: string, newKey: string, value: string) => {
    const next: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (k === oldKey) next[newKey || oldKey] = value;
      else next[k] = v;
    }
    onChange({ ...impl, [valueKey]: next });
  };
  const remove = (k: string) => {
    const next = { ...values };
    delete next[k];
    onChange({ ...impl, [valueKey]: next });
  };
  const add = () => onChange({ ...impl, [valueKey]: { ...values, [`column_${entries.length + 1}`]: '' } });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="editorial-mark">{kind === 'rpc' ? 'RPC arguments' : 'Column values'}</div>
          <p className="text-xs text-ink-100">
            Use <code>{`{{params.x}}`}</code> to bind to call arguments. Plain text becomes a literal.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5" /> Add {kind === 'rpc' ? 'arg' : 'column'}
        </Button>
      </div>
      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed border-cream-300 px-4 py-3 text-xs text-ink-50">
          No {kind === 'rpc' ? 'arguments' : 'columns'} mapped.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, value]) => (
            <div key={key} className="grid gap-2 sm:grid-cols-[1fr,2fr,auto] sm:items-center">
              <Input
                value={key}
                onChange={(e) => setEntry(key, e.target.value, value)}
                placeholder={kind === 'rpc' ? 'arg_name' : 'column_name'}
                className="font-mono text-xs"
              />
              <Input
                value={value}
                onChange={(e) => setEntry(key, key, e.target.value)}
                placeholder="{{params.x}} or literal"
                className="font-mono text-xs"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(key)}>
                <Trash2 className="h-3.5 w-3.5 text-accent-500" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function FilterEditor({
  filters,
  onChange
}: {
  filters: FilterSpec[];
  onChange: (next: FilterSpec[]) => void;
}) {
  const set = (i: number, patch: Partial<FilterSpec>) => {
    const next = filters.slice();
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const remove = (i: number) => onChange(filters.filter((_, j) => j !== i));
  const add = () => onChange([...filters, { column: '', op: 'eq', value: '' }]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="editorial-mark">Filters</div>
          <p className="text-xs text-ink-100">
            Combined with AND. Templates resolve at runtime: empty values are skipped.
          </p>
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={add}>
          <Plus className="h-3.5 w-3.5" /> Add filter
        </Button>
      </div>
      {filters.length === 0 ? (
        <div className="rounded-md border border-dashed border-cream-300 px-4 py-3 text-xs text-ink-50">
          No filters. The operation applies to all rows.
        </div>
      ) : (
        <div className="space-y-2">
          {filters.map((f, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-[1fr,120px,2fr,auto] sm:items-center">
              <Input
                value={f.column}
                onChange={(e) => set(i, { column: e.target.value })}
                placeholder="column"
                className="font-mono text-xs"
              />
              <Select value={f.op} onChange={(e) => set(i, { op: e.target.value as FilterOp })}>
                {OPS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </Select>
              <Input
                value={f.value}
                onChange={(e) => set(i, { value: e.target.value })}
                placeholder="{{params.id}} or literal"
                className="font-mono text-xs"
              />
              <Button type="button" variant="ghost" size="sm" onClick={() => remove(i)}>
                <Trash2 className="h-3.5 w-3.5 text-accent-500" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- helpers ----------

function getTable(tool: ToolSpec): string {
  return ((tool.implementation as any)?.table || '') as string;
}

function nextParamName(existing: Record<string, ParamSpec>): string {
  let i = 1;
  while (`param_${i}` in existing) i++;
  return `param_${i}`;
}

function sanitize(input: any): ToolSpec {
  return {
    name: input.name || 'new-tool',
    description: input.description || '',
    parameters: typeof input.parameters === 'object' && input.parameters !== null ? input.parameters : {},
    implementation:
      input.implementation && typeof input.implementation === 'object'
        ? (input.implementation as ToolImplementation)
        : { kind: 'select', table: '', columns: '*' }
  };
}

export { sanitize as sanitizeToolSpec };

export function cnDebug(...inputs: any[]) {
  return cn(...inputs);
}
