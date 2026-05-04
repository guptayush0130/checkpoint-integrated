import { HTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Tone = 'pass' | 'fail' | 'pending' | 'running' | 'warning' | 'neutral';

export function Badge({
  tone = 'neutral',
  className,
  children,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  const map: Record<Tone, string> = {
    pass: 'badge-pass',
    fail: 'badge-fail',
    pending: 'badge-pending',
    running: 'badge-running',
    warning: 'badge-base border-warning-400 bg-warning-50 text-warning-600',
    neutral: 'badge-base border-cream-400 bg-cream-100 text-ink-100'
  };
  return (
    <span className={cn(map[tone], className)} {...props}>
      {children}
    </span>
  );
}
