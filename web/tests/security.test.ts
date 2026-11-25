import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig, readMigrationConfig, productionBase } from '../src/server/config';
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
import { registrationPath, registrationErrorPath } from '../src/domain/space-link';

test('registration links and OAuth errors keep the intended Space without accepting redirects', () => {
  const id = '00000000-0000-4000-8000-000000000002';
  assert.equal(registrationPath('team-b', id), '/team-b/register');
  assert.equal(registrationPath(undefined, id), '/register?space=' + id);
  assert.equal(registrationErrorPath('/team-b', id), '/team-b/register?error=google');
  assert.equal(registrationErrorPath('/', id), '/register?space=' + id + '&error=google');
  assert.equal(
    registrationErrorPath('https://evil.test', id),
    '/register?space=' + id + '&error=google',
  );
  assert.equal(registrationPath('../other'), '/register');
});

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
test('migration config permits database setup before web credentials while preserving TLS and environment isolation', () => {
  const minimal = {
    APP_ENV: 'staging',
    AIRTABLE_BASE_ID: environment.AIRTABLE_BASE_ID,
    DATABASE_URL:
      'postgresql://test:private-db-value@runtime.example.test/test?sslmode=verify-full',
    DATABASE_MIGRATION_URL:
      'postgresql://test:private-db-value@direct.example.test/test?sslmode=verify-full',
    VERCEL_ENV: 'preview',
  };
  assert.equal(readMigrationConfig(minimal).DATABASE_URL, minimal.DATABASE_MIGRATION_URL);
  assert.throws(() => readConfig(minimal), 'runtime still requires complete auth configuration');
  assert.equal(
    readMigrationConfig({ ...minimal, DATABASE_MIGRATION_URL: '' }).DATABASE_URL,
    minimal.DATABASE_URL,
  );
  for (const override of [
    { AIRTABLE_BASE_ID: productionBase },
    { APP_ENV: 'development' },
    { VERCEL_ENV: 'production' },
    {
      DATABASE_URL: 'postgresql://test:private-db-value@runtime.example.test/test?sslmode=require',
    },
    {
      DATABASE_MIGRATION_URL:
        'postgresql://test:private-db-value@direct.example.test/test?sslmode=require',
    },
    { DATABASE_MIGRATION_URL: 'not-a-url-private-db-value' },
  ])
    assert.throws(
      () => readMigrationConfig({ ...minimal, ...override }),
      (error) => error instanceof Error && !error.message.includes('private-db-value'),
    );
});

test('return destinations allow only known local paths', () => {
  assert.equal(safeReturnTo('/tasks/new'), '/tasks/new');
  assert.equal(safeReturnTo('/rinlyn'), '/rinlyn');
  assert.equal(safeReturnTo('/team-2'), '/team-2');
  for (const path of [
    '/rinlyn/tasks',
    '/rinlyn/inbox',
    '/rinlyn/tasks/new',
    '/rinlyn/customer-care/dashboard',
    '/rinlyn/customer-care/queue',
    '/rinlyn/customer-care/queue?group=premium',
    '/rinlyn/customer-care/policies',
    '/rinlyn/customer-care/register',
    '/rinlyn/forms?q=HC1',
    '/rinlyn/tasks?status=open',
    '/rinlyn/forms/12345678-1234-1234-1234-123456789abc/open',
  ])
    assert.equal(safeReturnTo(path), path);
  assert.equal(
    safeReturnTo(
      '/spaces/open?' +
        new URLSearchParams({ space: '00000000-0000-4000-8000-000000000001', next: '/rinlyn' }),
    ),
    '/',
  );
  const form = '/forms/12345678-1234-1234-1234-123456789abc/open';
  assert.equal(safeReturnTo(form), form);
  assert.equal(safeReturnTo('/forms?q=HC1'), '/forms?q=HC1');
  for (const input of [
    '//evil.test',
    'https://evil.test',
    '/\\evil.test',
    '/api/tasks',
    '/api',
    '/rinlyn?next=https://evil.test',
    '/rinlyn/../../api',
    '/rinlyn%2fevil',
    '/rinlyn/api/tasks',
    '/rinlyn/customer-care/unknown',
    '/rinlyn/customer-care/queue?group=unknown',
    '/rinlyn/tasks?status=open&redirect=https://evil.test',
    '/rinlyn/forms?q=HC1&q=HC2',
    '/rinlyn/tasks/new?next=https://evil.test',
    '/tasks/new?next=evil',
    '%2f%2fevil',
    '/forms?q=HC1&next=https://evil.test',
    '/forms?q=HC1&q=HC2',
    '/forms?q=' + 'x'.repeat(301),
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
