'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  Download,
  Folder,
  FolderInput,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from 'lucide-react';
import type { NameConflictDetails, NodeDto } from '@dataroom/contracts';
import { api, ApiError, type Conflict } from '@/lib/api';
import { Button, Chip, FileBadge } from '@/components/ui';
import { ConflictDialog, DeleteDialog, MoveDialog, ShareDialog } from '@/components/node-dialogs';
import { fileKind, formatBytes, formatDate, pluralize } from '@/lib/format';
import { cn } from '@/lib/cn';

type Action = 'rename' | 'move' | 'share' | 'delete';

/**
 * §11.3 NodeTable — 44px rows, four metadata columns, folders above files.
 * "Uploaded by" is a column, not a hover detail: in diligence, provenance is
 * primary metadata.
 */
export function NodeTable({
  items,
  canWrite,
  onOpenFile,
  onOpenFolder,
}: {
  items: NodeDto[];
  canWrite: boolean;
  onOpenFile?: (node: NodeDto) => void;
  /** Public-link browsing navigates in place rather than by route (§8.4). */
  onOpenFolder?: (node: NodeDto) => void;
}) {
  const [dialog, setDialog] = useState<{ node: NodeDto; action: Exclude<Action, 'rename'> } | null>(
    null,
  );
  const [renaming, setRenaming] = useState<string | null>(null);

  return (
    <>
      <div className="overflow-hidden rounded-card border border-line bg-surface">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-line">
              <th className="label-caps px-4 py-2 text-left font-medium">Name</th>
              <th className="label-caps hidden w-[110px] px-4 py-2 text-left font-medium md:table-cell">
                Size
              </th>
              <th className="label-caps w-[150px] px-4 py-2 text-left font-medium">Modified</th>
              <th className="label-caps hidden w-[150px] px-4 py-2 text-left font-medium lg:table-cell">
                Uploaded by
              </th>
              <th className="w-[44px] px-2" />
            </tr>
          </thead>
          <tbody>
            {items.map((node) => (
              <tr key={node.id} className="h-row border-b border-line-2 last:border-0 hover:bg-surface-2">
                <td className="px-4">
                  {renaming === node.id ? (
                    <InlineRename node={node} onDone={() => setRenaming(null)} />
                  ) : (
                    <div className="flex items-center gap-2.5">
                      {node.type === 'FILE' ? (
                        <FileBadge kind={fileKind(node.mimeType)} />
                      ) : (
                        <Folder size={16} aria-hidden className="mx-1.5 shrink-0 text-ink-3" />
                      )}

                      {node.type === 'FILE' ? (
                        <button
                          onClick={() => onOpenFile?.(node)}
                          className="row-primary min-w-0 truncate text-left hover:underline"
                        >
                          {node.name}
                        </button>
                      ) : onOpenFolder ? (
                        <button
                          onClick={() => onOpenFolder(node)}
                          className="row-primary min-w-0 truncate text-left hover:underline"
                        >
                          {node.name}
                        </button>
                      ) : (
                        <Link
                          href={`/n/${node.id}`}
                          className="row-primary min-w-0 truncate no-underline hover:underline"
                        >
                          {node.name}
                        </Link>
                      )}

                      {node.isShared ? <Chip tone="accent">Shared</Chip> : null}
                    </div>
                  )}
                  {renaming !== node.id ? (
                    <span className="block pl-[42px] text-[11px] text-ink-3 md:hidden">
                      {node.type === 'FILE'
                        ? formatBytes(node.size)
                        : pluralize(node.itemCount, 'item')}
                    </span>
                  ) : null}
                </td>

                <td className="hidden px-4 text-[13px] text-ink-2 md:table-cell">
                  {node.type === 'FILE'
                    ? formatBytes(node.size)
                    : pluralize(node.itemCount, 'item')}
                </td>
                <td className="px-4 text-[13px] text-ink-2">{formatDate(node.updatedAt)}</td>
                <td className="hidden truncate px-4 text-[13px] text-ink-2 lg:table-cell">
                  {node.ownerName}
                </td>

                <td className="px-2 text-right">
                  {canWrite ? (
                    <RowMenu
                      node={node}
                      onRename={() => setRenaming(node.id)}
                      onAction={(action) => setDialog({ node, action })}
                    />
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {dialog?.action === 'delete' ? (
        <DeleteDialog node={dialog.node} open onOpenChange={() => setDialog(null)} />
      ) : null}
      {dialog?.action === 'move' ? (
        <MoveDialog node={dialog.node} open onOpenChange={() => setDialog(null)} />
      ) : null}
      {dialog?.action === 'share' ? (
        <ShareDialog node={dialog.node} open onOpenChange={() => setDialog(null)} />
      ) : null}
    </>
  );
}

function RowMenu({
  node,
  onRename,
  onAction,
}: {
  node: NodeDto;
  onRename: () => void;
  onAction: (action: Exclude<Action, 'rename'>) => void;
}) {
  async function download() {
    const { url } = await api.contentUrl(node.id, { download: true });
    window.open(url, '_blank', 'noopener');
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label="Item actions"
        className="rounded-[4px] p-1.5 leading-none text-ink-3 hover:bg-surface-3 hover:text-ink-1"
      >
        <MoreHorizontal size={16} aria-hidden />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[160px] rounded-[8px] border border-line bg-surface py-1 shadow-[0_8px_24px_rgba(24,24,27,0.12)]"
        >
          {node.type === 'FILE' ? (
            <MenuItem icon={<Download size={14} aria-hidden />} onSelect={download}>
              Download
            </MenuItem>
          ) : null}
          <MenuItem icon={<FolderInput size={14} aria-hidden />} onSelect={() => onAction('move')}>
            Move
          </MenuItem>
          <MenuItem icon={<Pencil size={14} aria-hidden />} onSelect={onRename}>
            Rename
          </MenuItem>
          <MenuItem icon={<Share2 size={14} aria-hidden />} onSelect={() => onAction('share')}>
            Share
          </MenuItem>
          <DropdownMenu.Separator className="my-1 h-px bg-line" />
          <MenuItem danger icon={<Trash2 size={14} aria-hidden />} onSelect={() => onAction('delete')}>
            Delete
          </MenuItem>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuItem({
  children,
  danger,
  icon,
  onSelect,
}: {
  children: React.ReactNode;
  danger?: boolean;
  icon?: React.ReactNode;
  onSelect: () => void;
}) {
  return (
    <DropdownMenu.Item
      onSelect={onSelect}
      className={cn(
        'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] outline-none data-[highlighted]:bg-surface-3',
        danger ? 'text-danger' : 'text-ink-1',
      )}
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  );
}

/**
 * §11.3 InlineRename — editing happens in the row so the user keeps their place
 * in a long list. The extension is shown but not selected on entry.
 */
function InlineRename({ node, onDone }: { node: NodeDto; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(node.name);
  const [conflict, setConflict] = useState<NameConflictDetails | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const rename = useMutation({
    mutationFn: (onConflict?: Conflict) => api.rename(node.id, value, onConflict),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['children', node.parentId ?? ''] });
      setConflict(null);
      onDone();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.conflict) setConflict(error.conflict);
    },
  });

  return (
    <>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          rename.mutate(undefined);
        }}
      >
        <input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => {
            // Select the stem only — the extension stays out of the selection.
            const dot = node.type === 'FILE' ? value.lastIndexOf('.') : -1;
            event.target.setSelectionRange(0, dot > 0 ? dot : value.length);
          }}
          onKeyDown={(event) => event.key === 'Escape' && onDone()}
          className="h-7 min-w-0 flex-1 rounded-[4px] border border-accent-line bg-surface px-2 text-[13px] focus:outline-none"
        />
        <Button type="submit" variant="primary" className="h-7" disabled={rename.isPending}>
          Save
        </Button>
        <Button type="button" className="h-7" onClick={onDone}>
          Cancel
        </Button>
      </form>

      <ConflictDialog
        conflict={conflict}
        onResolve={(resolution) => rename.mutate(resolution)}
        onCancel={() => setConflict(null)}
      />
    </>
  );
}

/** §11.3 NodeGrid — the same data, for visual material. */
export function NodeGrid({
  items,
  onOpenFile,
  onOpenFolder,
}: {
  items: NodeDto[];
  onOpenFile?: (node: NodeDto) => void;
  onOpenFolder?: (node: NodeDto) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((node) =>
        node.type === 'FILE' ? (
          <button
            key={node.id}
            onClick={() => onOpenFile?.(node)}
            className="rounded-card border border-line bg-surface p-3 text-left hover:border-accent-line"
          >
            <div className="mb-3 flex h-24 items-center justify-center rounded-[6px] bg-surface-3 text-[11px] tracking-[0.08em] text-ink-3">
              {fileKind(node.mimeType)}
            </div>
            <p className="truncate text-[13px] font-medium">{node.name}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">
              {formatBytes(node.size)} · {formatDate(node.updatedAt)}
            </p>
          </button>
        ) : (
          <Link
            key={node.id}
            href={`/n/${node.id}`}
            onClick={(event) => {
              if (!onOpenFolder) return;
              event.preventDefault();
              onOpenFolder(node);
            }}
            className="rounded-card border border-line bg-surface p-3 no-underline hover:border-accent-line"
          >
            <div className="mb-3 flex h-24 items-center justify-center rounded-[6px] bg-surface-2 text-ink-4">
              <Folder size={26} aria-hidden />
            </div>
            <p className="truncate text-[13px] font-medium text-ink-1">{node.name}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">{pluralize(node.itemCount, 'item')}</p>
          </Link>
        ),
      )}
    </div>
  );
}
