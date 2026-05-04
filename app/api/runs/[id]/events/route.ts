/**
 * SSE stream for a single run. Replays any persisted events (so reconnects
 * never lose history) and then tails the live event bus until the run
 * completes or the client disconnects.
 */

import { NextRequest } from 'next/server';
import { getRun, readRunEvents } from '@/lib/storage';
import { isInflight, subscribe } from '@/core/orchestrator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) {
    return new Response('Not found', { status: 404 });
  }

  const encoder = new TextEncoder();
  const past = await readRunEvents(id);

  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: any) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // controller closed
        }
      };

      // Replay persisted history first.
      for (const event of past) send(event);

      // If the run is already finished, close the stream.
      if (!isInflight(id) && run.status !== 'pending' && run.status !== 'running') {
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify(run)}\n\n`));
        controller.close();
        return;
      }

      const unsubscribe = subscribe(id, (event) => {
        send(event);
        if (event.type === 'run.completed' || event.type === 'run.failed') {
          unsubscribe();
          controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify(event)}\n\n`));
          controller.close();
        }
      });

      // Periodic keep-alive comment to defeat proxies.
      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          clearInterval(keepAlive);
        }
      }, 15000);

      // If the client disconnects, cleanup.
      const onAbort = () => {
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {}
      };
      _req.signal?.addEventListener('abort', onAbort);
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
