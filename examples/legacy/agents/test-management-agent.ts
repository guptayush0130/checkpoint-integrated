/**
 * Reference target agent for the bundled test-management schema.
 *
 * This agent is the example used to drive the audit harness. Replace it
 * with your own definition by exporting an object with `name`, `config`,
 * `systemPrompt`, and `tools[]` of the same shape — the harness is
 * agent-agnostic.
 *
 * Tools deliberately use the exact names the user requested so behavior
 * mirrors a real production setup.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { CustomAgentDefinition, ToolDefinition } from '../../src/harness/types';

// --------- prompt ---------

export const SYSTEM_PROMPT = `You are an expert QA platform agent. You help engineers manage a test catalog stored in Supabase.

Capabilities:
- Categories, test cases, test files, test runs, users, and user integrations.
- Create, read, update, search, and summarize operations via the tool catalog.

Operating principles:
1. ALWAYS prefer calling a tool over making something up. If a request is read-only, use a read tool.
2. Resolve foreign keys (user IDs, category IDs, test case IDs) by querying first when the user does not provide one.
3. Never claim a write succeeded without confirming the tool returned data.
4. Be concise. Cite IDs you actually saw. If the database lacks the requested data, say so.
5. For reporting/summarization tasks, use multiple tool calls if needed and present a structured answer.
6. If a tool fails, do NOT retry blindly — diagnose and respond honestly.`;

// --------- helpers ---------

const isUuid = (v: any) =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

async function resolveUser(supabase: SupabaseClient, value?: any): Promise<string | null> {
  if (isUuid(value)) return value;
  if (typeof value === 'string' && value.includes('@')) {
    const { data } = await supabase.from('users').select('id').eq('email', value).limit(1);
    if (data?.[0]?.id) return data[0].id;
  }
  const { data } = await supabase.from('users').select('id').limit(1);
  return data?.[0]?.id || null;
}

async function resolveCategory(supabase: SupabaseClient, value?: any): Promise<string | null> {
  if (isUuid(value)) return value;
  if (typeof value === 'string') {
    const { data } = await supabase.from('categories').select('id').ilike('name', value).limit(1);
    if (data?.[0]?.id) return data[0].id;
  }
  const { data } = await supabase.from('categories').select('id').limit(1);
  return data?.[0]?.id || null;
}

async function resolveTestCase(supabase: SupabaseClient, value?: any): Promise<string | null> {
  if (isUuid(value)) return value;
  const { data } = await supabase.from('test_cases').select('id').limit(1);
  return data?.[0]?.id || null;
}

const required = (params: any, key: string) => {
  const value = params?.[key];
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing required parameter: ${key}`);
  }
  return value;
};

// --------- tool definitions ---------

export const TOOLS: ToolDefinition[] = [
  {
    name: 'create-new-category',
    description: 'Create a new test category for organizing test cases.',
    parameters: {
      name: { type: 'string', description: 'Category name' },
      description: { type: 'string', description: 'Optional category description' },
      created_by: { type: 'string', description: 'Optional creator user UUID or email; defaults to first user' }
    },
    execute: async (supabase, params) => {
      const userId = await resolveUser(supabase, params.created_by);
      const { data, error } = await supabase
        .from('categories')
        .insert({ name: required(params, 'name'), description: params.description || '', created_by: userId })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
  },
  {
    name: 'add-category-to-test-case',
    description: 'Assign or move a test case to a category.',
    parameters: {
      test_case_id: { type: 'string' },
      category_id: { type: 'string' }
    },
    execute: async (supabase, params) => {
      const tcId = await resolveTestCase(supabase, params.test_case_id);
      const catId = await resolveCategory(supabase, params.category_id);
      if (!tcId) throw new Error('No test case found to update.');
      if (!catId) throw new Error('No category found to assign.');
      const { data, error } = await supabase
        .from('test_cases')
        .update({ category_id: catId, updated_at: new Date().toISOString() })
        .eq('id', tcId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
  },
  {
    name: 'create-new-test-case',
    description: 'Create a new test case.',
    parameters: {
      title: { type: 'string' },
      description: { type: 'string' },
      priority: { type: 'number', description: '1=low, 2=medium, 3=high, 4=critical' },
      status: { type: 'string', description: 'pending | active | archived' },
      category_id: { type: 'string', description: 'Optional category UUID or name' },
      created_by: { type: 'string', description: 'Optional user UUID or email' },
      metadata: { type: 'object' }
    },
    execute: async (supabase, params) => {
      const userId = await resolveUser(supabase, params.created_by);
      const categoryId = params.category_id ? await resolveCategory(supabase, params.category_id) : null;
      const { data, error } = await supabase
        .from('test_cases')
        .insert({
          title: required(params, 'title'),
          description: params.description || '',
          priority: clampPriority(params.priority),
          status: params.status || 'pending',
          category_id: categoryId,
          created_by: userId,
          metadata: params.metadata || {}
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
  },
  {
    name: 'create-new-test-file',
    description: 'Register a new test file.',
    parameters: {
      app: { type: 'string' },
      path: { type: 'string' },
      description: { type: 'string' },
      uploaded_by: { type: 'string', description: 'Optional user UUID or email' }
    },
    execute: async (supabase, params) => {
      const userId = await resolveUser(supabase, params.uploaded_by);
      const { data, error } = await supabase
        .from('test_files')
        .insert({
          app: required(params, 'app'),
          path: required(params, 'path'),
          description: params.description || '',
          uploaded_by: userId
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
  },
  {
    name: 'create-new-test-run',
    description: 'Log a test execution result.',
    parameters: {
      test_case_id: { type: 'string', description: 'UUID of the executed test case' },
      status: { type: 'string', description: 'passed | failed | skipped' },
      device_info: { type: 'object' },
      failures: { type: 'array', items: { type: 'object' } },
      executed_by: { type: 'string', description: 'Optional user UUID or email' }
    },
    execute: async (supabase, params) => {
      const userId = await resolveUser(supabase, params.executed_by);
      const tcId = await resolveTestCase(supabase, params.test_case_id);
      if (!tcId) throw new Error('No test case found to associate the run with.');
      const { data, error } = await supabase
        .from('test_runs')
        .insert({
          test_case_id: tcId,
          status: required(params, 'status'),
          device_info: params.device_info || {},
          failures: params.failures || [],
          executed_by: userId,
          executed_at: new Date().toISOString()
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
  },
  {
    name: 'get-categories-by-name',
    description: 'Find categories by partial name (case-insensitive).',
    parameters: {
      name: { type: 'string', description: 'Substring to match against category name' },
      limit: { type: 'number' }
    },
    execute: async (supabase, params) => {
      const limit = clampLimit(params.limit, 50);
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .ilike('name', `%${required(params, 'name')}%`)
        .limit(limit);
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-category-by-id',
    description: 'Retrieve a category by UUID.',
    parameters: {
      category_id: { type: 'string' }
    },
    execute: async (supabase, params) => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('id', required(params, 'category_id'))
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    }
  },
  {
    name: 'get-failures-by-device',
    description: 'Group recent failed test runs by device label.',
    parameters: {
      limit: { type: 'number' }
    },
    execute: async (supabase, params) => {
      const limit = clampLimit(params.limit, 200);
      const { data, error } = await supabase
        .from('test_runs')
        .select('device_info,failures')
        .eq('status', 'failed')
        .limit(limit);
      if (error) throw new Error(error.message);
      const out: Record<string, { count: number; failures: any[] }> = {};
      for (const run of data || []) {
        const device = (run as any).device_info?.device || 'unknown';
        if (!out[device]) out[device] = { count: 0, failures: [] };
        out[device].count++;
        const fs = (run as any).failures;
        if (Array.isArray(fs)) out[device].failures.push(...fs);
      }
      return out;
    }
  },
  {
    name: 'get-test-case-by-id',
    description: 'Retrieve a test case by UUID.',
    parameters: { test_case_id: { type: 'string' } },
    execute: async (supabase, params) => {
      const { data, error } = await supabase
        .from('test_cases')
        .select('*')
        .eq('id', required(params, 'test_case_id'))
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    }
  },
  {
    name: 'get-test-cases-by-category',
    description: 'List test cases belonging to a category (UUID or name).',
    parameters: { category: { type: 'string' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const categoryId = await resolveCategory(supabase, required(params, 'category'));
      if (!categoryId) return [];
      const limit = clampLimit(params.limit, 100);
      const { data, error } = await supabase
        .from('test_cases')
        .select('*')
        .eq('category_id', categoryId)
        .limit(limit);
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-test-cases-by-date-range',
    description: 'List test cases created within a date range (ISO).',
    parameters: { from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const limit = clampLimit(params.limit, 100);
      let q = supabase.from('test_cases').select('*').limit(limit);
      if (params.from) q = q.gte('created_at', String(params.from));
      if (params.to) q = q.lte('created_at', String(params.to));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-test-cases-by-priority',
    description: 'List test cases with a given priority (1..4).',
    parameters: { priority: { type: 'number' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const limit = clampLimit(params.limit, 100);
      const { data, error } = await supabase
        .from('test_cases')
        .select('*')
        .eq('priority', clampPriority(required(params, 'priority')))
        .limit(limit);
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-test-cases-by-status',
    description: 'List test cases with a given status.',
    parameters: { status: { type: 'string' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const limit = clampLimit(params.limit, 100);
      const { data, error } = await supabase
        .from('test_cases')
        .select('*')
        .eq('status', required(params, 'status'))
        .limit(limit);
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-test-cases-by-user-id',
    description: 'List test cases authored by a given user.',
    parameters: { user_id: { type: 'string' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const userId = await resolveUser(supabase, required(params, 'user_id'));
      if (!userId) return [];
      const limit = clampLimit(params.limit, 100);
      const { data, error } = await supabase
        .from('test_cases')
        .select('*')
        .eq('created_by', userId)
        .limit(limit);
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-test-file-by-id',
    description: 'Retrieve a test file by UUID.',
    parameters: { test_file_id: { type: 'string' } },
    execute: async (supabase, params) => {
      const { data, error } = await supabase
        .from('test_files')
        .select('*')
        .eq('id', required(params, 'test_file_id'))
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    }
  },
  {
    name: 'get-test-files-by-app',
    description: 'List test files belonging to an application label.',
    parameters: { app: { type: 'string' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const limit = clampLimit(params.limit, 100);
      const { data, error } = await supabase
        .from('test_files')
        .select('*')
        .eq('app', required(params, 'app'))
        .limit(limit);
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-test-files-by-date-range',
    description: 'List test files registered within a date range.',
    parameters: { from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const limit = clampLimit(params.limit, 100);
      let q = supabase.from('test_files').select('*').limit(limit);
      if (params.from) q = q.gte('created_at', String(params.from));
      if (params.to) q = q.lte('created_at', String(params.to));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-test-files-by-user-id',
    description: 'List test files uploaded by a user.',
    parameters: { user_id: { type: 'string' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const userId = await resolveUser(supabase, required(params, 'user_id'));
      if (!userId) return [];
      const limit = clampLimit(params.limit, 100);
      const { data, error } = await supabase
        .from('test_files')
        .select('*')
        .eq('uploaded_by', userId)
        .limit(limit);
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-test-run-by-id',
    description: 'Retrieve a test run by UUID.',
    parameters: { test_run_id: { type: 'string' } },
    execute: async (supabase, params) => {
      const { data, error } = await supabase
        .from('test_runs')
        .select('*')
        .eq('id', required(params, 'test_run_id'))
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    }
  },
  {
    name: 'get-test-run-statistics',
    description: 'Aggregate counts and pass rate across all test runs.',
    parameters: {},
    execute: async (supabase) => {
      const { data, error } = await supabase.from('test_runs').select('status');
      if (error) throw new Error(error.message);
      const stats = { total: 0, passed: 0, failed: 0, skipped: 0, pass_rate: 0 };
      for (const r of data || []) {
        stats.total++;
        if ((r as any).status === 'passed') stats.passed++;
        else if ((r as any).status === 'failed') stats.failed++;
        else if ((r as any).status === 'skipped') stats.skipped++;
      }
      if (stats.total) stats.pass_rate = Math.round((stats.passed / stats.total) * 100);
      return stats;
    }
  },
  {
    name: 'get-test-runs-by-date-range',
    description: 'List test runs executed within a date range.',
    parameters: { from: { type: 'string' }, to: { type: 'string' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const limit = clampLimit(params.limit, 200);
      let q = supabase.from('test_runs').select('*').limit(limit);
      if (params.from) q = q.gte('executed_at', String(params.from));
      if (params.to) q = q.lte('executed_at', String(params.to));
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-test-runs-by-status',
    description: 'List test runs with a given status.',
    parameters: { status: { type: 'string' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const limit = clampLimit(params.limit, 200);
      const { data, error } = await supabase
        .from('test_runs')
        .select('*')
        .eq('status', required(params, 'status'))
        .limit(limit);
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-test-runs-by-user-id',
    description: 'List test runs executed by a user.',
    parameters: { user_id: { type: 'string' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const userId = await resolveUser(supabase, required(params, 'user_id'));
      if (!userId) return [];
      const limit = clampLimit(params.limit, 200);
      const { data, error } = await supabase
        .from('test_runs')
        .select('*')
        .eq('executed_by', userId)
        .limit(limit);
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'get-user-by-id',
    description: 'Retrieve a user by UUID or email.',
    parameters: { user: { type: 'string', description: 'UUID or email' } },
    execute: async (supabase, params) => {
      const value = required(params, 'user');
      if (isUuid(value)) {
        const { data, error } = await supabase.from('users').select('*').eq('id', value).maybeSingle();
        if (error) throw new Error(error.message);
        return data;
      }
      const { data, error } = await supabase.from('users').select('*').eq('email', value).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    }
  },
  {
    name: 'get-user-integration-by-userid',
    description: 'List integrations linked to a user.',
    parameters: { user_id: { type: 'string' } },
    execute: async (supabase, params) => {
      const userId = await resolveUser(supabase, required(params, 'user_id'));
      if (!userId) return [];
      const { data, error } = await supabase
        .from('user_integrations')
        .select('*')
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'search-test-cases',
    description: 'Free-text search across test case title and description.',
    parameters: { query: { type: 'string' }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const q = required(params, 'query');
      const limit = clampLimit(params.limit, 50);
      const { data, error } = await supabase
        .from('test_cases')
        .select('*')
        .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
        .limit(limit);
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'search-test-cases-by-keywords',
    description: 'Search test cases that match all of the provided keywords (in title OR description).',
    parameters: { keywords: { type: 'array', items: { type: 'string' } }, limit: { type: 'number' } },
    execute: async (supabase, params) => {
      const keywords = (params.keywords as string[]) || [];
      const limit = clampLimit(params.limit, 50);
      if (!keywords.length) return [];
      let query = supabase.from('test_cases').select('*').limit(limit);
      for (const kw of keywords) {
        query = query.or(`title.ilike.%${kw}%,description.ilike.%${kw}%`);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data || [];
    }
  },
  {
    name: 'summarize-recent-runs',
    description: 'Return a structured summary (counts by status, top failing devices) for the latest test runs.',
    parameters: { since: { type: 'string', description: 'ISO timestamp; defaults to last 7 days' } },
    execute: async (supabase, params) => {
      const since = params.since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('test_runs')
        .select('status,device_info,failures,executed_at')
        .gte('executed_at', since)
        .limit(500);
      if (error) throw new Error(error.message);
      const byStatus: Record<string, number> = {};
      const failuresByDevice: Record<string, number> = {};
      for (const run of data || []) {
        const status = (run as any).status || 'unknown';
        byStatus[status] = (byStatus[status] || 0) + 1;
        if (status === 'failed') {
          const device = (run as any).device_info?.device || 'unknown';
          failuresByDevice[device] = (failuresByDevice[device] || 0) + 1;
        }
      }
      return {
        since,
        total: (data || []).length,
        by_status: byStatus,
        failures_by_device: failuresByDevice
      };
    }
  },
  {
    name: 'update-test-case-priority',
    description: 'Update the priority of a test case.',
    parameters: { test_case_id: { type: 'string' }, priority: { type: 'number' } },
    execute: async (supabase, params) => {
      const tcId = await resolveTestCase(supabase, required(params, 'test_case_id'));
      if (!tcId) throw new Error('No test case found to update.');
      const { data, error } = await supabase
        .from('test_cases')
        .update({ priority: clampPriority(required(params, 'priority')), updated_at: new Date().toISOString() })
        .eq('id', tcId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
  },
  {
    name: 'update-test-case-status',
    description: 'Update the status of a test case (pending | active | archived).',
    parameters: { test_case_id: { type: 'string' }, status: { type: 'string' } },
    execute: async (supabase, params) => {
      const tcId = await resolveTestCase(supabase, required(params, 'test_case_id'));
      if (!tcId) throw new Error('No test case found to update.');
      const { data, error } = await supabase
        .from('test_cases')
        .update({ status: required(params, 'status'), updated_at: new Date().toISOString() })
        .eq('id', tcId)
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    }
  }
];

function clampPriority(value: any): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 2;
  return Math.max(1, Math.min(4, Math.round(n)));
}

function clampLimit(value: any, defaultValue: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return defaultValue;
  return Math.min(n, 500);
}

const agent: CustomAgentDefinition = {
  name: 'test-management-agent',
  description: 'Reference QA platform agent over the bundled test-management schema.',
  config: { model: 'gpt-5-nano', reasoning_effort: 'low' },
  systemPrompt: SYSTEM_PROMPT,
  tools: TOOLS,
  tables: ['users', 'user_integrations', 'categories', 'test_cases', 'test_files', 'test_runs']
};

export default agent;
