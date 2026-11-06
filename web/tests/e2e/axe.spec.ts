import { test, expect } from '@playwright/test';
import { scanAccessibility as scan } from '../support/accessibility';
import { repository, rid } from '../fixtures';
import { bootstrap, detail } from '../../src/server/services/reads';
import { statuses, priorities } from '../../src/domain/model';

test('core Manager pages have no automatically detected accessibility violations', async ({
  page,
}, info) => {
  const h = repository();
  test.setTimeout(90000);
  for (let n = 0; n < statuses.length; n++)
    h.tables.tasks.push({
      id: rid(50 + n),
      fields: {
        ...h.tables.tasks[0].fields,
        Status: statuses[n],
        Priority: priorities[n % priorities.length],
        'Task Title': 'งานสถานะ ' + n,
      },
    });
  h.tables.updates.push({
    id: rid(81),
    fields: {
      Task: [rid(11)],
      Message: 'ความคืบหน้าทดสอบ',
      'Actor Name': 'เลขาฯ ทดสอบ',
      'Visible to Agent': true,
    },
  });
  h.tables.followups.push({
    id: rid(82),
    fields: { Task: [rid(11)], 'Follow-up Date': '2026-11-08', 'Follow-up Status': 'Pending' },
  });
  await page.route('**/api/bootstrap*', async (route) => {
    const scope =
      new URL(route.request().url()).searchParams.get('scope') === 'context' ? 'context' : 'full';
    await route.fulfill({
      json: {
        ...(await bootstrap(h.repo, h.secretary, scope)),
        csrfToken: 'a'.repeat(64),
        writesEnabled: true,
      },
    });
  });
  await page.route('**/api/tasks/' + rid(11), async (route) =>
    route.fulfill({ json: await detail(h.repo, h.secretary, rid(11)) }),
  );
  for (const [path, name] of [
    ['/', 'dashboard'],
    ['/tasks', 'tasks'],
    ['/tasks/new', 'new'],
    ['/tasks/' + rid(11), 'detail'],
    ['/followups', 'followups'],
    ['/calendar', 'calendar'],
    ['/reports', 'reports'],
    ['/team', 'team'],
  ]) {
    await test.step(name, async () => {
      await page.goto(path);
      await expect(page.locator('.page-heading h1')).toBeVisible();
      await scan(page, info, name);
    });
  }
  if (info.project.name === 'mobile') {
    await page.getByRole('button', { name: 'เปิดเมนู', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await scan(page, info, 'mobile-menu');
  }
});

test('Login and unavailable-data screens have no automatically detected accessibility violations', async ({
  page,
}, info) => {
  await page.goto('/login');
  await scan(page, info, 'login');
  await page.route('**/api/bootstrap*', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'UNAVAILABLE', message: 'ระบบไม่พร้อมใช้งาน กรุณาลองอีกครั้ง' } },
    }),
  );
  await page.goto('/tasks');
  await expect(page.getByRole('alert').filter({ hasText: 'ระบบไม่พร้อมใช้งาน' })).toBeVisible();
  await scan(page, info, 'unavailable');
});
