import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { Pool } from 'pg';
import { rid } from '../fixtures';

test('overlapping HTTP status changes reserve one task, reject stale retry, and preserve replay', async ({
  playwright,
}) => {
  const file = process.env.HVR_TEST_CONTROL_FILE;
  const raw = process.env.DATABASE_URL;
  const token = process.env.HVR_TEST_SECRETARY_TOKEN;
  if (!file || !/hvr_http_[a-f0-9]{32}\.json$/.test(file) || !raw?.includes('hvr_http_') || !token)
    throw new Error('Isolated HTTP suite required');
  const origin = 'http://127.0.0.1:4181';
  const db = new Pool({ connectionString: raw, max: 1 });
  const clients: APIRequestContext[] = [];
  let inFlight: ReturnType<APIRequestContext['post']> | undefined;
  try {
    await writeFile(file, '{}');
    for (let n = 0; n < 2; n++)
      clients.push(
        await playwright.request.newContext({
          baseURL: origin,
          extraHTTPHeaders: { Cookie: 'hvr-session=' + token },
        }),
      );
    const bootstrap = await clients[0].get('/api/bootstrap?scope=context');
    expect(bootstrap.status()).toBe(200);
    const context = await bootstrap.json();
    const headers = (key: string) => ({
      Origin: origin,
      'X-CSRF-Token': context.csrfToken,
      'Idempotency-Key': key,
    });
    const created = await clients[0].post('/api/tasks', {
      headers: headers(randomUUID()),
      data: {
        title: 'HTTP contention ' + randomUUID(),
        description: 'Synthetic same-task concurrency',
        caseName: 'บุคคลสมมติ ทดสอบ',
        category: 'ลูกค้าเก่า',
        priority: 'Normal',
        dueDate: '2026-11-08',
        agentId: rid(2),
      },
    });
    expect(created.status()).toBe(200);
    const { id } = await created.json();
    const detail = async () => {
      const response = await clients[0].get('/api/tasks/' + id);
      expect(response.status()).toBe(200);
      return response.json();
    };
    const initial = await detail();
    const checklist = initial.caseWorkflow.state;
    for (const item of Object.values(checklist.items) as { status: string }[]) item.status = 'done';
    checklist.fields.premium = '12000';
    checklist.fields.premiumDue = '2026-11-10';
    checklist.fields.paymentChannel = 'Synthetic bank transfer';
    checklist.fields.paymentDate = '2026-11-10';
    expect(
      (
        await clients[0].post('/api/tasks/' + id + '/workflow', {
          headers: headers(randomUUID()),
          data: { version: 0, state: checklist },
        })
      ).status(),
    ).toBe(200);
    const firstKey = randomUUID(),
      secondKey = randomUUID();
    const firstPayload = { status: 'In Progress', version: initial.task.version };
    const secondPayload = { status: 'Completed', version: initial.task.version };
    await writeFile(file, JSON.stringify({ holdTaskPatch: id }));
    inFlight = clients[0].post('/api/tasks/' + id + '/status', {
      headers: headers(firstKey),
      data: firstPayload,
    });
    await expect
      .poll(async () => readFile(file + '.held', 'utf8').catch(() => ''), {
        timeout: 10000,
      })
      .toBe(id);
    const running = await db.query('SELECT state FROM hvr_operations WHERE request_id=$1', [
      firstKey,
    ]);
    expect(running.rows[0].state).toBe('running');
    const competing = await clients[1].post('/api/tasks/' + id + '/status', {
      headers: headers(secondKey),
      data: secondPayload,
    });
    expect(competing.status()).toBe(409);
    expect((await competing.json()).error.code).toBe('RESOURCE_BUSY');
    const replayWhileRunning = await clients[1].post('/api/tasks/' + id + '/status', {
      headers: headers(firstKey),
      data: firstPayload,
    });
    expect(replayWhileRunning.status()).toBe(202);
    expect((await replayWhileRunning.json()).state).toBe('running');
    await writeFile(file + '.release', id);
    const first = await inFlight;
    await writeFile(file, '{}');
    expect(first.status()).toBe(200);
    const result = (await first.json()) as { state: string; operationId: string; id: string };
    expect(result.state).toBe('completed');
    const after = await detail();
    expect(after.task.status).toBe('In Progress');
    expect(after.updates).toHaveLength(2);
    const stale = await clients[1].post('/api/tasks/' + id + '/status', {
      headers: headers(secondKey),
      data: secondPayload,
    });
    expect(stale.status()).toBe(409);
    expect((await stale.json()).error.code).toBe('VERSION_CONFLICT');
    const fresh = await clients[1].post('/api/tasks/' + id + '/status', {
      headers: headers(randomUUID()),
      data: { status: 'Completed', version: after.task.version },
    });
    expect(fresh.status()).toBe(200);
    const completed = await detail();
    expect(completed.task.status).toBe('Completed');
    expect(completed.updates).toHaveLength(3);
    const replay = await clients[0].post('/api/tasks/' + id + '/status', {
      headers: headers(firstKey),
      data: firstPayload,
    });
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toEqual(result);
    const final = await detail();
    expect(final.task.version).toBe(completed.task.version);
    expect(final.task.completedAt).toBe(completed.task.completedAt);
    expect(final.updates).toHaveLength(3);
    expect(
      (await db.query('SELECT * FROM hvr_resources WHERE resource=$1', ['task:' + id])).rows,
    ).toEqual([]);
  } finally {
    const heldId = await readFile(file + '.held', 'utf8').catch(() => '');
    await writeFile(file + '.release', heldId);
    await writeFile(file, '{}');
    await inFlight?.catch(() => {});
    await Promise.all(clients.map((client) => client.dispose()));
    await db.end();
    await rm(file + '.held', { force: true });
    await rm(file + '.release', { force: true });
  }
});
