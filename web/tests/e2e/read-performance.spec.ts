import { test, expect } from '@playwright/test';
import { repository, rid } from '../fixtures';
import { bootstrap, detail } from '../../src/server/services/reads';

test('Login renders Thai and Latin using local fonts without requests to Google Fonts', async ({
  page,
}) => {
  const externalFonts: string[] = [];
  const localFonts: string[] = [];
  const assetCacheHeaders: string[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/_next/static/'))
      assetCacheHeaders.push(response.headers()['cache-control'] || '');
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname))
      externalFonts.push(request.url());
    if (request.resourceType() === 'font' && url.hostname === '127.0.0.1')
      localFonts.push(url.pathname);
  });
  // External font services can be unavailable without delaying this page.
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort());
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'ยินดีต้อนรับกลับมา' })).toBeVisible();
  const loaded = await page.evaluate(async () => {
    await document.fonts.ready;
    const fonts = [...document.fonts].filter((font) => font.status === 'loaded');
    return fonts.map((font) => font.family);
  });
  expect(loaded.some((family) => family.includes('dmSans'))).toBe(true);
  expect(loaded.some((family) => family.includes('notoSansThai'))).toBe(true);
  expect(externalFonts).toEqual([]);
  expect(localFonts.length).toBeGreaterThanOrEqual(2);
  expect(assetCacheHeaders.length).toBeGreaterThanOrEqual(2);
  for (const header of assetCacheHeaders) {
    expect(header).toContain('public');
    expect(header).toContain('immutable');
    expect(header).not.toContain('no-store');
  }
  for (const path of ['/login', '/test-space/tasks', '/api/bootstrap']) {
    const response = await page.request.get(path);
    expect(response.headers()['cache-control']).toContain('private');
    expect(response.headers()['cache-control']).toContain('no-store');
  }
});

test('scoped detail uses one bootstrap and reloads after revoked access without showing stale task', async ({
  page,
}) => {
  const h = repository();
  const workspace = {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Test Space',
    slug: 'test-space',
  };
  let reads = 0;
  let separateDetails = 0;
  let revoked = false;
  await page.route('**/api/tasks/**', async (route) => {
    separateDetails++;
    await route.fulfill({ status: 500, json: { error: { message: 'Unexpected extra request' } } });
  });
  await page.route('**/api/bootstrap*', async (route) => {
    reads++;
    const request = route.request();
    expect(request.headers()['x-workspace-slug']).toBe(workspace.slug);
    expect(new URL(request.url()).searchParams.get('taskId')).toBe(rid(11));
    if (revoked) {
      await route.fulfill({
        status: 403,
        json: { error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์เข้าถึง' } },
      });
      return;
    }
    await route.fulfill({
      json: {
        ...(await bootstrap(h.repo, h.secretary, 'context')),
        workspace,
        csrfToken: 'a'.repeat(64),
        writesEnabled: true,
        detail: await detail(h.repo, h.secretary, rid(11)),
      },
    });
  });
  await page.goto('/test-space/tasks/' + rid(11));
  await expect(page.getByRole('heading', { name: 'เอกสารทดสอบ A', exact: true })).toBeVisible();
  expect(reads).toBe(1);
  expect(separateDetails).toBe(0);
  revoked = true;
  await page.reload();
  await expect(page.getByText('ไม่มีสิทธิ์เข้าถึง', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'เอกสารทดสอบ A', exact: true })).toHaveCount(0);
  expect(reads).toBe(2);
  expect(separateDetails).toBe(0);
});
