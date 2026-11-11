import test from 'node:test';
import assert from 'node:assert/strict';
import { categories } from '../src/domain/model';
import { repository } from './fixtures';
import { mutate, validateMutation } from '../src/server/services/mutations';
import { bootstrap, detail } from '../src/server/services/reads';

test('all new categories require a trimmed case name without granting ownership', async () => {
  for (const category of categories) {
    const h = repository();
    const input = {
      title: 'งานสมมติ',
      description: 'ข้อมูลสมมติ',
      category,
      priority: 'Normal',
      dueDate: '2026-12-15',
      agentId: h.other.id,
    };
    for (const caseName of [undefined, null, '', '   ', 'a'.repeat(181)]) {
      assert.throws(() => validateMutation('create', { ...input, caseName }, h.agent));
      await assert.rejects(
        mutate(
          h.repo,
          h.agent,
          'create',
          { ...input, caseName },
          { key: 'invalid', run: async (_name, work) => work() },
        ),
      );
    }
    assert.equal(h.calls.length, 0);
    const result = await mutate(
      h.repo,
      h.agent,
      'create',
      { ...input, caseName: '  ลูกค้า สมมติ  ' },
      { key: 'new-name', run: async (_name, work) => work() },
    );
    const task = (await detail(h.repo, h.agent, result.id)).task;
    assert.equal(task.caseName, 'ลูกค้า สมมติ');
    assert.equal(task.agentId, h.agent.id);
    assert.equal(
      (await bootstrap(h.repo, h.agent)).tasks.find((t) => t.id === result.id)?.caseName,
      task.caseName,
    );
    await assert.rejects(detail(h.repo, h.other, result.id), /ไม่มีสิทธิ์/);
    assert.equal((await detail(h.repo, h.agent, 'rec00000000000011')).task.caseName, '');
  }
});
