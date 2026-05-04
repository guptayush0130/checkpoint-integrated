/**
 * Compiles a declarative `ToolSpec` into a `ToolDefinition` whose `execute`
 * function performs the requested operation against a real `SupabaseClient`.
 *
 * Every implementation kind maps to the corresponding `@supabase/supabase-js`
 * call so the mock executes the request through its full PostgREST pipeline
 * (filters, prefer headers, return shape) — exactly as a real Supabase
 * deployment would.
 *
 * Templating
 * ----------
 * Filter values, insert/update/upsert values, RPC args, and SQL bindings can
 * use `{{params.key}}` to reference the agent's tool-call arguments at runtime.
 * Unknown templates resolve to `null`. Plain strings are used as-is.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  FilterSpec,
  ParamSpec,
  ToolImplementation,
  ToolSpec
} from './types';
import type { ToolDefinition } from '@/src/harness/types';

const TEMPLATE_RE = /\{\{\s*params\.([a-zA-Z_][\w.]*)\s*\}\}/g;

function resolveTemplate(template: string, params: Record<string, any>): any {
  if (typeof template !== 'string') return template;
  // Whole-string template such as `{{params.title}}` keeps the original type.
  const wholeMatch = template.trim().match(/^\{\{\s*params\.([a-zA-Z_][\w.]*)\s*\}\}$/);
  if (wholeMatch) {
    return readPath(params, wholeMatch[1]);
  }
  // Inline interpolation inside a larger string.
  return template.replace(TEMPLATE_RE, (_, key) => {
    const value = readPath(params, key);
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  });
}

function readPath(obj: Record<string, any>, path: string): any {
  const parts = path.split('.');
  let cur: any = obj;
  for (const part of parts) {
    if (cur && typeof cur === 'object' && part in cur) {
      cur = cur[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function applyFilters(
  query: any,
  filters: FilterSpec[],
  params: Record<string, any>
) {
  for (const f of filters || []) {
    let value: any = resolveTemplate(f.value, params);
    if (value === undefined || value === null) continue;
    switch (f.op) {
      case 'eq':
      case 'neq':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        query = query[f.op](f.column, coerce(value));
        break;
      case 'like':
      case 'ilike':
        query = query[f.op](f.column, String(value));
        break;
      case 'in': {
        const list = Array.isArray(value) ? value : String(value).split(',').map((s) => s.trim()).filter(Boolean);
        query = query.in(f.column, list);
        break;
      }
      case 'is':
        query = query.is(f.column, coerceIs(value));
        break;
    }
  }
  return query;
}

function coerce(value: any): any {
  if (typeof value !== 'string') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (/^-?\d+\.\d+$/.test(value)) return Number(value);
  return value;
}

function coerceIs(value: any): any {
  if (value === 'null' || value === null) return null;
  if (value === 'true' || value === true) return true;
  if (value === 'false' || value === false) return false;
  return value;
}

function buildValueRecord(
  template: Record<string, string>,
  params: Record<string, any>
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [key, expr] of Object.entries(template || {})) {
    const resolved = resolveTemplate(expr, params);
    if (resolved !== undefined) out[key] = resolved;
  }
  return out;
}

export function compileTool(spec: ToolSpec): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    parameters: paramsToJsonSchema(spec.parameters || {}),
    execute: async (supabase: SupabaseClient, params: Record<string, any>) => {
      return runImplementation(spec.implementation, supabase, params);
    }
  };
}

export function compileTools(specs: ToolSpec[]): ToolDefinition[] {
  return specs.map(compileTool);
}

async function runImplementation(
  impl: ToolImplementation,
  supabase: SupabaseClient,
  params: Record<string, any>
): Promise<any> {
  switch (impl.kind) {
    case 'select': {
      let q: any = supabase.from(impl.table).select(impl.columns || '*');
      if (impl.filters) q = applyFilters(q, impl.filters, params);
      if (impl.orderBy) q = q.order(impl.orderBy, { ascending: impl.orderAsc !== false });
      if (typeof impl.limit === 'number' && impl.limit > 0) q = q.limit(impl.limit);
      if (impl.single) q = q.single();
      else if (impl.maybeSingle) q = q.maybeSingle();
      const { data, error } = await q;
      if (error) throw new Error(formatPgError(error));
      return data;
    }
    case 'insert': {
      const values = buildValueRecord(impl.values, params);
      let q: any = supabase.from(impl.table).insert(values);
      if (impl.returnRow !== false) q = q.select();
      const result: any = await q;
      if (result.error) throw new Error(formatPgError(result.error));
      const data = result.data;
      return Array.isArray(data) && data.length === 1 ? data[0] : data;
    }
    case 'update': {
      const values = buildValueRecord(impl.values, params);
      let q: any = supabase.from(impl.table).update(values);
      q = applyFilters(q, impl.filters, params);
      if (impl.returnRow !== false) q = q.select();
      const result: any = await q;
      if (result.error) throw new Error(formatPgError(result.error));
      const data = result.data;
      return Array.isArray(data) && data.length === 1 ? data[0] : data;
    }
    case 'delete': {
      let q: any = supabase.from(impl.table).delete();
      q = applyFilters(q, impl.filters, params);
      if (impl.returnRow !== false) q = q.select();
      const result: any = await q;
      if (result.error) throw new Error(formatPgError(result.error));
      return result.data || [];
    }
    case 'upsert': {
      const values = buildValueRecord(impl.values, params);
      const opts = impl.onConflict ? { onConflict: impl.onConflict } : undefined;
      let q: any = supabase.from(impl.table).upsert(values, opts as any);
      if (impl.returnRow !== false) q = q.select();
      const result: any = await q;
      if (result.error) throw new Error(formatPgError(result.error));
      const data = result.data;
      return Array.isArray(data) && data.length === 1 ? data[0] : data;
    }
    case 'rpc': {
      const args = buildValueRecord(impl.args, params);
      const { data, error } = await supabase.rpc(impl.function, args);
      if (error) throw new Error(formatPgError(error));
      return data;
    }
    case 'sql': {
      // PGlite is real Postgres so we expose a generic SQL escape hatch
      // through a Postgres function call. We use postgres-style :name bindings.
      // To honor the abstraction, we go through the REST RPC if a function
      // with this body is unavailable; otherwise we degrade to a direct
      // exec on the underlying client (only available server-side).
      throw new Error(
        'SQL implementation is not callable via supabase-js client; use rpc/select/update/insert/delete/upsert.'
      );
    }
  }
}

function paramsToJsonSchema(params: Record<string, ParamSpec>) {
  const properties: Record<string, any> = {};
  const required: string[] = [];
  for (const [key, spec] of Object.entries(params || {})) {
    const node: any = { type: spec.type, description: spec.description };
    if (spec.enum) node.enum = spec.enum;
    if (spec.type === 'array') node.items = { type: 'string' };
    properties[key] = node;
    if (spec.required) required.push(key);
  }
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: true
  };
}

function formatPgError(err: any): string {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err.message || JSON.stringify(err);
}
