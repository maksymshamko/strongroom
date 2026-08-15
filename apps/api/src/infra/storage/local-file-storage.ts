import { InMemoryFileStorage } from './in-memory-file-storage';
import type { DownloadOptions, SignedUrl } from '../../application/ports/file-storage';

/**
 * Development adapter for the FileStorage port (§10.1).
 *
 * Same semantics as the in-memory adapter, except the signed URLs point at this
 * server's own `/dev-storage` routes so a real browser can PUT and GET them.
 * That keeps the §7.1 handshake — init → direct PUT → complete — genuinely
 * exercised locally instead of stubbed, without requiring Supabase credentials.
 *
 * Never selected when SUPABASE_URL is configured.
 */
export class LocalFileStorage extends InMemoryFileStorage {
  constructor(private readonly publicBaseUrl: string) {
    super();
  }

  override async createSignedUploadUrl(
    key: string,
    _mimeType: string,
    _maxBytes: number,
    ttlSeconds: number,
  ): Promise<SignedUrl> {
    return {
      url: `${this.publicBaseUrl}/dev-storage/${key}`,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  override async createSignedDownloadUrl(key: string, opts: DownloadOptions): Promise<SignedUrl> {
    const params = new URLSearchParams({
      disposition: opts.disposition,
      filename: opts.filename,
    });
    return {
      url: `${this.publicBaseUrl}/dev-storage/${key}?${params.toString()}`,
      expiresAt: new Date(Date.now() + opts.ttlSeconds * 1000),
    };
  }

  /** Used by the dev-storage controller; not part of the port. */
  read(key: string): { body: Buffer; contentType: string } | null {
    return this.object(key);
  }
}
