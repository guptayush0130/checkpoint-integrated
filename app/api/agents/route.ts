import { NextRequest, NextResponse } from 'next/server';
import { listAgents, newId, saveAgent } from '@/lib/storage';
import type { AgentRecord } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ agents: await listAgents() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<AgentRecord>;
  if (!body.name || !body.systemPrompt || !Array.isArray(body.tools)) {
    return NextResponse.json(
      { error: 'name, systemPrompt and tools[] are required' },
      { status: 400 }
    );
  }
  const now = new Date().toISOString();
  const record: AgentRecord = {
    id: body.id || newId(),
    name: body.name,
    description: body.description,
    systemPrompt: body.systemPrompt,
    model: body.model,
    reasoningEffort: body.reasoningEffort,
    maxOutputTokens: body.maxOutputTokens,
    tools: body.tools,
    tables: body.tables,
    createdAt: now,
    updatedAt: now
  };
  await saveAgent(record);
  return NextResponse.json({ agent: record }, { status: 201 });
}
