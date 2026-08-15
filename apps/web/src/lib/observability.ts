'use client'

import * as Sentry from '@sentry/nextjs'
import posthog from 'posthog-js'
/**
 * spec 004 §4 and §5 — browser-side observability.
 *
 * Both are inert without credentials, so nothing at a call site has to check
 * whether telemetry is configured.
 */

let started = false

export function initObservability(): void {
  if (started || typeof window === 'undefined') return
  started = true

  const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? 'development',
      tracesSampleRate: Number(
        process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? 0.1,
      ),
      release: process.env.NEXT_PUBLIC_SENTRY_RELEASE ?? 'unknown',
      // §4 — one project, split by tag, so a browser error sits next to the API
      // error that caused it.
      initialScope: { tags: { service: 'web' } },
      // §4.1 — replay would record the documents themselves. Never enabled.
      replaysOnErrorSampleRate: 0,
      replaysSessionSampleRate: 0,
      beforeSend(event) {
        if (event.request?.url) event.request.url = redactUrl(event.request.url)
        if (event.user) {
          delete event.user.email
          delete event.user.username
        }
        return event
      },
    })
  }

  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY

  if (posthogKey) {
    posthog.init(posthogKey, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
      // §5 — events and identification only. These three are off explicitly
      // rather than left at their defaults: in a diligence tool a session
      // recording is a recording of somebody's confidential documents.
      disable_session_recording: true,
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      // URLs carry share tokens and node ids; the path alone is not safe.
      sanitize_properties: (properties) => {
        for (const key of ['$current_url', '$referrer', '$pathname'] as const) {
          if (typeof properties[key] === 'string') {
            properties[key] = redactUrl(properties[key] as string)
          }
        }
        return properties
      },
      persistence: 'localStorage+cookie',
    })
  }
}

export function redactUrl(url: string): string {
  return url
    .replace(/\/s\/[^/?#]+/g, '/s/[token]')
    .replace(/([?&]t=)[^&#]*/g, '$1[token]')
}

/** §5 — identified by email, per the product owner. */
export function identifyUser(user: {
  id: string
  email: string
  name: string
}): void {
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
    posthog.identify(user.email, { email: user.email, name: user.name })
  }
  // §4.1 — Sentry gets the account id only; the email is not ours to ship there.
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.setUser({ id: user.id })
  }
}

export function resetIdentity(): void {
  if (process.env.NEXT_PUBLIC_POSTHOG_KEY) posthog.reset()
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) Sentry.setUser(null)
}

/** §5 — the event vocabulary. Ids, counts and types; never names or paths. */
export type AnalyticsEvent =
  | 'dataroom_created'
  | 'folder_created'
  | 'file_uploaded'
  | 'file_previewed'
  | 'node_deleted'
  | 'node_restored'
  | 'share_link_created'
  | 'share_people_invited'
  | 'share_revoked'
  | 'search_performed'
  | 'trash_emptied'

export function track(
  event: AnalyticsEvent,
  properties: Record<string, unknown> = {},
): void {
  if (!process.env.NEXT_PUBLIC_POSTHOG_KEY) return
  posthog.capture(event, properties)
}
