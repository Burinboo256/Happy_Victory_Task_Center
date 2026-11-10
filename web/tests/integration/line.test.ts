import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { database, repository, config, rid } from '../fixtures';
import { Journal } from '../../src/server/operations/journal';
import { mutate } from '../../src/server/services/mutations';
import {
  startLink,
  receiveWebhook,
  linkCandidate,
  confirmLink,
  setRecipient,
  disconnectLine,
} from '../../src/server/line/accounts';
import { verifySignature } from '../../src/server/line/client';
import { drainLineQueue } from '../../src/server/line/queue';

const lineUser = 'U' + '1'.repeat(32),
  bot = 'U' + 'a'.repeat(32);
const enabledConfig = {
  ...config,
  ENABLE_LINE_NOTIFICATIONS: true,
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token-only-never-live',
  LINE_CHANNEL_SECRET: 'test-secret-never-live',
  LINE_OA_ID: '@test',
  LINE_BOT_USER_ID: bot,
};
const payload = {
  title: 'ทดสอบงานใหม่',
  description: 'PRIVATE description not for LINE',
  priority: 'Urgent',
  category: 'ตัวแทนใหม่',
  dueDate: '2026-11-12',
  referenceUrl: '',
};
const profile: typeof fetch = async () =>
  Response.json({ userId: lineUser, displayName: 'เลขาทดสอบ' });
const event = (text: string, userId = lineUser, type = 'user') => ({
  destination: bot,
  events: [
    {
      type: 'message',
      timestamp: Date.now(),
      source: { type, userId },
      message: { type: 'text', text },
    },
  ],
});

test('Secretary LINE linking requires signed direct messages, explicit confirmation and Admin approval; codes cannot be replayed', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const raw = JSON.stringify(event('hello'));
    const signature = createHmac('sha256', enabledConfig.LINE_CHANNEL_SECRET)
      .update(raw)
      .digest('base64');
    verifySignature(raw, signature, enabledConfig.LINE_CHANNEL_SECRET);
    assert.throws(() => verifySignature(raw + ' ', signature, enabledConfig.LINE_CHANNEL_SECRET));
    assert.throws(() => verifySignature(raw, null, enabledConfig.LINE_CHANNEL_SECRET));
    await assert.rejects(startLink(db, enabledConfig, { ...h.agent, role: 'Admin' }));
    const { code } = await startLink(db, enabledConfig, h.secretary);
    await receiveWebhook(db, enabledConfig, event(code, lineUser, 'group'));
    assert.equal(await linkCandidate(db, enabledConfig, h.secretary), null);
    await receiveWebhook(db, enabledConfig, event(code));
    await receiveWebhook(db, enabledConfig, event(code, 'U' + '2'.repeat(32)));
    assert.equal(await linkCandidate(db, enabledConfig, h.secretary), lineUser);
    assert.equal((await db.query('SELECT * FROM hvr_line_accounts')).rows.length, 0);
    await confirmLink(db, enabledConfig, h.secretary, lineUser, profile);
    const account = (await db.query('SELECT * FROM hvr_line_accounts')).rows[0];
    assert.equal(account.enabled, false);
    await assert.rejects(confirmLink(db, enabledConfig, h.secretary, lineUser, profile));
    await assert.rejects(
      setRecipient(db, enabledConfig, h.repo, h.secretary, h.secretary.id, account.binding, true),
    );
    await setRecipient(
      db,
      enabledConfig,
      h.repo,
      { ...h.secretary, role: 'Admin' },
      h.secretary.id,
      account.binding,
      true,
    );
    await receiveWebhook(db, enabledConfig, {
      destination: bot,
      events: [
        {
          type: 'unfollow',
          timestamp: Date.now() + 1000,
          source: { type: 'user', userId: lineUser },
        },
      ],
    });
    assert.equal((await db.query('SELECT enabled FROM hvr_line_accounts')).rows[0].enabled, false);
    const expired = await startLink(db, enabledConfig, h.secretary);
    await db.query("UPDATE hvr_line_links SET expires_at=clock_timestamp()-interval '1 minute'");
    await receiveWebhook(db, enabledConfig, event(expired.code));
    assert.equal(await linkCandidate(db, enabledConfig, h.secretary), undefined);
  } finally {
    await engine.close();
  }
});

test('completed task commits one outbox per approved recipient; no historical, failed or disabled tasks; send timeout retries identical payload/key', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const journal = new Journal(db, config);
    const create = (key: string) =>
      journal.execute(h.agent.id, key, 'create', payload, 'create:' + key, (steps) =>
        mutate(h.repo, h.agent, 'create', payload, steps),
      );
    const old = randomUUID();
    await create(old);
    await db.query('INSERT INTO hvr_line_settings(environment,enabled) VALUES($1,true)', [
      config.APP_ENV,
    ]);
    await db.query(
      'INSERT INTO hvr_line_accounts(environment,user_id,line_id,display_name,enabled) VALUES($1,$2,$3,$4,true)',
      [config.APP_ENV, h.secretary.id, lineUser, 'เลขา'],
    );
    await create(old);
    assert.equal((await db.query('SELECT * FROM hvr_line_deliveries')).rows.length, 0);
    const incomplete = randomUUID();
    const broken = await journal.execute(
      h.agent.id,
      incomplete,
      'create',
      payload,
      'create:' + incomplete,
      async () => {
        throw new Error('simulated process failure before completion');
      },
    );
    assert.equal(broken.state, 'review');
    assert.equal((await db.query('SELECT * FROM hvr_line_deliveries')).rows.length, 0);
    const key = randomUUID();
    assert.equal((await create(key)).state, 'completed');
    await create(key);
    let rows = (await db.query('SELECT * FROM hvr_line_deliveries')).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, 'pending');
    assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
    const calls: { body: string; key: string }[] = [];
    const timeout: typeof fetch = async (_url, init) => {
      calls.push({
        body: String(init?.body),
        key: new Headers(init?.headers).get('x-line-retry-key') || '',
      });
      throw new Error('upstream could have accepted');
    };
    await drainLineQueue(db, enabledConfig, h.repo, timeout);
    assert.equal(calls.length, 1);
    rows = (await db.query('SELECT * FROM hvr_line_deliveries')).rows;
    assert.equal(rows[0].state, 'pending');
    assert.ok(rows[0].first_attempt_at);
    assert.match(calls[0].body, /#b91c1c/);
    assert.match(calls[0].body, /#a21caf/);
    assert.ok(!calls[0].body.includes('PRIVATE'));
    h.tables.users[1].fields['Full Name'] = 'Changed sender name';
    await db.query(
      "UPDATE hvr_line_deliveries SET next_attempt_at=clock_timestamp()-interval '1 second'",
    );
    const acceptedRetry: typeof fetch = async (_url, init) => {
      calls.push({
        body: String(init?.body),
        key: new Headers(init?.headers).get('x-line-retry-key') || '',
      });
      return new Response('', {
        status: 409,
        headers: { 'x-line-accepted-request-id': 'accepted-id' },
      });
    };
    await drainLineQueue(db, enabledConfig, h.repo, acceptedRetry);
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(
      (await db.query('SELECT state FROM hvr_line_deliveries')).rows[0].state,
      'accepted',
    );
    await drainLineQueue(db, enabledConfig, h.repo, timeout);
    assert.equal(calls.length, 2);
    await db.query('UPDATE hvr_line_settings SET enabled=false');
    await create(randomUUID());
    assert.equal((await db.query('SELECT * FROM hvr_line_deliveries')).rows.length, 1);
  } finally {
    await engine.close();
  }
});

test('concurrent LINE workers claim once; rate limits back off and confirmed HTTP rejection stops automatic retry', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    await db.query('INSERT INTO hvr_line_settings(environment,enabled) VALUES($1,true)', [
      config.APP_ENV,
    ]);
    await db.query(
      'INSERT INTO hvr_line_accounts(environment,user_id,line_id,display_name,enabled) VALUES($1,$2,$3,$4,true)',
      [config.APP_ENV, h.secretary.id, lineUser, 'เลขา'],
    );
    const key = randomUUID();
    await new Journal(db, config).execute(
      h.agent.id,
      key,
      'create',
      payload,
      'create:' + key,
      async () => ({ id: rid(11) }),
    );
    let calls = 0;
    const throttled: typeof fetch = async () => {
      calls++;
      return new Response('', { status: 429 });
    };
    await Promise.all([
      drainLineQueue(db, enabledConfig, h.repo, throttled),
      drainLineQueue(db, enabledConfig, h.repo, throttled),
    ]);
    assert.equal(calls, 1);
    assert.equal(
      (await db.query('SELECT state FROM hvr_line_deliveries')).rows[0].state,
      'pending',
    );
    await drainLineQueue(db, enabledConfig, h.repo, throttled);
    assert.equal(calls, 1);
    await db.query(
      "UPDATE hvr_line_deliveries SET next_attempt_at=clock_timestamp()-interval '1 second'",
    );
    await drainLineQueue(db, enabledConfig, h.repo, async () => {
      calls++;
      return new Response('', { status: 401 });
    });
    assert.equal((await db.query('SELECT state FROM hvr_line_deliveries')).rows[0].state, 'failed');
    await drainLineQueue(db, enabledConfig, h.repo, throttled);
    assert.equal(calls, 2);
  } finally {
    await engine.close();
  }
});

test('LINE dispatch recovers expired leases, never retries past dedup window, checks current permissions and ignores disabled config', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    await db.query('INSERT INTO hvr_line_settings(environment,enabled) VALUES($1,true)', [
      config.APP_ENV,
    ]);
    await db.query(
      'INSERT INTO hvr_line_accounts(environment,user_id,line_id,display_name,enabled) VALUES($1,$2,$3,$4,true)',
      [config.APP_ENV, h.secretary.id, lineUser, 'เลขา'],
    );
    const create = async () => {
      const key = randomUUID();
      return new Journal(db, config).execute(
        h.agent.id,
        key,
        'create',
        payload,
        'create:' + key,
        async () => ({ id: rid(11) }),
      );
    };
    await create();
    let calls = 0;
    const push: typeof fetch = async () => {
      calls++;
      return new Response('{}');
    };
    await drainLineQueue(db, config, h.repo, push);
    assert.equal(calls, 0);
    await db.query(
      "UPDATE hvr_line_deliveries SET state='sending',first_attempt_at=clock_timestamp()-interval '24 hours',lease_until=clock_timestamp()-interval '1 minute'",
    );
    await drainLineQueue(db, enabledConfig, h.repo, push);
    assert.equal(calls, 0);
    assert.equal((await db.query('SELECT state FROM hvr_line_deliveries')).rows[0].state, 'review');
    await create();
    await db.query(
      "UPDATE hvr_line_deliveries SET state='sending',lease_until=clock_timestamp()-interval '1 minute' WHERE state='pending'",
    );
    await drainLineQueue(db, enabledConfig, h.repo, push);
    assert.equal(calls, 1);
    await create();
    h.tables.users[0].fields.Active = false;
    await drainLineQueue(db, enabledConfig, h.repo, push);
    assert.equal(calls, 1);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM hvr_line_deliveries WHERE state='cancelled'"))
        .rows[0].n,
      1,
    );
    h.tables.users[0].fields.Active = true;
    await create();
    await disconnectLine(db, enabledConfig, h.secretary);
    await drainLineQueue(db, enabledConfig, h.repo, push);
    assert.equal(calls, 1);
  } finally {
    await engine.close();
  }
});
