import { test, expect } from '@playwright/test';
import { repository, rid } from '../fixtures';
import { bootstrap } from '../../src/server/services/reads';
import { statuses } from '../../src/domain/model';

test('new and pending groups have disjoint counts, reflect other filters and retain overdue work across both groups', async ({
  page,
}) => {
  const h = repository();
  const fields = h.tables.tasks[0].fields;
  h.tables.tasks = statuses.map((status, i) => ({
    id: rid(70 + i),
    fields: {
      ...fields,
      'Task Title': 'กลุ่มทดสอบ ' + status,
      Status: status,
      'Due Date': '2026-01-01',
    },
  }));
  await page.route('**/api/bootstrap*', async (route) =>
    route.fulfill({
      json: {
        ...(await bootstrap(h.repo, h.secretary)),
        today: '2026-11-09',
        csrfToken: 'f'.repeat(64),
        writesEnabled: true,
      },
    }),
  );
  await page.goto('/tasks');
  const tabs = page.locator('.tabbar');
  await expect(tabs.getByRole('button', { name: 'ทั้งหมด 6', exact: true })).toBeVisible();
  await tabs.getByRole('button', { name: 'งานเข้าใหม่ 1', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(1);
  await expect(page.locator('.task-row')).toContainText('กลุ่มทดสอบ New');
  await expect(page.locator('.task-row .late')).toHaveCount(1);
  await tabs.getByRole('button', { name: 'คงค้าง 3', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(3);
  await expect(page.locator('.task-row').filter({ hasText: 'กลุ่มทดสอบ New' })).toHaveCount(0);
  await page.getByLabel('ค้นหางาน').fill('กลุ่มทดสอบ Waiting');
  await expect(tabs.getByRole('button', { name: 'คงค้าง 1', exact: true })).toBeVisible();
  await expect(tabs.getByRole('button', { name: 'งานเข้าใหม่ 0', exact: true })).toBeVisible();
  await page.getByLabel('ค้นหางาน').fill('');
  await tabs.getByRole('button', { name: 'ยกเลิก 1', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(1);
  await expect(page.locator('.task-row .late')).toHaveCount(0);
  await page.goto('/tasks?status=late');
  await expect(page.locator('.task-row')).toHaveCount(4);
  await expect(page.locator('.task-row').filter({ hasText: 'กลุ่มทดสอบ New' })).toHaveCount(1);
  h.tables.tasks[0].fields.Status = 'In Progress';
  await page.goto('/tasks?status=New');
  await expect(tabs.getByRole('button', { name: 'งานเข้าใหม่ 0', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.task-row')).toHaveCount(0);
  await tabs.getByRole('button', { name: 'คงค้าง 4', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(4);
  await page.goto('/');
  await expect(page.locator('.stat').filter({ hasText: 'งานเข้าใหม่' }).locator('strong')).toHaveText(
    '00',
  );
  await expect(page.locator('.stat').filter({ hasText: 'งานคงค้าง' }).locator('strong')).toHaveText(
    '04',
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('list pagination, filters and card view work without losing the selected scope', async ({
  page,
}) => {
  const h = repository();
  for (let n = 0; n < 7; n++)
    h.tables.tasks.push({
      id: rid(40 + n),
      fields: { ...h.tables.tasks[0].fields, 'Task Title': 'งานรายการ ' + n },
    });
  const data = {
    ...(await bootstrap(h.repo, h.secretary)),
    csrfToken: 'c'.repeat(64),
    writesEnabled: true,
  };
  await page.route('**/api/bootstrap*', (route) => route.fulfill({ json: data }));
  await page.goto('/tasks');
  await expect(page.locator('.task-row')).toHaveCount(7);
  await page.getByRole('button', { name: 'หน้าถัดไป' }).click();
  await expect(page.locator('.task-row')).toHaveCount(2);
  await page.getByLabel('ค้นหางาน').fill('งานรายการ 6');
  await expect(page.locator('.task-row')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'หน้าก่อนหน้า' })).toBeDisabled();
  await page.getByRole('button', { name: 'แสดงการ์ด' }).click();
  await expect(page.getByRole('button', { name: 'แสดงการ์ด' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.task-list')).toHaveClass(/cards/);
});

test('review response retains the form and same request key without claiming success', async ({
  page,
}) => {
  const h = repository(),
    data = {
      ...(await bootstrap(h.repo, h.agent)),
      csrfToken: 'd'.repeat(64),
      writesEnabled: true,
    };
  await page.route('**/api/bootstrap*', (route) => route.fulfill({ json: data }));
  const keys: string[] = [];
  await page.route('**/api/tasks', (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    return route.fulfill({
      status: 202,
      json: { state: 'review', operationId: '00000000-0000-4000-8000-000000000000' },
    });
  });
  await page.goto('/tasks/new');
  await page.getByLabel('ชื่องาน').fill('ทดสอบการรอตรวจสอบ');
  await page.getByLabel('รายละเอียดงาน').fill('ข้อมูลสมมติ');
  await page.getByRole('button', { name: 'ส่งงานให้เลขาฯ' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'รอผู้ดูแลตรวจสอบ' })).toBeVisible();
  await expect(page.getByLabel('ชื่องาน')).toHaveValue('ทดสอบการรอตรวจสอบ');
  await page.getByRole('button', { name: 'ส่งงานให้เลขาฯ' }).click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  // Editing a draft must not erase the retry key of the earlier pending intent.
  await page.getByLabel('ชื่องาน').fill('อีกคำขอหนึ่ง');
  await page.getByRole('button', { name: 'ส่งงานให้เลขาฯ' }).click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys[2]).not.toBe(keys[0]);
  await page.getByLabel('ชื่องาน').fill('ทดสอบการรอตรวจสอบ');
  await page.getByRole('button', { name: 'ส่งงานให้เลขาฯ' }).click();
  await expect.poll(() => keys.length).toBe(4);
  expect(keys[3]).toBe(keys[0]);
  await expect(page).toHaveURL(/\/tasks\/new$/);
  const storage = await page.evaluate(() => JSON.stringify(sessionStorage));
  expect(storage).not.toContain('ทดสอบการรอตรวจสอบ');
});

test('calendar, report distribution and mobile navigation remain usable', async ({
  page,
}, info) => {
  const h = repository(),
    data = {
      ...(await bootstrap(h.repo, h.secretary)),
      csrfToken: 'e'.repeat(64),
      writesEnabled: true,
    };
  await page.route('**/api/bootstrap*', (route) => route.fulfill({ json: data }));
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'สัดส่วนสถานะงาน' })).toBeVisible();
  await page.goto('/calendar');
  await expect(page.getByRole('button', { name: 'เดือนถัดไป' })).toBeVisible();
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'เปิดเมนู' }).click();
    await expect(page.getByRole('button', { name: 'ปิดเมนู', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ปิดเมนู', exact: true }).click();
    await expect(page.locator('.sidebar')).not.toHaveClass(/open/);
  }
});
