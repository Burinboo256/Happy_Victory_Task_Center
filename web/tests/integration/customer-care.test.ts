import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { database, repository, config } from '../fixtures';
import { careAlerts, careRoster, saveCare } from '../../src/server/services/customer-care';
import { initialCare, alertLevel, shiftDate } from '../../src/domain/customer-care';
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
