'use client';

import { useEffect, useState } from 'react';
import { formatRelative, formatUtcDateMinute } from '@/lib/format';

interface Props {
  iso: string;
  className?: string;
}

/**
 * Renders human-relative text (`Xs ago`) only after mount so SSR + hydration
 * match (both show the same deterministic UTC fallback until the client updates).
 */
export function ClientRelativeTime({ iso, className }: Props) {
  const [relative, setRelative] = useState<string | null>(null);

  useEffect(() => {
    setRelative(formatRelative(iso));
    const id = window.setInterval(() => setRelative(formatRelative(iso)), 30_000);
    return () => window.clearInterval(id);
  }, [iso]);

  return <span className={className}>{relative ?? formatUtcDateMinute(iso)}</span>;
}
