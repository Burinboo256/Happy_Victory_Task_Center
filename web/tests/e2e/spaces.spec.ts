import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repository } from '../fixtures';
import { bootstrap } from '../../src/server/services/reads';

const id = '00000000-0000-4000-8000-000000000001';
const second = '00000000-0000-4000-8000-000000000002';
const csrf = 'a'.repeat(64);
test('Space Admin sees own membership tools and approves pending users; mobile layout stays within screen', async ({
  page,
}, info) => {
  let approved = false;
  await page.route('**/api/spaces*', async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (request.method() === 'POST') {
      const body = request.postDataJSON();
      expect(request.headers()['x-csrf-token']).toBe(csrf);
      expect(body.action).toBe('member');
      expect(body.id).toBe(id);
      expect(body.data.email).toBe('synthetic@example.test');
      expect(body.data.role).toBe('Agent');
      expect(body.data.active).toBe(true);
      approved = true;
      return route.fulfill({ json: { saved: true } });
    }
    if (url.searchParams.has('members'))
      return route.fulfill({
        json: {
          members: [
            {
              name: 'สมาชิกสมมติ',
              email: 'synthetic@example.test',
              role: 'Agent',
              active: approved,
              globallyActive: true,
            },
          ],
        },
      });
    return route.fulfill({
      json: {
        enabled: true,
        owner: false,
        csrfToken: csrf,
        items: [
          { id, name: 'ทีมตัวอย่าง A', active: true, approved: true, role: 'Admin' },
          { id: second, name: 'ทีมตัวอย่าง B', active: true, approved: true, role: 'Agent' },
        ],
      },
    });
  });
  await page.goto('/spaces');
  await expect(page.getByRole('heading', { name: 'Space ของคุณ' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'จัดการสมาชิก' })).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'สร้าง Space ใหม่' })).toHaveCount(0);
  await page.getByRole('button', { name: 'จัดการสมาชิก' }).click();
  await page.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ปิดสมาชิก', exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty(
    'scrollWidth',
    await page.locator('body').evaluate((el) => el.clientWidth),
  );
  await mkdir(resolve('../artifacts/workspaces'), { recursive: true });
  await page.screenshot({
    path: resolve('../artifacts/workspaces/spaces-' + info.project.name + '.png'),
    fullPage: true,
  });
});

test('explicit Space link selects its target and a stale request redirects to selection', async ({
  page,
}) => {
  const h = repository();
  const data = {
    ...(await bootstrap(h.repo, h.agent, 'context')),
    workspace: { id: second, name: 'ทีมตัวอย่าง B' },
    csrfToken: csrf,
    writesEnabled: true,
  };
  let selected = false,
    stale = false;
  await page.route('**/api/spaces*', async (route) => {
    if (route.request().method() === 'POST') {
      expect(route.request().postDataJSON()).toMatchObject({ action: 'select', id: second });
      selected = true;
      return route.fulfill({ json: { selected: second } });
    }
    return route.fulfill({
      json: {
        enabled: true,
        owner: false,
        csrfToken: csrf,
        items: [{ id: second, name: 'ทีมตัวอย่าง B', active: true, approved: true, role: 'Agent' }],
      },
    });
  });
  await page.route('**/api/bootstrap*', (route) => {
    expect(selected).toBe(true);
    if (stale) {
      expect(route.request().headers()['x-workspace-id']).toBe(second);
      return route.fulfill({
        status: 409,
        json: { error: { code: 'WORKSPACE_CHANGED', message: 'เลือก Space ใหม่' } },
      });
    }
    return route.fulfill({ json: data });
  });
  await page.goto('/spaces/open?' + new URLSearchParams({ space: second, next: '/tasks/new' }));
  await page.getByRole('button', { name: 'เข้า Space', exact: true }).click();
  await expect(page).toHaveURL(/\/tasks\/new$/);
  await expect(page.getByRole('link', { name: 'ทีมตัวอย่าง B · เปลี่ยน Space' })).toBeVisible();
  stale = true;
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด', exact: true }).click();
  await expect(page).toHaveURL(/\/spaces$/);
});

test('a task outside the selected Space offers a route back to Space selection', async ({ page }) => {
  const h = repository();
  await page.route('**/api/bootstrap*', (route) =>
    route.fulfill({
      json: {
        user: h.agent,
        workspace: { id, name: 'ทีมตัวอย่าง A' },
      },
    }),
  );
  await page.route('**/api/tasks/rec00000000000090', (route) => {
    expect(route.request().headers()['x-workspace-id']).toBe(id);
    return route.fulfill({
      status: 404,
      json: {
        error: {
          code: 'TASK_NOT_FOUND',
          message: 'ไม่พบงานใน Space นี้ กรุณาตรวจ Space ที่เลือก',
        },
      },
    });
  });
  await page.goto('/tasks/rec00000000000090');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText(
    'ไม่พบงานใน Space นี้ กรุณาตรวจ Space ที่เลือก',
  );
  await expect(page.getByRole('link', { name: 'เลือก Space', exact: true })).toHaveAttribute(
    'href',
    '/spaces',
  );
});
