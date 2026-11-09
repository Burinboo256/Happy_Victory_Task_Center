import test from 'node:test';
import assert from 'node:assert/strict';
import { registerAgent } from '../../src/server/auth/registration';
import { findIdentity } from '../../src/server/auth/identity';
import { createSession, authenticate } from '../../src/server/auth/session';
import { registrationSchema } from '../../src/domain/registration';
import { UncertainWrite } from '../../src/server/errors';
import { database, repository, config } from '../fixtures';

const identity = { sub: 'new-google-agent', email: 'new-agent@gmail.com', email_verified: true };
const profile = { fullName: 'ตัวแทน ทดสอบ', agentCode: 'AG-1234', phone: '0812345678' };
test('registration creates only an inactive Agent; approval enables login and retries preserve approved data', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    assert.equal(await registerAgent(h.repo, db, config, identity, profile), 'pending');
    const row = h.tables.users.at(-1);
    assert.ok(row);
    assert.equal(row.fields.Role, 'Agent');
    assert.equal(row.fields.Active, false);
    assert.equal(row.fields.Phone, profile.phone);
    assert.equal(row.fields['Agent Code'], profile.agentCode);
    assert.equal(row.fields['Google Subject'], identity.sub);
    assert.equal((await db.query('SELECT * FROM hvr_sessions')).rows.length, 0);
    await assert.rejects(findIdentity(h.repo, db, config, identity));
    assert.equal(
      await registerAgent(h.repo, db, config, identity, { ...profile, fullName: 'Changed' }),
      'pending',
    );
    assert.equal(row.fields['Full Name'], profile.fullName);
    row.fields.Active = true;
    const user = await findIdentity(h.repo, db, config, identity);
    const session = await createSession(db, config, user);
    assert.equal((await authenticate(db, h.repo, config, session.token)).user.role, 'Agent');
    row.fields.Role = 'Secretary';
    assert.equal(await registerAgent(h.repo, db, config, identity, profile), 'existing');
    assert.equal(row.fields.Role, 'Secretary');
    assert.equal(row.fields.Active, true);
    assert.equal(h.calls.filter((c) => c === 'upsert:users').length, 1);
    row.fields.Active = false;
    await assert.rejects(authenticate(db, h.repo, config, session.token));
  } finally {
    await engine.close();
  }
});
test('concurrent verified registrations and ambiguous writes cannot issue duplicate or repeated user writes', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    const outcomes = await Promise.all([
      registerAgent(h.repo, db, config, identity, profile),
      registerAgent(h.repo, db, config, identity, profile),
    ]);
    assert.ok(outcomes.includes('pending'));
    assert.equal(h.calls.filter((c) => c === 'upsert:users').length, 1);
    let writes = 0;
    const broken = {
      ...h.repo,
      async upsert() {
        writes++;
        throw new UncertainWrite();
      },
    };
    const second = { ...identity, sub: 'other-new', email: 'other-new@gmail.com' };
    assert.equal(await registerAgent(broken, db, config, second, profile), 'review');
    assert.equal(await registerAgent(broken, db, config, second, profile), 'review');
    assert.equal(writes, 1);
    assert.equal(
      await registerAgent(h.repo, db, config, { ...second, sub: 'replaced-subject' }, profile),
      'review',
    );
    assert.equal(h.calls.filter((c) => c === 'upsert:users').length, 1);
  } finally {
    await engine.close();
  }
});
test('registration rejects unverified identity, replaced binding, forged privileges and maintenance', async () => {
  const { db, engine } = await database(),
    h = repository();
  try {
    for (const bad of [
      { ...identity, email_verified: false },
      { ...identity, sub: '' },
      { ...identity, email: 'unmanaged@example.test' },
    ])
      await assert.rejects(registerAgent(h.repo, db, config, bad, profile));
    await assert.rejects(
      registerAgent(h.repo, db, config, { ...identity, email: 'agent-a@gmail.com' }, profile),
    );
    for (const fields of [
      { Active: true },
      { Role: 'Admin' },
      { email: 'forged@gmail.com' },
      { phone: '123' },
      { agentCode: '<script>' },
    ])
      assert.equal(registrationSchema.safeParse({ ...profile, ...fields }).success, false);
    await db.query('UPDATE hvr_runtime SET task_writes=false');
    await assert.rejects(registerAgent(h.repo, db, config, identity, profile), /พักการบันทึก/);
    assert.equal(h.calls.filter((c) => c === 'upsert:users').length, 0);
  } finally {
    await engine.close();
  }
});
