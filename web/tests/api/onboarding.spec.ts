import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { caseDefinitions, type CaseState } from '../../src/domain/case-workflow';
const origin = 'http://127.0.0.1:4181';
async function login(page: Page, role: 'AGENT' | 'OTHER' | 'SECRETARY') {
  const token = process.env['HVR_TEST_' + role + '_TOKEN'];
  if (!token) throw Error('Missing isolated session');
  await page
    .context()
    .addCookies([
      { name: 'hvr-session', value: token, url: origin, httpOnly: true, sameSite: 'Lax' },
    ]);
  return (await page.request.get('/api/bootstrap')).json();
}
test('case workflow HTTP enforces ownership, CSRF, exact checklist, replay, stale writes and close/continue rules', async ({
  page,
}) => {
  const agent = await login(page, 'AGENT');
  const headers = (csrf: string) => ({
    Origin: origin,
    'X-CSRF-Token': csrf,
    'Idempotency-Key': randomUUID(),
  });
  const created = await page.request.post('/api/tasks', {
    headers: headers(agent.csrfToken),
    data: {
      title: 'SIX CATEGORY WORKFLOW TEST',
      description: 'Synthetic only',
      category: 'ตัวแทนใหม่',
      priority: 'Normal',
      dueDate: '2026-11-10',
    },
  });
  expect(created.status()).toBe(200);
  const { id } = await created.json(),
    endpoint = '/api/tasks/' + id;
  expect(
    (
      await page.request.post(endpoint + '/workflow', {
        headers: headers(agent.csrfToken),
        data: {},
      })
    ).status(),
  ).toBe(403);
  let response = await (await page.request.get(endpoint)).json();
  expect(response.caseWorkflow.state).toBeUndefined();
  await login(page, 'OTHER');
  expect((await page.request.get(endpoint)).status()).toBe(403);
  const manager = await login(page, 'SECRETARY');
  response = await (await page.request.get(endpoint)).json();
  const state: CaseState = response.caseWorkflow.state;
  const payload = { version: 0, state };
  expect(
    (
      await page.request.post(endpoint + '/workflow', {
        headers: { Origin: origin, 'Idempotency-Key': randomUUID() },
        data: payload,
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post(endpoint + '/status', {
        headers: headers(manager.csrfToken),
        data: { status: 'Completed', version: response.task.version },
      })
    ).status(),
  ).toBe(409);
  const invalid = structuredClone(payload);
  delete invalid.state.items['prepare-1'];
  expect(
    (
      await page.request.post(endpoint + '/workflow', {
        headers: headers(manager.csrfToken),
        data: invalid,
      })
    ).status(),
  ).toBe(422);
  for (const item of caseDefinitions['ตัวแทนใหม่'].sections
    .flatMap((s) => s.items)
    .filter((i) => i.required))
    state.items[item.id].status = 'done';
  state.fields.applicationMode = 'อบรมพร้อมสอบ';
  state.fields.agentCode = 'SYNTHETIC-001';
  state.items['continue-1'].notes = 'PRIVATE-WORKFLOW-NOTE';
  state.items['continue-1'].followupDate = '2026-11-20';
  const saveHeaders = headers(manager.csrfToken);
  const saved = await page.request.post(endpoint + '/workflow', {
    headers: saveHeaders,
    data: payload,
  });
  expect(saved.status()).toBe(200);
  expect(
    await (
      await page.request.post(endpoint + '/workflow', { headers: saveHeaders, data: payload })
    ).json(),
  ).toEqual(await saved.json());
  expect(
    (
      await page.request.post(endpoint + '/workflow', {
        headers: headers(manager.csrfToken),
        data: payload,
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post(endpoint + '/status', {
        headers: headers(manager.csrfToken),
        data: { status: 'Completed', version: response.task.version },
      })
    ).status(),
  ).toBe(200);
  state.items['continue-1'].status = 'done';
  expect(
    (
      await page.request.post(endpoint + '/workflow', {
        headers: headers(manager.csrfToken),
        data: { version: 1, state },
      })
    ).status(),
  ).toBe(200);
  state.items['prepare-1'].status = 'pending';
  expect(
    (
      await page.request.post(endpoint + '/workflow', {
        headers: headers(manager.csrfToken),
        data: { version: 2, state },
      })
    ).status(),
  ).toBe(409);
  await login(page, 'AGENT');
  response = await (await page.request.get(endpoint)).json();
  expect(response.task.status).toBe('Completed');
  expect(response.caseWorkflow.state).toBeUndefined();
  expect(response.caseWorkflow.history).toBeUndefined();
  expect(JSON.stringify(response)).not.toContain('PRIVATE-WORKFLOW-NOTE');
});
