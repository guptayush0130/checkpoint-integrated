'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

const NAV = [
  { href: '/', label: 'Dashboard' },
  { href: '/agents', label: 'Agents' },
  { href: '/schemas', label: 'Schemas' },
  { href: '/runs', label: 'Runs' }
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="border-b border-cream-300 bg-cream-50/95 backdrop-blur sticky top-0 z-30">
      <div className="container-fixed flex items-center justify-between gap-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <CheckpointMark />
          <span className="font-serif text-xl tracking-tightest">Checkpoint</span>
          <span className="ml-2 hidden md:inline-flex items-center gap-1.5 rounded-full border border-cream-300 bg-cream-100 px-2 py-0.5 text-2xs font-mono uppercase tracking-[0.16em] text-ink-100">
            <span className="pulse-dot text-success-500" /> Local
          </span>
        </Link>
        <nav className="hidden md:flex items-center gap-1">
          {NAV.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-3 py-1.5 text-sm transition-colors',
                  active
                    ? 'bg-ink-500 text-cream-50'
                    : 'text-ink-100 hover:bg-cream-200'
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/runs/new"
            className="button-base bg-accent-500 text-white hover:bg-accent-600 px-3.5 py-1.5 text-sm"
          >
            New run
          </Link>
        </div>
      </div>
    </header>
  );
}

function CheckpointMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
      <rect x="1" y="1" width="20" height="20" rx="4" fill="#0F0E0C" />
      <path
        d="M6.5 11.6L9.5 14.5L15.5 7.5"
        stroke="#F7F5EE"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
