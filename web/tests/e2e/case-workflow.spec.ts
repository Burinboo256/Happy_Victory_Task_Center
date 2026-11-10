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
    await panel.getByRole('checkbox', { name: 'เสร็จแล้ว: ' + label, exact: true }).check();
    await expect(panel.locator('textarea')).toHaveCount(0);
    await expect(
      panel.getByText('หมายเหตุ / หลักฐาน / เหตุผลที่ไม่เกี่ยวข้อง', { exact: false }),
    ).toHaveCount(0);
    await expect(panel.getByLabel('วันติดตาม: ' + label, { exact: true })).toBeHidden();
    await panel.getByRole('button', { name: 'ตั้งวันติดตาม: ' + label, exact: false }).click();
    await panel.getByLabel('วันติดตาม: ' + label, { exact: true }).fill('2026-11-20');
    expect(version).toBe(0);
    await panel.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }).click();
    await expect(
      panel.getByRole('checkbox', { name: 'เสร็จแล้ว: ' + label, exact: true }),
    ).toBeChecked();
    await expect(
      panel.getByRole('button', { name: 'ตั้งวันติดตาม: ' + label, exact: false }),
    ).toContainText('20');
    expect(state.items[first.id].followupDate).toBe('2026-11-20');
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
    await panel.getByRole('button', { name: 'ไม่เกี่ยวข้อง: ' + optional.label, exact: false }).click();
    await panel.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }).click();
    if (sectionIndex > 0) await panel.locator('summary').filter({ hasText: section.title }).click();
    await expect(
      panel.getByRole('button', { name: 'ไม่เกี่ยวข้อง: ' + optional.label, exact: false }),
    ).toHaveAttribute('aria-pressed', 'true');
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

for (const closed of [false, true]) {
  test(`checklist opens the next stage, keeps followups ordered and respects closed=${closed}`, async ({
    page,
  }, info) => {
    const h = repository();
    const category = 'ตัวแทนใหม่';
    h.tables.tasks[0].fields.Category = category;
    if (closed) h.tables.tasks[0].fields.Status = 'Completed';
    const state = newCaseState(category);
    const sections = caseDefinitions[category].sections;
    for (const section of sections)
      for (const item of section.items)
        if (closed ? item.required : section.id === 'prepare') state.items[item.id].status = 'done';
    state.fields.applicationMode = 'อบรมพร้อมสอบ';
    state.fields.agentCode = 'TEST-001';
    const current = sections[closed ? 3 : 1];
    const [later, earlier] = current.items;
    state.items[later.id].followupDate = '2026-11-22';
    state.items[earlier.id].followupDate = '2026-11-20';
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
          caseWorkflow: { category, version: 0, state, summary: caseSummary(state), history: [] },
        },
      }),
    );
    await page.goto('/tasks/' + rid(11));
    const panel = page.getByRole('region', { name: 'ขั้นตอนงาน ' + category });
    const firstStage = panel.locator('details.case-stage').first();
    await expect(firstStage).not.toHaveAttribute('open');
    await expect(
      panel.getByRole('checkbox', { name: 'เสร็จแล้ว: ' + earlier.label, exact: true }),
    ).toBeVisible();
    const next = panel.getByRole('complementary', { name: 'งานติดตามถัดไป' });
    await expect(next).toContainText(earlier.label);
    await panel.getByRole('checkbox', { name: 'เสร็จแล้ว: ' + earlier.label, exact: true }).check();
    await expect(next).toContainText(later.label);
    await panel.getByRole('button', { name: 'ตั้งวันติดตาม: ' + later.label, exact: false }).click();
    await panel.getByRole('button', { name: 'ล้างวันที่', exact: true }).click();
    await expect(next).toContainText('ยังไม่มีรายการที่ตั้งวันติดตาม');
    await panel.getByRole('button', { name: 'ซ่อนวันที่', exact: true }).click();
    await firstStage.locator('summary').click();
    const firstCheck = panel.getByRole('checkbox', {
      name: 'เสร็จแล้ว: ' + sections[0].items[0].label,
      exact: true,
    });
    if (closed) {
      await expect(firstCheck).toBeDisabled();
      await expect(panel.getByLabel('รหัสตัวแทนที่ออกแล้ว', { exact: true })).toBeDisabled();
    } else await expect(firstCheck).toBeEnabled();
    await firstStage.locator('summary').click();
    await panel.locator('summary').filter({ hasText: 'ข้อมูลประกอบเคส' }).click();
    await panel.scrollIntoViewIfNeeded();
    await scanAccessibility(page, info, 'compact-checklist-' + closed);
    await panel
      .locator('.case-stage[open]')
      .evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await expect(
      panel.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง', exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: resolve(
        '../artifacts/vercel/case-workflows/compact-' + closed + '-' + info.project.name + '.png',
      ),
    });
  });
}
