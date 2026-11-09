import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { database, repository, config, rid } from '../fixtures';
import {
  readWorkflow,
  readTemplate,
  saveWorkflow,
  saveTemplate,
  requireWorkflowComplete,
  attachWorkflowSummaries,
} from '../../src/server/services/onboarding';
import {
  workflowSchema,
  defaultTemplate,
  newWorkflow,
  workflowSummary,
  blankTracking,
} from '../../src/domain/onboarding';
import { bootstrap } from '../../src/server/services/reads';
import { Journal } from '../../src/server/operations/journal';

test('new-agent workflow enforces completion prerequisites, valid dates and all modules', () => {
  const state = newWorkflow(defaultTemplate);
  assert.equal(workflowSummary(state).complete, false);
  state.issue.code = 'NEW-001';
  assert.equal(workflowSchema.safeParse(state).success, false);
  state.issue.code = '';
  state.modules[0].date = '2026-02-30';
  assert.equal(workflowSchema.safeParse(state).success, false);
  state.modules[0].date = '2026-11-10';
  state.modules[0].status = 'booked';
  assert.equal(workflowSummary(state).nextDate, '2026-11-10');
  state.modules[0].status = 'completed';
  assert.equal(workflowSummary(state).nextDate, '');
});

test('workflow SQL saves atomic history, rejects stale edits and preserves retry, exam history and role boundaries', async () => {
  const { db, engine } = await database(),
    h = repository();
  h.tables.tasks[0].fields.Category = 'ตัวแทนใหม่';
  try {
    const view = await readWorkflow(db, config, rid(11), true),
      state = view.state;
    state.exams.push({
      id: randomUUID(),
      date: '2026-11-09',
      status: 'failed',
      notes: 'PRIVATE EXAM NOTE',
      followupDate: '',
    });
    state.modules[1].followupDate = '2026-11-10';
    const input = { version: 0, templateVersion: 0, state },
      key = 'web:' + randomUUID();
    await assert.rejects(saveWorkflow(db, config, h.repo, h.agent, rid(11), input, key));
    await saveWorkflow(db, config, h.repo, h.secretary, rid(11), input, key);
    await saveWorkflow(db, config, h.repo, h.secretary, rid(11), input, key);
    assert.equal((await readWorkflow(db, config, rid(11), true)).version, 1);
    assert.equal((await db.query('SELECT * FROM hvr_workflow_history')).rows.length, 1);
    await assert.rejects(
      saveWorkflow(db, config, h.repo, h.secretary, rid(11), input, 'web:' + randomUUID()),
      /โหลดใหม่/,
    );
    const agentView = await readWorkflow(db, config, rid(11), false);
    assert.equal(agentView.state, undefined);
    assert.equal(agentView.history, undefined);
    assert.ok(!JSON.stringify(agentView).includes('PRIVATE'));
    await assert.rejects(
      saveWorkflow(
        db,
        config,
        h.repo,
        h.secretary,
        rid(11),
        { ...input, version: 1, state: { ...state, modules: state.modules.slice(1) } },
        'web:' + randomUUID(),
      ),
      /Module/,
    );
    await assert.rejects(
      saveWorkflow(
        db,
        config,
        h.repo,
        h.secretary,
        rid(11),
        { ...input, version: 1, state: { ...state, exams: [] } },
        'web:' + randomUUID(),
      ),
      /ลบรอบสอบ/,
    );
    const tasks = (await bootstrap(h.repo, h.secretary)).tasks;
    const attached = await attachWorkflowSummaries(db, config, tasks);
    assert.equal(attached.find((t) => t.id === rid(11))?.followupDate, '2026-11-10');
    assert.equal(
      (
        await attachWorkflowSummaries(
          db,
          config,
          tasks.filter((t) => t.id === rid(12)),
        )
      ).length,
      1,
    );
    h.tables.tasks[0].fields.Status = 'Completed';
    await assert.rejects(
      saveWorkflow(
        db,
        config,
        h.repo,
        h.secretary,
        rid(11),
        { ...input, version: 1 },
        'web:' + randomUUID(),
      ),
      /เปิดงาน/,
    );
  } finally {
    await engine.close();
  }
});

test('Admin can rename modules without losing progress; new requirements seed future cases and Secretary cannot alter defaults', async () => {
  const { db, engine } = await database(),
    h = repository(),
    admin = { ...h.secretary, role: 'Admin' as const };
  h.tables.tasks[0].fields.Category = 'ตัวแทนใหม่';
  try {
    const first = (await readWorkflow(db, config, rid(11), true)).state;
    first.modules[0].status = 'completed';
    first.modules[0].date = '2026-11-09';
    await saveWorkflow(
      db,
      config,
      h.repo,
      h.secretary,
      rid(11),
      { version: 0, templateVersion: 0, state: first },
      'web:' + randomUUID(),
    );
    const value = await readTemplate(db, config);
    value.template.modules[0].name = 'Smart Start Official';
    value.template.modules.push({ id: randomUUID(), name: 'New module' });
    value.template.documents.push({ id: randomUUID(), name: 'Document example' });
    await assert.rejects(saveTemplate(db, config, h.secretary, value, 'web:' + randomUUID()));
    await saveTemplate(db, config, admin, value, 'web:' + randomUUID());
    const saved = await readWorkflow(db, config, rid(11), true);
    assert.equal(saved.state.modules[0].name, 'Smart Start Official');
    assert.equal(saved.state.modules[0].status, 'completed');
    assert.equal(saved.state.modules.length, 4);
    assert.equal(saved.state.documents.length, 0);
    const future = await readWorkflow(db, config, rid(12), true);
    assert.equal(future.state.modules.length, 5);
    assert.equal(future.state.documents.length, 1);
    await assert.rejects(
      saveWorkflow(
        db,
        config,
        h.repo,
        h.secretary,
        rid(11),
        { version: 1, templateVersion: 0, state: saved.state },
        'web:' + randomUUID(),
      ),
      /โหลดใหม่/,
    );
  } finally {
    await engine.close();
  }
});

test('completion guard requires exam pass, confirmed documents, issued code and every module; ordinary categories remain unchanged', async () => {
  const { db, engine } = await database(),
    h = repository();
  h.tables.tasks[0].fields.Category = 'ตัวแทนใหม่';
  try {
    await assert.rejects(
      requireWorkflowComplete(db, config, h.repo, h.secretary, rid(11)),
      /ยังปิดงานไม่ได้/,
    );
    await requireWorkflowComplete(db, config, h.repo, h.secretary, rid(12));
    const state = newWorkflow(defaultTemplate);
    state.notice = { date: '2026-11-01', acknowledged: true, ...blankTracking() };
    state.training = {
      date: '2026-11-02',
      combined: true,
      place: 'Test',
      status: 'attended',
      ...blankTracking(),
    };
    state.exams = [
      { id: randomUUID(), date: '2026-11-02', status: 'failed', ...blankTracking() },
      { id: randomUUID(), date: '2026-11-04', status: 'passed', ...blankTracking() },
    ];
    state.documents = [
      {
        id: randomUUID(),
        name: 'เอกสารทดสอบ',
        requestedDate: '2026-11-04',
        receivedDate: '2026-11-05',
        ...blankTracking(),
      },
    ];
    state.documentsConfirmed = true;
    state.issue = {
      submittedDate: '2026-11-05',
      code: 'TEST-001',
      issuedDate: '2026-11-06',
      ...blankTracking(),
    };
    state.modules = state.modules.map((m) => ({ ...m, status: 'completed', date: '2026-11-07' }));
    await saveWorkflow(
      db,
      config,
      h.repo,
      h.secretary,
      rid(11),
      { version: 0, templateVersion: 0, state },
      'web:' + randomUUID(),
    );
    await requireWorkflowComplete(db, config, h.repo, h.secretary, rid(11));
    assert.equal((await readWorkflow(db, config, rid(11), true)).state.exams.length, 2);
    // Workflow and status share the same persistent resource reservation.
    const journal = new Journal(db, config);
    await db.query(
      `INSERT INTO hvr_operations(environment,id,user_id,request_id,fingerprint,resource,action,payload,state) VALUES ($1,$2,$3,$4,'held',$5,'status','{}','running')`,
      [config.APP_ENV, ridUUID, h.secretary.id, randomUUID(), 'task:' + rid(11)],
    );
    await db.query(
      'INSERT INTO hvr_resources(environment,resource,operation_id) VALUES ($1,$2,$3)',
      [config.APP_ENV, 'task:' + rid(11), ridUUID],
    );
    await assert.rejects(
      journal.execute(
        h.secretary.id,
        randomUUID(),
        'onboarding',
        {},
        'task:' + rid(11),
        async () => {
          throw Error('must not run');
        },
      ),
      /ยังบันทึกไม่ครบ/,
    );
  } finally {
    await engine.close();
  }
});
const ridUUID = '11111111-1111-4111-8111-111111111111';
