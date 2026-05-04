/**
 * GET    /api/sandbox/[id]  — fetch sandbox metadata + retained events
 * DELETE /api/sandbox/[id]  — teardown
 */
import { NextRequest, NextResponse } from 'next/server';
import { disposeSandbox, getEvents, getSandbox } from '@/lib/sandbox_pool';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const entry = getSandbox(id);
  if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({
    id,
    env: entry.env,
    createdAt: entry.createdAt,
    eventCount: entry.events.length,
    events: getEvents(id)
  });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const ok = await disposeSandbox(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
