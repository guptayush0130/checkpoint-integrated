import { NextRequest, NextResponse } from 'next/server';
import { deleteAgent, getAgent, saveAgent } from '@/lib/storage';
import type { AgentRecord } from '@/lib/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const agent = await getAgent(id);
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ agent });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const existing = await getAgent(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = (await req.json()) as Partial<AgentRecord>;
  const updated: AgentRecord = {
    ...existing,
    ...body,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString()
  };
  await saveAgent(updated);
  return NextResponse.json({ agent: updated });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  await deleteAgent(id);
  return NextResponse.json({ ok: true });
}
