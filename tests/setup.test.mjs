import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const files = ['Config.gs', 'AirtableService.gs', 'Setup.gs'];
const source = files.map(name => fs.readFileSync(new URL('../apps-script/' + name, import.meta.url), 'utf8')).join('\n');
function harness() {
  const properties = new Map(), requests = [], logs = [];
  const ctx = vm.createContext({
    console: { log: value => logs.push(value) },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }), getActiveUser: () => ({ getEmail: () => 'owner@example.com' }), getScriptTimeZone: () => 'Asia/Bangkok' },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) ?? null, setProperty: (key, value) => properties.set(key, value) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    UrlFetchApp: { fetch: (url, options) => { requests.push({ url, options }); return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ records: [{ fields: { Email: 'private@example.com' } }] }) }; } }
  });
  vm.runInContext(source, ctx);
  return { ctx, properties, requests, logs };
}
function configure(h) {
  h.ctx.initializeProject_();
  for (const [key, value] of Object.entries({ AIRTABLE_TOKEN: 'secret-pat', GOOGLE_CLIENT_ID: '123-test.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'secret-oauth', WEB_APP_URL: 'https://script.google.com/macros/s/test-deployment/exec' })) h.properties.set(key, value);
}

test('initializer adds nonsecret mappings idempotently and preserves credentials and existing flags', () => {
  const h = harness();
  h.properties.set('AIRTABLE_TOKEN', 'keep-secret');
  h.properties.set('ENABLE_EMAIL_NOTIFICATIONS', 'true');
  h.ctx.initializeProject_();
  assert.equal(h.properties.get('AIRTABLE_TASKS_TABLE'), 'tblD50c8x4jdMfFxL');
  assert.equal(h.properties.get('AIRTABLE_TOKEN'), 'keep-secret');
  assert.equal(h.properties.get('ENABLE_EMAIL_NOTIFICATIONS'), 'true');
  assert.equal(h.properties.get('ENABLE_LINE_NOTIFICATIONS'), 'false');
  assert.equal(h.ctx.initializeProject_().added.length, 0);
  assert.equal(h.requests.length, 0);
  assert.ok(!h.logs.join('').includes('keep-secret'));
});

test('initializer refuses a conflicting base or table before changing any properties', () => {
  for (const key of ['AIRTABLE_BASE_ID', 'AIRTABLE_TASKS_TABLE']) {
    const h = harness();
    h.properties.set(key, 'different');
    assert.throws(() => h.ctx.initializeProject_(), /ไม่มีการเปลี่ยนแปลง/);
    assert.equal(h.properties.size, 1);
  }
});

test('editor helpers reject missing or different interactive identity before access', () => {
  const h = harness();
  h.ctx.Session.getActiveUser = () => ({ getEmail: () => '' });
  assert.throws(() => h.ctx.initializeProject_(), /Editor/);
  assert.throws(() => h.ctx.checkDeployment_(), /Editor/);
  assert.throws(() => h.ctx.initializeProject(), /Editor/);
  assert.throws(() => h.ctx.checkDeployment(), /Editor/);
  assert.equal(h.properties.size, 0);
  assert.equal(h.requests.length, 0);
});

test('Run menu entry points use the same guarded setup and read-only diagnostics', () => {
  const h = harness();
  assert.equal(h.ctx.initializeProject().added.length, 8);
  assert.equal(h.ctx.checkDeployment().configurationReady, false);
  assert.equal(h.requests.length, 0);
  h.ctx.Session.getActiveUser = () => ({ getEmail: () => 'different@example.com' });
  assert.throws(() => h.ctx.checkDeployment(), /Editor/);
});

test('missing credentials and invalid callback or timezone fail checks without API requests', () => {
  const h = harness();
  h.ctx.initializeProject_();
  h.properties.set('WEB_APP_URL', 'https://script.google.com/macros/s/test/dev');
  h.ctx.Session.getScriptTimeZone = () => 'UTC';
  const report = h.ctx.checkDeployment_();
  assert.equal(report.configurationReady, false);
  for (const name of ['AIRTABLE_TOKEN', 'GOOGLE_CLIENT_SECRET', 'Timezone', 'Web app URL']) assert.equal(report.checks.find(c => c.name === name).ok, false);
  assert.equal(h.requests.length, 0);
});

test('configured checks use GET only for each table and omit credentials and records from reports', () => {
  const h = harness(); configure(h);
  assert.equal(h.ctx.checkDeployment_().configurationReady, true);
  assert.equal(h.requests.length, 5);
  assert.ok(h.requests.every(r => r.options.method === 'get' && /maxRecords=1/.test(r.url)));
  for (const secret of ['secret-pat', 'secret-oauth', 'private@example.com']) assert.ok(!h.logs.join('').includes(secret));
});

test('failed API probes and enabled LINE without credentials prevent readiness and redact upstream errors', () => {
  const h = harness(); configure(h);
  h.properties.set('ENABLE_LINE_NOTIFICATIONS', 'true');
  h.ctx.UrlFetchApp.fetch = () => { throw new Error('secret-pat private upstream response'); };
  const report = h.ctx.checkDeployment_();
  assert.equal(report.configurationReady, false);
  assert.equal(report.checks.find(c => c.name === 'LINE_CHANNEL_ACCESS_TOKEN').ok, false);
  assert.equal(report.checks.filter(c => /^Airtable (users|tasks|updates|followups|notifications)$/.test(c.name) && !c.ok).length, 5);
  assert.ok(!h.logs.join('').includes('secret-pat'));
});
