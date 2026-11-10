import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repository, rid } from '../fixtures';
import { bootstrap, detail } from '../../src/server/services/reads';
import { newCaseState, caseSummary, validateCaseState } from '../../src/domain/case-workflow';
import { scanAccessibility } from '../support/accessibility';
test('new Agent workflow omits every item note field and saves dates and optional skips without a reason', async ({
  page,
}, info) => {
  const h = repository();
  h.tables.tasks[0].fields.Category = 'ตัวแทนใหม่';
  const state = newCaseState('ตัวแทนใหม่');
  state.items['prepare-1'].notes = 'Previously saved private note';
  let version = 0;
  const data = {
    ...(await bootstrap(h.repo, h.secretary)),
    csrfToken: 'test-csrf',
    writesEnabled: true,
  };
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ json: data }));
  await page.route('**/api/tasks/' + rid(11), async (r) =>
    r.fulfill({
      json: {
        ...(await detail(h.repo, h.secretary, rid(11))),
        caseWorkflow: {
          category: 'ตัวแทนใหม่',
          version,
          state,
          summary: caseSummary(state),
          history: [],
        },
      },
    }),
  );
  await page.route('**/api/tasks/' + rid(11) + '/workflow', async (r) => {
    expect(r.request().headers()['x-csrf-token']).toBe('test-csrf');
    const input = r.request().postDataJSON();
    expect(input.version).toBe(version);
    Object.assign(state, validateCaseState(input.state));
    version++;
    return r.fulfill({ json: { id: rid(11), state: 'completed' } });
  });
  await page.goto('/tasks/' + rid(11));
  const panel = page.getByRole('region', { name: 'ขั้นตอนงาน ตัวแทนใหม่' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('ประเภทสมัครอบรม/สอบ', { exact: true }).selectOption('สอบอย่างเดียว');
  const label = 'ขอข้อมูลส่วนตัวและเอกสารประกอบให้ครบ';
  await panel.getByLabel('สถานะ: ' + label, { exact: true }).selectOption('done');
  await expect(panel.locator('textarea')).toHaveCount(0);
  await expect(panel.getByText('หมายเหตุ / หลักฐาน / เหตุผลที่ไม่เกี่ยวข้อง', { exact: false })).toHaveCount(0);
  await panel.getByLabel('วันติดตาม: ' + label, { exact: true }).fill('2026-11-20');
  await panel.getByRole('button', { name: 'บันทึกขั้นตอนงาน', exact: true }).click();
  await expect(panel.getByLabel('สถานะ: ' + label, { exact: true })).toHaveValue('done');
  await expect(panel.getByLabel('วันติดตาม: ' + label, { exact: true })).toHaveValue('2026-11-20');
  expect(state.items['prepare-1'].notes).toBe('Previously saved private note');
  await expect(page.locator('select[name="status"] option[value="Completed"]')).toHaveAttribute(
    'disabled',
    '',
  );
  await panel.locator('summary').filter({ hasText: '1.3 ติดตามต่อหลังลงทะเบียน' }).click();
  await expect(panel.getByLabel('สถานะ: ติดตามการเข้าเรียน HiPro', { exact: true })).toBeVisible();
  await panel.getByLabel('สถานะ: ติดตามการเข้าเรียน HiPro', { exact: true }).selectOption('na');
  await panel.getByRole('button', { name: 'บันทึกขั้นตอนงาน', exact: true }).click();
  await expect(panel.getByLabel('สถานะ: ติดตามการเข้าเรียน HiPro', { exact: true })).toHaveValue('na');
  expect(state.items['continue-2'].status).toBe('na');
  expect(state.items['continue-2'].notes).toBe('');
  await scanAccessibility(page, info, 'six-case-workflow');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(resolve('../artifacts/vercel/case-workflows'), { recursive: true });
  await page.screenshot({
    path: resolve('../artifacts/vercel/case-workflows/checklist-' + info.project.name + '.png'),
    fullPage: true,
  });
});
test('completed Agent onboarding remains visible in followups when continuing training is due', async ({
  page,
}) => {
  const h = repository(),
    data = {
      ...(await bootstrap(h.repo, h.secretary)),
      csrfToken: 'test-csrf',
      writesEnabled: true,
    };
  data.tasks[0] = {
    ...data.tasks[0],
    status: 'Completed',
    category: 'ตัวแทนใหม่',
    followupDate: '2026-11-20',
    continuingFollowup: true,
  };
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ json: data }));
  await page.goto('/followups');
  await expect(page.locator('a[href="/tasks/' + rid(11) + '"]')).toContainText(data.tasks[0].title);
});
