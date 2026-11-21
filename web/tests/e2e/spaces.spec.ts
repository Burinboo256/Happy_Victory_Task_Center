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
          { id, slug: 'team-a', name: 'ทีมตัวอย่าง A', active: true, approved: true, role: 'Admin' },
          {
            id: second,
            slug: 'x'.repeat(48),
            name: 'ทีมตัวอย่าง B',
            active: true,
            approved: true,
            role: 'Agent',
          },
        ],
      },
    });
  });
  await page.goto('/spaces');
  await expect(page.getByRole('heading', { name: 'Space ของคุณ' })).toBeVisible();
  await expect(page.getByRole('link', { name: '/team-a', exact: true })).toHaveAttribute(
    'href',
    '/team-a',
  );
  await expect(page.getByRole('button', { name: 'คัดลอกลิงก์', exact: true })).toHaveCount(2);
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

test('Space stays in dashboard, list, inbox, form and detail URLs with scoped requests', async ({
  page,
}, info) => {
  const h = repository();
  const data = {
    ...(await bootstrap(h.repo, h.secretary)),
    workspace: { id: second, slug: 'rinlyn', name: 'ทีมตัวอย่าง B' },
    csrfToken: csrf,
    writesEnabled: true,
  };
  await page.route('**/api/bootstrap*', (route) => {
    expect(route.request().headers()['x-workspace-slug']).toBe('rinlyn');
    return route.fulfill({ json: data });
  });
  await page.goto('/rinlyn');
  await expect(page.getByRole('link', { name: 'ทีมตัวอย่าง B · เปลี่ยน Space' })).toBeVisible();
  await expect(page).toHaveURL(/\/rinlyn$/);
  await expect(page.locator('a[href="/rinlyn/tasks"]')).toHaveCount(1);
  await expect(page.locator('a[href="/rinlyn/inbox"]')).toHaveCount(1);
  await page.goto('/rinlyn/tasks');
  await expect(page.locator('a[href^="/rinlyn/tasks/rec"]').first()).toBeVisible();
  await page.goto('/rinlyn/inbox');
  await expect(page.getByRole('link', { name: 'ทีมตัวอย่าง B · เปลี่ยน Space' })).toBeVisible();
  await expect(page).toHaveURL(/\/rinlyn\/inbox$/);
  await page.goto('/rinlyn/tasks/new');
  await expect(page.getByRole('heading', { name: 'รายละเอียดงานใหม่' })).toBeVisible();
  await expect(page).toHaveURL(/\/rinlyn\/tasks\/new$/);
  await mkdir(resolve('../artifacts/workspaces'), { recursive: true });
  await page.screenshot({
    path: resolve('../artifacts/workspaces/scoped-url-' + info.project.name + '.png'),
    fullPage: true,
  });
});

test('scoped deep link survives Login; old URLs canonicalize to the selected Space', async ({
  page,
}) => {
  await page.route('**/api/bootstrap*', (route) =>
    route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } }),
  );
  await page.goto('/rinlyn/tasks/new');
  await expect(page).toHaveURL(/\/login[?]returnTo=%2Frinlyn%2Ftasks%2Fnew$/);
  await page.unroute('**/api/bootstrap*');
  const h = repository();
  const data = {
    ...(await bootstrap(h.repo, h.agent)),
    workspace: { id, slug: 'rinlyn', name: 'RINLYN' },
    csrfToken: csrf,
    writesEnabled: true,
  };
  await page.route('**/api/bootstrap*', (route) => route.fulfill({ json: data }));
  await page.goto('/tasks?status=open');
  await expect(page).toHaveURL(/\/rinlyn\/tasks[?]status=open$/);
});

test('unauthorized URL Space never falls back to another team or makes task writes', async ({
  page,
}) => {
  let writes = 0;
  await page.route('**/api/tasks**', (route) => {
    writes++;
    return route.fulfill({ status: 500, json: {} });
  });
  await page.route('**/api/bootstrap*', (route) => {
    expect(route.request().headers()['x-workspace-slug']).toBe('blocked');
    return route.fulfill({
      status: 403,
      json: { error: { code: 'WORKSPACE_REQUIRED', message: 'ไม่มีสิทธิ์ Space นี้' } },
    });
  });
  await page.route('**/api/spaces', (route) =>
    route.fulfill({ json: { enabled: true, csrfToken: csrf, items: [] } }),
  );
  await page.goto('/blocked/tasks/new');
  await expect(page).toHaveURL(/\/spaces$/);
  expect(writes).toBe(0);
});

test('two tabs preserve their URL Space for reads, creates and detail navigation', async ({
  context,
  page,
}) => {
  const h = repository();
  const other = await context.newPage();
  const base = await bootstrap(h.repo, h.agent);
  const ids = { 'team-a': id, 'team-b': second };
  const tokens = { 'team-a': 'a'.repeat(64), 'team-b': 'b'.repeat(64) };
  const sent: string[] = [];
  await context.route('**/api/bootstrap*', (route) => {
    const slug = route.request().headers()['x-workspace-slug'] as keyof typeof ids;
    expect(ids[slug]).toBeTruthy();
    return route.fulfill({
      json: {
        ...base,
        workspace: { id: ids[slug], name: slug, slug },
        csrfToken: tokens[slug],
        writesEnabled: true,
      },
    });
  });
  await context.route('**/api/tasks', (route) => {
    const headers = route.request().headers();
    const slug = headers['x-workspace-slug'] as keyof typeof ids;
    expect(headers['x-workspace-id']).toBe(ids[slug]);
    expect(headers['x-csrf-token']).toBe(tokens[slug]);
    sent.push(slug);
    return route.fulfill({ json: { state: 'completed', id: 'rec00000000000011' } });
  });
  await context.route('**/api/tasks/rec00000000000011', (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: 'TASK_NOT_FOUND', message: 'ข้อมูลสมมติ' } },
    }),
  );
  await page.goto('/team-a/tasks/new');
  await other.goto('/team-b/tasks/new');
  // Simulate a different Space selected by another tab in the same browser session.
  await context.addCookies([{ name: 'hvr-space', value: second, domain: '127.0.0.1', path: '/' }]);
  for (const [tab, slug] of [
    [page, 'team-a'],
    [other, 'team-b'],
  ] as const) {
    await tab.getByLabel('ชื่องาน').fill('งานทดสอบ ' + slug);
    await tab.getByLabel('รายละเอียดงาน').fill('ข้อมูลสมมติสำหรับทดสอบแยก Space');
    await tab.locator('select[name="category"]').selectOption('ตัวแทนใหม่');
    await tab.getByLabel('ชื่อตัวแทน', { exact: true }).fill('บุคคลสมมติ');
    await tab.getByRole('button', { name: 'ส่งงานให้เลขาฯ' }).click();
    await expect(tab).toHaveURL(new RegExp('/' + slug + '/tasks/rec00000000000011$'));
  }
  expect(sent).toEqual(['team-a', 'team-b']);
  await other.close();
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

test('a task outside the selected Space offers a route back to Space selection', async ({
  page,
}) => {
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
