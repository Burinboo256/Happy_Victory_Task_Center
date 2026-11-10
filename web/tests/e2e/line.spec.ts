import { test, expect } from '@playwright/test';
import { repository } from '../fixtures';
import { bootstrap } from '../../src/server/services/reads';
import { defaultTemplate } from '../../src/domain/onboarding';
import { scanAccessibility } from '../support/accessibility';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

test('Agent opens LINE settings, explicitly opts in and out, and cannot see staff controls', async ({
  page,
}, info) => {
  const h = repository();
  const data = {
    ...(await bootstrap(h.repo, h.agent, 'context')),
    csrfToken: 'test-csrf',
    writesEnabled: true,
  };
  let enabled = false;
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ json: data }));
  await page.route('**/api/line', async (r) => {
    if (r.request().method() === 'POST') {
      const input = r.request().postDataJSON();
      expect(input.action).toBe('preference');
      expect(input.userId).toBeUndefined();
      expect(r.request().headers()['x-csrf-token']).toBe('test-csrf');
      enabled = input.enabled;
      return r.fulfill({ json: { saved: true } });
    }
    return r.fulfill({
      json: {
        configured: true,
        sendingAllowed: true,
        enabled: true,
        oaId: '@test',
        candidate: null,
        accounts: [
          {
            user_id: h.agent.id,
            display_name: 'Agent A LINE',
            binding: 'fixture-binding',
            enabled,
            recipient_role: 'Agent',
          },
        ],
        deliveries: [],
      },
    });
  });
  await page.goto('/notifications');
  const panel = page.getByRole('region', { name: 'แจ้งงานเสร็จผ่าน LINE' });
  await expect(panel.getByText('ยังไม่เปิดรับแจ้งงานเสร็จ', { exact: false })).toBeVisible();
  await panel.getByRole('button', { name: 'เปิดรับแจ้งงานเสร็จ', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'ปิดรับแจ้งงานเสร็จ', exact: true })).toBeVisible();
  await expect(panel.getByText('เลือกเลขาที่รับข้อความ')).toHaveCount(0);
  await expect(panel.getByText('สถานะล่าสุด 50 รายการ')).toHaveCount(0);
  await scanAccessibility(page, info, 'line-agent-preference');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(resolve('../artifacts/vercel/line'), { recursive: true });
  await page.screenshot({
    path: resolve('../artifacts/vercel/line/agent-' + info.project.name + '.png'),
    fullPage: true,
  });
  await panel.getByRole('button', { name: 'ปิดรับแจ้งงานเสร็จ', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'เปิดรับแจ้งงานเสร็จ', exact: true })).toBeVisible();
});

test('LINE settings preserve destination through Login', async ({ page }) => {
  await page.route('**/api/bootstrap*', (r) =>
    r.fulfill({
      status: 401,
      json: { error: { code: 'UNAUTHENTICATED', message: 'Login required' } },
    }),
  );
  await page.goto('/notifications');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fnotifications/);
});

test('Secretary links LINE with one-time code, checks identity and confirms without Admin controls', async ({
  page,
}, info) => {
  const h = repository();
  const data = {
    ...(await bootstrap(h.repo, h.secretary)),
    csrfToken: 'test-csrf',
    writesEnabled: true,
  };
  let candidate: { id: string; name: string } | null = null;
  let linked = false;
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ json: data }));
  await page.route('**/api/line', async (r) => {
    if (r.request().method() === 'POST') {
      expect(r.request().headers()['x-csrf-token']).toBe('test-csrf');
      const input = r.request().postDataJSON();
      if (input.action === 'start') {
        candidate = { id: 'U' + '1'.repeat(32), name: 'เลขาทดสอบ' };
        return r.fulfill({ json: { code: 'HVR ' + 'a'.repeat(24) } });
      }
      expect(input.action).toBe('confirm');
      expect(input.candidateId).toBe(candidate?.id);
      candidate = null;
      linked = true;
      return r.fulfill({ json: { saved: true } });
    }
    return r.fulfill({
      json: {
        configured: true,
        sendingAllowed: true,
        enabled: false,
        oaId: '@test',
        candidate,
        accounts: linked
          ? [
              {
                user_id: h.secretary.id,
                display_name: 'เลขาทดสอบ',
                enabled: false,
                binding: 'test-binding',
              },
            ]
          : [],
        deliveries: [],
      },
    });
  });
  await page.goto('/team');
  const panel = page.getByRole('region', { name: 'แจ้งงานใหม่ผ่าน LINE' });
  await panel.getByRole('button', { name: 'สร้างรหัสเชื่อม LINE' }).click();
  await expect(panel.getByText('HVR ' + 'a'.repeat(24))).toBeVisible();
  await expect(panel.getByText('เลขาทดสอบ', { exact: true })).toBeVisible();
  await scanAccessibility(page, info, 'line-link');
  await panel.getByRole('button', { name: 'ยืนยันบัญชี LINE ของฉัน' }).click();
  await expect(panel.getByText(/รอผู้ดูแลเปิดรับแจ้งเตือน/)).toBeVisible();
  await expect(panel.getByRole('button', { name: 'เปิดระบบแจ้งเตือน LINE', exact: true })).toHaveCount(
    0,
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(resolve('../artifacts/vercel/line'), { recursive: true });
  await page.screenshot({
    path: resolve('../artifacts/vercel/line/link-' + info.project.name + '.png'),
    fullPage: true,
  });
});

test('Admin can approve a linked Secretary and enable notifications; delivery acceptance wording stays accurate', async ({
  page,
}, info) => {
  const h = repository(),
    admin = { ...h.secretary, role: 'Admin' as const };
  const data = { ...(await bootstrap(h.repo, admin)), csrfToken: 'test-csrf', writesEnabled: true };
  let enabled = false,
    approved = false;
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ json: data }));
  await page.route('**/api/onboarding-template', (r) =>
    r.fulfill({ json: { template: defaultTemplate, version: 0 } }),
  );
  await page.route('**/api/line', async (r) => {
    if (r.request().method() === 'POST') {
      const input = r.request().postDataJSON();
      if (input.action === 'recipient') approved = input.enabled;
      if (input.action === 'switch') enabled = input.enabled;
      return r.fulfill({ json: { saved: true } });
    }
    return r.fulfill({
      json: {
        configured: true,
        sendingAllowed: true,
        enabled,
        oaId: '@test',
        candidate: null,
        accounts: [
          {
            user_id: h.secretary.id,
            display_name: 'เลขาทดสอบ',
            enabled: approved,
            binding: 'test-binding',
          },
        ],
        deliveries: [
          {
            id: 'test',
            task_id: 'rec00000000000011',
            user_id: h.secretary.id,
            state: 'accepted',
            attempts: 1,
            error_code: null,
            created_at: '2026-11-09T04:00:00Z',
          },
        ],
      },
    });
  });
  await page.goto('/team');
  const panel = page.getByRole('region', { name: 'แจ้งเตือนงานผ่าน LINE' });
  await expect(
    panel.getByRole('button', { name: 'เปิดระบบแจ้งเตือน LINE', exact: true }),
  ).toBeDisabled();
  await panel.getByRole('checkbox').click();
  await expect(panel.getByRole('checkbox')).toBeChecked();
  await panel.getByRole('button', { name: 'เปิดระบบแจ้งเตือน LINE', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'ปิดระบบแจ้งเตือน LINE' })).toBeVisible();
  await expect(panel.getByText(/ไม่ได้ยืนยันว่าผู้รับอ่านแล้ว/)).toBeVisible();
  await scanAccessibility(page, info, 'line-admin');
});
