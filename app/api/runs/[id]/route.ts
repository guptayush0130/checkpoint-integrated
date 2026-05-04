import { NextRequest, NextResponse } from 'next/server';
import { deleteRun, getRun, readRunReportJson } from '@/lib/storage';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const summary = await getRun(id);
  if (!summary) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const report = await readRunReportJson(id);
  return NextResponse.json({ run: summary, report });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  await deleteRun(id);
  return NextResponse.json({ ok: true });
}
