/**
 * GET /api/sandbox/[id]/events  — SSE stream of intercepted Supabase calls.
 *
 * Replays retained history first (so reconnect never loses events), then
 * tails the live subscriber bus until the sandbox is disposed or the client
 * disconnects.
 */
import { NextRequest } from 'next/server';
import { getEvents, getSandbox, subscribe } from '@/lib/sandbox_pool';
import type { SandboxInterceptEvent } from '@/sandbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const entry = getSandbox(id);
  if (!entry) return new Response('Not found', { status: 404 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: SandboxInterceptEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // 1) Buffer first to defeat the replay-then-subscribe race window:
      //    queue every live event during the brief gap before history is sent.
      const buffer: SandboxInterceptEvent[] = [];
      const unsubscribe = subscribe(id, (event) => {
        if (replayed) send(event);
        else buffer.push(event);
      });

      // 2) Replay history.
      let replayed = false;
      for (const ev of getEvents(id)) send(ev);
      replayed = true;

      // 3) Drain anything that arrived during replay.
      for (const ev of buffer) send(ev);
      buffer.length = 0;

      // 4) Keep-alive against proxies.
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keep-alive\n\n`));
        } catch {
          closed = true;
        }
      }, 15000);

      const teardown = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };

      req.signal?.addEventListener('abort', teardown);
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}
