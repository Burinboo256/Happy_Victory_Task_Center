import { expect, type Page, type TestInfo } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function scanAccessibility(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  const result = await new AxeBuilder({ page }).analyze();
  const report = JSON.stringify(
    {
      scope:
        'Local test with synthetic data; manual screen-reader and device testing remain required.',
      engine: result.testEngine,
      url: new URL(page.url()).pathname,
      violations: result.violations,
      incomplete: result.incomplete,
    },
    null,
    2,
  );
  const directory = resolve('../artifacts/vercel/accessibility');
  await mkdir(directory, { recursive: true });
  const filename = (info.project.name + '-' + name).replace(/[^a-zA-Z0-9_-]/g, '_') + '.json';
  await writeFile(resolve(directory, filename), report);
  await info.attach('axe-' + name, { body: report, contentType: 'application/json' });
  expect(
    result.violations.map((issue) => ({
      rule: issue.id,
      nodes: issue.nodes.map((node) => ({ target: node.target, reason: node.failureSummary })),
    })),
  ).toEqual([]);
}
