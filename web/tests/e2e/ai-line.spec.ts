import { test, expect } from '@playwright/test';
import { repository } from '../fixtures';
import { bootstrap } from '../../src/server/services/reads';
test('AI account linking is separate, confirms the LINE identity and can be disconnected on mobile', async ({
  page,
}) => {
  const h = repository();
  const data = {
    ...(await bootstrap(h.repo, h.agent, 'context')),
    csrfToken: 'test-csrf',
    writesEnabled: true,
  };
  let candidate: { id: string; name: string } | null = null,
    account = '';
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ json: data }));
  await page.route('**/api/line', (r) =>
    r.fulfill({
      json: {
        configured: false,
        sendingAllowed: false,
        enabled: false,
        oaId: '',
        candidate: null,
        accounts: [],
        deliveries: [],
      },
    }),
  );
  await page.route('**/api/ai/account', async (r) => {
    if (r.request().method() === 'POST') {
      expect(r.request().headers()['x-csrf-token']).toBe('test-csrf');
      const input = r.request().postDataJSON();
      if (input.action === 'start') {
        candidate = { id: 'U' + '1'.repeat(32), name: 'LINE ของฉัน' };
        return r.fulfill({ json: { code: 'RINAI ' + 'a'.repeat(24) } });
      }
      if (input.action === 'confirm') {
        expect(input.candidateId).toBe(candidate?.id);
        account = 'LINE ของฉัน';
        candidate = null;
      } else {
        expect(input.action).toBe('disconnect');
        account = '';
      }
      return r.fulfill({ json: { saved: true } });
    }
    return r.fulfill({ json: { configured: true, oaId: '@test-ai', candidate, account } });
  });
  await page.goto('/notifications');
  const panel = page.getByRole('region', { name: 'ถาม AI ผ่าน LINE' });
  await panel.getByRole('button', { name: 'สร้างรหัสเชื่อม AI' }).click();
  await expect(panel.getByText('RINAI ' + 'a'.repeat(24), { exact: true })).toBeVisible();
  await expect(panel.getByText('LINE ของฉัน', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'ยืนยันบัญชี LINE สำหรับ AI' }).click();
  await expect(panel.getByRole('status')).toContainText('LINE ของฉัน');
  await expect(panel.getByRole('button', { name: 'ยืนยันบัญชี LINE สำหรับ AI' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await panel.getByRole('button', { name: 'ยกเลิกการเชื่อม AI' }).click();
  await expect(panel.getByRole('status')).toHaveCount(0);
});
