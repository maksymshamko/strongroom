'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Trash2 } from 'lucide-react';
import { TRASH_TTL_DAYS, type TrashItemDto } from '@dataroom/contracts';
import { api, ApiError } from '@/lib/api';
import { track } from '@/lib/observability';
import { useRequireSession } from '@/lib/session';
import { AppShell, PageHeader } from '@/components/app-shell';
import {
  Button,
  Card,
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogShell,
  EmptyState,
  ErrorNote,
  FileBadge,
  Spinner,
} from '@/components/ui';
import { fileKind, formatBytes, formatDate, pluralize } from '@/lib/format';

/** spec 003 §2.5–§2.7 — view what was deleted, put it back, or destroy it early. */
export default function TrashPage() {
  const session = useRequireSession();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [purging, setPurging] = useState<TrashItemDto | null>(null);
  const [emptying, setEmptying] = useState(false);

  const trash = useQuery({
    queryKey: ['trash'],
    queryFn: () => api.trash(),
    enabled: Boolean(session.data),
  });

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['trash'] });
    await queryClient.invalidateQueries({ queryKey: ['data-rooms'] });
    await queryClient.invalidateQueries({ queryKey: ['children'] });
  };

  const restore = useMutation({
    mutationFn: (item: TrashItemDto) => api.restoreFromTrash(item.id),
    onSuccess: async (node) => {
      track('node_restored', { type: node.type });
      setError(null);
      await invalidate();
    },
    onError: (caught) => {
      if (caught instanceof ApiError && caught.code === 'RESTORE_TARGET_MISSING') {
        setError(caught.message);
      } else if (caught instanceof ApiError && caught.code === 'NAME_CONFLICT') {
        setError(
          'Something with that name already exists where this came from. Rename it there first.',
        );
      } else {
        setError((caught as Error).message);
      }
    },
  });

  const purge = useMutation({
    mutationFn: (item: TrashItemDto) => api.purgeTrashItem(item.id),
    onSuccess: async () => {
      setPurging(null);
      setError(null);
      await invalidate();
    },
  });

  const empty = useMutation({
    mutationFn: () => api.emptyTrash(),
    onSuccess: async () => {
      track('trash_emptied', { entry_count: items.length });
      setEmptying(false);
      setError(null);
      await invalidate();
    },
  });

  if (!session.data) return null;

  const items = trash.data?.items ?? [];
  const node = trash.data?.node;

  return (
    <AppShell>
      <PageHeader
        title="Trash"
        meta={
          node
            ? `${pluralize(node.itemCount, 'item')} · ${formatBytes(node.size)} · permanently deleted after ${TRASH_TTL_DAYS} days`
            : undefined
        }
        actions={
          items.length > 0 ? (
            <Button variant="danger" onClick={() => setEmptying(true)}>
              <Trash2 size={14} aria-hidden />
              Empty trash
            </Button>
          ) : null
        }
      />

      <div className="px-4 py-6 md:px-6">
        {trash.isLoading ? <Spinner /> : null}

        {error ? (
          <div className="mb-3">
            <ErrorNote>{error}</ErrorNote>
          </div>
        ) : null}

        {trash.data && items.length === 0 ? (
          <Card>
            <EmptyState
              title="Trash is empty"
              body={`Deleted items land here and are permanently removed after ${TRASH_TTL_DAYS} days. Until then you can put them back where they came from.`}
            />
          </Card>
        ) : null}

        {items.length > 0 ? (
          <Card className="overflow-hidden">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-line">
                  <th className="label-caps px-4 py-2 text-left font-medium">Name</th>
                  <th className="label-caps hidden px-4 py-2 text-left font-medium sm:table-cell">
                    Deleted from
                  </th>
                  <th className="label-caps hidden w-[110px] px-4 py-2 text-left font-medium md:table-cell">
                    Size
                  </th>
                  <th className="label-caps w-[130px] px-4 py-2 text-left font-medium">Deleted</th>
                  <th className="w-[150px] px-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="h-row border-b border-line-2 last:border-0">
                    <td className="px-4">
                      <div className="flex items-center gap-2.5">
                        {item.type === 'FILE' ? (
                          <FileBadge kind={fileKind(item.mimeType)} />
                        ) : (
                          <Trash2 size={15} aria-hidden className="shrink-0 text-ink-4" />
                        )}
                        {/* The original name (§2.5) — no system-invented suffix. */}
                        <span className="row-primary min-w-0 truncate">{item.name}</span>
                      </div>
                      {/* Origin is what tells two same-named items apart (§2.4). */}
                      <span className="block truncate pl-[42px] text-[11px] text-ink-3 sm:hidden">
                        {item.deletedFromLabel}
                      </span>
                    </td>
                    <td className="hidden truncate px-4 text-[13px] text-ink-2 sm:table-cell">
                      {item.deletedFromLabel}
                    </td>
                    <td className="hidden px-4 text-[13px] text-ink-2 md:table-cell">
                      {item.type === 'FILE'
                        ? formatBytes(item.size)
                        : pluralize(item.itemCount, 'item')}
                    </td>
                    <td className="px-4 text-[13px] text-ink-2">{formatDate(item.deletedAt)}</td>
                    <td className="px-2">
                      <div className="flex items-center justify-end gap-1">
                        {/* Restore is the primary action; destroying is deliberate. */}
                        <Button
                          onClick={() => restore.mutate(item)}
                          disabled={restore.isPending}
                          className="h-7"
                        >
                          <RotateCcw size={13} aria-hidden />
                          Restore
                        </Button>
                        <Button
                          variant="ghost"
                          aria-label={`Delete “${item.name}” permanently`}
                          onClick={() => setPurging(item)}
                          className="h-7 px-1.5 hover:text-danger"
                        >
                          <Trash2 size={14} aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        ) : null}

        {items.length > 0 ? (
          <p className="mt-3 text-[12px] text-ink-3">
            Restoring puts an item back where it came from. Sharing is not restored — anyone who
            had access will need to be invited again.
          </p>
        ) : null}
      </div>

      {/* §2.7 — no undo at all, so both dialogs name exactly what is destroyed. */}
      {purging ? (
        <Dialog open onOpenChange={() => setPurging(null)}>
          <DialogShell className="w-[min(460px,calc(100vw-32px))]">
            <DialogHeader
              title={`Permanently delete “${purging.name}”?`}
              subtitle="This cannot be undone. The item and its files are destroyed immediately, not after 30 days."
            />
            <div className="px-5 py-4">
              <p className="label-caps">Contents</p>
              <div className="mt-2 flex gap-6 text-[13px]">
                <span>
                  {purging.type === 'FILE' ? '1 file' : pluralize(purging.itemCount, 'item')}
                </span>
                <span>{formatBytes(purging.size)}</span>
              </div>
              <p className="mt-3 text-[12px] text-ink-2">
                Deleted from {purging.deletedFromLabel}.
              </p>
              {purge.error ? (
                <div className="mt-3">
                  <ErrorNote>{(purge.error as Error).message}</ErrorNote>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button
                variant="danger"
                disabled={purge.isPending}
                onClick={() => purge.mutate(purging)}
              >
                Delete permanently
              </Button>
            </DialogFooter>
          </DialogShell>
        </Dialog>
      ) : null}

      {emptying && node ? (
        <Dialog open onOpenChange={() => setEmptying(false)}>
          <DialogShell className="w-[min(460px,calc(100vw-32px))]">
            <DialogHeader
              title="Empty the trash?"
              subtitle="This cannot be undone. Everything below is destroyed immediately."
            />
            <div className="px-5 py-4">
              <p className="label-caps">Contents</p>
              <div className="mt-2 flex gap-6 text-[13px]">
                <span>{pluralize(items.length, 'entry', 'entries')}</span>
                <span>{pluralize(node.itemCount, 'item')}</span>
                <span>{formatBytes(node.size)}</span>
              </div>
              {empty.error ? (
                <div className="mt-3">
                  <ErrorNote>{(empty.error as Error).message}</ErrorNote>
                </div>
              ) : null}
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button>Cancel</Button>
              </DialogClose>
              <Button variant="danger" disabled={empty.isPending} onClick={() => empty.mutate()}>
                {empty.isPending ? 'Emptying…' : 'Empty trash'}
              </Button>
            </DialogFooter>
          </DialogShell>
        </Dialog>
      ) : null}
    </AppShell>
  );
}
