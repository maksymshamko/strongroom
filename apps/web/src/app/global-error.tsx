'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * spec 004 §4 — the App Router's last-resort error boundary. Whatever reaches
 * here was not handled anywhere else, so it is genuinely an incident.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'Helvetica, Arial, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          background: '#efeff0',
          color: '#18181b',
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 500, margin: 0 }}>Something went wrong</h1>
          <p style={{ fontSize: 13, color: '#5c5c63', lineHeight: 1.6, marginTop: 8 }}>
            The error has been reported. Reloading usually clears it; if it does not, your
            documents are unaffected — nothing was changed.
          </p>
          <a
            href="/"
            style={{
              display: 'inline-block',
              marginTop: 16,
              padding: '8px 16px',
              borderRadius: 6,
              background: '#3d3a4f',
              color: '#fff',
              fontSize: 13,
              textDecoration: 'none',
            }}
          >
            Back to data rooms
          </a>
        </div>
      </body>
    </html>
  );
}
