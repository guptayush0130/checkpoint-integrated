import { NextRequest, NextResponse } from 'next/server';
import { generateSchemaFromDescription } from '@/core/generators';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { description, model } = await req.json();
  if (!description) return NextResponse.json({ error: 'description required' }, { status: 400 });
  const result = await generateSchemaFromDescription(description, model);
  if (!result) {
    return NextResponse.json(
      { error: 'Failed to generate. Ensure OPENAI_API_KEY is set.' },
      { status: 400 }
    );
  }
  return NextResponse.json(result);
}
