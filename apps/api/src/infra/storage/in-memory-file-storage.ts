import type {
  DownloadOptions,
  FileStorage,
  ObjectStat,
  SignedUrl,
} from '../../application/ports/file-storage';

/**
 * The port's second implementation (§10.1). Used by tests and by local dev when
 * Supabase credentials are absent — the application layer cannot tell the
 * difference, which is the point of the port.
 */
export class InMemoryFileStorage implements FileStorage {
  protected readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  /** Test hook: makes deleteObjects throw, to exercise the orphan path (§10.3). */
  failDeletes = false;

  async createSignedUploadUrl(
    key: string,
    mimeType: string,
    _maxBytes: number,
    ttlSeconds: number,
  ): Promise<SignedUrl> {
    return {
      url: `memory://upload/${key}?ct=${encodeURIComponent(mimeType)}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async createSignedDownloadUrl(key: string, opts: DownloadOptions): Promise<SignedUrl> {
    return {
      url: `memory://download/${key}?disposition=${opts.disposition}&filename=${encodeURIComponent(opts.filename)}`,
      expiresAt: new Date(Date.now() + opts.ttlSeconds * 1000),
    };
  }

  async statObject(key: string): Promise<ObjectStat | null> {
    const object = this.objects.get(key);
    return object ? { size: object.body.length, contentType: object.contentType } : null;
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (this.failDeletes) throw new Error('storage unavailable');
    for (const key of keys) this.objects.delete(key);
  }

  // ---- test affordances ------------------------------------------------

  /** Stands in for the browser's direct PUT to the signed URL. */
  put(key: string, body: Buffer, contentType: string): void {
    this.objects.set(key, { body, contentType });
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  protected object(key: string): { body: Buffer; contentType: string } | null {
    return this.objects.get(key) ?? null;
  }

  reset(): void {
    this.objects.clear();
    this.failDeletes = false;
  }
}
