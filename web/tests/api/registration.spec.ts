import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { scanAccessibility } from '../support/accessibility';
const origin = 'http://127.0.0.1:4181';
test('registration endpoint rejects cross-origin and forged approval before Google or Airtable calls', async ({
  request,
}) => {
  const data = { fullName: 'Test Agent', agentCode: '1234', phone: '0812345678' };
  expect(
    (
      await request.post('/api/auth/register', { headers: { Origin: 'https://other.test' }, data })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post('/api/auth/register', {
        headers: { Origin: origin },
        data: { ...data, Active: true, Role: 'Admin' },
      })
    ).status(),
  ).toBe(422);
  expect((await request.get('/api/auth/register')).status()).toBe(405);
});
test('registration form validates fields, preserves input on error and shows approval state on mobile and desktop', async ({
  page,
}, info) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/register');
    await page.getByLabel('ชื่อ–นามสกุล').fill('ตัวแทน ทดสอบ');
    await page.getByLabel('รหัสตัวแทน').fill('AG-1234');
    await page.getByLabel('เบอร์โทรศัพท์').fill('0812345678');
    let requests = 0;
    await page.route('**/api/auth/register', async (route) => {
      expect(route.request().postDataJSON()).toEqual({
        fullName: 'ตัวแทน ทดสอบ',
        agentCode: 'AG-1234',
        phone: '0812345678',
      });
      requests++;
      await route.fulfill(
        requests === 1
          ? { status: 503, json: { error: { message: 'กรุณาลองอีกครั้ง' } } }
          : { json: { url: origin + '/register?status=pending' } },
      );
    });
    await page.getByRole('button', { name: 'ยืนยัน Google และส่งคำขอสมัคร' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'กรุณาลองอีกครั้ง' })).toBeVisible();
    await expect(page.getByLabel('เบอร์โทรศัพท์')).toHaveValue('0812345678');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await scanAccessibility(page, info, 'registration-' + width);
    await mkdir(resolve('../artifacts/vercel/registration'), { recursive: true });
    await page.screenshot({
      path: resolve('../artifacts/vercel/registration/form-' + width + '.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'ยืนยัน Google และส่งคำขอสมัคร' }).click();
    await expect(page.getByRole('heading', { name: 'ส่งคำขอแล้ว รอผู้ดูแลอนุมัติ' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'กลับไปเข้าสู่ระบบ' })).toBeVisible();
    await page.unroute('**/api/auth/register');
  }
});
