'use client';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2, Loader2 } from 'lucide-react';

interface Props {
  /** REST endpoint that responds to DELETE. */
  endpoint: string;
  /** Short label for the confirm dialog (e.g. "this run"). */
  label: string;
  /** Optional path to navigate to after successful delete. Defaults to refreshing. */
  redirectTo?: string;
  className?: string;
  size?: 'sm' | 'md';
  /** Render mode. "icon" shows just the trash icon (compact tables); "button" is full pill. */
  variant?: 'icon' | 'button';
}

/**
 * Inline delete affordance for resources that support DELETE on a known
 * endpoint. Confirms first, surfaces errors, and uses Router.refresh() so
 * server-rendered list pages re-fetch without a full reload.
 */
export function DeleteButton({
  endpoint,
  label,
  redirectTo,
  className,
  size = 'sm',
  variant = 'icon'
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onClick = () => {
    if (pending) return;
    setError(null);
    if (typeof window !== 'undefined') {
      const ok = window.confirm(
        `Delete ${label}? This permanently removes it (events, reports included if applicable).`
      );
      if (!ok) return;
    }
    startTransition(async () => {
      try {
        const res = await fetch(endpoint, { method: 'DELETE' });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || `Delete failed (HTTP ${res.status})`);
          return;
        }
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } catch (err: any) {
        setError(err?.message || 'Delete failed');
      }
    });
  };

  const sizeCls = size === 'sm' ? 'px-2 py-1 text-2xs' : 'px-3 py-1.5 text-xs';

  if (variant === 'icon') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        title={`Delete ${label}`}
        aria-label={`Delete ${label}`}
        className={
          'inline-flex items-center justify-center rounded-md border border-cream-300 bg-white p-1.5 text-ink-100 hover:border-accent-400/60 hover:bg-accent-50 hover:text-accent-500 disabled:opacity-50 ' +
          (className ?? '')
        }
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
        {error && <span className="sr-only">{error}</span>}
      </button>
    );
  }

  return (
    <div className={'flex flex-col items-end gap-1 ' + (className ?? '')}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={
          'inline-flex items-center gap-1.5 rounded-md border border-accent-400/40 bg-white text-accent-500 hover:bg-accent-50 disabled:opacity-50 ' +
          sizeCls
        }
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
        Delete {label}
      </button>
      {error && <span className="text-2xs text-accent-500">{error}</span>}
    </div>
  );
}
