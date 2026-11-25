import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { database, repository, config } from '../fixtures';
import { careAlerts, careRoster, saveCare } from '../../src/server/services/customer-care';
import { initialCare, alertLevel, shiftDate, nextPremium } from '../../src/domain/customer-care';
import { todayBangkok } from '../../src/domain/model';

test('annual reviews clamp leap day and customer care alerts use explicit policy dates', () => {
  const entries = initialCare('2024-02-29', '2027-02-20', '2027-03-01', '2027-10-31');
  assert.deepEqual(
    entries.map((e) => e.kind),
    ['service', 'review', 'premium', 'maturity'],
  );
  assert.equal(entries[1].due, '2027-02-28');
  assert.equal(alertLevel(entries[2], '2027-01-29'), 'ตามแผน');
  assert.equal(alertLevel(entries[2], '2027-01-30'), 'ใกล้ถึงนัด');
  assert.equal(alertLevel(entries[2], '2027-03-01'), 'วันนี้');
  assert.equal(alertLevel(entries[2], '2027-03-02'), 'เกินนัด');
});
test('care registration, history, handoff and repeat requests stay scoped to the owning agent', async () => {
  const { db, engine } = await database(),
    h = repository(),
    c = { db, config, repo: h.repo, user: h.secretary },
    other = { ...c, user: h.other },
    agent = { ...c, user: h.agent };
  try {
    const today = todayBangkok(),
      id = randomUUID();
    const create = {
      action: 'create',
      operation: id,
      agentId: h.agent.id,
      kind: 'health',
      customer: 'ลูกค้าทดลอง',
      reference: 'DEMO-CARE',
      started: today,
      premium: shiftDate(today, 10),
    };
    await assert.rejects(saveCare(other, create), { code: 'FORBIDDEN' });
    await saveCare(c, create);
    await saveCare(c, create);
    await assert.rejects(saveCare(c, { ...create, customer: 'Changed' }), {
      code: 'CARE_CONFLICT',
    });
    const [policy] = (await careRoster(agent)).policies;
    assert.equal(policy.events.length, 4);
    assert.equal((await careRoster(other)).policies.length, 0);
    assert.deepEqual(await careAlerts(other), { total: 0, late: 0 });
    assert.deepEqual(await careAlerts(agent), { total: 2, late: 0 });
    const event = policy.events.find((e) => e.kind === 'welcome');
    assert.ok(event);
    const finish = {
      action: 'finish',
      operation: randomUUID(),
      policyId: id,
      eventId: event.id,
      note: 'ต้องการคุยกับตัวแทน',
      outcome: 'handoff',
    };
    await assert.rejects(saveCare(c, finish), { code: 'CARE_DATE' });
    const handoff = { ...finish, next: shiftDate(today, 2) };
    await assert.rejects(saveCare(other, handoff), { code: 'FORBIDDEN' });
    await saveCare(c, handoff);
    await saveCare(c, handoff);
    await assert.rejects(saveCare(c, { ...handoff, operation: randomUUID() }), {
      code: 'CARE_EVENT',
    });
    const updated = (await careRoster(c)).policies[0];
    assert.equal(updated.events.filter((e) => e.recipient === 'agent').length, 1);
    assert.equal(updated.events.find((e) => e.id === event.id)?.outcome, 'handoff');
    const close = { action: 'close', operation: randomUUID(), policyId: id };
    await assert.rejects(saveCare(agent, close), { code: 'FORBIDDEN' });
    await saveCare(c, close);
    assert.equal((await careRoster(agent)).policies[0].closed, true);
    assert.deepEqual(await careAlerts(c), { total: 0, late: 0 });
  } finally {
    await engine.close();
  }
});

test('payment cycles keep the original day at month ends and leap years', () => {
  assert.equal(nextPremium('2027-01-31', '2027-01-31', 'monthly'), '2027-02-28');
  assert.equal(nextPremium('2027-02-28', '2027-01-31', 'monthly'), '2027-03-31');
  assert.equal(nextPremium('2026-11-30', '2026-11-30', 'quarterly'), '2027-02-28');
  assert.equal(nextPremium('2027-02-28', '2024-02-29', 'yearly'), '2028-02-29');
});

test('birthday, review and contractual instalments repeat after completion and preserve their cycle on retry', async () => {
  const { db, engine } = await database(),
    h = repository(),
    c = { db, config, repo: h.repo, user: h.secretary };
  const year = Number(todayBangkok().slice(0, 4)) + 1;
  const create = {
    action: 'create',
    operation: randomUUID(),
    customer: 'ตัวอย่าง',
    reference: 'RECUR',
    kind: 'life',
    agentId: h.agent.id,
    started: year + '-01-01',
    reviewDate: year + '-07-10',
    birthday: '02-29',
    frequency: 'quarterly',
    premium: year + '-01-31',
    ends: year + 1 + '-06-30',
  };
  try {
    await assert.rejects(saveCare(c, { ...create, birthday: '02-30' }));
    await assert.rejects(saveCare(c, { ...create, premium: undefined }), { code: 'CARE_DATE' });
    await saveCare(c, create);
    const policy = (await careRoster(c)).policies[0];
    assert.deepEqual(
      [policy.birthday, policy.reviewDate, policy.frequency],
      ['02-29', create.reviewDate, 'quarterly'],
    );
    const occurrences = (kind: string) => policy.events.find((e) => e.kind === kind)?.id;
    const finish = (eventId: string | undefined, outcome = 'done', next?: string) => ({
      action: 'finish',
      operation: randomUUID(),
      policyId: policy.id,
      eventId,
      outcome,
      next,
      note: '',
    });
    await saveCare(c, finish(occurrences('review')));
    await saveCare(c, finish(occurrences('birthday')));
    await saveCare(c, finish(occurrences('premium'), 'retry', year + '-02-05'));
    const retry = (await careRoster(c)).policies[0].events.find(
      (e) => !e.outcome && e.kind === 'premium',
    );
    assert.ok(retry);
    const done = finish(retry.id);
    await saveCare(c, done);
    await saveCare(c, done);
    const pending = (await careRoster(c)).policies[0].events.filter((e) => !e.outcome);
    assert.deepEqual(
      pending.filter((e) => e.kind === 'premium').map((e) => e.due),
      [year + '-04-30'],
    );
    assert.ok(pending.some((e) => e.kind === 'birthday' && e.due.startsWith(year + 1 + '-02-')));
    assert.ok(!pending.some((e) => e.kind === 'review'));
  } finally {
    await engine.close();
  }
});
