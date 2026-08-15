'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ALLOWED_FILE_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  type NameConflictDetails,
  type NodeDto,
} from '@dataroom/contracts';
import { api, ApiError, type Conflict } from '@/lib/api';
import { track } from '@/lib/observability';
import { useRequireSession } from '@/lib/session';
import { UploadProvider, useUploads } from '@/lib/uploads';
import { AppShell } from '@/components/app-shell';
import { Breadcrumbs } from '@/components/breadcrumbs';
import { NodeGrid, NodeTable } from '@/components/node-table';
import { UploadPanel } from '@/components/upload-panel';
import { FileViewer } from '@/components/pdf-viewer';
import { ConflictDialog, DeleteDialog, ShareDialog } from '@/components/node-dialogs';
import { EMPTY_FILTERS, SearchBar, type SearchFilters } from '@/components/search-bar';
import {
  Button,
  Dialog,
  DialogClose,
  DialogFooter,
  DialogHeader,
  DialogShell,
  EmptyState,
  Input,
  Label,
  Spinner,
} from '@/components/ui';
import { FolderPlus, Share2, Trash2, Upload } from 'lucide-react';
import { formatBytes, pluralize } from '@/lib/format';
import { cn } from '@/lib/cn';

// §11.2 /n/[nodeId] — the folder browser.
export default function BrowserPage() {
  return (
    <UploadProvider>
      <Browser />
    </UploadProvider>
  );
}

function Browser() {
  const params = useParams<{ nodeId: string }>();
  const router = useRouter();
  const nodeId = params.nodeId;
  const session = useRequireSession();
  const uploads = useUploads();

  const [view, setView] = useState<'list' | 'grid'>('list');
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [preview, setPreview] = useState<NodeDto | null>(null);

  const openPreview = (file: NodeDto) => {
    track('file_previewed', { data_room_id: file.dataRoomId, mime_type: file.mimeType });
    setPreview(file);
  };
  const [sharing, setSharing] = useState<NodeDto | null>(null);
  const [deleting, setDeleting] = useState<NodeDto | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const detail = useQuery({
    queryKey: ['node', nodeId],
    queryFn: () => api.getNode(nodeId),
    enabled: Boolean(session.data),
  });

  const searching =
    filters.q !== '' ||
    filters.type.length > 0 ||
    filters.mimeType.length > 0 ||
    filters.minSize !== undefined ||
    filters.maxSize !== undefined ||
    filters.updatedFrom !== undefined;

  const children = useQuery({
    queryKey: ['children', nodeId],
    queryFn: () => api.listChildren(nodeId, { limit: 100 }),
    enabled: Boolean(session.data) && !searching,
  });

  const results = useQuery({
    queryKey: ['search', nodeId, filters],
    queryFn: () => {
      track('search_performed', {
        has_query: filters.q !== '',
        filter_count:
          filters.type.length +
          filters.mimeType.length +
          (filters.minSize !== undefined || filters.maxSize !== undefined ? 1 : 0) +
          (filters.updatedFrom !== undefined ? 1 : 0),
      });
      return api.search(nodeId, {
        q: filters.q || undefined,
        type: filters.type,
        mimeType: filters.mimeType,
        minSize: filters.minSize,
        maxSize: filters.maxSize,
        updatedFrom: filters.updatedFrom,
        updatedTo: filters.updatedTo,
        limit: 100,
      });
    },
    enabled: Boolean(session.data) && searching,
  });

  const node = detail.data?.node;
  const canWrite = node?.viewerRole === 'OWNER';
  const items = useMemo(
    () => (searching ? (results.data?.items ?? []) : (children.data?.items ?? [])),
    [searching, results.data, children.data],
  );

  if (!session.data) return null;

  if (detail.isError) {
    return (
      <AppShell>
        <div className="px-6 py-10">
          <EmptyState
            title="This item is no longer available"
            body="It may have been deleted, or your access may have been revoked."
            actions={
              <Link href="/" className="no-underline">
                <Button variant="primary">Back to data rooms</Button>
              </Link>
            }
          />
        </div>
      </AppShell>
    );
  }

  // A file is not a container, so it must not be dressed as one. Reaching
  // /n/<fileId> directly — which is how "Shared with me" links to a file
  // shared by email — used to render the folder browser around it: an empty
  // listing, an Upload button, and a breadcrumb suggesting you could put
  // things inside a PDF. Open the document instead.
  if (node && node.type === 'FILE') {
    return (
      <>
        <FileViewer
          node={node}
          // Opened from a link in an email there is nothing to go back to, and
          // the parent folder may not be readable by this viewer anyway.
          onClose={() => (window.history.length > 1 ? router.back() : router.push('/'))}
          onShare={canWrite ? () => setSharing(node) : undefined}
        />
        {sharing ? (
          <ShareDialog node={sharing} open onOpenChange={(open) => !open && setSharing(null)} />
        ) : null}
      </>
    );
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragging(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) uploads.enqueue(files, nodeId);
  }

  return (
    <AppShell>
      <div
        onDragOver={(event) => {
          if (!canWrite) return;
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className="relative min-h-screen"
      >
        <header className="border-b border-line bg-surface px-4 py-4 md:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Breadcrumbs segments={detail.data?.breadcrumb ?? []} />

            {canWrite && node ? (
              <div className="flex items-center gap-2">
                <NewFolderDialog parentId={nodeId} />
                <Button variant="primary" onClick={() => fileInput.current?.click()}>
                  <Upload size={14} aria-hidden />
                  Upload
                </Button>
                <Button onClick={() => setSharing(node)}>
                  <Share2 size={14} aria-hidden />
                  Share
                </Button>
                <Button onClick={() => setDeleting(node)}>
                  <Trash2 size={14} aria-hidden />
                  Delete
                </Button>
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  hidden
                  // 002 §7.2 — the MVP accepts PDF only.
                  accept={[...ALLOWED_FILE_EXTENSIONS, ...ALLOWED_MIME_TYPES].join(',')}
                  onChange={(event) => {
                    const files = Array.from(event.target.files ?? []);
                    if (files.length > 0) uploads.enqueue(files, nodeId);
                    event.target.value = '';
                  }}
                />
              </div>
            ) : null}
          </div>

          {node ? (
            <p className="mt-2 text-[12px] text-ink-3">
              {pluralize(node.itemCount, 'item')} · {formatBytes(node.size)}
            </p>
          ) : null}
        </header>

        <div className="flex flex-col gap-3 px-4 py-5 md:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-[240px] flex-1">
              <SearchBar
                itemCount={node?.itemCount ?? 0}
                resultCount={searching ? (results.data?.items.length ?? null) : null}
                filters={filters}
                onChange={setFilters}
              />
            </div>
            <div className="flex overflow-hidden rounded-[6px] border border-line-2">
              {(['list', 'grid'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setView(mode)}
                  className={cn(
                    'px-3 py-1.5 text-[12px] capitalize',
                    view === mode ? 'bg-accent-soft text-accent' : 'bg-surface text-ink-2',
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          {detail.isLoading || children.isLoading || results.isLoading ? <Spinner /> : null}

          {items.length === 0 && !detail.isLoading && !children.isLoading ? (
            <div className="rounded-card border border-line bg-surface">
              <EmptyState
                title={searching ? 'No matching items' : 'This folder is empty'}
                body={
                  searching
                    ? 'Try a broader search, or clear the filters.'
                    : 'Drag files here to upload, or create a folder to start organising.'
                }
                actions={
                  !searching && canWrite ? (
                    <>
                      <Button variant="primary" onClick={() => fileInput.current?.click()}>
                        Select files
                      </Button>
                      <NewFolderDialog parentId={nodeId} />
                    </>
                  ) : null
                }
              />
            </div>
          ) : null}

          {items.length > 0 ? (
            view === 'list' ? (
              <NodeTable items={items} canWrite={Boolean(canWrite)} onOpenFile={openPreview} />
            ) : (
              <NodeGrid items={items} onOpenFile={openPreview} />
            )
          ) : null}
        </div>

        {/* Design §3.1 — the overlay names the destination folder; dropping into
            the wrong branch of a large room is the mistake this line prevents. */}
        {dragging && canWrite ? (
          <div className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-accent/10">
            <div className="rounded-dialog border-2 border-dashed border-accent bg-surface px-8 py-6 text-center">
              <p className="text-[15px] font-medium">Drop to upload into “{node?.name}”</p>
              <p className="mt-1 text-[12px] text-ink-3">
                PDF files only · uploaded directly to secure storage
              </p>
            </div>
          </div>
        ) : null}

        <UploadPanel />
      </div>

      {preview ? (
        <FileViewer
          node={preview}
          onClose={() => setPreview(null)}
          onShare={() => setSharing(preview)}
        />
      ) : null}

      {sharing ? (
        <ShareDialog node={sharing} open onOpenChange={() => setSharing(null)} />
      ) : null}

      {deleting ? (
        <DeleteDialog
          node={deleting}
          open
          onOpenChange={() => setDeleting(null)}
          onDeleted={() => {
            window.location.href = deleting.parentId ? `/n/${deleting.parentId}` : '/';
          }}
        />
      ) : null}
    </AppShell>
  );
}

function NewFolderDialog({ parentId }: { parentId: string }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [conflict, setConflict] = useState<NameConflictDetails | null>(null);

  const create = useMutation({
    mutationFn: (onConflict?: Conflict) => api.createFolder(parentId, name, onConflict),
    onSuccess: async (folder) => {
      track('folder_created', { data_room_id: folder.dataRoomId });
      await queryClient.invalidateQueries({ queryKey: ['children', parentId] });
      await queryClient.invalidateQueries({ queryKey: ['node', parentId] });
      setName('');
      setConflict(null);
      setOpen(false);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.conflict) setConflict(error.conflict);
    },
  });

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <FolderPlus size={14} aria-hidden />
        New folder
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogShell className="w-[min(420px,calc(100vw-32px))]">
          <DialogHeader title="New folder" />
          <form
            className="px-5 py-4"
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate(undefined);
            }}
          >
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="folder-name">Name</Label>
              <Input
                id="folder-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="02 Financials"
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button">Cancel</Button>
              </DialogClose>
              <Button type="submit" variant="primary" disabled={!name.trim() || create.isPending}>
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogShell>
      </Dialog>

      <ConflictDialog
        conflict={conflict}
        onResolve={(resolution) => create.mutate(resolution)}
        onCancel={() => setConflict(null)}
      />
    </>
  );
}
