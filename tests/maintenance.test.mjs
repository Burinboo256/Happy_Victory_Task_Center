import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const maintenance = fs.readFileSync(new URL('../apps-script/Maintenance.gs', import.meta.url), 'utf8');
const config = fs.readFileSync(new URL('../apps-script/Config.gs', import.meta.url), 'utf8');
const setup = fs.readFileSync(new URL('../apps-script/Setup.gs', import.meta.url), 'utf8');
function harness(values = {}, triggers = []) {
  const properties = new Map(Object.entries({ AIRTABLE_BASE_ID: 'appDS1Ji5cqIohPq3', ...values }));
  const events = [], logs = [];
  let locked = false;
  const context = vm.createContext({
    console: { log: value => logs.push(value) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      getProperties: () => Object.fromEntries(properties),
      setProperty(key, value) { assert.equal(locked, true, 'Pause must hold the same script lock as mutations'); events.push(key); properties.set(key, value); },
    }) },
    LockService: { getScriptLock: () => ({ waitLock() { assert.equal(locked, false); locked = true; events.push('lock'); }, releaseLock() { locked = false; events.push('release'); } }) },
    ScriptApp: { getProjectTriggers: () => triggers },
    Session: { getActiveUser: () => ({ getEmail: () => 'owner@example.test' }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) },
  });
  vm.runInContext(config + '\n' + setup + '\n' + maintenance, context);
  return { context, properties, events, logs };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('editor-only pause holds the mutation lock, disables all write channels and preserves credentials/journals', () => {
  assert.deepEqual([...maintenance.matchAll(/function (\w+)\(/g)].map(match => match[1]).filter(name => !name.endsWith('_')).sort(), ['checkLegacyCutover', 'pauseLegacyWritesForVercel']);
  const original = { AIRTABLE_TOKEN: 'private-sentinel-token', GOOGLE_CLIENT_SECRET: 'private-sentinel-secret', 'operation:done': JSON.stringify({ done: true, steps: { task: 'private-record' } }), ENABLE_TASK_WRITES: 'true', ENABLE_EMAIL_NOTIFICATIONS: 'true', ENABLE_LINE_NOTIFICATIONS: 'true' };
  const h = harness(original);
  assert.deepEqual(plain(h.context.pauseLegacyWritesForVercel_()), { taskWritesPaused: true, emailEnabled: false, lineEnabled: false, pendingOperations: 0, malformedOperations: 0, triggerCount: 0, readyToCutover: true });
  assert.deepEqual(h.events, ['lock', 'ENABLE_TASK_WRITES', 'ENABLE_EMAIL_NOTIFICATIONS', 'ENABLE_LINE_NOTIFICATIONS', 'release']);
  for (const [key, value] of Object.entries(original)) if (!key.startsWith('ENABLE_')) assert.equal(h.properties.get(key), value);
  assert.doesNotMatch(h.logs.join(''), /private-sentinel|private-record/);
});

test('read-only cutover status does not ignore empty-step, malformed or unfinished journals and existing triggers', () => {
  const h = harness({ ENABLE_TASK_WRITES: 'false', 'operation:empty': JSON.stringify({ steps: {} }), 'operation:partial': JSON.stringify({ done: false, steps: { task: 'private-record' } }), 'operation:bad': '{not-json' }, [{}, {}]);
  const before = Object.fromEntries(h.properties);
  const status = plain(h.context.legacyCutoverStatus_());
  assert.equal(status.pendingOperations, 2);
  assert.equal(status.malformedOperations, 1);
  assert.equal(status.triggerCount, 2);
  assert.equal(status.readyToCutover, false);
  assert.deepEqual(Object.fromEntries(h.properties), before);
  assert.deepEqual(h.events, ['lock', 'release']);
  assert.doesNotMatch(h.logs.join(''), /private-record|not-json|operation:/);
});

test('pause refuses a different Base without changing flags and releases its script lock', () => {
  const h = harness({ AIRTABLE_BASE_ID: 'app00000000000000', ENABLE_TASK_WRITES: 'true' });
  const before = Object.fromEntries(h.properties);
  assert.throws(() => h.context.pauseLegacyWritesForVercel_(), /configured production Base/);
  assert.deepEqual(Object.fromEntries(h.properties), before);
  assert.deepEqual(h.events, ['lock', 'release']);
  assert.deepEqual(h.logs, []);
});

test('Run-menu wrappers reject missing or different interactive identity before reading or changing maintenance state', () => {
  for (const email of ['', 'different@example.test']) {
    const h = harness({ ENABLE_TASK_WRITES: 'true' });
    h.context.Session.getActiveUser = () => ({ getEmail: () => email });
    const before = Object.fromEntries(h.properties);
    assert.throws(() => h.context.checkLegacyCutover(), /Editor/);
    assert.throws(() => h.context.pauseLegacyWritesForVercel(), /Editor/);
    assert.deepEqual(Object.fromEntries(h.properties), before);
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.logs, []);
  }
});
