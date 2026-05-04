'use client';

import { useEffect, useRef, useState } from 'react';
import type { RunEvent } from '@/lib/types';

export function InterceptPanel({ events }: { events: RunEvent[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as new events arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <section className="rounded-lg border border-cream-300 bg-white">
      <div className="flex items-baseline justify-between border-b border-cream-300 px-5 py-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">
          Intercepted Supabase calls
        </h2>
        <span className="font-mono text-xs text-ink-100">{events.length}</span>
      </div>
      <div ref={scrollRef} className="max-h-[400px] overflow-auto">
        {events.length === 0 && (
          <div className="px-5 py-6 text-center text-xs text-ink-100">
            Waiting for the target agent to hit the sandbox at URL 2…
          </div>
        )}
        {events.map((ev) => {
          const p = ev.payload;
          const isOpen = open === String(ev.id);
          return (
            <div key={ev.id} className="border-t border-cream-300 first:border-t-0">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : String(ev.id))}
                className="flex w-full items-center gap-2 px-5 py-2 text-left hover:bg-cream-50"
              >
                <SurfaceTag surface={p.surface} />
                <span className="font-mono text-xs text-ink-500">{p.method}</span>
                <span className="flex-1 truncate font-mono text-xs text-ink-500">{p.path}</span>
                <StatusTag status={p.status} />
                <span className="font-mono text-[11px] text-ink-100">{p.durationMs}ms</span>
              </button>
              {isOpen && (
                <div className="bg-cream-50 px-5 py-3 font-mono text-[11px] text-ink-500 space-y-2">
                  {p.query && Object.keys(p.query).length > 0 && (
                    <div>
                      <div className="text-ink-100">query</div>
                      <pre className="whitespace-pre-wrap break-all">
                        {JSON.stringify(p.query, null, 2)}
                      </pre>
                    </div>
                  )}
                  {p.requestBody !== undefined && p.requestBody !== null && (
                    <div>
                      <div className="text-ink-100">request body</div>
                      <pre className="whitespace-pre-wrap break-all">
                        {JSON.stringify(p.requestBody, null, 2)}
                      </pre>
                    </div>
                  )}
                  {p.responsePreview !== undefined && p.responsePreview !== null && (
                    <div>
                      <div className="text-ink-100">response preview</div>
                      <pre className="whitespace-pre-wrap break-all">
                        {typeof p.responsePreview === 'string'
                          ? p.responsePreview
                          : JSON.stringify(p.responsePreview, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SurfaceTag({ surface }: { surface?: string }) {
  const cls =
    surface === 'rest'
      ? 'bg-blue-100 text-blue-700'
      : surface === 'auth'
      ? 'bg-purple-100 text-purple-700'
      : surface === 'storage'
      ? 'bg-amber-100 text-amber-700'
      : 'bg-cream-100 text-ink-100';
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${cls}`}>
      {surface || '?'}
    </span>
  );
}

function StatusTag({ status }: { status?: number }) {
  const ok = status && status < 400;
  const cls = ok ? 'text-emerald-600' : 'text-red-600';
  return <span className={`font-mono text-xs ${cls}`}>{status ?? '?'}</span>;
}
