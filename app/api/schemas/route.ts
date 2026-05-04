import { NextRequest, NextResponse } from 'next/server';
import { listSchemas, newId, saveSchema } from '@/lib/storage';
import { ensureSchemaIsLoadable } from '@/core/generators';
import type { SchemaRecord } from '@/lib/types';

export const runtime = 'nodejs';

export async function GET() {
  return NextResponse.json({ schemas: await listSchemas() });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Partial<SchemaRecord>;
  if (!body.name || !body.ddlSql) {
    return NextResponse.json({ error: 'name and ddlSql are required' }, { status: 400 });
  }

  const preflight = await ensureSchemaIsLoadable(body.ddlSql, body.seedSql || '');
  if (!preflight.valid) {
    return NextResponse.json(
      {
        error: `Schema does not load in Postgres: ${preflight.error}`,
        validation: { valid: false, repairAttempts: preflight.repairAttempts, error: preflight.error }
      },
      { status: 400 }
    );
  }

  const now = new Date().toISOString();
  const record: SchemaRecord = {
    id: body.id || newId(),
    name: body.name,
    description: body.description,
    ddlSql: preflight.ddlSql,
    seedSql: preflight.seedSql,
    density: body.density || 'medium',
    snapshotTables: body.snapshotTables,
    createdAt: now,
    updatedAt: now
  };
  await saveSchema(record);
  return NextResponse.json(
    {
      schema: record,
      validation: {
        valid: true,
        changed: preflight.changed,
        repairAttempts: preflight.repairAttempts
      }
    },
    { status: 201 }
  );
}
