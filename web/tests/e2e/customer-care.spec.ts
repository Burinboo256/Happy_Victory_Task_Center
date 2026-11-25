import { test, expect } from '@playwright/test';
import { bootstrap } from '../../src/server/services/reads';
import { repository } from '../fixtures';
import type { CarePolicy } from '../../src/domain/customer-care';
test('secretary opens care from Space, creates policy and hands next contact to Agent', async ({
  page,
}) => {
  const h = repository(),
    today = '2026-11-25',
    slug = 'rinlyn';
  const ctx = {
    ...(await bootstrap(h.repo, h.secretary)),
    workspace: { id: '00000000-0000-4000-8000-000000000001', slug, name: 'ตัวอย่าง' },
    customerCareEnabled: true,
    writesEnabled: true,
    csrfToken: 'a'.repeat(64),
  };
  const policies: CarePolicy[] = [];
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ json: ctx }));
  await page.route('**/api/customer-care*', async (r) => {
    expect(r.request().headers()['x-workspace-slug']).toBe(slug);
    if (r.request().url().endsWith('scope=alerts'))
      return r.fulfill({ json: { total: 0, late: 0 } });
    if (r.request().method() === 'GET') return r.fulfill({ json: { policies, today } });
    const v = r.request().postDataJSON();
    expect(r.request().headers()['x-csrf-token']).toBe(ctx.csrfToken);
    if (v.action === 'create')
      policies.push({
        id: v.operation,
        agentId: v.agentId,
        kind: v.kind,
        customer: v.customer,
        reference: v.reference,
        started: v.started,
        birthday: v.birthday,
        frequency: v.frequency,
        reviewDate: v.reviewDate,
        closed: false,
        ends: null,
        events: [
          {
            id: 'event',
            kind: 'welcome',
            due: today,
            note: '',
            recipient: 'team',
            completedAt: null,
            outcome: null,
            resultNote: null,
          },
        ],
      });
    else {
      expect(v.action).toBe('finish');
      expect(v.outcome).toBe('handoff');
      expect(v.next).toBe('2026-11-26');
      Object.assign(policies[0].events[0], {
        outcome: 'handoff',
        completedAt: '2026-11-25T02:00:00Z',
        resultNote: v.note,
      });
    }
    return r.fulfill({ json: { saved: true } });
  });
  await page.goto('/rinlyn');
  await page.getByRole('link', { name: /นัดดูแลลูกค้า 0/ }).click();
  await page.getByRole('button', { name: 'เพิ่มกรมธรรม์', exact: true }).click();
  await page.getByLabel('ชื่อลูกค้า').fill('ลูกค้าทดลอง A');
  await page.getByLabel('รหัสอ้างอิง').fill('DEMO-CARE-01');
  await page.getByLabel('ตัวแทนผู้ดูแล').selectOption(h.agent.id);
  await page.getByLabel('วันเริ่มกรมธรรม์').fill(today);
  await page.getByLabel('วันทบทวนครั้งแรก').fill('2027-01-15');
  await page.getByLabel('เดือนเกิด').selectOption('02');
  await page.getByLabel('วันที่เกิด').selectOption('29');
  await page.getByLabel('ประเภทการชำระเงิน').selectOption('quarterly');
  await page.getByLabel('วันชำระเบี้ยครั้งถัดไป').fill('2026-12-31');
  await page.getByRole('button', { name: 'บันทึกและสร้างแผนติดตาม' }).click();
  await expect(page.getByRole('heading', { name: /ลูกค้าทดลอง A/ })).toBeVisible();
  await expect(page.getByText(/วันเกิด 29 กุมภาพันธ์.*รอบชำระเบี้ย รายไตรมาส/)).toBeVisible();
  await page.getByRole('button', { name: 'คิวแจ้งเตือน' }).click();
  await page.getByRole('button', { name: /ลูกค้าทดลอง A · ส่งมอบ/ }).click();
  await page.getByLabel('ผลการติดตาม').selectOption('handoff');
  await page.getByLabel('วันนัดถัดไป').fill('2026-11-26');
  await page.getByLabel('สรุปการติดต่อ').fill('ลูกค้าสะดวกพรุ่งนี้');
  await page.getByRole('button', { name: 'บันทึกผล' }).click();
  await expect(page.getByText(/ส่งต่อตัวแทน.*ลูกค้าสะดวกพรุ่งนี้/)).toBeVisible();
});
