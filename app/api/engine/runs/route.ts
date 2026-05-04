/**
 * POST /api/engine/runs  — start a new MCTS run with the full engine config.
 *   body: EngineRunConfig (see core_engine/engine_types.ts)
 *   → 201 { runId }
 *
 * GET  /api/engine/runs  — list past runs from disk (delegates to lib/storage).
 *
 * The Phase 4 dashboard hits this route. The legacy `/api/runs` POST is
 * intentionally left throwing the Phase 0 "agentId/schemaId" stub error;
 * Phase 5 deletes the legacy surface entirely.
 */
import { NextRequest, NextResponse } from 'next/server';
import { listRuns } from '@/lib/storage';
import { startEngineRun } from '@/core/orchestrator';
import type { RunConfig as EngineRunConfig } from '@/core/engine_types';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ runs: await listRuns() });
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const errors = validateEngineConfig(body);
  if (errors.length) {
    return NextResponse.json({ error: 'invalid config', details: errors }, { status: 400 });
  }

  try {
    const { runId } = await startEngineRun(body as EngineRunConfig);
    return NextResponse.json({ runId }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

function validateEngineConfig(body: any): string[] {
  const errors: string[] = [];
  if (!body || typeof body !== 'object') return ['body must be an object'];
  if (!body.input || typeof body.input !== 'object') errors.push('input is required');
  else {
    if (!body.input.agentSpec || typeof body.input.agentSpec !== 'object')
      errors.push('input.agentSpec is required');
    if (!Array.isArray(body.input.personas) || !body.input.personas.length)
      errors.push('input.personas[] must be a non-empty array');
    if (!Array.isArray(body.input.objectives) || !body.input.objectives.length)
      errors.push('input.objectives[] must be a non-empty array');
    if (!body.input.sandboxSchema || typeof body.input.sandboxSchema !== 'object')
      errors.push('input.sandboxSchema is required');
  }
  if (!body.target || typeof body.target !== 'object') errors.push('target endpoint config is required');
  else {
    if (!body.target.url) errors.push('target.url is required');
    if (!body.target.profile) errors.push('target.profile is required');
    if (!body.target.conversationStrategy) errors.push('target.conversationStrategy is required');
  }
  return errors;
}
