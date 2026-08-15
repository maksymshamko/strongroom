'use client';

import Link from 'next/link';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronRight } from 'lucide-react';
import type { BreadcrumbSegment } from '@dataroom/contracts';
import { cn } from '@/lib/cn';

/**
 * spec 003 §4.5 — root-first, already truncated by the API to what the viewer
 * may see (002 §5.5). Above four segments the middle ones collapse behind a "…"
 * menu; first and last are never collapsed. On mobile only the parent and the
 * current segment are shown.
 */
const MAX_VISIBLE = 4;

export function Breadcrumbs({
  segments,
  onNavigate,
  className,
}: {
  segments: BreadcrumbSegment[];
  /** Public-link browsing navigates in place rather than by route (§8.4). */
  onNavigate?: (segment: BreadcrumbSegment) => void;
  className?: string;
}) {
  if (segments.length === 0) return null;

  const collapsed = segments.length > MAX_VISIBLE;
  const hidden = collapsed ? segments.slice(1, segments.length - 2) : [];
  const visible = collapsed
    ? [segments[0], ...segments.slice(segments.length - 2)]
    : segments;

  return (
    <nav aria-label="Breadcrumb" className={cn('flex min-w-0 items-center gap-1 text-[13px]', className)}>
      {visible.map((segment, index) => {
        const isLast = index === visible.length - 1;
        // With a collapse, the "…" menu sits after the root.
        const showEllipsis = collapsed && index === 1;

        return (
          <span key={segment.id} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <Separator /> : null}

            {showEllipsis ? (
              <>
                <HiddenSegments segments={hidden} onNavigate={onNavigate} />
                <Separator />
              </>
            ) : null}

            <Crumb
              segment={segment}
              isLast={isLast}
              onNavigate={onNavigate}
              // §4.5 — mobile keeps only the parent and the current segment.
              className={cn(!isLast && index < visible.length - 2 && 'hidden sm:inline')}
            />
          </span>
        );
      })}
    </nav>
  );
}

function Separator() {
  return <ChevronRight size={13} aria-hidden className="shrink-0 text-ink-4" />;
}

function Crumb({
  segment,
  isLast,
  onNavigate,
  className,
}: {
  segment: BreadcrumbSegment;
  isLast: boolean;
  onNavigate?: (segment: BreadcrumbSegment) => void;
  className?: string;
}) {
  // The last segment is the current location, so it is not actionable (§4.5).
  if (isLast) {
    return (
      <span aria-current="page" className={cn('truncate font-medium', className)}>
        {segment.name}
      </span>
    );
  }

  if (onNavigate) {
    return (
      <button
        onClick={() => onNavigate(segment)}
        className={cn('truncate text-ink-2 hover:text-ink-1', className)}
      >
        {segment.name}
      </button>
    );
  }

  return (
    <Link
      href={`/n/${segment.id}`}
      className={cn('truncate text-ink-2 no-underline hover:text-ink-1', className)}
    >
      {segment.name}
    </Link>
  );
}

function HiddenSegments({
  segments,
  onNavigate,
}: {
  segments: BreadcrumbSegment[];
  onNavigate?: (segment: BreadcrumbSegment) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Show ${segments.length} hidden folders`}
        className="rounded-[4px] px-1 text-ink-3 hover:bg-surface-3 hover:text-ink-1"
      >
        …
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 min-w-[180px] rounded-[8px] border border-line bg-surface p-1 shadow-[0_8px_24px_rgba(24,24,27,0.12)]"
        >
          {segments.map((segment) => (
            <DropdownMenu.Item key={segment.id} asChild>
              {onNavigate ? (
                <button
                  onClick={() => onNavigate(segment)}
                  className="w-full cursor-pointer truncate rounded-[4px] px-2 py-1.5 text-left text-[13px] outline-none data-[highlighted]:bg-surface-3"
                >
                  {segment.name}
                </button>
              ) : (
                <Link
                  href={`/n/${segment.id}`}
                  className="block cursor-pointer truncate rounded-[4px] px-2 py-1.5 text-[13px] no-underline outline-none data-[highlighted]:bg-surface-3"
                >
                  {segment.name}
                </Link>
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
