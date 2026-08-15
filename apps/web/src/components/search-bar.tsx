'use client';

import { useState } from 'react';
import { ALLOWED_MIME_TYPES } from '@dataroom/contracts';
import { Button, Chip, Input } from '@/components/ui';
import { cn } from '@/lib/cn';

export type SearchFilters = {
  q: string;
  type: string[];
  mimeType: string[];
  minSize?: number;
  maxSize?: number;
  updatedFrom?: string;
  updatedTo?: string;
};

export const EMPTY_FILTERS: SearchFilters = { q: '', type: [], mimeType: [] };

const MIME_GROUPS: { label: string; mimes: string[] }[] = [
  { label: 'PDF', mimes: ['application/pdf'] },
  {
    label: 'Spreadsheet',
    mimes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ],
  },
  {
    label: 'Document',
    mimes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
      'text/plain',
    ],
  },
  {
    label: 'Presentation',
    mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  },
  { label: 'Image', mimes: ['image/png', 'image/jpeg'] },
];

/**
 * §11.3 SearchBar — collapsed is name plus type; expanding reveals ranges rather
 * than more dropdowns, because a reviewer needs two axes at once (design §8).
 */
export function SearchBar({
  itemCount,
  resultCount,
  filters,
  onChange,
}: {
  itemCount: number;
  resultCount: number | null;
  filters: SearchFilters;
  onChange: (filters: SearchFilters) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const set = (patch: Partial<SearchFilters>) => onChange({ ...filters, ...patch });

  const toggleMime = (mimes: string[]) => {
    const active = mimes.every((m) => filters.mimeType.includes(m));
    set({
      mimeType: active
        ? filters.mimeType.filter((m) => !mimes.includes(m))
        : [...new Set([...filters.mimeType, ...mimes])],
    });
  };

  const hasFilters =
    filters.q !== '' ||
    filters.type.length > 0 ||
    filters.mimeType.length > 0 ||
    filters.minSize !== undefined ||
    filters.maxSize !== undefined ||
    filters.updatedFrom !== undefined;

  return (
    <div className="rounded-card border border-line bg-surface px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={filters.q}
          onChange={(event) => set({ q: event.target.value })}
          placeholder={`Search ${itemCount.toLocaleString()} items`}
          className="h-8 min-w-[200px] flex-1"
        />

        {(['FOLDER', 'FILE'] as const).map((type) => (
          <button
            key={type}
            onClick={() =>
              set({
                type: filters.type.includes(type)
                  ? filters.type.filter((t) => t !== type)
                  : [...filters.type, type],
              })
            }
            className={cn(
              'h-8 rounded-[6px] border px-2.5 text-[12px]',
              filters.type.includes(type)
                ? 'border-accent-line bg-accent-soft text-accent'
                : 'border-line-2 bg-surface text-ink-2 hover:bg-surface-3',
            )}
          >
            {type === 'FOLDER' ? 'Folders' : 'Files'}
          </button>
        ))}

        <Button onClick={() => setExpanded((v) => !v)} className="h-8">
          {expanded ? 'Fewer filters ▴' : 'More filters ▾'}
        </Button>
      </div>

      {expanded ? (
        <div className="mt-3 grid gap-4 border-t border-line pt-3 md:grid-cols-3">
          <div>
            <p className="label-caps mb-1.5">File type</p>
            <div className="flex flex-wrap gap-1.5">
              {MIME_GROUPS.map((group) => {
                const active = group.mimes.every((m) => filters.mimeType.includes(m));
                return (
                  <button key={group.label} onClick={() => toggleMime(group.mimes)}>
                    <Chip tone={active ? 'accent' : 'neutral'}>{group.label}</Chip>
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <p className="label-caps mb-1.5">Size (MB)</p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                placeholder="Min"
                onChange={(event) =>
                  set({
                    minSize: event.target.value
                      ? Math.round(Number(event.target.value) * 1024 * 1024)
                      : undefined,
                  })
                }
              />
              <span className="text-[12px] text-ink-3">to</span>
              <Input
                type="number"
                min={0}
                placeholder="Max"
                onChange={(event) =>
                  set({
                    maxSize: event.target.value
                      ? Math.round(Number(event.target.value) * 1024 * 1024)
                      : undefined,
                  })
                }
              />
            </div>
          </div>

          <div>
            <p className="label-caps mb-1.5">Modified</p>
            <div className="flex items-center gap-2">
              <Input
                type="date"
                onChange={(event) =>
                  set({ updatedFrom: event.target.value || undefined })
                }
              />
              <span className="text-[12px] text-ink-3">to</span>
              <Input
                type="date"
                onChange={(event) => set({ updatedTo: event.target.value || undefined })}
              />
            </div>
          </div>
        </div>
      ) : null}

      {hasFilters ? (
        <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2.5">
          <p className="text-[12px] text-ink-3">
            {resultCount === null ? 'Searching…' : `${resultCount.toLocaleString()} results`}
          </p>
          <button
            onClick={() => onChange(EMPTY_FILTERS)}
            className="text-[12px] text-ink-3 hover:text-ink-1"
          >
            Clear all filters
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const ALL_MIME_TYPES = ALLOWED_MIME_TYPES;
