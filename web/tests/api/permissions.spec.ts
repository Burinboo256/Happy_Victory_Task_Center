import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { rid } from '../fixtures';

const origin = 'http://127.0.0.1:4181';
async function login(page: Page, role: 'AGENT' | 'OTHER' | 'SECRETARY') {
  const token = process.env['HVR_TEST_' + role + '_TOKEN'];
  if (!token) throw new Error('Missing isolated test session');
  await page
    .context()
    .addCookies([
      { name: 'hvr-session', value: token, url: origin, httpOnly: true, sameSite: 'Lax' },
    ]);
  const response = await page.request.get('/api/bootstrap');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  return response.json();
}
test('browser submits the real form through the API and PostgreSQL journal', async ({ page }) => {
  await login(page, 'AGENT');
  await page.goto('/tasks/new');
  await expect(page.getByRole('heading', { name: 'รายละเอียดงานใหม่' })).toBeVisible();
  await page.getByLabel('ชื่องาน').fill('งานทดสอบจากเบราว์เซอร์จริง');
  await page.getByLabel('รายละเอียดงาน').fill('ข้อมูลสมมติสำหรับทดสอบ UI ต่อ API โดยไม่ mock หน้าเว็บ');
  await page.getByRole('button', { name: 'ส่งงานให้เลขาฯ' }).click();
  await expect(page).toHaveURL(/\/tasks\/rec[a-zA-Z0-9]{14}$/);
  await expect(page.getByRole('heading', { name: 'งานทดสอบจากเบราว์เซอร์จริง' })).toBeVisible();
  await expect(page.getByText('ส่งงานใหม่: งานทดสอบจากเบราว์เซอร์จริง', { exact: true })).toBeVisible();
});
test('actual API rejects missing session and CSRF, and isolates Agent records', async ({
  page,
}) => {
  expect((await page.request.get('/api/bootstrap')).status()).toBe(401);
  const data = await login(page, 'AGENT');
  expect(data.tasks.some((t: { id: string }) => t.id === rid(11))).toBe(true);
  expect(data.tasks.every((t: { agentId: string }) => t.agentId === rid(2))).toBe(true);
  expect(JSON.stringify(data)).not.toContain('agent-b@gmail.com');
  expect((await page.request.get('/api/tasks/' + rid(12))).status()).toBe(403);
  const headers = { Origin: origin, 'Idempotency-Key': randomUUID() };
  expect((await page.request.post('/api/tasks', { headers, data: {} })).status()).toBe(403);
  expect(
    (
      await page.request.post('/api/tasks/' + rid(11) + '/status', {
        headers: { ...headers, 'X-CSRF-Token': data.csrfToken },
        data: { status: 'Completed', version: 'v1' },
      })
    ).status(),
  ).toBe(403);
});

test('actual create, replay, Secretary update and private comment round trip through HTTP and PostgreSQL', async ({
  page,
}) => {
  const data = await login(page, 'AGENT');
  const headers = {
    Origin: origin,
    'X-CSRF-Token': data.csrfToken,
    'Idempotency-Key': randomUUID(),
  };
  const payload = {
    title: 'งานทดสอบ HTTP',
    description: 'Synthetic API integration',
    category: 'วันเกิดตัวแทนและลูกค้า',
    priority: 'Normal',
    dueDate: '2026-11-06',
    agentId: rid(3),
    role: 'Admin',
    status: 'Completed',
  };
  const created = await page.request.post('/api/tasks', { headers, data: payload });
  expect(created.status()).toBe(200);
  const result = await created.json();
  expect(result.state).toBe('completed');
  const replay = await page.request.post('/api/tasks', { headers, data: payload });
  expect(await replay.json()).toEqual(result);
  const own = await (await page.request.get('/api/tasks/' + result.id)).json();
  expect(own.task.agentId).toBe(rid(2));
  expect(own.task.status).toBe('New');
  expect(own.updates).toHaveLength(1);
  const other = await login(page, 'OTHER');
  expect((await page.request.get('/api/tasks/' + result.id)).status()).toBe(403);
  expect((await page.request.get('/api/operations/' + result.operationId)).status()).toBe(404);
  expect(other.user.id).toBe(rid(3));
  const manager = await login(page, 'SECRETARY');
  const managerHeaders = {
    Origin: origin,
    'X-CSRF-Token': manager.csrfToken,
    'Idempotency-Key': randomUUID(),
  };
  const incomplete = await page.request.post('/api/tasks/' + result.id + '/status', {
    headers: { ...managerHeaders, 'Idempotency-Key': randomUUID() },
    data: { status: 'Completed', version: own.task.version },
  });
  expect(incomplete.status()).toBe(409);
  const caseView = (await (await page.request.get('/api/tasks/' + result.id)).json()).caseWorkflow;
  for (const item of Object.values(caseView.state.items) as { status: string; notes: string }[]) {
    item.status = 'done';
    item.notes = 'PRIVATE-CHECKLIST-NOTE';
  }
  caseView.state.fields.birthdayDate = '2026-11-10';
  caseView.state.fields.greetingDate = '2026-11-10';
  expect(
    (
      await page.request.post('/api/tasks/' + result.id + '/workflow', {
        headers: { ...managerHeaders, 'Idempotency-Key': randomUUID() },
        data: { version: caseView.version, state: caseView.state },
      })
    ).status(),
  ).toBe(200);
  const updated = await page.request.post('/api/tasks/' + result.id + '/status', {
    headers: managerHeaders,
    data: { status: 'Completed', version: own.task.version, message: 'ดำเนินการแล้ว' },
  });
  expect(updated.status()).toBe(200);
  const commented = await page.request.post('/api/tasks/' + result.id + '/comments', {
    headers: { ...managerHeaders, 'Idempotency-Key': randomUUID() },
    data: { message: 'PRIVATE-HTTP-NOTE', visible: false },
  });
  expect(commented.status()).toBe(200);
  await login(page, 'AGENT');
  const after = await (await page.request.get('/api/tasks/' + result.id)).json();
  expect(after.task.status).toBe('Completed');
  expect(JSON.stringify(after)).not.toContain('PRIVATE-HTTP-NOTE');
  expect(JSON.stringify(after)).not.toContain('PRIVATE-CHECKLIST-NOTE');
  expect(after.caseWorkflow.state).toBeUndefined();
  expect(after.followups).toEqual([]);
});

test('actual ambiguous write returns review and persists its idempotency key', async ({ page }) => {
  const data = await login(page, 'AGENT');
  const headers = {
    Origin: origin,
    'X-CSRF-Token': data.csrfToken,
    'Idempotency-Key': randomUUID(),
  };
  const payload = {
    title: 'TEST_UNCERTAIN',
    description: 'Synthetic failure',
    category: 'วันเกิดตัวแทนและลูกค้า',
    priority: 'Normal',
    dueDate: '2026-11-06',
  };
  const response = await page.request.post('/api/tasks', { headers, data: payload });
  expect(response.status()).toBe(202);
  const review = await response.json();
  expect(review.state).toBe('review');
  const retry = await page.request.post('/api/tasks', { headers, data: payload });
  expect(await retry.json()).toEqual(review);
  const status = await (await page.request.get('/api/operations/' + review.operationId)).json();
  expect(status.state).toBe('review');
  expect(status.payload).toBeUndefined();
  const tasks = await (await page.request.get('/api/bootstrap')).json();
  const unfinished = tasks.tasks.find((task: { title: string }) => task.title === 'TEST_UNCERTAIN');
  expect(unfinished).toBeTruthy();
  const comment = await page.request.post('/api/tasks/' + unfinished.id + '/comments', {
    headers: { ...headers, 'Idempotency-Key': randomUUID() },
    data: { message: 'Must wait until create audit is confirmed' },
  });
  expect(comment.status()).toBe(409);
  expect((await comment.json()).error.code).toBe('TASK_INITIALIZING');
});

test('context bootstrap omits task lists and full bootstrap returns summaries without detail fields', async ({
  page,
}) => {
  await login(page, 'SECRETARY');
  const response = await page.request.get('/api/bootstrap?scope=context');
  expect(response.status()).toBe(200);
  const context = await response.json();
  expect(context.tasksIncluded).toBe(false);
  expect(context.tasks).toEqual([]);
  expect(context.users.some((user: { id: string }) => user.id === rid(2))).toBe(true);
  expect(context.users.every((user: object) => !('email' in user) && !('sub' in user))).toBe(true);
  const full = await (await page.request.get('/api/bootstrap')).json();
  expect(full.tasksIncluded).toBe(true);
  expect(full.tasks.length).toBeGreaterThan(0);
  for (const task of full.tasks) {
    expect(task.description).toBeDefined();
    expect(task.attachments).toBeUndefined();
    expect(task.referenceUrl).toBeUndefined();
    expect(task.version).toBeUndefined();
  }
  expect((await page.request.get('/api/bootstrap?scope=admin')).status()).toBe(422);
});
