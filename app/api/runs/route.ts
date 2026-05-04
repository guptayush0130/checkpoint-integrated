import { NextRequest, NextResponse } from 'next/server';
import { getSchema, listRuns, saveSchema } from '@/lib/storage';
import { startRun } from '@/core/orchestrator';
import { ensureSchemaIsLoadable } from '@/core/generators';
import type { RunConfig } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ runs: await listRuns() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<RunConfig>;
  if (!body.agentId || !body.schemaId) {
    return NextResponse.json({ error: 'agentId and schemaId are required' }, { status: 400 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'OPENAI_API_KEY is not configured. Add it to .env to launch a run.' },
      { status: 400 }
    );
  }

  const schema = await getSchema(body.schemaId);
  if (!schema) {
    return NextResponse.json({ error: `Schema ${body.schemaId} not found` }, { status: 404 });
  }

  const defaultModel =
    body.defaultModel || process.env.MOCK_DEFAULT_MODEL || 'gpt-5-nano';

  // Pre-flight: validate (and if needed, LLM-repair) the schema/seed before the
  // run is even queued. If repair changes anything, persist back to disk so the
  // schema record is permanently fixed and no future run has to heal it again.
  const preflight = await ensureSchemaIsLoadable(
    schema.ddlSql,
    schema.seedSql || '',
    defaultModel
  );
  if (!preflight.valid) {
    return NextResponse.json(
      {
        error: `Schema "${schema.name}" failed Postgres validation: ${preflight.error}`,
        validation: {
          valid: false,
          repairAttempts: preflight.repairAttempts,
          error: preflight.error
        }
      },
      { status: 400 }
    );
  }
  if (preflight.changed) {
    await saveSchema({
      ...schema,
      ddlSql: preflight.ddlSql,
      seedSql: preflight.seedSql,
      updatedAt: new Date().toISOString()
    });
  }

  const config: RunConfig = {
    agentId: body.agentId,
    schemaId: body.schemaId,
    testCount: typeof body.testCount === 'number' && body.testCount > 0 ? body.testCount : 5,
    autoTestCount: !!body.autoTestCount,
    defaultModel,
    auditorModel: body.auditorModel,
    targetModel: body.targetModel,
    judgeModel: body.judgeModel,
    maxToolIterations: body.maxToolIterations || 10
  };
  try {
    const summary = await startRun(config);
    return NextResponse.json(
      {
        run: summary,
        validation: {
          valid: true,
          changed: preflight.changed,
          repairAttempts: preflight.repairAttempts
        }
      },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 400 });
  }
}
