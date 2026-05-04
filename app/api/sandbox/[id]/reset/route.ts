/**
 * POST /api/sandbox/[id]/reset  — wipe DB + reseed.
 *
 * The MCTS engine calls this between iterations during replay-from-root.
 * Exposed over HTTP so the dashboard can also trigger it manually.
 */
import { NextRequest, NextResponse } from 'next/server';
import { resetSandbox } from '@/lib/sandbox_pool';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const ok = await resetSandbox(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
