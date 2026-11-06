import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, productionBase } from '../src/server/config';
import {
  safeReturnTo,
  safeEqual,
  signBinding,
  readBinding,
  requireCsrf,
  cookieName,
  cookieOptions,
} from '../src/server/auth/security';
import { todayBangkok } from '../src/domain/model';
import { environment, config } from './fixtures';

test('configuration rejects production data in development and unsafe origins without disclosing values', () => {
  for (const override of [
    { AIRTABLE_BASE_ID: productionBase },
    { APP_ORIGIN: 'http://example.com' },
    { APP_ORIGIN: 'https://example.com/path' },
    { DATABASE_URL: 'postgresql://sensitive:password@example.com/db?sslmode=require' },
    { VERCEL_ENV: 'preview' },
    { ENABLE_LINE_NOTIFICATIONS: 'true' },
  ]) {
    assert.throws(
      () => readConfig({ ...environment, ...override }),
      (error) =>
        error instanceof Error &&
        !error.message.includes('password') &&
        !error.message.includes(productionBase),
    );
  }
});
test('return destinations allow only known local paths', () => {
  assert.equal(safeReturnTo('/tasks/new'), '/tasks/new');
  for (const input of [
    '//evil.test',
    'https://evil.test',
    '/\\evil.test',
    '/api/tasks',
    '/tasks/new?next=evil',
    '%2f%2fevil',
  ])
    assert.equal(safeReturnTo(input), '/');
});
test('OAuth browser binding refuses tampering and handles non-ASCII safely', () => {
  const value = 'a'.repeat(64),
    signed = signBinding(value, config.AUTH_SECRET);
  assert.equal(readBinding(signed, config.AUTH_SECRET), value);
  assert.equal(readBinding(signed.slice(0, -1) + 'z', config.AUTH_SECRET), '');
  assert.equal(safeEqual('é', 'a'), false);
});
test('mutation CSRF requires exact origin and session token', () => {
  const token = 'b'.repeat(64);
  requireCsrf(
    new Request(config.APP_ORIGIN, {
      headers: { origin: config.APP_ORIGIN, 'x-csrf-token': token },
    }),
    token,
    config,
  );
  for (const entries of [
    [
      ['origin', 'https://evil.test'],
      ['x-csrf-token', token],
    ],
    [['origin', config.APP_ORIGIN]],
    [
      ['origin', config.APP_ORIGIN],
      ['x-csrf-token', 'c'.repeat(64)],
    ],
  ])
    assert.throws(() =>
      requireCsrf(
        new Request(config.APP_ORIGIN, { headers: new Headers(Object.fromEntries(entries)) }),
        token,
        config,
      ),
    );
});
test('production cookies are host-bound secure and expiry uses six hours', () => {
  const https = { ...config, APP_ORIGIN: 'https://tasks.example.com' };
  assert.equal(cookieName(https, 'session'), '__Host-hvr-session');
  assert.deepEqual(cookieOptions(https, 21600), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 21600,
  });
});
test('Bangkok calendar crosses midnight independently of UTC', () => {
  assert.equal(todayBangkok(new Date('2026-11-05T16:59:59Z')), '2026-11-05');
  assert.equal(todayBangkok(new Date('2026-11-05T17:00:00Z')), '2026-11-06');
});
