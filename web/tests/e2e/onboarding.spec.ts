import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repository, rid } from '../fixtures';
import { bootstrap, detail } from '../../src/server/services/reads';
import {
  newWorkflow,
  defaultTemplate,
  workflowSummary,
  type Onboarding,
} from '../../src/domain/onboarding';
import { scanAccessibility } from '../support/accessibility';

test('Secretary records combined training and exam, sees pending modules, keeps input after failure and reloads saved workflow', async ({
  page,
}, info) => {
  const h = repository();
  h.tables.tasks[0].fields.Category = 'ตัวแทนใหม่';
  let state = newWorkflow(defaultTemplate),
    version = 0,
    attempts = 0;
  const data = {
    ...(await bootstrap(h.repo, h.secretary, 'context')),
    csrfToken: 'a'.repeat(64),
    writesEnabled: true,
  };
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ json: data }));
  await page.route('**/api/tasks/' + rid(11), async (r) =>
    r.fulfill({
      json: {
        ...(await detail(h.repo, h.secretary, rid(11))),
        workflow: {
          version,
          templateVersion: 0,
          state,
          summary: workflowSummary(state),
          history: [],
        },
      },
    }),
  );
  await page.route('**/api/tasks/*/onboarding', async (r) => {
    expect(r.request().headers()['x-csrf-token']).toBe(data.csrfToken);
    attempts++;
    if (attempts === 1)
      return r.fulfill({ status: 503, json: { error: { message: 'จำลองเครือข่ายไม่พร้อม' } } });
    const payload = r.request().postDataJSON();
    expect(payload.version).toBe(version);
    state = payload.state as Onboarding;
    version++;
    return r.fulfill({ json: { state: 'completed', id: rid(11) } });
  });
  await page.goto('/tasks/' + rid(11));
  const workflow = page.getByRole('region', { name: 'Workflow ตัวแทนใหม่' });
  await expect(workflow.getByText('อบรมแล้ว 0/4 Module', { exact: false })).toBeVisible();
  await expect(page.locator('select[name=status] option[value=Completed]')).toHaveJSProperty(
    'disabled',
    true,
  );
  await workflow.getByLabel('วันที่แจ้ง', { exact: true }).fill('2026-11-01');
  await workflow.getByLabel('ผู้สมัครรับทราบแล้ว').check();
  await workflow.getByLabel('วันอบรม', { exact: true }).fill('2026-11-02');
  await workflow.getByLabel('อบรมพร้อมสอบในรอบเดียวกัน').check();
  await workflow.getByRole('combobox', { name: 'สถานะอบรม', exact: true }).selectOption('attended');
  await workflow.getByRole('button', { name: '+ เพิ่มรอบสอบ' }).click();
  await expect(workflow.getByLabel('วันสอบ', { exact: true })).toHaveValue('2026-11-02');
  await workflow.getByLabel('ผล / สถานะสอบ').selectOption('failed');
  await workflow.getByRole('button', { name: 'บันทึก Workflow', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'จำลองเครือข่ายไม่พร้อม' })).toBeVisible();
  await expect(workflow.getByLabel('วันสอบ', { exact: true })).toHaveValue('2026-11-02');
  await workflow.getByRole('button', { name: 'บันทึก Workflow', exact: true }).click();
  await expect(page.getByText('บันทึกเรียบร้อยแล้ว', { exact: true })).toBeVisible();
  await expect(workflow.getByLabel('ผล / สถานะสอบ')).toHaveValue('failed');
  expect(state.exams).toHaveLength(1);
  expect(state.training.combined).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await scanAccessibility(page, info, 'new-agent-workflow');
  await mkdir(resolve('../artifacts/vercel/onboarding'), { recursive: true });
  await page.screenshot({
    path: resolve('../artifacts/vercel/onboarding/workflow-' + info.project.name + '.png'),
    fullPage: true,
  });
});

test('Admin team page no longer exposes or loads retired workflow settings', async ({ page }) => {
  const h = repository(),
    admin = { ...h.secretary, role: 'Admin' as const };
  let templateRequests = 0;
  await page.route('**/api/bootstrap*', async (r) =>
    r.fulfill({
      json: {
        ...(await bootstrap(h.repo, admin)),
        csrfToken: 'b'.repeat(64),
        writesEnabled: true,
      },
    }),
  );
  await page.route('**/api/onboarding-template', async (r) => {
    templateRequests++;
    return r.fulfill({ status: 410, json: {} });
  });
  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'สมาชิกในพื้นที่ทำงาน' })).toBeVisible();
  await expect(page.getByText('ตั้งค่า Workflow รุ่นเดิม (เก็บไว้สำหรับประวัติ)', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'ตั้งค่า Workflow ตัวแทนใหม่' })).toHaveCount(0);
  expect(templateRequests).toBe(0);
});
