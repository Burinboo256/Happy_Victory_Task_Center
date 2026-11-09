import { test, expect, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { blankTracking, type Onboarding } from '../../src/domain/onboarding';
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
test('new-agent HTTP workflow protects roles, CSRF, histories, optimistic versions and completion through real routes', async ({
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
      title: 'NEW AGENT WORKFLOW TEST',
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
      await page.request.post(endpoint + '/onboarding', {
        headers: headers(agent.csrfToken),
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect((await page.request.get('/api/onboarding-template')).status()).toBe(403);
  let response = await (await page.request.get(endpoint)).json();
  expect(response.workflow.state).toBeUndefined();
  const manager = await login(page, 'SECRETARY');
  expect(
    (
      await page.request.post('/api/onboarding-template', {
        headers: headers(manager.csrfToken),
        data: {},
      })
    ).status(),
  ).toBe(403);
  response = await (await page.request.get(endpoint)).json();
  const state: Onboarding = response.workflow.state;
  const payload = { version: 0, templateVersion: response.workflow.templateVersion, state };
  expect(
    (
      await page.request.post(endpoint + '/onboarding', {
        headers: { Origin: origin },
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
  state.notice = { date: '2026-11-01', acknowledged: true, ...blankTracking() };
  state.training = {
    date: '2026-11-02',
    status: 'attended',
    combined: true,
    place: 'Test',
    ...blankTracking(),
  };
  state.exams = [
    { id: randomUUID(), date: '2026-11-02', status: 'failed', ...blankTracking() },
    { id: randomUUID(), date: '2026-11-03', status: 'passed', ...blankTracking() },
  ];
  state.documentsConfirmed = true;
  state.issue = {
    code: 'TEST-NEW-01',
    submittedDate: '2026-11-04',
    issuedDate: '2026-11-05',
    notes: 'PRIVATE-WORKFLOW-NOTE',
    followupDate: '',
  };
  state.modules = state.modules.map((m, i) => ({
    ...m,
    status: i === 3 ? 'booked' : 'completed',
    date: '2026-11-06',
  }));
  const saveHeaders = headers(manager.csrfToken);
  const saved = await page.request.post(endpoint + '/onboarding', {
    headers: saveHeaders,
    data: payload,
  });
  expect(saved.status()).toBe(200);
  expect((await saved.json()).state).toBe('completed');
  expect(
    (
      await page.request.post(endpoint + '/onboarding', { headers: saveHeaders, data: payload })
    ).status(),
  ).toBe(200);
  response = await (await page.request.get(endpoint)).json();
  expect(response.workflow.version).toBe(1);
  expect(response.workflow.history).toHaveLength(1);
  expect(
    (
      await page.request.post(endpoint + '/onboarding', {
        headers: headers(manager.csrfToken),
        data: payload,
      })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post(endpoint + '/onboarding', {
        headers: headers(manager.csrfToken),
        data: { ...payload, version: 1, state: { ...state, modules: state.modules.slice(0, 3) } },
      })
    ).status(),
  ).toBe(422);
  expect(
    (
      await page.request.post(endpoint + '/status', {
        headers: headers(manager.csrfToken),
        data: { status: 'Completed', version: response.task.version },
      })
    ).status(),
  ).toBe(409);
  state.modules[3].status = 'completed';
  expect(
    (
      await page.request.post(endpoint + '/onboarding', {
        headers: headers(manager.csrfToken),
        data: { ...payload, version: 1 },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post(endpoint + '/status', {
        headers: headers(manager.csrfToken),
        data: { status: 'Completed', version: response.task.version },
      })
    ).status(),
  ).toBe(200);
  await login(page, 'AGENT');
  response = await (await page.request.get(endpoint)).json();
  expect(response.workflow.summary.complete).toBe(true);
  expect(response.workflow.summary.modulesDone).toBe(4);
  expect(JSON.stringify(response)).not.toContain('PRIVATE-WORKFLOW-NOTE');
  expect(response.workflow.state).toBeUndefined();
  await login(page, 'OTHER');
  expect((await page.request.get(endpoint)).status()).toBe(403);
});
