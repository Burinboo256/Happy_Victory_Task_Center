import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { rid } from '../fixtures';
import { hash } from '../../src/server/auth/security';
import { createSession } from '../../src/server/auth/session';
import { readConfig } from '../../src/server/config';

const origin = 'http://127.0.0.1:4181';
async function controls(value: unknown = {}) {
  const file = process.env.HVR_TEST_CONTROL_FILE;
  if (!file || !/hvr_http_[a-f0-9]{32}\.json$/.test(file))
    throw new Error('Isolated controls required');
  await writeFile(file, JSON.stringify(value));
}
async function login(page: Page, role: 'AGENT' | 'SECRETARY') {
  const raw = process.env.DATABASE_URL;
  if (!raw?.includes('hvr_http_')) throw new Error('Disposable database required');
  const db = new Pool({ connectionString: raw, max: 1 });
  let token: string;
  try {
    token = (
      await createSession(db, readConfig(process.env), {
        id: role === 'AGENT' ? rid(2) : rid(1),
        sub: role === 'AGENT' ? 'agent-a' : 'secretary',
      })
    ).token;
  } finally {
    await db.end();
  }
  await page
    .context()
    .addCookies([
      { name: 'hvr-session', value: token, url: origin, httpOnly: true, sameSite: 'Lax' },
    ]);
  const response = await page.request.get('/api/bootstrap');
  expect(response.status()).toBe(200);
  return { ...(await response.json()), testToken: token };
}
const headers = (csrf: string) => ({
  Origin: origin,
  'X-CSRF-Token': csrf,
  'Idempotency-Key': randomUUID(),
});
test.beforeEach(() => controls());
test.afterEach(() => controls());

test('active session obeys role downgrade, ownership changes and privilege revocation on the next request', async ({
  page,
}) => {
  const manager = await login(page, 'SECRETARY');
  await controls({ users: { [rid(1)]: { Role: 'Agent' } } });
  const downgraded = await (await page.request.get('/api/bootstrap')).json();
  expect(downgraded.user.role).toBe('Agent');
  expect(downgraded.users.map((user: { id: string }) => user.id)).toEqual([rid(1)]);
  expect(downgraded.tasks).toEqual([]);
  expect((await page.request.get('/api/tasks/' + rid(11))).status()).toBe(403);
  for (const [path, data] of [
    ['/status', { status: 'Completed', version: 'v1' }],
    ['/followups', { date: '2026-11-07' }],
    ['/followups/' + rid(81) + '/resolve', { status: 'Done', notes: 'Test' }],
  ] as const) {
    const response = await page.request.post('/api/tasks/' + rid(11) + path, {
      headers: headers(manager.csrfToken),
      data,
    });
    expect(response.status()).toBe(403);
  }
  await controls();
  const agent = await login(page, 'AGENT');
  await controls({ taskOwners: { [rid(11)]: rid(3) } });
  expect((await page.request.get('/api/tasks/' + rid(11))).status()).toBe(403);
  expect(
    (
      await page.request.post('/api/tasks/' + rid(11) + '/comments', {
        headers: headers(agent.csrfToken),
        data: { message: 'Must not write' },
      })
    ).status(),
  ).toBe(403);
});

test('disabled Active, replaced subject and invalid role fail closed; logout still revokes the session', async ({
  page,
}) => {
  const agent = await login(page, 'AGENT');
  for (const changed of [
    { Active: false },
    { 'Google Subject': 'replaced-subject' },
    { Role: 'Owner' },
  ]) {
    await controls({ users: { [rid(2)]: changed } });
    const read = await page.request.get('/api/bootstrap');
    expect(read.status()).toBe(403);
    expect(JSON.stringify(await read.json())).not.toContain('เอกสารทดสอบ');
    expect(
      (
        await page.request.post('/api/tasks', {
          headers: headers(agent.csrfToken),
          data: {
            title: 'Blocked user',
            description: 'Synthetic',
            caseName: 'บุคคลสมมติ ทดสอบ',
            category: 'ลูกค้าเก่า',
            priority: 'Normal',
            dueDate: '2026-11-07',
          },
        })
      ).status(),
    ).toBe(403);
  }
  const logout = await page.request.post('/api/auth/logout', {
    headers: { Origin: origin, 'X-CSRF-Token': agent.csrfToken },
  });
  expect(logout.status()).toBe(200);
  expect(logout.headers()['set-cookie']).toContain('Max-Age=0');
  // Replaying the cookie cannot restore the deleted server session.
  const token = agent.testToken;
  expect(
    (
      await page.request.get('/api/bootstrap', { headers: { Cookie: 'hvr-session=' + token } })
    ).status(),
  ).toBe(401);
});

test('unavailable identity source returns no cached privileges or upstream details', async ({
  page,
}) => {
  const manager = await login(page, 'SECRETARY');
  await controls({ failUsers: true });
  for (const response of [
    await page.request.get('/api/bootstrap'),
    await page.request.get('/api/tasks/' + rid(11)),
    await page.request.post('/api/tasks/' + rid(11) + '/status', {
      headers: headers(manager.csrfToken),
      data: { status: 'Completed', version: 'v1' },
    }),
  ]) {
    expect(response.status()).toBe(503);
    expect(response.headers()['cache-control']).toContain('no-store');
    const body = JSON.stringify(await response.json());
    expect(body).not.toContain('TEST_PRIVATE_UPSTREAM_MESSAGE');
    expect(body).not.toContain('เอกสารทดสอบ');
  }
});

test('expired database session is rejected by HTTP endpoints', async ({ page }) => {
  // Use a separate cookie so expiry does not invalidate the other test users.
  const token = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
  const raw = process.env.DATABASE_URL;
  if (!raw?.includes('hvr_http_')) throw new Error('Disposable database required');
  const db = new Pool({ connectionString: raw, max: 1 });
  try {
    await db.query(
      `INSERT INTO hvr_sessions(environment,token_hash,user_id,subject,csrf_token,expires_at)
      VALUES('development',$1,$2,'agent-a',$3,clock_timestamp()-interval '1 second')`,
      [hash(token), rid(2), 'f'.repeat(64)],
    );
    await page
      .context()
      .addCookies([{ name: 'hvr-session', value: token, url: origin, httpOnly: true }]);
    expect((await page.request.get('/api/bootstrap')).status()).toBe(401);
    expect((await page.request.get('/api/tasks/' + rid(11))).status()).toBe(401);
  } finally {
    await db.end();
  }
});

test('runtime kill switch blocks all business mutation routes while reads remain available', async ({
  page,
}) => {
  const manager = await login(page, 'SECRETARY');
  const raw = process.env.DATABASE_URL;
  if (!raw?.includes('hvr_http_')) throw new Error('Disposable database required');
  const db = new Pool({ connectionString: raw, max: 1 });
  try {
    await db.query("UPDATE hvr_runtime SET task_writes=false WHERE environment='development'");
    expect((await page.request.get('/api/bootstrap')).status()).toBe(200);
    for (const path of [
      '',
      '/' + rid(11) + '/status',
      '/' + rid(11) + '/comments',
      '/' + rid(11) + '/followups',
      '/' + rid(11) + '/followups/' + rid(81) + '/resolve',
    ]) {
      const response = await page.request.post('/api/tasks' + path, {
        headers: headers(manager.csrfToken),
        data: {},
      });
      expect(response.status()).toBe(503);
      expect((await response.json()).error.code).toBe('MAINTENANCE');
    }
  } finally {
    await db.query("UPDATE hvr_runtime SET task_writes=true WHERE environment='development'");
    await db.end();
  }
});

test('invalid business data returns a safe error without inventing status or invalid render dates', async ({
  page,
}) => {
  await login(page, 'AGENT');
  for (const changed of [
    { 'Due Date': '2026-02-30' },
    { Status: 'Archived' },
    { Agent: [rid(2), rid(3)] },
  ]) {
    await controls({ tasks: { [rid(11)]: changed } });
    for (const path of ['/api/bootstrap', '/api/tasks/' + rid(11)]) {
      const response = await page.request.get(path);
      expect(response.status()).toBe(503);
      const body = await response.json();
      expect(body.error.code).toBe('AIRTABLE_DATA');
      expect(JSON.stringify(body)).not.toContain('เอกสารทดสอบ A');
      expect(JSON.stringify(body)).not.toContain('Archived');
    }
  }
});
