import { describe, expect, it } from 'vitest';
import { isSentryEnabled, redactUrl, scrub } from '../../src/infra/observability/sentry';
import { trackedProperties } from '../../src/infra/observability/analytics';

// spec 004 §4.1 — telemetry must not carry the confidential material.
describe('Sentry scrubbing (§4.1)', () => {
  it('is inert without a DSN', () => {
    // No DSN is set in the test environment, so nothing was ever initialized.
    expect(isSentryEnabled()).toBe(false);
  });

  it('redacts share tokens from every URL shape that carries one', () => {
    expect(redactUrl('/api/v1/public/shares/9fK2mQ7xLp4abcd/nodes/x')).toBe(
      '/api/v1/public/shares/[token]/nodes/x',
    );
    expect(redactUrl('https://strongroom.shamko.me/s/9fK2mQ7xLp4abcd')).toBe(
      'https://strongroom.shamko.me/s/[token]',
    );
    expect(redactUrl('/api/v1/nodes/abc?t=9fK2mQ7xLp4abcd&limit=50')).toBe(
      '/api/v1/nodes/abc?t=[token]&limit=50',
    );
  });

  it('drops request bodies, cookies and credential headers', () => {
    const event = scrub({
      request: {
        url: '/api/v1/nodes/abc',
        data: { name: 'Project Meridian — Board Minutes.pdf' },
        cookies: { dr_session: 'jwt' },
        headers: { cookie: 'dr_session=jwt', 'x-share-token': 'tok', 'user-agent': 'x' },
      },
    });

    const request = event.request as Record<string, unknown>;
    expect(request.data).toBeUndefined();
    expect(request.cookies).toBeUndefined();
    expect(request.headers).toEqual({ 'user-agent': 'x' });
  });

  it('keeps the account id but never the email', () => {
    const event = scrub({ user: { id: 'user-1', email: 'anna@harlanco.com', username: 'anna' } });
    expect(event.user).toEqual({ id: 'user-1' });
  });
});

// spec 004 §5 — analytics carry ids and counts, never names or paths.
describe('analytics properties (§5)', () => {
  it('passes through ids, counts and types', () => {
    expect(
      trackedProperties({ data_room_id: 'room-1', size_bytes: 4200, mime_type: 'application/pdf' }),
    ).toEqual({ data_room_id: 'room-1', size_bytes: 4200, mime_type: 'application/pdf' });
  });

  it('drops anything that looks like a name, path or token', () => {
    expect(
      trackedProperties({
        node_id: 'n-1',
        name: 'Board Minutes.pdf',
        fileName: 'Board Minutes.pdf',
        path: '/room/folder/file/',
        pathLabel: '02 Financials',
        token: 'secret',
        email: 'anna@harlanco.com',
        deletedFromLabel: '02 Financials',
      }),
    ).toEqual({ node_id: 'n-1' });
  });
});
