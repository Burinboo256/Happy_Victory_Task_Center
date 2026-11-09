import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repository, rid } from '../fixtures';
import { bootstrap, detail } from '../../src/server/services/reads';

test('direct form link retains destination through Login; no credentials means honest setup state', async ({
  page,
}) => {
  await page.route('**/api/bootstrap*', (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
    }),
  );
  await page.goto('/tasks/new');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Ftasks%2Fnew/);
  await expect(page.getByRole('heading', { name: 'พร้อมส่งงานใหม่แล้วหรือยัง?' })).toBeVisible();
  await expect(page.getByText('กำลังเตรียมพื้นที่ทำงาน', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'เข้าสู่ระบบด้วยบัญชี Google' })).toHaveCount(0);
});

test('Agent opens mobile form directly and creates only after completed response', async ({
  page,
}, info) => {
  const h = repository(),
    data = {
      ...(await bootstrap(h.repo, h.agent, 'context')),
      csrfToken: 'a'.repeat(64),
      writesEnabled: true,
    };
  await page.route('**/api/bootstrap*', (route) => {
    expect(new URL(route.request().url()).searchParams.get('scope')).toBe('context');
    return route.fulfill({ json: data });
  });
  await page.route(
    '**/api/tasks/' + rid(11),
    (route) =>
      void detail(h.repo, h.agent, rid(11)).then((value) => route.fulfill({ json: value })),
  );
  let key = '',
    submissions = 0;
  await page.route('**/api/tasks', async (route) => {
    const headers = route.request().headers(),
      body = route.request().postDataJSON();
    expect(headers['x-csrf-token']).toBe(data.csrfToken);
    expect(body.agentId).toBeUndefined();
    expect(body.status).toBeUndefined();
    expect(body.category).toBe('ตัวแทนใหม่');
    key = headers['idempotency-key'];
    expect(key).toMatch(/^[a-f0-9-]{36}$/);
    submissions++;
    await route.fulfill({
      json: { state: 'completed', operationId: crypto.randomUUID(), id: rid(11) },
    });
  });
  await page.goto('/tasks/new');
  await expect(page.getByRole('heading', { name: 'รายละเอียดงานใหม่' })).toBeVisible();
  await page.locator('select[name="category"]').selectOption('ตัวแทนใหม่');
  await expect(page.getByLabel('Agent เจ้าของงาน')).toHaveCount(0);
  await page.getByLabel('ชื่องาน').fill('ติดตามเอกสารทดสอบ');
  await page.getByLabel('รายละเอียดงาน').fill('ข้อมูลสมมติสำหรับทดสอบฟอร์มบนมือถือ');
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.locator('body').evaluate((el) => el.clientWidth),
  );
  await mkdir(resolve('../artifacts/vercel'), { recursive: true });
  await page.screenshot({
    path: resolve('../artifacts/vercel/new-task-' + info.project.name + '.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'ส่งงานให้เลขาฯ' }).click();
  await expect(page).toHaveURL(new RegExp('/tasks/' + rid(11)));
  expect(submissions).toBe(1);
});

test('Secretary sees assignment, team pages and detail metadata in Bangkok time', async ({
  page,
}, info) => {
  const h = repository();
  await page.route(
    '**/api/bootstrap*',
    (route) =>
      void bootstrap(h.repo, h.secretary).then((data) =>
        route.fulfill({ json: { ...data, csrfToken: 'b'.repeat(64), writesEnabled: true } }),
      ),
  );
  await page.goto('/tasks/new');
  await expect(page.getByLabel('Agent เจ้าของงาน')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'สวัสดี, เลขาฯ ☀' })).toBeVisible();
  await mkdir(resolve('../artifacts/vercel'), { recursive: true });
  await page.screenshot({
    path: resolve('../artifacts/vercel/dashboard-' + info.project.name + '.png'),
    fullPage: true,
  });
  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'สมาชิกในพื้นที่ทำงาน' })).toBeVisible();
  await expect(page.getByText('Agent B', { exact: true })).toBeVisible();
  h.tables.tasks[0].fields['Created At'] = '2026-11-05T18:30:00Z';
  h.tables.updates.push({
    id: rid(70),
    fields: {
      Task: [rid(11)],
      'Updated By': [h.secretary.id],
      'Actor Name': h.secretary.name,
      'Update Type': 'Created',
      Message: 'บันทึกข้ามวันกรุงเทพฯ',
      'Visible to Agent': true,
      'Updated At': '2026-11-05T18:30:00Z',
    },
  });
  await page.route('**/api/tasks/' + rid(11), async (route) =>
    route.fulfill({ json: await detail(h.repo, h.secretary, rid(11)) }),
  );
  await page.goto('/tasks/' + rid(11));
  await expect(page.locator('.detail-grid > div').filter({ hasText: 'ประเภทงาน' })).toContainText(
    'งานทั่วไป',
  );
  await expect(page.locator('.detail-grid > div').filter({ hasText: 'วันที่ส่งงาน' })).toContainText(
    '6 พฤศจิกายน 2569',
  );
  await expect(page.locator('.timeline article small')).toHaveText(
    '6 พฤศจิกายน 2569 · 01:30 น.',
  );
});
