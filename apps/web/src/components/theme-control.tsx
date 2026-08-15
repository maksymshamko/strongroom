'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme, type ThemeMode } from '@/lib/theme';
import { cn } from '@/lib/cn';

const OPTIONS: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: 'system', label: 'System', Icon: Monitor },
  { mode: 'light', label: 'Light', Icon: Sun },
  { mode: 'dark', label: 'Dark', Icon: Moon },
];

/**
 * spec 003 §3.4 — the same control in both places it appears (user menu and
 * account settings), so the two can never drift.
 */
export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const { mode, setMode } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className="flex gap-0.5 rounded-[6px] border border-line-2 bg-surface-2 p-0.5"
    >
      {OPTIONS.map(({ mode: value, label, Icon }) => (
        <button
          key={value}
          role="radio"
          aria-checked={mode === value}
          aria-label={label}
          onClick={() => setMode(value)}
          className={cn(
            'flex flex-1 items-center justify-center gap-1.5 rounded-[4px] px-2 py-1 text-[12px] transition-colors',
            mode === value
              ? 'bg-surface text-ink-1 shadow-[0_1px_2px_rgba(24,24,27,0.08)]'
              : 'text-ink-3 hover:text-ink-1',
          )}
        >
          <Icon size={13} aria-hidden />
          {!compact ? label : null}
        </button>
      ))}
    </div>
  );
}
