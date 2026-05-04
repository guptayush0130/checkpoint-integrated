import { forwardRef, ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variantClasses: Record<Variant, string> = {
  primary: 'bg-ink-500 text-cream-50 hover:bg-ink-400',
  secondary: 'border border-cream-300 bg-white text-ink-500 hover:bg-cream-100',
  ghost: 'text-ink-500 hover:bg-cream-200',
  accent: 'bg-accent-500 text-white hover:bg-accent-600',
  danger: 'border border-accent-400/40 bg-white text-accent-500 hover:bg-accent-50'
};

const sizeClasses: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm'
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = 'primary', size = 'md', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        'button-base',
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    />
  );
});
