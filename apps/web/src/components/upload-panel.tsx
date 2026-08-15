'use client';

import { useEffect, useState } from 'react';
import { useUploads, type UploadItem } from '@/lib/uploads';
import { Button } from '@/components/ui';
import { fileKind, formatBytes } from '@/lib/format';
import { cn } from '@/lib/cn';

/**
 * §11.3 UploadPanel — a silent upload failure means a buyer reviews an
 * incomplete room, so failures persist in the list until dismissed and are
 * counted in the header.
 */
export function UploadPanel() {
  const uploads = useUploads();
  const [minimized, setMinimized] = useState(false);

  const active = uploads.items.filter(
    (item) => item.status === 'uploading' || item.status === 'queued' || item.status === 'verifying',
  );

  // "Leaving the page cancels active uploads" — so say so before it happens.
  useEffect(() => {
    if (active.length === 0) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active.length]);

  if (uploads.items.length === 0) return null;

  const complete = uploads.items.filter((i) => i.status === 'complete').length;
  const failed = uploads.items.filter((i) => i.status === 'failed').length;
  const needsAnswer = uploads.items.filter((i) => i.status === 'conflict').length;

  return (
    <div className="fixed bottom-4 right-4 z-30 w-[360px] overflow-hidden rounded-card border border-line bg-surface shadow-[0_12px_32px_rgba(24,24,27,0.16)]">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">
            Uploading {uploads.items.length} file{uploads.items.length === 1 ? '' : 's'}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {complete} complete · {active.length} uploading
            {failed > 0 ? ` · ${failed} failed` : ''}
            {needsAnswer > 0 ? ` · ${needsAnswer} needs a decision` : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setMinimized((v) => !v)}
            className="rounded-[4px] px-1.5 py-1 text-[11px] text-ink-3 hover:bg-surface-3"
          >
            {minimized ? 'Expand' : 'Minimize'}
          </button>
          <button
            onClick={uploads.clearFinished}
            className="rounded-[4px] px-1.5 py-1 text-[11px] text-ink-3 hover:bg-surface-3"
          >
            ✕
          </button>
        </div>
      </div>

      {!minimized ? (
        <>
          <ul className="max-h-[320px] overflow-y-auto">
            {uploads.items.map((item) => (
              <UploadRow key={item.id} item={item} />
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-line bg-surface-2 px-3 py-2">
            <p className="text-[11px] text-ink-3">Leaving the page cancels active uploads</p>
            {failed > 0 ? (
              <Button onClick={uploads.retryAllFailed} className="h-7">
                Retry all failed
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
    </div>
  );
}

function UploadRow({ item }: { item: UploadItem }) {
  const uploads = useUploads();
  const percent = item.total > 0 ? Math.round((item.loaded / item.total) * 100) : 0;

  return (
    <li className="flex items-start gap-2.5 border-b border-line-2 px-3 py-2.5 last:border-0">
      <span className="mt-0.5 inline-flex h-5 w-7 shrink-0 items-center justify-center rounded-[3px] border border-line-2 bg-surface-3 text-[8px] font-semibold text-ink-3">
        {fileKind(item.file.type || null)}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium">{item.name}</p>

        {item.status === 'uploading' ? (
          <>
            <p className="mt-0.5 text-[11px] text-ink-3">
              {formatBytes(item.loaded)} of {formatBytes(item.total)}
              {item.eta !== null ? ` · ${item.eta}s left` : ''}
            </p>
            <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line-2">
              <div className="h-full bg-accent transition-[width]" style={{ width: `${percent}%` }} />
            </div>
          </>
        ) : null}

        {item.status === 'queued' ? <p className="mt-0.5 text-[11px] text-ink-3">Waiting</p> : null}
        {item.status === 'verifying' ? (
          <p className="mt-0.5 text-[11px] text-ink-3">Verifying…</p>
        ) : null}
        {item.status === 'complete' ? (
          <p className="mt-0.5 text-[11px] text-done">Complete</p>
        ) : null}
        {item.status === 'failed' ? (
          <p className="mt-0.5 text-[11px] text-danger">Failed — {item.error}</p>
        ) : null}

        {item.status === 'conflict' && item.conflict ? (
          <div className="mt-1">
            <p className="text-[11px] text-pending">
              “{item.name}” already exists here.
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button
                className="h-6 px-2 text-[11px]"
                onClick={() => uploads.resolveConflict(item.id, 'KEEP_BOTH')}
              >
                Keep both
              </Button>
              {item.conflict.versioningAvailable ? (
                <>
                  <Button
                    className="h-6 px-2 text-[11px]"
                    onClick={() => uploads.resolveConflict(item.id, 'NEW_VERSION')}
                  >
                    Add as new version
                  </Button>
                  <Button
                    className="h-6 px-2 text-[11px]"
                    variant="danger"
                    onClick={() => uploads.resolveConflict(item.id, 'REPLACE')}
                  >
                    Replace
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {item.status === 'uploading' ? (
          <span className="text-[11px] tabular-nums text-ink-3">{percent}%</span>
        ) : null}
        {item.status === 'failed' ? (
          <button
            onClick={() => uploads.retry(item.id)}
            className="rounded-[4px] px-1.5 py-0.5 text-[11px] text-accent hover:bg-surface-3"
          >
            Retry
          </button>
        ) : null}
        <button
          onClick={() =>
            item.status === 'uploading' || item.status === 'queued'
              ? uploads.cancel(item.id)
              : uploads.dismiss(item.id)
          }
          className={cn('rounded-[4px] px-1 py-0.5 text-[11px] text-ink-3 hover:bg-surface-3')}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </li>
  );
}
