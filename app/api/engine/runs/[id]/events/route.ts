/**
 * GET /api/engine/runs/[id]/events — SSE stream of every engine event.
 *
 * Event types include:
 *   run.created            sandbox.ready          parsing.complete
 *   matrix.generated       case.started           case.completed
 *   mcts.iteration_start   mcts.replay_start      mcts.node_expanded
 *   mcts.node_executed     mcts.simulation_complete  mcts.iteration_end
 *   mcts.budget_exhausted  mcts.converged
 *   sandbox.intercept      run.completed          run.failed
 *
 * Replays persisted history first (so reconnect never loses events) and then
 * tails the live subscriber bus. Buffer-then-replay defeats the read/subscribe
 * race window.
 */
import { NextRequest } from 'next/server';
import { getRun, readRunEvents } from '@/lib/storage';
import { isInflight, subscribe } from '@/core/orchestrator';
import type { RunEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) return new Response('Not found', { status: 404 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: RunEvent | { type: string; data: any }) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      // 1) Subscribe FIRST, buffering any live events that arrive while we
      //    replay history. This kills the classic SSE replay-then-subscribe race.
      const buffer: RunEvent[] = [];
      let replayDone = false;
      const unsubscribe = subscribe(id, (event) => {
        if (replayDone) send(event);
        else buffer.push(event);
      });

      // 2) Replay persisted history.
      const past = await readRunEvents(id);
      for (const event of past) send(event);

      // 3) If the run is already done before we ever attached, close out.
      if (!isInflight(id) && (run.status === 'completed' || run.status === 'failed')) {
        replayDone = true;
        controller.enqueue(encoder.encode(`event: done\ndata: ${JSON.stringify(run)}\n\n`));
        unsubscribe();
        try {
          controller.close();
        } catch {}
        return;
      }

      // 4) Drain anything that buffered during replay.
      for (const event of buffer) send(event);
      buffer.length = 0;
      replayDone = true;

      // Keep-alive against proxies.
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
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
