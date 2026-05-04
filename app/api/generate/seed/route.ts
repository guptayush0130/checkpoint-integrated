import { NextRequest, NextResponse } from 'next/server';
import { generateSeedSql } from '@/core/generators';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { ddlSql, density, model } = await req.json();
  if (!ddlSql) return NextResponse.json({ error: 'ddlSql required' }, { status: 400 });
  const seedSql = await generateSeedSql(ddlSql, density || 'medium', model);
  if (!seedSql) {
    return NextResponse.json(
      { error: 'Failed to generate. Ensure OPENAI_API_KEY is set.' },
      { status: 400 }
    );
  }
  return NextResponse.json({ seedSql });
}
