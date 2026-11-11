import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { categories, caseNameLabel } from '../../src/domain/model';
import { repository } from '../fixtures';
import { bootstrap, detail } from '../../src/server/services/reads';
import { mutate } from '../../src/server/services/mutations';

for (const [index, category] of categories.entries()) {
  test(`case name required and persisted for ${category}`, async ({ page }, info) => {
    const h = repository(),
      user = index % 2 ? h.secretary : h.agent;
    let submissions = 0;
    await page.route('**/api/bootstrap*', async (r) =>
      r.fulfill({
        json: {
          ...(await bootstrap(h.repo, user)),
          csrfToken: 'test-csrf',
          writesEnabled: true,
        },
      }),
    );
    await page.route('**/api/tasks/rec*', async (r) =>
      r.fulfill({
        json: await detail(h.repo, user, new URL(r.request().url()).pathname.split('/').at(-1) || ''),
      }),
    );
    await page.route('**/api/tasks', async (r) => {
      submissions++;
      const result = await mutate(h.repo, user, 'create', r.request().postDataJSON(), {
        key: 'case-name-ui',
        run: async (_name, work) => work(),
      });
      await r.fulfill({ json: { ...result, state: 'completed' } });
    });
    await page.goto('/tasks/new');
    await page.getByLabel('ชื่องาน').fill('ตรวจข้อมูลสมมติ');
    await page.getByLabel('รายละเอียดงาน').fill('รายละเอียดเคสทดสอบ');
    if (user.role === 'Secretary')
      await page.getByLabel('Agent เจ้าของงาน').selectOption(h.agent.id);
    await page.locator('select[name="category"]').selectOption(category);
    const input = page.getByLabel(caseNameLabel(category), { exact: true });
    await expect(input).toHaveAttribute('required', '');
    await expect(page.locator('.case-required-marker')).toHaveCSS('color', 'rgb(180, 35, 24)');
    await page.getByRole('button', { name: 'ส่งงานให้เลขาฯ' }).click();
    await expect(page).toHaveURL(/\/tasks\/new$/);
    expect(submissions).toBe(0);
    await input.fill('คุณสมมติ เคสทดสอบ');
    await mkdir(resolve('../artifacts/vercel/case-name'), { recursive: true });
    await page
      .locator('.form-panel')
      .screenshot({
        path: resolve(`../artifacts/vercel/case-name/${index}-${info.project.name}.png`),
      });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole('button', { name: 'ส่งงานให้เลขาฯ' }).click();
    await expect(page.locator('.detail-grid')).toContainText('คุณสมมติ เคสทดสอบ');
    expect(h.tables.tasks.at(-1)?.fields.Agent).toEqual([h.agent.id]);
    await page.goto('/tasks');
    await page.getByRole('searchbox').fill('คุณสมมติ');
    await expect(page.locator('.task-row')).toHaveCount(1);
    await expect(page.locator('.task-row')).toContainText('คุณสมมติ เคสทดสอบ');
  });
}
