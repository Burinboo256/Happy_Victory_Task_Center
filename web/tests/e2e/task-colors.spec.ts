import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { categories } from '../../src/domain/model';
import { bootstrap } from '../../src/server/services/reads';
import { repository, rid } from '../fixtures';
import { scanAccessibility } from '../support/accessibility';

test('retired and empty categories do not return as filters and existing tasks remain accessible', async ({
  page,
}) => {
  const h = repository();
  h.tables.tasks[0].fields.Category = '';
  const data = {
    ...(await bootstrap(h.repo, h.secretary)),
    csrfToken: 'a'.repeat(64),
    writesEnabled: true,
  };
  await page.route('**/api/bootstrap*', (route) => route.fulfill({ json: data }));
  await page.goto('/tasks');
  const legend = page.getByRole('group', { name: 'กรองประเภทงานตามสี' });
  await expect(legend.getByRole('button')).toHaveText(['ทุกประเภท', ...categories]);
  const existingTask = page.locator(`.task-row[href="/tasks/${h.tables.tasks[0].id}"]`);
  await expect(existingTask).toContainText('ไม่ระบุประเภท');
  await page.goto('/calendar');
  await expect(legend.getByRole('button')).toHaveText(['ทุกประเภท', ...categories]);
});

test('category colors match across lists and calendar, urgent work stands out and filters preserve task links', async ({
  page,
}, info) => {
  const h = repository(),
    fields = h.tables.tasks[0].fields;
  h.tables.tasks = categories.map((category, i) => ({
    id: rid(100 + i),
    fields: {
      ...fields,
      Category: category,
      'Task Title': 'งานสี ' + category,
      Priority: i === 1 ? 'Urgent' : i === 2 ? 'High' : 'Normal',
      'Due Date': i === 0 ? '2026-11-08' : '2026-11-09',
    },
  }));
  const data = {
    ...(await bootstrap(h.repo, h.secretary)),
    today: '2026-11-09',
    csrfToken: 'a'.repeat(64),
    writesEnabled: true,
  };
  await page.route('**/api/bootstrap*', (r) => r.fulfill({ json: data }));
  await page.goto('/tasks');
  await expect(page.locator('.task-row')).toHaveCount(4);
  await expect(page.locator('.task-row').first()).toContainText('งานสี ตัวแทนเก่า');
  await expect(page.locator('.task-row').first().locator('.priority-urgent')).toHaveText(
    '! ด่วนมาก',
  );
  const listColors = await page
    .locator('.task-row .category-badge')
    .evaluateAll((elements) =>
      Object.fromEntries(
        elements.map((el) => [
          el.textContent,
          getComputedStyle(el).getPropertyValue('--category-ink').trim(),
        ]),
      ),
    );
  expect(new Set(Object.values(listColors)).size).toBe(4);
  const legend = page.getByRole('group', { name: 'กรองประเภทงานตามสี' });
  await legend.getByRole('button', { name: 'ลูกค้าเก่า', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(1);
  await expect(page.locator('.task-row')).toContainText('งานสี ลูกค้าเก่า');
  await legend.getByRole('button', { name: 'ทุกประเภท', exact: true }).click();
  await scanAccessibility(page, info, 'category-colors-list');
  await mkdir(resolve('../artifacts/vercel/task-colors'), { recursive: true });
  await page.screenshot({
    path: resolve('../artifacts/vercel/task-colors/list-' + info.project.name + '.png'),
    fullPage: true,
  });
  await page.goto('/calendar');
  await expect(page.locator('.calendar-event')).toHaveCount(4);
  const calendarColors = await page
    .locator('.calendar-event')
    .evaluateAll((elements) =>
      Object.fromEntries(
        elements.map((el) => [
          el.querySelector('.calendar-event-category')?.textContent,
          getComputedStyle(el).getPropertyValue('--category-ink').trim(),
        ]),
      ),
    );
  expect(calendarColors).toEqual(listColors);
  await expect(page.locator('.calendar-event.urgency-urgent')).toHaveAttribute(
    'href',
    '/tasks/' + rid(101),
  );
  await page.getByRole('combobox', { name: 'ความเร่งด่วนในปฏิทิน' }).selectOption('Urgent');
  await expect(page.locator('.calendar-event')).toHaveCount(1);
  await expect(page.locator('.calendar-event')).toContainText('ด่วนมาก');
  await page.getByRole('combobox', { name: 'ความเร่งด่วนในปฏิทิน' }).selectOption('all');
  await legend.getByRole('button', { name: 'ตัวแทนใหม่', exact: true }).click();
  await expect(page.locator('.calendar-event')).toHaveCount(1);
  await expect(page.locator('.calendar-event')).toContainText('งานสี ตัวแทนใหม่');
  await legend.getByRole('button', { name: 'ทุกประเภท', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await scanAccessibility(page, info, 'category-colors-calendar');
  await page.screenshot({
    path: resolve('../artifacts/vercel/task-colors/calendar-' + info.project.name + '.png'),
    fullPage: true,
  });
});
