import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { scanAccessibility } from '../support/accessibility';

function diagnose(token: string) {
  return new Promise<{ code: number | null; output: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'tools/diagnose.ts'], {
      env: { ...process.env, AIRTABLE_SCHEMA_TOKEN: token, HVR_TEST_DIAGNOSTIC_ONLY: '1' },
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      output += data;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, output }));
  });
}
test('diagnostics CLI checks schema and table access without record reads, writes or token output', async () => {
  const file = process.env.HVR_TEST_CONTROL_FILE;
  if (!file || !/hvr_http_[a-f0-9]{32}\.json$/.test(file))
    throw new Error('Isolated control file required');
  try {
    await writeFile(file, '{}');
    const passed = await diagnose('schema-only-test-token');
    expect(passed.code, passed.output).toBe(0);
    expect(passed.output).toContain('Schema contract: passed');
    expect(passed.output.match(/: readable/g)).toHaveLength(5);
    expect(passed.output).not.toContain('schema-only-test-token');
    await writeFile(file, JSON.stringify({ schemaMismatch: true }));
    const mismatch = await diagnose('schema-only-test-token');
    expect(mismatch.code).toBe(1);
    expect(mismatch.output).toContain('LINK_TARGET_OR_CARDINALITY');
    expect(mismatch.output).not.toContain(': readable');
    const missing = await diagnose('');
    expect(missing.code).toBe(1);
    expect(missing.output).toContain('SCHEMA_TOKEN_REQUIRED');
  } finally {
    await writeFile(file, '{}');
  }
});

test('configured Login has no automatically detected accessibility violations', async ({
  page,
}, info) => {
  await page.goto('/login?returnTo=%2Ftasks%2Fnew');
  await expect(page.getByRole('link', { name: 'เข้าสู่ระบบด้วยบัญชี Google' })).toBeVisible();
  await scanAccessibility(page, info, 'configured-login');
});
