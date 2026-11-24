import test from 'node:test';
import assert from 'node:assert/strict';
import { RequestReadScope } from '../src/server/airtable/read-scope';
import { repository, rid } from './fixtures';

test('read scope shares concurrent reads without sharing mutable authorization records', async () => {
  const h = repository();
  const scope = new RequestReadScope();
  const repo = scope.wrap(h.repo);
  const [first, second] = await Promise.all([repo.get('users', rid(2)), repo.get('users', rid(2))]);
  first.fields.Active = false;
  assert.equal(second.fields.Active, true);
  assert.equal((await repo.get('users', rid(2))).fields.Active, true);
  assert.equal(h.calls.filter((c) => c === 'get:users').length, 1);
  h.tables.users[1].fields.Active = false;
  const nextRequest = new RequestReadScope().wrap(h.repo);
  assert.equal((await nextRequest.get('users', rid(2))).fields.Active, false);
  scope.close();
  assert.equal((await repo.get('users', rid(2))).fields.Active, false);
});

test('read scope isolates repositories and list projections with identical record IDs', async () => {
  const a = repository();
  const b = repository();
  b.tables.tasks[0].fields['Task Title'] = 'Only Space B';
  const scope = new RequestReadScope();
  const first = scope.wrap(a.repo);
  const second = scope.wrap(b.repo);
  assert.notEqual(
    (await first.get('tasks', rid(11))).fields['Task Title'],
    (await second.get('tasks', rid(11))).fields['Task Title'],
  );
  const names = await first.list('users', undefined, ['Full Name']);
  const active = await first.list('users', undefined, ['Active']);
  assert.equal(names[0].fields.Active, undefined);
  assert.equal(active[0].fields.Active, true);
  await first.list('users', '{Active}=1', ['Active']);
  assert.equal(a.calls.filter((c) => c === 'list:users').length, 3);
});

test('writes invalidate all repositories in the request even on an uncertain outcome', async () => {
  const h = repository();
  const scope = new RequestReadScope();
  const reader = scope.wrap(h.repo);
  const writer = scope.wrap({
    ...h.repo,
    async patch() {
      h.tables.users[1].fields.Active = false;
      throw new Error('uncertain write');
    },
  });
  await reader.get('users', rid(2));
  await assert.rejects(writer.patch('users', rid(2), { Active: false }));
  assert.equal((await reader.get('users', rid(2))).fields.Active, false);
  await reader.upsert('users', 'Email', { Email: 'agent-a@gmail.com', Active: true });
  assert.equal((await reader.get('users', rid(2))).fields.Active, true);
});

test('closed request scopes never cache background reads', async () => {
  const h = repository();
  const scope = new RequestReadScope();
  const repo = scope.wrap(h.repo);
  await repo.get('users', rid(2));
  scope.close();
  await repo.get('users', rid(2));
  h.tables.users[1].fields.Active = false;
  assert.equal((await repo.get('users', rid(2))).fields.Active, false);
  assert.equal(h.calls.filter((c) => c === 'get:users').length, 3);
});
