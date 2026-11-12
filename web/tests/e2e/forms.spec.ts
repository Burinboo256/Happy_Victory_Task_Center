import { test, expect } from '@playwright/test';
import { database, repository, config } from '../fixtures';
import { bootstrap } from '../../src/server/services/reads';
import {
  createDocument,
  documentDetails,
  favoriteDocument,
  listDocuments,
  pauseDocument,
  publishDocument,
  saveDocumentDraft,
} from '../../src/server/documents/service';
import type { User } from '../../src/domain/model';
import { AppError } from '../../src/server/errors';
import { scanAccessibility } from '../support/accessibility';

test('secretary creates a link draft, Admin publishes it, and Agent favorites persist after reload', async ({
  page,
}, info) => {
  test.setTimeout(60000);
  const { db, engine } = await database(),
    h = repository();
  const c = { ...config, FORMS_ENABLED: true };
  const admin = { ...h.secretary, role: 'Admin' as const };
  let user: User = h.secretary;
  await page.route('**/api/bootstrap*', async (route) =>
    route.fulfill({
      json: {
        ...(await bootstrap(h.repo, user, 'context')),
        formsEnabled: true,
        writesEnabled: true,
        csrfToken: 'test-csrf',
      },
    }),
  );
  await page.route('**/api/forms**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      id = url.pathname.split('/')[3];
    try {
      let result: unknown;
      if (req.method() === 'GET')
        result = id
          ? await documentDetails(db, c, user, id)
          : await listDocuments(db, c, user, Object.fromEntries(url.searchParams));
      else {
        const b = req.postDataJSON();
        if (!id) result = await createDocument(db, c, user, b.id, b.data);
        else if (b.action === 'favorite') {
          await favoriteDocument(db, c, user, id, b.favorite);
          result = { saved: true };
        } else if (b.action === 'publish')
          result = await publishDocument(db, c, user, id, b.revision, b.versionId, b.reviewed);
        else if (b.action === 'pause')
          result = await pauseDocument(db, c, user, id, b.revision, b.paused);
        else result = await saveDocumentDraft(db, c, user, id, b.revision, b.versionId, b.data);
      }
      await route.fulfill({ json: result });
    } catch (e) {
      await route.fulfill({
        status: e instanceof AppError ? e.status : 422,
        json: { error: { message: e instanceof Error ? e.message : 'error' } },
      });
    }
  });
  try {
    await page.goto('/forms');
    await expect(
      page.getByRole('heading', { name: 'เอกสารและแบบฟอร์ม', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: '+ เพิ่มเอกสาร', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('ชื่อเอกสาร').fill('แบบฟอร์มทีมทดสอบ');
    await dialog.getByLabel('หมวดเอกสาร').selectOption('เอกสารทีม');
    await dialog.getByLabel('แหล่งเอกสาร').selectOption('drive');
    await dialog
      .getByLabel('ลิงก์เอกสาร')
      .fill('https://drive.google.com/file/d/synthetic-example/view');
    await dialog.getByLabel('คำค้น / ชื่อเรียกอื่น').fill('เอกสารต้อนรับ, คู่มือทีม');
    await dialog.getByLabel('ชื่อฉบับในระบบ').fill('ตัวอย่าง 1');
    await dialog.getByLabel('สิ่งที่เปลี่ยน / เหตุผลที่เพิ่ม').fill('เพิ่มข้อมูลสมมติเพื่อทดสอบ');
    await expect(dialog.locator('input[type=file]')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'บันทึกเป็นร่าง' }).click();
    await expect(page.locator('article')).toContainText('แบบฟอร์มทีมทดสอบ');
    await page.getByRole('button', { name: 'รายละเอียด', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'เผยแพร่ฉบับนี้' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
    user = h.agent;
    await page.reload();
    await expect(page.getByRole('button', { name: '+ เพิ่มเอกสาร', exact: true })).toHaveCount(0);
    await expect(page.locator('article')).toHaveCount(0);
    user = admin;
    await page.reload();
    await page.getByRole('button', { name: /ร่างรอตรวจ/ }).click();
    await page.getByRole('button', { name: 'รายละเอียด', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'เผยแพร่ฉบับนี้' })).toBeDisabled();
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'เผยแพร่ฉบับนี้' }).click();
    await expect(dialog.getByText('ฉบับที่เผยแพร่', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'ปิด', exact: true }).click();
    user = h.agent;
    await page.reload();
    await page.getByRole('button', { name: /^เพิ่มในรายการโปรด:/ }).click();
    await page.getByRole('button', { name: /ใช้บ่อย/ }).click();
    await expect(page.locator('article')).toHaveCount(1);
    await page.reload();
    await page.getByRole('button', { name: /ใช้บ่อย/ }).click();
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.locator('article a')).toHaveAttribute('href', /\/forms\/[a-f0-9-]+\/open$/);
    await scanAccessibility(page, info, 'forms');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    user = h.other;
    await page.reload();
    await page.getByRole('button', { name: /ใช้บ่อย/ }).click();
    await expect(page.locator('article')).toHaveCount(0);
  } finally {
    await engine.close();
  }
});
