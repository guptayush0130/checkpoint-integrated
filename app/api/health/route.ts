import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({
    healthy: true,
    openaiConfigured: !!process.env.OPENAI_API_KEY,
    defaultModel: process.env.MOCK_DEFAULT_MODEL || 'gpt-5-nano'
  });
}
