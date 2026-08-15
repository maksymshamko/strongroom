import * as Sentry from '@sentry/node'

/**
 * spec 004 §4 — one Sentry project for both apps, separated by a `service` tag.
 * During an incident the useful question is "what broke in this deployment",
 * and a single project keeps a frontend error next to the API error that caused
 * it.
 *
 * Absent DSN ⇒ inert. Nothing downstream has to check.
 */
let initialized = false

export function initSentry(): boolean {
  const dsn = process.env.SENTRY_DSN
  if (!dsn || initialized) return initialized

  Sentry.init({
    dsn,
    environment:
      process.env.SENTRY_ENVIRONMENT ?? process.env.ENV ?? 'development',
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    release: process.env.SENTRY_RELEASE ?? 'unknown',
    // §4 — the Nest logger is forwarded, so `logger.error` reaches Sentry too.
    enableLogs: true,
    initialScope: { tags: { service: 'api' } },
    beforeSend: scrub,
    beforeSendTransaction: scrub,
  })

  initialized = true
  return true
}

export function isSentryEnabled(): boolean {
  return initialized
}

/**
 * §4.1 — document names, folder paths and share tokens are the confidential
 * material in a diligence tool. None of them may leave the building in a crash
 * report, so the scrub is deliberately blunt: redact rather than sample.
 */
export function scrub<T extends { request?: unknown; user?: unknown }>(
  event: T,
): T {
  const request = event.request as
    | {
        url?: string
        data?: unknown
        cookies?: unknown
        headers?: Record<string, string>
      }
    | undefined

  if (request) {
    if (request.url) request.url = redactUrl(request.url)
    // Bodies carry names on every create/rename/move.
    delete request.data
    delete request.cookies
    if (request.headers) {
      delete request.headers.cookie
      delete request.headers.authorization
      delete request.headers['x-share-token']
    }
  }

  // The account id is enough to find the user; the email is not ours to ship.
  const user = event.user as
    | { id?: string; email?: string; username?: string }
    | undefined
  if (user) {
    delete user.email
    delete user.username
  }

  return event
}

export function redactUrl(url: string): string {
  return url
    .replace(/\/public\/shares\/[^/?#]+/g, '/public/shares/[token]')
    .replace(/\/s\/[^/?#]+/g, '/s/[token]')
    .replace(/([?&]t=)[^&#]*/g, '$1[token]')
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!initialized) return
  Sentry.captureException(error, context ? { extra: context } : undefined)
}

export function setSentryUser(userId: string | null): void {
  if (!initialized) return
  Sentry.setUser(userId ? { id: userId } : null)
}
