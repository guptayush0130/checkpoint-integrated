import Link from 'next/link';
import { Button } from './button';

export function EmptyState({
  marker,
  title,
  description,
  ctaLabel,
  ctaHref
}: {
  marker?: string;
  title: string;
  description?: string;
  ctaLabel?: string;
  ctaHref?: string;
}) {
  return (
    <div className="surface flex flex-col items-center gap-3 px-8 py-16 text-center">
      {marker && <div className="editorial-mark">{marker}</div>}
      <h3 className="text-2xl">{title}</h3>
      {description && <p className="max-w-md text-sm text-ink-100 leading-relaxed">{description}</p>}
      {ctaLabel && ctaHref && (
        <Link href={ctaHref}>
          <Button variant="primary" className="mt-3">
            {ctaLabel}
          </Button>
        </Link>
      )}
    </div>
  );
}
