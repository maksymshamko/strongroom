'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type Conflict } from './api';
import { track } from './observability';
import {
  ALLOWED_FILE_EXTENSIONS,
  ALLOWED_MIME_TYPES,
  type NameConflictDetails,
} from '@dataroom/contracts';

const ALLOWED = new Set<string>(ALLOWED_MIME_TYPES);

/**
 * 002 §7.2 — the server is authoritative, but rejecting here saves the user
 * from watching a 200 MB file upload before being told it was never accepted.
 * Browsers leave `File.type` empty for some sources, so the extension is the
 * fallback rather than an outright rejection.
 */
function isAllowed(file: File): boolean {
  if (file.type) return ALLOWED.has(file.type);
  const lower = file.name.toLowerCase();
  return ALLOWED_FILE_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function declaredMimeType(file: File): string {
  return file.type || 'application/pdf';
}

export type UploadStatus = 'queued' | 'uploading' | 'verifying' | 'complete' | 'failed' | 'conflict';

export type UploadItem = {
  id: string;
  file: File;
  parentId: string;
  name: string;
  status: UploadStatus;
  loaded: number;
  total: number;
  /** Seconds remaining, from observed throughput. */
  eta: number | null;
  error?: string;
  conflict?: NameConflictDetails;
  uploadId?: string;
};

type UploadContextValue = {
  items: UploadItem[];
  enqueue: (files: File[], parentId: string) => void;
  retry: (id: string) => void;
  retryAllFailed: () => void;
  resolveConflict: (id: string, resolution: Conflict) => void;
  cancel: (id: string) => void;
  dismiss: (id: string) => void;
  clearFinished: () => void;
};

const UploadContext = createContext<UploadContextValue | null>(null);

export function useUploads(): UploadContextValue {
  const context = useContext(UploadContext);
  if (!context) throw new Error('useUploads must be used inside <UploadProvider>');
  return context;
}

export function UploadProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [items, setItems] = useState<UploadItem[]>([]);
  const requests = useRef(new Map<string, XMLHttpRequest>());

  const patch = useCallback((id: string, changes: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  const run = useCallback(
    async (item: UploadItem, onConflict?: Conflict) => {
      // Retrying a rejected file must not reach the network either.
      if (!isAllowed(item.file)) {
        patch(item.id, { status: 'failed', error: 'Only PDF files can be uploaded' });
        return;
      }
      patch(item.id, { status: 'uploading', loaded: 0, error: undefined, conflict: undefined });

      try {
        const init = await api.initUpload({
          parentId: item.parentId,
          name: item.name,
          size: item.file.size,
          mimeType: declaredMimeType(item.file),
        });
        patch(item.id, { uploadId: init.uploadId });

        // XHR, not fetch: the spec's per-file progress (§11.3) needs upload
        // progress events, which fetch does not expose.
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          requests.current.set(item.id, xhr);
          const startedAt = Date.now();

          xhr.upload.addEventListener('progress', (event) => {
            if (!event.lengthComputable) return;
            const elapsed = (Date.now() - startedAt) / 1000;
            const rate = elapsed > 0 ? event.loaded / elapsed : 0;
            const remaining = rate > 0 ? Math.round((event.total - event.loaded) / rate) : null;
            patch(item.id, { loaded: event.loaded, total: event.total, eta: remaining });
          });

          xhr.addEventListener('load', () =>
            xhr.status >= 200 && xhr.status < 300
              ? resolve()
              : reject(new Error(`Upload failed (${xhr.status})`)),
          );
          xhr.addEventListener('error', () => reject(new Error('Network error during upload')));
          xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')));

          xhr.open('PUT', init.signedUrl);
          // Must match what was declared at init — `complete` compares the
          // stored object's content type against it (002 §7.4).
          xhr.setRequestHeader('content-type', declaredMimeType(item.file));
          xhr.send(item.file);
        });

        patch(item.id, { status: 'verifying' });
        const node = await api.completeUpload(init.uploadId, { onConflict });

        // Only counted once the server has verified the object (002 §7.4) —
        // a client-side "done" would over-report.
        track('file_uploaded', {
          data_room_id: node.dataRoomId,
          size_bytes: item.file.size,
          mime_type: node.mimeType,
        });
        patch(item.id, { status: 'complete', loaded: item.file.size, eta: 0 });
        await queryClient.invalidateQueries({ queryKey: ['children', item.parentId] });
        await queryClient.invalidateQueries({ queryKey: ['node', item.parentId] });
      } catch (error) {
        // A name clash is not a failure — it is a question for the user (§6.4).
        if (error instanceof ApiError && error.conflict) {
          patch(item.id, { status: 'conflict', conflict: error.conflict });
          return;
        }
        patch(item.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Upload failed',
        });
      } finally {
        requests.current.delete(item.id);
      }
    },
    [patch, queryClient],
  );

  const enqueue = useCallback(
    (files: File[], parentId: string) => {
      const added: UploadItem[] = files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        parentId,
        name: file.name,
        status: isAllowed(file) ? 'queued' : 'failed',
        error: isAllowed(file) ? undefined : 'Only PDF files can be uploaded',
        loaded: 0,
        total: file.size,
        eta: null,
      }));
      setItems((current) => [...current, ...added]);
      added.filter((item) => item.status === 'queued').forEach((item) => void run(item));
    },
    [run],
  );

  const value = useMemo<UploadContextValue>(
    () => ({
      items,
      enqueue,
      retry: (id) => {
        const item = items.find((i) => i.id === id);
        if (item) void run(item);
      },
      retryAllFailed: () => {
        items.filter((i) => i.status === 'failed').forEach((item) => void run(item));
      },
      resolveConflict: (id, resolution) => {
        const item = items.find((i) => i.id === id);
        if (!item) return;
        // KEEP_BOTH etc. are re-submitted at `complete`, so the bytes already in
        // storage are reused rather than uploaded again.
        if (item.uploadId) {
          patch(id, { status: 'verifying' });
          api
            .completeUpload(item.uploadId, { onConflict: resolution })
            .then(async () => {
              patch(id, { status: 'complete' });
              await queryClient.invalidateQueries({ queryKey: ['children', item.parentId] });
            })
            .catch((error: Error) => patch(id, { status: 'failed', error: error.message }));
        } else {
          void run(item, resolution);
        }
      },
      cancel: (id) => {
        requests.current.get(id)?.abort();
        const item = items.find((i) => i.id === id);
        if (item?.uploadId) void api.abortUpload(item.uploadId).catch(() => undefined);
        setItems((current) => current.filter((i) => i.id !== id));
      },
      dismiss: (id) => setItems((current) => current.filter((i) => i.id !== id)),
      clearFinished: () =>
        setItems((current) => current.filter((item) => item.status !== 'complete')),
    }),
    [items, enqueue, run, patch, queryClient],
  );

  return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}
