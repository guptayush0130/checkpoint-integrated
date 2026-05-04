import { forwardRef, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn('input-base', className)} {...props} />;
  }
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn('input-base font-mono text-xs leading-relaxed', className)}
        {...props}
      />
    );
  }
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...props }, ref) {
    return (
      <select ref={ref} className={cn('input-base appearance-none pr-9', className)} {...props}>
        {children}
      </select>
    );
  }
);

export function Label({
  children,
  htmlFor,
  hint,
  required
}: {
  children: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="text-xs font-medium uppercase tracking-[0.12em] text-ink-100">
        {children}
        {required && <span className="ml-1 text-accent-500">*</span>}
      </span>
      {hint && <span className="mt-1 block text-xs text-ink-50">{hint}</span>}
    </label>
  );
}

export function Field({
  label,
  hint,
  required,
  htmlFor,
  children
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} hint={hint} required={required}>
        {label}
      </Label>
      {children}
    </div>
  );
}
