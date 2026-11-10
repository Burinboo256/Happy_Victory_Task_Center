import { test, expect } from '@playwright/test';

test('LINE HTTP settings isolate members and reject anonymous, CSRF and non-Admin administration; no secrets in state', async ({
  page,
}) => {
  const origin = 'http://127.0.0.1:4181';
  expect((await page.request.get('/api/line')).status()).toBe(401);
  expect((await page.request.get('/api/cron/line')).status()).toBe(401);
  for (const role of ['AGENT', 'SECRETARY']) {
    const token = process.env['HVR_TEST_' + role + '_TOKEN'];
    if (!token) throw new Error('Missing isolated session');
    await page
      .context()
      .addCookies([
        { name: 'hvr-session', value: token, url: origin, httpOnly: true, sameSite: 'Lax' },
      ]);
    const data = await (await page.request.get('/api/bootstrap')).json();
    const state = await page.request.get('/api/line');
    expect(state.status()).toBe(200);
    const text = await state.text();
    expect(text).not.toContain('SECRET');
    expect(JSON.parse(text).deliveries).toEqual([]);
    expect(
      JSON.parse(text).accounts.every((a: { user_id: string }) => a.user_id === data.user.id),
    ).toBe(true);
    const preference = await page.request.post('/api/line', {
      headers: { Origin: origin, 'X-CSRF-Token': data.csrfToken },
      data: {
        action: 'preference',
        binding: '00000000-0000-4000-8000-000000000001',
        enabled: true,
        userId: 'rec00000000000003',
      },
    });
    expect(preference.status()).toBe(role === 'AGENT' ? 409 : 403);
    expect(
      (
        await page.request.post('/api/line', {
          headers: { Origin: origin },
          data: { action: 'disconnect' },
        })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post('/api/line', {
          headers: { Origin: origin, 'X-CSRF-Token': data.csrfToken },
          data: { action: 'switch', enabled: true },
        })
      ).status(),
    ).toBe(403);
  }
});
