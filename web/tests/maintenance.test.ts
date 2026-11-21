import assert from 'node:assert/strict';
import test from 'node:test';
import { proxy } from '../src/proxy';

test('maintenance stops login, callbacks, webhooks, task writes and server actions', async () => {
  const previous = process.env.MAINTENANCE_MODE;
  process.env.MAINTENANCE_MODE = 'true';
  try {
    for (const [path, method] of [
      ['/api/auth/google', 'GET'],
      ['/api/auth/google/callback?code=secret&state=secret', 'GET'],
      ['/api/auth/register', 'POST'],
      ['/api/tasks', 'POST'],
      ['/api/ai/line', 'POST'],
      ['/api/ai/reply', 'POST'],
      ['/api/line/webhook', 'POST'],
      ['/api/health', 'POST'],
      ['/tasks/new', 'POST'],
      ['/api/health/not-a-health-check', 'GET'],
    ]) {
      const response = proxy(new Request('https://example.test' + path, { method }));
      assert.equal(response.status, 503, path);
      assert.equal(response.headers.get('Retry-After'), '300');
      assert.match(response.headers.get('Cache-Control') || '', /no-store/);
      assert.equal(response.headers.get('x-middleware-next'), null);
      const body = await response.json();
      assert.equal(body.error.code, 'MAINTENANCE');
      assert.ok(!JSON.stringify(body).includes('secret'));
    }
    const page = proxy(new Request('https://example.test/tasks/new'));
    assert.equal(page.status, 503);
    assert.match(await page.text(), /ระบบกำลังปรับปรุง/);
    for (const path of ['/api/health', '/_next/static/chunks/main.js', '/favicon.ico']) {
      assert.equal(
        proxy(new Request('https://example.test' + path)).headers.get('x-middleware-next'),
        '1',
      );
    }
  } finally {
    if (previous === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = previous;
  }
});

test('normal deployments do not block application requests', () => {
  const previous = process.env.MAINTENANCE_MODE;
  try {
    for (const value of [undefined, 'false']) {
      if (value === undefined) delete process.env.MAINTENANCE_MODE;
      else process.env.MAINTENANCE_MODE = value;
      assert.equal(
        proxy(new Request('https://example.test/api/ai/line', { method: 'POST' })).headers.get(
          'x-middleware-next',
        ),
        '1',
      );
    }
  } finally {
    if (previous === undefined) delete process.env.MAINTENANCE_MODE;
    else process.env.MAINTENANCE_MODE = previous;
  }
});
