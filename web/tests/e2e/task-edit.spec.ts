import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repository, rid } from '../fixtures';
import { bootstrap, detail } from '../../src/server/services/reads';
import { mutate } from '../../src/server/services/mutations';
import { scanAccessibility } from '../support/accessibility';

test('manager can cancel, retain a failed draft and save all five task fields', async ({
  page,
}, info) => {
  const h = repository();
  const endpoint = '/api/tasks/' + rid(11) + '/edit';
  let fail = true;
  await page.route('**/api/bootstrap*', async (r) =>
    r.fulfill({
      json: {
        ...(await bootstrap(h.repo, h.secretary)),
        csrfToken: 'test-csrf',
        writesEnabled: true,
      },
    }),
  );
  await page.route('**/api/tasks/' + rid(11), async (r) =>
    r.fulfill({ json: await detail(h.repo, h.secretary, rid(11)) }),
  );
  await page.route('**' + endpoint, async (r) => {
    expect(r.request().headers()['x-csrf-token']).toBe('test-csrf');
    if (fail) {
      fail = false;
      return r.fulfill({ status: 503, json: { error: { message: 'กรุณาลองอีกครั้ง' } } });
    }
    const result = await mutate(
      h.repo,
      h.secretary,
      'edit',
      { ...r.request().postDataJSON(), id: rid(11) },
      { key: 'edit-ui', run: async (_name, work) => work() },
    );
    return r.fulfill({ json: { ...result, state: 'completed' } });
  });
  await page.goto('/tasks/' + rid(11));
  await expect(
    page.locator('.panel-title').getByRole('button', { name: 'แก้ไขข้อมูลงาน', exact: true }),
  ).toBeVisible();
  await mkdir(resolve('../artifacts/vercel/task-edit'), { recursive: true });
  await page
    .locator('.panel-title')
    .filter({ hasText: 'เอกสารทดสอบ A' })
    .screenshot({
      path: resolve('../artifacts/vercel/task-edit/header-' + info.project.name + '.png'),
    });
  await page.getByRole('button', { name: 'แก้ไขข้อมูลงาน', exact: true }).click();
  let editor = page.getByRole('region', { name: 'แก้ไขข้อมูลงาน', exact: true });
  await editor.getByLabel('ชื่องาน').fill('Discard this draft');
  await editor.getByRole('button', { name: 'ยกเลิกการแก้ไข' }).click();
  await page.getByRole('button', { name: 'แก้ไขข้อมูลงาน', exact: true }).click();
  editor = page.getByRole('region', { name: 'แก้ไขข้อมูลงาน', exact: true });
  await expect(editor.getByLabel('ชื่องาน')).toHaveValue('เอกสารทดสอบ A');
  await editor.getByLabel('ชื่องาน').fill('งานที่แก้ไขแล้ว');
  await editor.getByLabel('รายละเอียดงาน').fill('รายละเอียดที่แก้ไขแล้ว');
  await editor.getByLabel('Agent เจ้าของงาน').selectOption(h.other.id);
  await editor.getByLabel('ความเร่งด่วน').selectOption('Urgent');
  await editor.getByLabel('กำหนดส่ง').fill('2026-12-15');
  await expect(editor).toContainText('Agent เดิมจะไม่เห็นงานนี้');
  await scanAccessibility(page, info, 'task-edit');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await mkdir(resolve('../artifacts/vercel/task-edit'), { recursive: true });
  await editor.screenshot({
    path: resolve('../artifacts/vercel/task-edit/' + info.project.name + '.png'),
  });
  await editor.getByRole('button', { name: 'บันทึกข้อมูลงาน' }).click();
  await expect(page.getByText('กรุณาลองอีกครั้ง', { exact: true })).toBeVisible();
  await expect(editor.getByLabel('ชื่องาน')).toHaveValue('งานที่แก้ไขแล้ว');
  await editor.getByRole('button', { name: 'บันทึกข้อมูลงาน' }).click();
  await expect(page.getByRole('heading', { name: 'งานที่แก้ไขแล้ว', exact: true })).toBeVisible();
  await expect(editor).toHaveCount(0);
  expect(h.tables.tasks[0].fields.Agent).toEqual([h.other.id]);
  expect(h.tables.tasks[0].fields.Priority).toBe('Urgent');
  expect(h.tables.tasks[0].fields['Due Date']).toBe('2026-12-15');
  await expect(page.locator('.detail-description')).toHaveText('รายละเอียดที่แก้ไขแล้ว');
});

test('Agent cannot open the task editor and paused writes disable it for managers', async ({
  page,
}) => {
  const h = repository();
  let manager = false;
  await page.route('**/api/bootstrap*', async (r) =>
    r.fulfill({
      json: {
        ...(await bootstrap(h.repo, manager ? h.secretary : h.agent)),
        csrfToken: 'test-csrf',
        writesEnabled: false,
      },
    }),
  );
  await page.route('**/api/tasks/' + rid(11), async (r) =>
    r.fulfill({ json: await detail(h.repo, manager ? h.secretary : h.agent, rid(11)) }),
  );
  await page.goto('/tasks/' + rid(11));
  await expect(page.getByRole('heading', { name: 'เอกสารทดสอบ A' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'แก้ไขข้อมูลงาน', exact: true })).toHaveCount(0);
  manager = true;
  await page.reload();
  await expect(page.getByRole('button', { name: 'แก้ไขข้อมูลงาน', exact: true })).toBeDisabled();
});
