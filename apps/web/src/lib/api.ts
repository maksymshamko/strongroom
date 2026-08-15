import type {
  AccountDeletePreviewDto,
  AccountSecurityDto,
  BreadcrumbSegment,
  ContentUrlResponse,
  DeletePreviewDto,
  ErrorCode,
  FileVersionDto,
  NameConflictDetails,
  NodeDto,
  SearchResultDto,
  SessionResponse,
  ShareGrantDto,
  SharedItemDto,
  ShareStateDto,
  TrashResponse,
} from '@dataroom/contracts';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

/** Mirrors the §4.2 envelope so callers can branch on `code`, not on strings. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get conflict(): NameConflictDetails | null {
    return this.code === 'NAME_CONFLICT' ? (this.details as unknown as NameConflictDetails) : null;
  }
}

type Query = Record<string, string | number | boolean | string[] | undefined>;

function queryString(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === '') continue;
    if (Array.isArray(value)) value.forEach((v) => params.append(key, v));
    else params.append(key, String(value));
  }
  const rendered = params.toString();
  return rendered ? `?${rendered}` : '';
}

async function request<T>(
  path: string,
  init: RequestInit & { query?: Query } = {},
): Promise<T> {
  const { query, ...rest } = init;
  const response = await fetch(`${BASE}${path}${queryString(query)}`, {
    ...rest,
    // The session is an httpOnly cookie (§3.1), so every call is credentialed.
    credentials: 'include',
    headers: {
      ...(rest.body ? { 'content-type': 'application/json' } : {}),
      ...rest.headers,
    },
  });

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      (error?.code as ErrorCode) ?? 'INTERNAL',
      error?.message ?? 'Request failed',
      error?.details,
      response.status,
    );
  }

  return payload as T;
}

const json = (body: unknown) => JSON.stringify(body);

export type Page<T> = { items: T[]; nextCursor: string | null };
export type Conflict = 'KEEP_BOTH' | 'NEW_VERSION' | 'REPLACE';

export const api = {
  // §3.2
  login: (email: string, password: string) =>
    request<SessionResponse>('/auth/login', { method: 'POST', body: json({ email, password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => request<SessionResponse>('/auth/me'),
  googleUrl: () => `${BASE}/auth/google`,

  // §8.1
  listDataRooms: (query?: Query) => request<Page<NodeDto>>('/data-rooms', { query }),
  createDataRoom: (name: string) =>
    request<NodeDto>('/data-rooms', { method: 'POST', body: json({ name }) }),
  sharedWithMe: () => request<Page<SharedItemDto>>('/shared-with-me'),

  getNode: (id: string) =>
    request<{ node: NodeDto; breadcrumb: BreadcrumbSegment[] }>(`/nodes/${id}`),
  listChildren: (id: string, query?: Query) =>
    request<Page<NodeDto>>(`/nodes/${id}/children`, { query }),

  createFolder: (parentId: string, name: string, onConflict?: Conflict) =>
    request<NodeDto>('/nodes/folders', {
      method: 'POST',
      body: json({ parentId, name, onConflict }),
    }),
  rename: (id: string, name: string, onConflict?: Conflict) =>
    request<NodeDto>(`/nodes/${id}`, { method: 'PATCH', body: json({ name, onConflict }) }),
  move: (id: string, parentId: string, onConflict?: Conflict) =>
    request<NodeDto>(`/nodes/${id}/move`, { method: 'POST', body: json({ parentId, onConflict }) }),
  deletePreview: (id: string) => request<DeletePreviewDto>(`/nodes/${id}/delete-preview`),
  remove: (id: string) => request<void>(`/nodes/${id}`, { method: 'DELETE' }),

  versions: (id: string) => request<{ items: FileVersionDto[] }>(`/nodes/${id}/versions`),
  contentUrl: (id: string, opts: { version?: number; download?: boolean } = {}) =>
    request<ContentUrlResponse>(`/nodes/${id}/content`, {
      query: { version: opts.version, download: opts.download ? 1 : undefined },
    }),

  // §8.5
  search: (rootId: string, query: Query) =>
    request<Page<SearchResultDto>>(`/nodes/${rootId}/search`, { query }),

  // §8.2 — init/complete only; the PUT itself is an XHR so progress events exist.
  initUpload: (input: { parentId: string; name: string; size: number; mimeType: string }) =>
    request<{
      uploadId: string;
      storageKey: string;
      signedUrl: string;
      expiresAt: string;
      conflict?: { conflictingNodeId: string; suggestedName: string; versioningAvailable: boolean };
    }>('/uploads/init', { method: 'POST', body: json(input) }),
  completeUpload: (uploadId: string, body: { checksum?: string; onConflict?: Conflict } = {}) =>
    request<NodeDto>(`/uploads/${uploadId}/complete`, { method: 'POST', body: json(body) }),
  abortUpload: (uploadId: string) =>
    request<void>(`/uploads/${uploadId}/abort`, { method: 'POST' }),

  // §8.3
  shareState: (id: string) => request<ShareStateDto>(`/nodes/${id}/shares`),
  createLink: (id: string) =>
    request<{ shareId: string; token: string; url: string }>(`/nodes/${id}/shares/link`, {
      method: 'POST',
    }),
  addPeople: (id: string, emails: string[]) =>
    request<{ grants: ShareGrantDto[] }>(`/nodes/${id}/shares/people`, {
      method: 'POST',
      body: json({ emails }),
    }),
  revokeShare: (shareId: string) => request<void>(`/shares/${shareId}`, { method: 'DELETE' }),
  revokeGrant: (grantId: string) =>
    request<void>(`/share-grants/${grantId}`, { method: 'DELETE' }),

  // §8.4
  publicShare: (token: string, nodeId?: string) =>
    request<{ node: NodeDto; breadcrumb: BreadcrumbSegment[]; share: { nodeId: string } }>(
      nodeId ? `/public/shares/${token}/nodes/${nodeId}` : `/public/shares/${token}`,
    ),
  publicChildren: (token: string, nodeId: string, query?: Query) =>
    request<Page<NodeDto>>(`/public/shares/${token}/nodes/${nodeId}/children`, { query }),
  publicContent: (token: string, nodeId: string, download?: boolean) =>
    request<ContentUrlResponse>(`/public/shares/${token}/nodes/${nodeId}/content`, {
      query: { download: download ? 1 : undefined },
    }),

  // spec 003 §2.5, §2.6
  trash: () => request<TrashResponse>('/trash'),
  restoreFromTrash: (nodeId: string, onConflict?: Conflict) =>
    request<NodeDto>(`/trash/${nodeId}/restore`, {
      method: 'POST',
      body: json({ onConflict }),
    }),
  purgeTrashItem: (nodeId: string) => request<void>(`/trash/${nodeId}`, { method: 'DELETE' }),
  emptyTrash: () => request<void>('/trash', { method: 'DELETE' }),

  // spec 003 §1.2, §1.4, §1.5
  accountSecurity: () => request<AccountSecurityDto>('/account/security'),
  googleLinkUrl: () => `${BASE}/account/google/link`,
  unlinkGoogle: () => request<void>('/account/google', { method: 'DELETE' }),

  // §8.6
  setPassword: (body: { currentPassword?: string; newPassword: string }) =>
    request<void>('/account/password', { method: 'POST', body: json(body) }),
  accountDeletePreview: () => request<AccountDeletePreviewDto>('/account/delete-preview'),
  deleteAccount: (confirmEmail: string) =>
    request<void>('/account', { method: 'DELETE', body: json({ confirmEmail }) }),
};
