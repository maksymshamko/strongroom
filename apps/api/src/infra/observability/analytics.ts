import { PostHog } from 'posthog-node';

/**
 * spec 004 §5 — product analytics. EU cloud, events and identification only.
 * Absent key ⇒ inert.
 *
 * Server-side tracking exists for the events the browser cannot witness
 * honestly — an upload is only real once `complete` has verified it (002 §7.4).
 */
let client: PostHog | null = null;

export function initAnalytics(): boolean {
  const key = process.env.POSTHOG_KEY;
  if (!key || client) return client !== null;

  client = new PostHog(key, {
    host: process.env.POSTHOG_HOST ?? 'https://eu.i.posthog.com',
    flushAt: 20,
    flushInterval: 10_000,
  });
  return true;
}

export async function shutdownAnalytics(): Promise<void> {
  await client?.shutdown();
  client = null;
}

/**
 * §5 — the distinct id is the account's email, per the product owner: it makes
 * the funnel legible without a lookup.
 */
export function track(
  identity: { email: string },
  event: string,
  properties: Record<string, unknown> = {},
): void {
  client?.capture({
    distinctId: identity.email,
    event,
    properties: trackedProperties(properties),
  });
}

export function identify(user: { email: string; name: string }): void {
  client?.identify({
    distinctId: user.email,
    properties: { email: user.email, name: user.name },
  });
}

/**
 * §5 / §4.1 — the allow-list is a deny-list by shape: anything whose key looks
 * like a name, a path, a label or a credential is dropped before it can leave.
 * Document names *are* the confidential material here, and an analytics payload
 * is the easiest place to leak them by accident.
 */
const FORBIDDEN_KEY = /name|path|label|token|email|title|query/i;

export function trackedProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    // Ids, counts, sizes and `mime_type` survive: they classify without
    // identifying. Everything shaped like a name or a credential does not.
    if (FORBIDDEN_KEY.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}
