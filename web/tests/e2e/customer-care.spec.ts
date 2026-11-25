import { test, expect } from '@playwright/test';
import { bootstrap, detail } from '../../src/server/services/reads';
import { mutate } from '../../src/server/services/mutations';
import { repository } from '../fixtures';
import type { CarePolicy } from '../../src/domain/customer-care';
test('a signed-out policy registration link keeps the exact destination', async ({ page }) => {
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ status: 401, json: {} }));
  await page.goto('/rinlyn/customer-care/register');
  await expect(page).toHaveURL(/\/login\?returnTo=%2Frinlyn%2Fcustomer-care%2Fregister$/);
});

test('agent sees the personal queue and registry without a team filter', async ({ page }) => {
  const h = repository();
  const ctx = {
    ...(await bootstrap(h.repo, h.agent, 'context')),
    workspace: { id: '00000000-0000-4000-8000-000000000001', slug: 'rinlyn', name: 'ตัวอย่าง' },
    customerCareEnabled: true,
  };
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ json: ctx }));
  await page.route('**/api/customer-care*', (r) =>
    r.fulfill({
      json: r.request().url().endsWith('scope=alerts')
        ? { total: 0, late: 0 }
        : { today: ctx.today, policies: [] },
    }),
  );
  await page.goto('/rinlyn/customer-care');
  await expect(page).toHaveURL(/\/rinlyn\/customer-care\/queue$/);
  const owner = page.getByRole('combobox', { name: 'ตัวแทนผู้ดูแล', exact: true });
  await expect(page.getByText('ยังไม่มีนัดที่ถึงช่วงแจ้งเตือน')).toBeVisible();
  await expect(owner).toHaveCount(0);
  await page.getByRole('link', { name: 'ทะเบียนกรมธรรม์' }).click();
  await expect(page).toHaveURL(/\/rinlyn\/customer-care\/policies$/);
  await expect(page.getByText('ไม่พบกรมธรรม์')).toBeVisible();
  await expect(owner).toHaveCount(0);
  await page.getByRole('link', { name: 'เพิ่มกรมธรรม์' }).click();
  await expect(page).toHaveURL(/\/rinlyn\/customer-care\/register$/);
  await expect(page.getByLabel('ชื่อลูกค้า')).toBeVisible();
  await page.goBack();
  await expect(page.getByRole('searchbox')).toBeVisible();
  await page.goForward();
  await page.reload();
  await expect(page.getByLabel('ชื่อลูกค้า')).toBeVisible();
  await page.goto('/rinlyn/customer-care/policies');
  await expect(page.getByRole('searchbox')).toBeVisible();
});

test('reminders group active appointments by type and recorded birth month', async ({ page }) => {
  const h = repository();
  const today = '2026-11-25';
  const policy: CarePolicy = {
    id: 'sample',
    agentId: h.agent.id,
    customer: 'ลูกค้าตัวอย่าง',
    reference: 'DEMO-GROUP',
    kind: 'life',
    started: '2025-01-01',
    birthday: '10-31',
    reviewDate: null,
    premiumAmount: null,
    frequency: null,
    closed: false,
    ends: null,
    events: [],
  };
  const event: CarePolicy['events'][number] = {
    id: 'birthday',
    kind: 'birthday',
    due: today,
    recipient: 'team',
    note: '',
    completedAt: null,
    outcome: null,
    resultNote: null,
  };
  policy.events = [
    event,
    { ...event, id: 'maturity', kind: 'maturity', due: '2026-11-21' },
    { ...event, id: 'future', kind: 'premium', due: '2027-02-25' },
    { ...event, id: 'done', kind: 'claim', outcome: 'done' },
  ];
  const ctx = {
    ...(await bootstrap(h.repo, h.secretary)),
    workspace: { id: '00000000-0000-4000-8000-000000000001', slug: 'rinlyn', name: 'ตัวอย่าง' },
    customerCareEnabled: true,
    writesEnabled: true,
    csrfToken: 'care-test',
  };
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ json: ctx }));
  await page.route('**/api/customer-care*', (r) =>
    r.fulfill({
      json: r.request().url().endsWith('scope=alerts')
        ? { total: 2, late: 1 }
        : {
            policies: [
              policy,
              { ...policy, id: 'closed', closed: true },
              {
                ...policy,
                id: 'second',
                agentId: h.other.id,
                reference: 'DEMO-B',
                events: [{ ...event, id: 'second-birthday' }],
              },
            ],
            today,
          },
    }),
  );
  await page.goto('/rinlyn/customer-care');
  let submissions = 0;
  await page.route('**/api/tasks/rec*', async (r) =>
    r.fulfill({
      json: await detail(
        h.repo,
        h.secretary,
        new URL(r.request().url()).pathname.split('/').at(-1) || '',
      ),
    }),
  );
  await page.route('**/api/tasks', async (r) => {
    expect(r.request().headers()['x-workspace-slug']).toBe('rinlyn');
    expect(r.request().headers()['x-csrf-token']).toBe(ctx.csrfToken);
    expect(r.request().headers()['idempotency-key']).toBeTruthy();
    submissions++;
    const result = await mutate(h.repo, h.secretary, 'create', r.request().postDataJSON(), {
      key: 'care-task-ui',
      run: async (_name, work) => work(),
    });
    await r.fulfill({ json: { ...result, state: 'completed' } });
  });
  const rows = page.getByRole('button', { name: /ลูกค้าตัวอย่าง ·/ });
  const owner = page.getByRole('combobox', { name: 'ตัวแทนผู้ดูแล', exact: true });
  await expect(owner).toHaveValue('');
  await expect(rows).toHaveCount(3);
  await owner.selectOption(h.other.id);
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('DEMO-B');
  await page.getByRole('button', { name: 'แยกตามกลุ่ม' }).click();
  await expect(page.locator('summary')).toHaveText(['วันเกิดลูกค้า 1 นัด']);
  await page.getByRole('link', { name: 'ทะเบียนกรมธรรม์' }).click();
  await expect(owner).toHaveValue(h.other.id);
  await expect(rows).toHaveCount(1);
  await page.getByRole('searchbox').fill('DEMO-GROUP');
  await expect(page.getByText('ไม่พบกรมธรรม์', { exact: true })).toBeVisible();
  await owner.selectOption('');
  await expect(rows).toHaveCount(2);
  await page.getByRole('searchbox').fill('');
  await expect(rows).toHaveCount(3);
  await owner.selectOption(h.agent.id);
  await page.getByRole('link', { name: 'คิวแจ้งเตือน' }).click();
  await expect(owner).toHaveValue(h.agent.id);
  await page.getByRole('button', { name: 'ตามวันนัด' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('ติดตามครบสัญญา');
  await page.getByRole('button', { name: /เปิดงานให้เลขา · วันเกิดลูกค้า/ }).click();
  await expect(page.getByLabel('ชื่องาน')).toHaveValue('วันเกิดลูกค้า · ลูกค้าตัวอย่าง');
  await page.getByRole('button', { name: 'กลับคิวติดตาม' }).click();
  expect(submissions).toBe(0);
  await page.getByRole('button', { name: 'แยกตามกลุ่ม' }).click();
  await page.getByText('วันเกิดลูกค้า 1 นัด', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ตุลาคม' })).toBeVisible();
  await expect(page.locator('summary', { hasText: 'ติดตามหลังแจ้งเคลม' })).toHaveCount(0);
  const premium = page.locator('summary', { hasText: 'ยืนยันการชำระเบี้ย' });
  await expect(premium).toHaveCount(0);
  await page.getByRole('checkbox', { name: /รวมนัดล่วงหน้า/ }).check();
  await expect(premium).toContainText('1 นัด');
  await page.getByRole('button', { name: 'ตามวันนัด' }).click();
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: 'แยกตามกลุ่ม' }).click();
  await page.getByText('ติดตามครบสัญญา 1 นัด', { exact: true }).click();
  await page.getByRole('button', { name: /ลูกค้าตัวอย่าง · ติดตามครบสัญญา/ }).click();
  await expect(page.getByLabel('ผลการติดตาม')).toBeVisible();
  await page.getByRole('link', { name: 'คิวแจ้งเตือน' }).click();
  await page.getByText('ติดตามครบสัญญา 1 นัด', { exact: true }).click();
  await page.getByRole('button', { name: /เปิดงานให้เลขา · ติดตามครบสัญญา/ }).click();
  await expect(page.getByLabel('ชื่อลูกค้า', { exact: true })).toHaveValue(policy.customer);
  await expect(page.getByLabel('รายละเอียดงาน')).toHaveValue(/DEMO-GROUP/);
  await expect(page.getByLabel('Agent เจ้าของงาน')).toHaveValue(h.agent.id);
  await expect(page.getByLabel('กำหนดส่ง')).toHaveValue('2026-11-21');
  await expect(page.getByLabel('ประเภทงาน')).toHaveValue('ลูกค้าเก่า');
  await page.getByLabel('ชื่องาน').fill('เตรียมเอกสารครบสัญญา');
  await page.getByRole('button', { name: 'ส่งงานให้เลขาฯ' }).click();
  await expect(page).toHaveURL(/\/rinlyn\/tasks\/rec\w+$/);
  await expect(page.getByRole('heading', { name: 'เตรียมเอกสารครบสัญญา' })).toBeVisible();
  expect(submissions).toBe(1);
  expect(h.tables.tasks.at(-1)?.fields).toMatchObject({
    Status: 'New',
    Agent: [h.agent.id],
    'Case Name': policy.customer,
    'Due Date': '2026-11-21',
  });
});

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
        premiumAmount: v.premiumAmount ?? null,
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
  await page.getByRole('link', { name: 'เพิ่มกรมธรรม์', exact: true }).click();
  await page.getByLabel('ชื่อลูกค้า').fill('ลูกค้าทดลอง A');
  await page.getByLabel('รหัสอ้างอิง').fill('DEMO-CARE-01');
  await page.getByLabel('ตัวแทนผู้ดูแล').selectOption(h.agent.id);
  await page.getByLabel('วันเริ่มกรมธรรม์').fill(today);
  await page.getByLabel('วันทบทวนครั้งแรก').fill('2027-01-15');
  await page.getByLabel('เดือนเกิด').selectOption('02');
  await page.getByLabel('วันที่เกิด').selectOption('29');
  await page.getByLabel('ประเภทการชำระเงิน').selectOption('quarterly');
  await page.getByLabel('ยอดเบี้ยที่ต้องชำระต่อรอบ').fill('12500.50');
  await page.getByLabel('วันชำระเบี้ยครั้งถัดไป').fill('2026-12-31');
  await page.getByRole('button', { name: 'บันทึกและสร้างแผนติดตาม' }).click();
  await expect(page.getByRole('heading', { name: /ลูกค้าทดลอง A/ })).toBeVisible();
  await expect(page.getByText(/วันเกิด 29 กุมภาพันธ์.*รอบชำระเบี้ย รายไตรมาส/)).toBeVisible();
  await expect(page.getByText(/ยอดเบี้ยต่อรอบ 12,500\.50 บาท/)).toBeVisible();
  await page.getByRole('link', { name: 'คิวแจ้งเตือน' }).click();
  await page.getByRole('button', { name: /ลูกค้าทดลอง A · ส่งมอบ/ }).click();
  await page.getByLabel('ผลการติดตาม').selectOption('handoff');
  await page.getByLabel('วันนัดถัดไป').fill('2026-11-26');
  await page.getByLabel('สรุปการติดต่อ').fill('ลูกค้าสะดวกพรุ่งนี้');
  await page.getByRole('button', { name: 'บันทึกผล' }).click();
  await expect(page.getByText(/ส่งต่อตัวแทน.*ลูกค้าสะดวกพรุ่งนี้/)).toBeVisible();
});
