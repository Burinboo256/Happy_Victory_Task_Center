import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, repository, config, rid } from '../fixtures';
import {
  caseDefinitions,
  newCaseState,
  validateCaseState,
  caseSummary,
} from '../../src/domain/case-workflow';
import {
  readCaseWorkflow,
  saveCaseWorkflow,
  requireCaseComplete,
  attachCaseSummaries,
} from '../../src/server/services/case-workflow';
import { ownTask } from '../../src/server/services/reads';
test('all four checklists preserve mandatory items, conditional skips, dates and exact case fields', () => {
  assert.equal(Object.keys(caseDefinitions).length, 4);
  for (const category of Object.keys(caseDefinitions)) {
    const s = newCaseState(category);
    assert.doesNotThrow(() => validateCaseState(s));
    assert.equal(caseSummary(s).complete, false);
    const first = Object.keys(s.items)[0];
    delete s.items[first];
    assert.throws(() => validateCaseState(s));
  }
  const s = newCaseState('ลูกค้าใหม่');
  s.items['application-9'].status = 'na';
  assert.doesNotThrow(() => validateCaseState(s));
  s.items['application-1'].status = 'na';
  s.items['application-1'].notes = 'ไม่อยากทำ';
  assert.throws(() => validateCaseState(s));
  s.items['application-1'].status = 'pending';
  s.fields.submittedDate = '2026-02-30';
  assert.throws(() => validateCaseState(s));
});

test('optional and conditional items need no hidden reason in every category while required items cannot be skipped', () => {
  const agent = newCaseState('ตัวแทนใหม่');
  agent.items['continue-1'].status = 'na';
  agent.items['develop-1'].status = 'na';
  assert.doesNotThrow(() => validateCaseState(agent));
  agent.items['prepare-1'].status = 'na';
  assert.throws(() => validateCaseState(agent));
  for (const [category, id] of [
    ['ตัวแทนเก่า', 'retain-4'],
    ['ลูกค้าใหม่', 'application-9'],
    ['ลูกค้าเก่า', 'renewal-5'],
  ]) {
    const state = newCaseState(category);
    state.items[id].status = 'na';
    assert.doesNotThrow(() => validateCaseState(state));
    const required = caseDefinitions[category].sections
      .flatMap((s) => s.items)
      .find((i) => i.required && !i.skippable);
    assert.ok(required);
    state.items[required.id].status = 'na';
    assert.throws(() => validateCaseState(state));
  }
});
test('new Agent closes after required registration steps, continues optional work after closing, keeps legacy history and rejects stale/cross-role writes', async () => {
  const { db, engine } = await database(),
    h = repository();
  h.tables.tasks[0].fields.Category = 'ตัวแทนใหม่';
  try {
    const task = await ownTask(h.repo, h.secretary, rid(11)),
      state = newCaseState(task.category);
    for (const item of caseDefinitions[task.category].sections
      .flatMap((s) => s.items)
      .filter((i) => i.required))
      state.items[item.id].status = 'done';
    state.fields.applicationMode = 'สอบอย่างเดียว';
    state.fields.agentCode = 'TEST-001';
    state.items['continue-1'].followupDate = '2026-11-20';
    state.items['continue-1'].notes = 'PRIVATE CLASS NOTE';
    assert.equal(caseSummary(state).complete, true);
    assert.equal(state.items['continue-1'].status, 'pending');
    await assert.rejects(requireCaseComplete(db, config, h.repo, h.secretary, task.id));
    const key = 'web:' + randomUUID(),
      input = { version: 0, state };
    await assert.rejects(saveCaseWorkflow(db, config, h.repo, h.agent, task.id, input, key));
    await db.query(
      'INSERT INTO hvr_workflows(environment,resource,version,payload,operation_key) VALUES($1,$2,1,$3,$4)',
      [config.APP_ENV, 'task:' + task.id, JSON.stringify({ legacy: 'preserved' }), 'legacy-test'],
    );
    await saveCaseWorkflow(db, config, h.repo, h.secretary, task.id, input, key);
    await saveCaseWorkflow(db, config, h.repo, h.secretary, task.id, input, key);
    assert.equal((await readCaseWorkflow(db, config, task, true))?.version, 1);
    assert.deepEqual(
      (await db.query('SELECT payload FROM hvr_workflows WHERE resource=$1', ['task:' + task.id]))
        .rows[0].payload,
      { legacy: 'preserved' },
    );
    await assert.rejects(
      saveCaseWorkflow(db, config, h.repo, h.secretary, task.id, input, 'web:' + randomUUID()),
      /โหลดใหม่/,
    );
    await requireCaseComplete(db, config, h.repo, h.secretary, task.id);
    const agent = await readCaseWorkflow(db, config, task, false);
    assert.equal(agent?.state, undefined);
    assert.equal(JSON.stringify(agent).includes('PRIVATE'), false);
    assert.deepEqual(agent?.summary.pending, []);
    h.tables.tasks[0].fields.Status = 'Completed';
    task.status = 'Completed';
    const list = await attachCaseSummaries(db, config, [task]);
    assert.equal(list[0].continuingFollowup, true);
    assert.equal(list[0].followupDate, '2026-11-20');
    state.items['continue-1'].status = 'done';
    await saveCaseWorkflow(
      db,
      config,
      h.repo,
      h.secretary,
      task.id,
      { version: 1, state },
      'web:' + randomUUID(),
    );
    state.items['prepare-1'].status = 'pending';
    await assert.rejects(
      saveCaseWorkflow(
        db,
        config,
        h.repo,
        h.secretary,
        task.id,
        { version: 2, state },
        'web:' + randomUUID(),
      ),
      /หลังปิดงาน/,
    );
    assert.equal(
      (
        await db.query('SELECT count(*)::int AS n FROM hvr_workflow_history WHERE resource=$1', [
          'case:' + task.id,
        ])
      ).rows[0].n,
      2,
    );
  } finally {
    await engine.close();
  }
});
