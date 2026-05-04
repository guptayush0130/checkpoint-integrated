import { NextRequest, NextResponse } from 'next/server';
import { deleteSchema, getSchema, saveSchema } from '@/lib/storage';
import { ensureSchemaIsLoadable } from '@/core/generators';
import type { SchemaRecord } from '@/lib/types';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const schema = await getSchema(id);
  if (!schema) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ schema });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const existing = await getSchema(id);
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = (await req.json()) as Partial<SchemaRecord>;
  const merged: SchemaRecord = {
    ...existing,
    ...body,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString()
  };

  const sqlChanged =
    typeof body.ddlSql === 'string' && body.ddlSql !== existing.ddlSql ||
    typeof body.seedSql === 'string' && body.seedSql !== (existing.seedSql || '');

  if (sqlChanged) {
    const preflight = await ensureSchemaIsLoadable(merged.ddlSql, merged.seedSql || '');
    if (!preflight.valid) {
      return NextResponse.json(
        {
          error: `Schema does not load in Postgres: ${preflight.error}`,
          validation: { valid: false, repairAttempts: preflight.repairAttempts, error: preflight.error }
        },
        { status: 400 }
      );
    }
    merged.ddlSql = preflight.ddlSql;
    merged.seedSql = preflight.seedSql;
    await saveSchema(merged);
    return NextResponse.json({
      schema: merged,
      validation: {
        valid: true,
        changed: preflight.changed,
        repairAttempts: preflight.repairAttempts
      }
    });
  }

  await saveSchema(merged);
  return NextResponse.json({ schema: merged });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  await deleteSchema(id);
  return NextResponse.json({ ok: true });
}
