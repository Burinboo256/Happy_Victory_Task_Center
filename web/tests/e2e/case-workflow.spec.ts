import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repository, rid } from '../fixtures';
import { bootstrap, detail } from '../../src/server/services/reads';
import { newCaseState, caseSummary } from '../../src/domain/case-workflow';
import { scanAccessibility } from '../support/accessibility';
test('Secretary tracks all stages, saves private followup notes and sees mandatory completion guard', async ({
  page,
}, info) => {
  const h = repository();
  h.tables.tasks[0].fields.Category = 'ตัวแทนใหม่';
  const state = newCaseState('ตัวแทนใหม่');
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
    Object.assign(state, input.state);
    version++;
    return r.fulfill({ json: { id: rid(11), state: 'completed' } });
  });
  await page.goto('/tasks/' + rid(11));
  const panel = page.getByRole('region', { name: 'ขั้นตอนงาน ตัวแทนใหม่' });
  await expect(panel).toBeVisible();
  await panel.getByLabel('ประเภทสมัครอบรม/สอบ', { exact: true }).selectOption('สอบอย่างเดียว');
  const label = 'ขอข้อมูลส่วนตัวและเอกสารประกอบให้ครบ';
  await panel.getByLabel('สถานะ: ' + label, { exact: true }).selectOption('done');
  await panel.getByLabel('หมายเหตุ: ' + label, { exact: true }).fill('ข้อมูลสมมติ ตรวจเอกสารแล้ว');
  await panel.getByRole('button', { name: 'บันทึกขั้นตอนงาน', exact: true }).click();
  await expect(panel.getByLabel('สถานะ: ' + label, { exact: true })).toHaveValue('done');
  await expect(page.locator('select[name="status"] option[value="Completed"]')).toHaveAttribute(
    'disabled',
    '',
  );
  await panel.locator('summary').filter({ hasText: '1.3 ติดตามต่อหลังลงทะเบียน' }).click();
  await expect(panel.getByLabel('สถานะ: ติดตามการเข้าเรียน HiPro', { exact: true })).toBeVisible();
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
