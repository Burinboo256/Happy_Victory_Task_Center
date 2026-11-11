import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, repository, config, rid } from '../fixtures';
import { createSession, authenticate, revokeSession } from '../../src/server/auth/session';
import { findIdentity } from '../../src/server/auth/identity';
import { requireWrites, runtimeState } from '../../src/server/runtime';
import { Journal } from '../../src/server/operations/journal';
import { AppError, UncertainWrite } from '../../src/server/errors';
import { mutate } from '../../src/server/services/mutations';

test('session expiry, role revocation and logout use persisted PostgreSQL state', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const session = await createSession(db, config, h.agent);
    assert.equal((await authenticate(db, h.repo, config, session.token)).user.id, h.agent.id);
    h.tables.users[1].fields.Role = 'Secretary';
    assert.equal((await authenticate(db, h.repo, config, session.token)).user.role, 'Secretary');
    h.tables.users[1].fields.Active = false;
    await assert.rejects(authenticate(db, h.repo, config, session.token));
    h.tables.users[1].fields.Active = true;
    await db.query("UPDATE hvr_sessions SET expires_at=clock_timestamp()-interval '1 second'");
    await assert.rejects(authenticate(db, h.repo, config, session.token));
    const second = await createSession(db, config, h.agent);
    await revokeSession(db, config, second.token);
    await assert.rejects(authenticate(db, h.repo, config, second.token));
    assert.equal(
      (await db.query('SELECT token_hash FROM hvr_sessions')).rows.some(
        (r) => r.token_hash === session.token,
      ),
      false,
    );
  } finally {
    await engine.close();
  }
});
test('runtime configuration and database switch must both allow writes; wrong base fails closed', async () => {
  const { db, engine } = await database();
  try {
    await requireWrites(db, config);
    assert.equal((await runtimeState(db, { ...config, TASK_WRITES_ENABLED: false })).writes, false);
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    await assert.rejects(requireWrites(db, config), /พักการบันทึก/);
    await db.query("UPDATE hvr_instances SET base_id='appOTHER0000000000'");
    await assert.rejects(runtimeState(db, config), /ไม่ตรงกับระบบ/);
  } finally {
    await engine.close();
  }
});
test('first identity binding refuses duplicate email, unverified identity and replacement subject', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    await assert.rejects(
      findIdentity(h.repo, db, config, {
        sub: 'agent-a',
        email: 'agent-a@gmail.com',
        email_verified: false,
      }),
    );
    h.tables.users[1].fields['Google Subject'] = '';
    await findIdentity(h.repo, db, config, {
      sub: 'agent-a',
      email: 'agent-a@gmail.com',
      email_verified: true,
    });
    assert.equal(h.tables.users[1].fields['Google Subject'], 'agent-a');
    h.tables.users[1].fields['Google Subject'] = '';
    await assert.rejects(
      findIdentity(h.repo, db, config, {
        sub: 'attacker',
        email: 'agent-a@gmail.com',
        email_verified: true,
      }),
    );
    h.tables.users.push({ id: rid(4), fields: { ...h.tables.users[1].fields } });
    await assert.rejects(
      findIdentity(h.repo, db, config, {
        sub: 'agent-a',
        email: 'agent-a@gmail.com',
        email_verified: true,
      }),
    );
  } finally {
    await engine.close();
  }
});
test('journal replay persists across service instances and rejects changed payload', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const request = randomUUID(),
      data = {
        title: 'Test',
        description: 'Details',
        caseName: 'บุคคลสมมติ ทดสอบ',
        dueDate: '2026-11-06',
        category: 'ลูกค้าเก่า',
        priority: 'Normal',
      };
    const perform = (journal: Journal, payload = data) =>
      journal.execute(h.agent.id, request, 'create', payload, 'new:' + request, (steps) =>
        mutate(h.repo, h.agent, 'create', payload, steps),
      );
    const first = await perform(new Journal(db, config));
    assert.equal(first.state, 'completed');
    const writes = h.calls.filter((c) => c.startsWith('upsert:')).length;
    assert.deepEqual(await perform(new Journal(db, config)), first);
    assert.equal(h.calls.filter((c) => c.startsWith('upsert:')).length, writes);
    await assert.rejects(
      perform(new Journal(db, config), { ...data, title: 'Changed' }),
      /ข้อมูลเปลี่ยน/,
    );
  } finally {
    await engine.close();
  }
});
test('partial audit failure resumes completed task step without creating another task', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const original = h.repo.upsert;
    let fail = true;
    h.repo.upsert = async (...args) => {
      if (args[0] === 'updates' && fail) {
        fail = false;
        throw new AppError(503, 'AIRTABLE_BUSY', 'retry', 1);
      }
      return original(...args);
    };
    const key = randomUUID(),
      data = {
        title: 'Test',
        description: 'Details',
        caseName: 'บุคคลสมมติ ทดสอบ',
        dueDate: '2026-11-06',
        category: 'ลูกค้าเก่า',
        priority: 'Normal',
      };
    const run = () =>
      new Journal(db, config).execute(h.agent.id, key, 'create', data, 'new:' + key, (steps) =>
        mutate(h.repo, h.agent, 'create', data, steps),
      );
    assert.equal((await run()).state, 'pending');
    await db.query("UPDATE hvr_operations SET retry_at=clock_timestamp()-interval '1 second'");
    assert.equal((await run()).state, 'completed');
    assert.equal(h.tables.tasks.length, 3);
    assert.equal(h.tables.updates.length, 1);
    assert.equal(h.calls.filter((c) => c === 'upsert:tasks').length, 1);
  } finally {
    await engine.close();
  }
});
test('ambiguous write retains resource reservation and is never replayed on retry', async () => {
  const { db, engine } = await database();
  try {
    const key = randomUUID();
    let writes = 0;
    const run = () =>
      new Journal(db, config).execute(rid(2), key, 'status', {}, 'task:' + rid(11), (steps) =>
        steps.run('patch', async () => {
          writes++;
          throw new UncertainWrite();
        }),
      );
    assert.equal((await run()).state, 'review');
    assert.equal((await run()).state, 'review');
    assert.equal(writes, 1);
    assert.equal((await db.query('SELECT * FROM hvr_resources')).rows.length, 1);
    await assert.rejects(
      new Journal(db, config).execute(
        rid(1),
        randomUUID(),
        'status',
        {},
        'task:' + rid(11),
        async () => ({ id: rid(11) }),
      ),
      /คำขอที่ยังบันทึกไม่ครบ/,
    );
  } finally {
    await engine.close();
  }
});

test('resuming a Manager create after role downgrade cannot reuse its stored owner privilege', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const original = h.repo.upsert;
    h.repo.upsert = async (...args) => {
      if (args[0] === 'updates') throw new AppError(503, 'AIRTABLE_BUSY', 'retry', 1);
      return original(...args);
    };
    const key = randomUUID(),
      data = {
        title: 'Manager draft',
        description: 'Synthetic details',
        caseName: 'บุคคลสมมติ ทดสอบ',
        dueDate: '2026-11-06',
        category: 'ลูกค้าเก่า',
        priority: 'Normal',
        agentId: h.agent.id,
      };
    const first = await new Journal(db, config).execute(
      h.secretary.id,
      key,
      'create',
      data,
      'create:' + key,
      (steps) => mutate(h.repo, h.secretary, 'create', data, steps),
    );
    assert.equal(first.state, 'pending');
    await db.query("UPDATE hvr_operations SET retry_at=clock_timestamp()-interval '1 second'");
    const downgraded = { ...h.secretary, role: 'Agent' as const };
    const next = await new Journal(db, config).execute(
      downgraded.id,
      key,
      'create',
      data,
      'create:' + key,
      (steps) => mutate(h.repo, downgraded, 'create', data, steps),
    );
    assert.equal(next.state, 'review');
    assert.equal(h.tables.updates.length, 0);
    assert.equal(h.calls.filter((c) => c === 'upsert:tasks').length, 1);
  } finally {
    await engine.close();
  }
});
