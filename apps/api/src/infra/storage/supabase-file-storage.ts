import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type {
  DownloadOptions,
  FileStorage,
  ObjectStat,
  SignedUrl,
} from '../../application/ports/file-storage';

type KeyKind = 'service_role' | 'anon' | 'secret' | 'publishable' | 'unknown';

/**
 * Supabase ships two key pairs — the legacy JWTs (`anon` / `service_role`) and
 * the newer `sb_publishable_…` / `sb_secret_…`. Only the privileged half of
 * either pair bypasses row-level security, and pasting the wrong one is easy:
 * both sit on the same settings page and both authenticate fine, so the
 * mistake only shows up as an RLS violation on the first upload.
 */
export function classifySupabaseKey(key: string): KeyKind {
  if (key.startsWith('sb_secret_')) return 'secret';
  if (key.startsWith('sb_publishable_')) return 'publishable';

  const payload = key.split('.')[1];
  if (!payload) return 'unknown';
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      role?: unknown;
    };
    if (claims.role === 'service_role') return 'service_role';
    if (typeof claims.role === 'string') return 'anon';
  } catch {
    // Not a JWT we can read — fall through and let the first call be the judge.
  }
  return 'unknown';
}

const SETUP_HINT =
  'The bucket must exist and the API must hold a privileged key. In the Supabase dashboard: ' +
  'Storage → New bucket (private, named to match SUPABASE_BUCKET), then Project Settings → API keys → ' +
  'copy the `service_role` secret (or an `sb_secret_…` key) into SUPABASE_SERVICE_ROLE_KEY. ' +
  'The publishable/anon key is subject to row-level security and cannot write objects.';

/**
 * §7 — uploads go straight from the browser to Supabase Storage; the API only
 * mints scoped, short-lived URLs and verifies the result afterwards (§7.4).
 */
export class SupabaseFileStorage implements FileStorage {
  private readonly client: SupabaseClient;

  constructor(
    url: string,
    serviceRoleKey: string,
    private readonly bucket: string,
  ) {
    const kind = classifySupabaseKey(serviceRoleKey);
    if (kind === 'anon' || kind === 'publishable') {
      // Fail at boot rather than at the first upload: a misconfigured key is a
      // deployment mistake, and every request until it is fixed would fail.
      throw new Error(
        `SUPABASE_SERVICE_ROLE_KEY is a ${kind === 'anon' ? '`anon`' : 'publishable'} key, ` +
          'which row-level security blocks from writing storage objects. ' +
          'Use the `service_role` secret (Project Settings → API keys) instead.',
      );
    }

    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async createSignedUploadUrl(
    key: string,
    _mimeType: string,
    _maxBytes: number,
    ttlSeconds: number,
  ): Promise<SignedUrl> {
    const { data, error } = await this.client.storage.from(this.bucket).createSignedUploadUrl(key);
    if (error || !data) throw this.storageError('Could not create upload URL', error?.message);
    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };
  }

  async createSignedDownloadUrl(key: string, opts: DownloadOptions): Promise<SignedUrl> {
    const { data, error } = await this.client.storage
      .from(this.bucket)
      .createSignedUrl(key, opts.ttlSeconds, {
        download: opts.disposition === 'attachment' ? opts.filename : undefined,
      });
    if (error || !data) throw this.storageError('Could not create download URL', error?.message);
    return {
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + opts.ttlSeconds * 1000),
    };
  }

  async statObject(key: string): Promise<ObjectStat | null> {
    const slash = key.lastIndexOf('/');
    const folder = slash === -1 ? '' : key.slice(0, slash);
    const name = slash === -1 ? key : key.slice(slash + 1);

    const { data, error } = await this.client.storage
      .from(this.bucket)
      .list(folder, { search: name, limit: 1 });
    if (error) throw this.storageError('Could not stat object', error.message);

    const found = data?.find((entry) => entry.name === name);
    if (!found) return null;
    return {
      size: Number(found.metadata?.size ?? 0),
      contentType: String(found.metadata?.mimetype ?? ''),
    };
  }

  async deleteObjects(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    const { error } = await this.client.storage.from(this.bucket).remove(keys);
    if (error) throw this.storageError('Could not delete objects', error.message);
  }

  /**
   * Supabase reports both a missing bucket and an unprivileged key as terse
   * Postgres/HTTP errors ("new row violates row-level security policy"), which
   * says nothing about what to change. Attach the fix to the message.
   */
  private storageError(what: string, detail?: string): Error {
    const message = detail ?? 'unknown error';
    const misconfigured =
      /row-level security|bucket not found|not authorized|violates/i.test(message);
    return new Error(
      misconfigured
        ? `${what}: ${message}. Supabase Storage looks misconfigured for bucket "${this.bucket}". ${SETUP_HINT}`
        : `${what}: ${message}`,
    );
  }
}
