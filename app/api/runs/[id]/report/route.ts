import { NextRequest } from 'next/server';
import { readRunMarkdown } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const md = await readRunMarkdown(id);
  if (!md) return new Response('Not found', { status: 404 });
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8'
    }
  });
}
