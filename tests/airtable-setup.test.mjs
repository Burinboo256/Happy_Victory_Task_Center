import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(new URL('../tools/setup-airtable.js', import.meta.url), 'utf8');
const run = new (Object.getPrototypeOf(async function() {}).constructor)('base', 'output', source);
const output = { text() {}, markdown() {}, table() {} };
function mockBase(id = 'appDS1Ji5cqIohPq3') {
  const base = { id, tables: [{ id: 'legacy', name: 'Table 1', fields: [] }] };
  base.getTable = name => {
    const table = base.tables.find(t => t.name === name || t.id === name);
    if (!table) throw new Error('Missing table: ' + name);
    return table;
  };
  base.createTableAsync = async (name, fields) => {
    const table = { id: 'table-' + base.tables.length, name, fields: structuredClone(fields) };
    table.createFieldAsync = async (name, type, options) => {
      table.fields.push({ name, type, options: structuredClone(options) });
      return name;
    };
    base.tables.push(table);
    return table.id;
  };
  return base;
}

test('Airtable setup creates only the five new schemas and is safe to rerun', async () => {
  const base = mockBase(), legacy = structuredClone(base.tables[0]);
  await run(base, output);
  assert.equal(base.tables.length, 6);
  assert.deepEqual(base.tables[0], legacy);
  const counts = base.tables.map(t => t.fields.length);
  assert.equal(base.getTable('Tasks').fields.find(f => f.name === 'Agent').options.linkedTableId, base.getTable('Users').id);
  assert.equal(base.getTable('Notifications').fields.find(f => f.name === 'Sent At').options.timeZone, 'Asia/Bangkok');
  await run(base, output);
  assert.deepEqual(base.tables.map(t => t.fields.length), counts);
});

test('Airtable setup rejects a different base before making changes', async () => {
  const base = mockBase('another-base');
  await assert.rejects(run(base, output), /Wrong base/);
  assert.equal(base.tables.length, 1);
});

test('Airtable setup rejects an incompatible existing field before making changes', async () => {
  const base = mockBase();
  base.tables.push({ name: 'Users', fields: [{ name: 'Email', type: 'singleLineText' }] });
  await assert.rejects(run(base, output), /Users.Email/);
  assert.equal(base.tables.length, 2);
});
