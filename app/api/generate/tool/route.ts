import { NextRequest, NextResponse } from 'next/server';
import { suggestToolImplementation } from '@/core/generators';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { description, ddlSql, model } = await req.json();
  if (!description || !ddlSql) {
    return NextResponse.json({ error: 'description and ddlSql required' }, { status: 400 });
  }
  const tool = await suggestToolImplementation(description, ddlSql, model);
  if (!tool) {
    return NextResponse.json(
      { error: 'Failed to generate. Ensure OPENAI_API_KEY is set.' },
      { status: 400 }
    );
  }
  return NextResponse.json({ tool });
}
