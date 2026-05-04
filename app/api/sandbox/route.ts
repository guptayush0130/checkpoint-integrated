/**
 * POST /api/sandbox  — boot a new SandboxInstance.
 *   body: { id?: string, ddl?: string, seed?: string, name?: string }
 *   → { id, env: { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY } }
 *
 * GET  /api/sandbox  — list active sandboxes.
 *
 * Mostly used by Phase 1 tests + the dashboard's "play with the sandbox"
 * button. The Phase 3 orchestrator will call `createSandbox` directly from
 * `lib/sandbox_pool` and never go through HTTP.
 */
import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createSandbox, listSandboxes } from '@/lib/sandbox_pool';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ sandboxes: listSandboxes() });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const id = String(body?.id || randomUUID());
  try {
    const { env } = await createSandbox(id, {
      schema: body?.ddl ? { sql: String(body.ddl) } : undefined,
      seed: body?.seed ? { sql: String(body.seed) } : undefined,
      name: body?.name ? String(body.name) : undefined
    });
    return NextResponse.json({ id, env }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 400 });
  }
}
