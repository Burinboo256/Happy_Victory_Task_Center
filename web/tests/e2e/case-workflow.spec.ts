import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { repository, rid } from '../fixtures';
import { bootstrap, detail } from '../../src/server/services/reads';
import {
  newCaseState,
  caseSummary,
  validateCaseState,
  caseDefinitions,
} from '../../src/domain/case-workflow';
import { scanAccessibility } from '../support/accessibility';
for (const category of Object.keys(caseDefinitions)) {
  test(`${category} omits every item note field and saves dates and optional skips without a reason`, async ({
    page,
  }, info) => {
    const h = repository();
    h.tables.tasks[0].fields.Category = category;
    const state = newCaseState(category);
    const definition = caseDefinitions[category];
    const first = definition.sections[0].items[0];
    state.items[first.id].notes = 'Previously saved private note';
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
            category,
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
    const panel = page.getByRole('region', { name: 'ขั้นตอนงาน ' + category });
    await expect(panel).toBeVisible();
    if (category === 'ตัวแทนใหม่')
      await panel.getByLabel('ประเภทสมัครอบรม/สอบ', { exact: true }).selectOption('สอบอย่างเดียว');
    const label = first.label;
    await panel.getByLabel('สถานะ: ' + label, { exact: true }).selectOption('done');
    await expect(panel.locator('textarea')).toHaveCount(0);
    await expect(
      panel.getByText('หมายเหตุ / หลักฐาน / เหตุผลที่ไม่เกี่ยวข้อง', { exact: false }),
    ).toHaveCount(0);
    await panel.getByLabel('วันติดตาม: ' + label, { exact: true }).fill('2026-11-20');
    await panel.getByRole('button', { name: 'บันทึกขั้นตอนงาน', exact: true }).click();
    await expect(panel.getByLabel('สถานะ: ' + label, { exact: true })).toHaveValue('done');
    await expect(panel.getByLabel('วันติดตาม: ' + label, { exact: true })).toHaveValue('2026-11-20');
    expect(state.items[first.id].notes).toBe('Previously saved private note');
    await expect(page.locator('select[name="status"] option[value="Completed"]')).toHaveAttribute(
      'disabled',
      '',
    );
    const sectionIndex = definition.sections.findIndex((s) =>
      s.items.some((i) => !i.required || i.skippable),
    );
    const section = definition.sections[sectionIndex];
    const optional = section.items.find((i) => !i.required || i.skippable);
    if (!optional) throw new Error('Expected an optional or conditional checklist item');
    if (sectionIndex > 0) await panel.locator('summary').filter({ hasText: section.title }).click();
    await panel.getByLabel('สถานะ: ' + optional.label, { exact: true }).selectOption('na');
    await panel.getByRole('button', { name: 'บันทึกขั้นตอนงาน', exact: true }).click();
    await expect(panel.getByLabel('สถานะ: ' + optional.label, { exact: true })).toHaveValue('na');
    expect(state.items[optional.id].status).toBe('na');
    expect(state.items[optional.id].notes).toBe('');
    await scanAccessibility(page, info, 'case-workflow-' + category);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await mkdir(resolve('../artifacts/vercel/case-workflows'), { recursive: true });
    await page.screenshot({
      path: resolve(
        '../artifacts/vercel/case-workflows/checklist-' +
          category +
          '-' +
          info.project.name +
          '.png',
      ),
      fullPage: true,
    });
  });
}
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
