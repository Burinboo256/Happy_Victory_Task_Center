import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { rid } from '../fixtures';

const origin = 'http://127.0.0.1:4181';
async function controls(value: unknown = {}) {
  const file = process.env.HVR_TEST_CONTROL_FILE;
  if (!file || !/hvr_http_[a-f0-9]{32}\.json$/.test(file))
    throw new Error('Isolated controls required');
  await writeFile(file, JSON.stringify(value));
}
async function login(page: Page, role: 'AGENT' | 'OTHER' | 'SECRETARY') {
  const token = process.env['HVR_TEST_' + role + '_TOKEN'];
  if (!token) throw new Error('Missing test session');
  await page
    .context()
    .addCookies([
      { name: 'hvr-session', value: token, url: origin, httpOnly: true, sameSite: 'Lax' },
    ]);
  const response = await page.request.get('/api/bootstrap?view=context');
  expect(response.status()).toBe(200);
  const body = await response.json();
  return { Origin: origin, 'X-CSRF-Token': body.csrfToken };
}
const data = {
  title: 'เอกสารทดสอบ API',
  category: 'เอกสารทีม',
  description: 'ข้อมูลสมมติ',
  keywords: ['ทดสอบ'],
  audience: 'all',
  url: 'https://drive.google.com/file/d/synthetic-example/view',
  label: '1',
  effectiveDate: '',
  note: 'ทดสอบ',
};
test.beforeEach(() => controls());
test.afterEach(() => controls());
test('forms API enforces identity, CSRF, draft ownership, publication and fresh access at redirect', async ({
  page,
}) => {
  const id = randomUUID(),
    path = '/api/forms/' + id;
  expect((await page.request.get('/api/forms')).status()).toBe(401);
  const anonymous = await page.request.get('/forms/' + id + '/open', { maxRedirects: 0 });
  expect(anonymous.status()).toBe(307);
  expect(new URL(anonymous.headers().location).searchParams.get('returnTo')).toBe(
    '/forms/' + id + '/open',
  );
  const secretary = await login(page, 'SECRETARY');
  expect((await page.request.post('/api/forms', { data: { id, data } })).status()).toBe(403);
  expect(
    (
      await page.request.post('/api/forms', {
        headers: { ...secretary, Origin: 'https://evil.test' },
        data: { id, data },
      })
    ).status(),
  ).toBe(403);
  const created = await page.request.post('/api/forms', { headers: secretary, data: { id, data } });
  expect(created.status()).toBe(201);
  const draft = await created.json();
  const publish = {
    action: 'publish',
    revision: draft.revision,
    versionId: draft.versionId,
    reviewed: true,
  };
  expect((await page.request.post(path, { headers: secretary, data: publish })).status()).toBe(403);
  let agent = await login(page, 'AGENT');
  expect(
    (
      await page.request.post('/api/forms', { headers: agent, data: { id: randomUUID(), data } })
    ).status(),
  ).toBe(403);
  expect((await page.request.get(path)).status()).toBe(404);
  await controls({ users: { [rid(3)]: { Role: 'Secretary' } } });
  const other = await login(page, 'OTHER');
  expect((await page.request.get(path)).status()).toBe(404);
  expect(
    (
      await page.request.post(path, {
        headers: other,
        data: { action: 'draft', revision: 1, versionId: draft.versionId, data },
      })
    ).status(),
  ).toBe(403);
  await controls({ users: { [rid(1)]: { Role: 'Admin' } } });
  const admin = await login(page, 'SECRETARY');
  expect((await page.request.post(path, { headers: admin, data: publish })).status()).toBe(200);
  agent = await login(page, 'AGENT');
  const opened = await page.request.get('/forms/' + id + '/open', { maxRedirects: 0 });
  expect(opened.status()).toBe(307);
  expect(opened.headers().location).toBe(data.url);
  expect(opened.headers()['cache-control']).toContain('no-store');
  expect(
    (
      await page.request.post(path, {
        headers: agent,
        data: { action: 'favorite', favorite: true },
      })
    ).status(),
  ).toBe(200);
  expect((await (await page.request.get('/api/forms?tab=favorites')).json()).total).toBe(1);
  await login(page, 'SECRETARY');
  expect(
    (
      await page.request.post(path, {
        headers: admin,
        data: { action: 'pause', revision: 2, paused: true },
      })
    ).status(),
  ).toBe(200);
  await login(page, 'AGENT');
  expect((await page.request.get('/forms/' + id + '/open', { maxRedirects: 0 })).status()).toBe(
    404,
  );
  expect((await (await page.request.get('/api/forms?tab=favorites')).json()).total).toBe(0);
  await controls({ users: { [rid(2)]: { Active: false } } });
  expect((await page.request.get('/api/forms')).status()).toBe(403);
});
