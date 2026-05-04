/**
 * GET /api/engine/runs/[id]  — fetch run summary + persisted report.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRun, readRunReportJson } from '@/lib/storage';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const summary = await getRun(id);
  if (!summary) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const report = await readRunReportJson(id);
  return NextResponse.json({ run: summary, report });
}
