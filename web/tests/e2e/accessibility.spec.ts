import { test, expect } from '@playwright/test';
import { repository } from '../fixtures';
import { bootstrap } from '../../src/server/services/reads';

test('loading, skip link and mobile menu support keyboard focus without offscreen navigation', async ({
  page,
}, info) => {
  const h = repository(),
    data = {
      ...(await bootstrap(h.repo, h.agent)),
      csrfToken: 'a'.repeat(64),
      writesEnabled: true,
    };
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/bootstrap*', async (route) => {
    await gate;
    await route.fulfill({ json: data });
  });
  try {
    await page.goto('/tasks');
    await expect(page.getByRole('status').filter({ hasText: 'กำลังเตรียมพื้นที่ทำงาน' })).toBeVisible();
  } finally {
    release();
  }
  await expect(page.getByRole('heading', { name: 'รายการงานของฉัน' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'ข้ามไปเนื้อหา' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#page-content')).toBeFocused();
  if (info.project.name === 'desktop')
    await expect(
      page.getByRole('button', { name: 'ปิดเมนู', exact: true, includeHidden: true }),
    ).toBeHidden();
  if (info.project.name === 'mobile') {
    const opener = page.getByRole('button', { name: 'เปิดเมนู', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'เมนูพื้นที่ทำงาน' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('link', { name: 'ข้ามไปเนื้อหา', includeHidden: true })).toBeHidden();
    const close = dialog.getByRole('button', { name: 'ปิดเมนู', exact: true });
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog.getByRole('button', { name: 'ออกจากระบบ' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' })).toBeFocused();
  }
});

test('failed refresh clears stale task content and lets the user retry using the keyboard', async ({
  page,
}) => {
  const h = repository(),
    data = {
      ...(await bootstrap(h.repo, h.agent)),
      csrfToken: 'b'.repeat(64),
      writesEnabled: true,
    };
  let failed = false;
  await page.route('**/api/bootstrap*', (route) =>
    route.fulfill(
      failed
        ? {
            status: 503,
            json: { error: { code: 'AIRTABLE_ERROR', message: 'ข้อมูลไม่พร้อมใช้งานชั่วคราว' } },
          }
        : { json: data },
    ),
  );
  await page.goto('/tasks');
  await expect(page.getByRole('link', { name: /เอกสารทดสอบ A/ })).toBeVisible();
  failed = true;
  await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'ข้อมูลไม่พร้อมใช้งาน' })).toBeVisible();
  await expect(page.getByRole('link', { name: /เอกสารทดสอบ A/ })).toHaveCount(0);
  const retry = page.getByRole('button', { name: 'ลองอีกครั้ง' });
  await retry.focus();
  failed = false;
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: /เอกสารทดสอบ A/ })).toBeVisible();
});

test('malformed and unavailable responses show Thai errors, then recover to an empty read-only workspace', async ({
  page,
}) => {
  const h = repository(),
    data = {
      ...(await bootstrap(h.repo, h.agent)),
      tasks: [],
      csrfToken: 'c'.repeat(64),
      writesEnabled: false,
    };
  let failure: 'json' | 'network' | null = 'json';
  await page.route('**/api/bootstrap*', (route) =>
    failure === 'json'
      ? route.fulfill({
          status: 502,
          contentType: 'text/html',
          body: '<h1>PRIVATE_GATEWAY_DETAIL</h1>',
        })
      : failure === 'network'
        ? route.abort('failed')
        : route.fulfill({ json: data }),
  );
  await page.goto('/tasks');
  await expect(page.getByRole('alert').filter({ hasText: 'ระบบตอบกลับไม่สมบูรณ์' })).toBeVisible();
  await expect(page.getByText('PRIVATE_GATEWAY_DETAIL')).toHaveCount(0);
  failure = 'network';
  await page.getByRole('button', { name: 'ลองอีกครั้ง' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'กรุณาตรวจสอบอินเทอร์เน็ต' })).toBeVisible();
  failure = null;
  await page.getByRole('button', { name: 'ลองอีกครั้ง' }).click();
  await expect(page.getByText('ไม่พบงานในรายการนี้', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: '+ ส่งงานใหม่', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ส่งงานให้เลขาฯ' })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'ขณะนี้เปิดให้ดูข้อมูล' })).toBeVisible();
});

test('an older refresh cannot restore task content after a newer refresh failed', async ({
  page,
}) => {
  const h = repository(),
    data = {
      ...(await bootstrap(h.repo, h.agent)),
      csrfToken: 'd'.repeat(64),
      writesEnabled: true,
    };
  let calls = 0,
    release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/bootstrap*', async (route) => {
    const call = ++calls;
    if (call === 2) await gate;
    await route.fulfill(
      call === 3
        ? {
            status: 503,
            json: { error: { code: 'AIRTABLE_ERROR', message: 'โหลดข้อมูลล่าสุดไม่สำเร็จ' } },
          }
        : { json: data },
    );
  });
  try {
    await page.goto('/tasks');
    await expect(page.getByRole('link', { name: /เอกสารทดสอบ A/ })).toBeVisible();
    await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }).click();
    await expect.poll(() => calls).toBe(2);
    await page.getByRole('button', { name: 'โหลดข้อมูลล่าสุด' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'โหลดข้อมูลล่าสุดไม่สำเร็จ' })).toBeVisible();
    const oldResponse = page.waitForResponse(
      (response) => response.url().endsWith('/api/bootstrap') && response.status() === 200,
    );
    release();
    await (await oldResponse).finished();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(page.getByRole('link', { name: /เอกสารทดสอบ A/ })).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: 'โหลดข้อมูลล่าสุดไม่สำเร็จ' })).toBeVisible();
  } finally {
    release();
  }
});
