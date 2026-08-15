'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cn } from '@/lib/cn';

/**
 * §11.1 — the small primitive set the screens are built from. Accent is used
 * for action only; red appears only on controls that destroy data.
 */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface text-ink-1 border border-line-2 hover:bg-surface-3',
  ghost: 'bg-transparent text-ink-2 border border-transparent hover:bg-surface-3 hover:text-ink-1',
  danger: 'bg-danger text-white border border-transparent hover:brightness-95',
};

export function Button({
  variant = 'secondary',
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-[6px] px-3 text-[13px]',
        'font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        BUTTON_STYLES[variant],
        className,
      )}
    />
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        'h-8 w-full rounded-[6px] border border-line-2 bg-surface px-2.5 text-[13px]',
        'text-ink-1 placeholder:text-ink-4 focus:border-accent-line focus:outline-none',
        className,
      )}
    />
  );
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return <label {...props} className={cn('label-caps block', className)} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      {...props}
      className={cn('rounded-card border border-line bg-surface', className)}
    />
  );
}

type ChipTone = 'neutral' | 'accent' | 'done' | 'pending' | 'danger';

const CHIP_STYLES: Record<ChipTone, string> = {
  neutral: 'bg-surface-3 text-ink-3 border-line-2',
  accent: 'bg-accent-soft text-accent border-accent-line',
  done: 'bg-[#eef4f0] text-done border-[#cfe0d6]',
  pending: 'bg-[#fdf6e8] text-pending border-[#efe0c4]',
  danger: 'bg-danger-soft text-danger border-danger-line',
};

export function Chip({
  tone = 'neutral',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: ChipTone }) {
  return (
    <span
      {...props}
      className={cn(
        'inline-flex items-center rounded-chip border px-1.5 py-0.5',
        'text-[10px] font-medium uppercase tracking-[0.08em]',
        CHIP_STYLES[tone],
        className,
      )}
    />
  );
}

/** The monospace-ish three-letter file badge from the design's rows. */
export function FileBadge({ kind }: { kind: string }) {
  return (
    <span className="inline-flex h-6 w-8 shrink-0 items-center justify-center rounded-[3px] border border-line-2 bg-surface-3 text-[9px] font-semibold tracking-[0.06em] text-ink-3">
      {kind}
    </span>
  );
}

export function Avatar({ label, className }: { label: string; className?: string }) {
  return (
    <span
      title={label}
      className={cn(
        'inline-flex h-6 w-6 items-center justify-center rounded-full border border-line-2',
        'bg-accent-soft text-[10px] font-semibold text-accent',
        className,
      )}
    >
      {label}
    </span>
  );
}

// ---- Dialog ----------------------------------------------------------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogShell({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-[#18181b]/25" />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-50 w-[min(560px,calc(100vw-32px))] -translate-x-1/2',
          '-translate-y-1/2 rounded-dialog border border-line bg-surface shadow-[0_16px_48px_rgba(24,24,27,0.14)]',
          'max-h-[calc(100vh-64px)] overflow-y-auto',
          className,
        )}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogHeader({
  title,
  subtitle,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <DialogPrimitive.Title className="text-[15px] font-medium leading-snug">
          {title}
        </DialogPrimitive.Title>
        {subtitle ? (
          <DialogPrimitive.Description className="mt-1 text-[12px] text-ink-3">
            {subtitle}
          </DialogPrimitive.Description>
        ) : null}
      </div>
      <DialogPrimitive.Close className="shrink-0 rounded-[4px] p-1 text-ink-3 hover:bg-surface-3 hover:text-ink-1">
        ✕
      </DialogPrimitive.Close>
    </div>
  );
}

export function DialogFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">
      {children}
    </div>
  );
}

export const DialogClose = DialogPrimitive.Close;

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-1 py-8 text-[13px] text-ink-3">
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-line-2 border-t-accent" />
      {label}…
    </div>
  );
}

export function EmptyState({
  title,
  body,
  actions,
}: {
  title: string;
  body: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <h3 className="text-[15px] font-medium">{title}</h3>
      <p className="max-w-md text-[13px] leading-relaxed text-ink-2">{body}</p>
      {actions ? <div className="mt-2 flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[12px] leading-relaxed text-danger">
      <span aria-hidden>!</span>
      <span>{children}</span>
    </p>
  );
}
