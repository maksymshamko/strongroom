/** §10.1 — the storage port, expressed in object-key terms, not Supabase terms. */
export type SignedUrl = { url: string; expiresAt: Date };

export type ObjectStat = { size: number; contentType: string };

export type DownloadOptions = {
  ttlSeconds: number;
  filename: string;
  disposition: 'inline' | 'attachment';
};

export interface FileStorage {
  createSignedUploadUrl(
    key: string,
    mimeType: string,
    maxBytes: number,
    ttlSeconds: number,
  ): Promise<SignedUrl>;

  createSignedDownloadUrl(key: string, opts: DownloadOptions): Promise<SignedUrl>;

  /** Returns null when the object does not exist — used by upload verification (§7.4). */
  statObject(key: string): Promise<ObjectStat | null>;

  deleteObjects(keys: string[]): Promise<void>;
}
