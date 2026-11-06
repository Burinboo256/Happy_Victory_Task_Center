import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../apps-script/Scripts.html', import.meta.url), 'utf8').replace(/^<script>\s*/, '').replace(/<\/script>\s*$/, '');

function browser(boot = {}, saved = {}, failure = '') {
  const storage = new Map(Object.entries(saved)), events = [], handlers = {};
  const data = { today: '2026-11-05', user: { role: 'Agent' }, tasks: [], users: [] };
  const element = { disabled: false, dataset: { action: 'login' } };
  const ctx = vm.createContext({
    window: { HVR_BOOT: boot, location: { search: '' } },
    sessionStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    document: { addEventListener: (k, fn) => { handlers[k] = fn; }, querySelector: () => element },
    URLSearchParams, Date, Intl, TextEncoder, Uint8Array, setTimeout, clearTimeout,
    crypto: { getRandomValues: a => a, subtle: { digest: async () => new Uint8Array(32) } },
    events,
    call: async (method, ...args) => {
      events.push(method);
      if (method === 'api') { if (failure) throw new Error(failure); return data; }
      if (method === 'completeGoogleLogin') { assert.equal(args[1], 'verifier'); return { token: 'signed-in' }; }
      if (method === 'startGoogleLogin') return 'https://accounts.google.com/';
    }
  });
  // Replace only UI painting and the network boundary; run the real startup/login flow.
  vm.runInContext(source.replace('  init();', `
    render = () => events.push('workspace');
    createForm = () => events.push('create');
    renderLogin = () => events.push('login');
    loading = () => {};
    gas = call;
    window.testNavigation = { init, load };
  `), ctx);
  return { storage, events, init: ctx.window.testNavigation.init, load: ctx.window.testNavigation.load,
    login: () => handlers.click({ target: { closest: () => element } }) };
}

test('direct create link opens only after authenticated bootstrap and only once', async () => {
  const b = browser({ view: 'create' }, { 'hvr-session': 'existing' });
  await b.init(); await b.load(true);
  assert.deepEqual(b.events, ['api', 'workspace', 'create', 'api', 'workspace']);
});

test('signed-out create link survives Google callback and consumes the return view', async () => {
  const b = browser({ view: 'create' });
  await b.init(); assert.deepEqual(b.events, ['login']);
  await b.login(); assert.equal(b.storage.get('hvr-return-view'), 'create');
  const returned = browser({ ticket: 'one-use-ticket' }, Object.fromEntries(b.storage.set('hvr-verifier', 'verifier')));
  await returned.init();
  assert.deepEqual(returned.events, ['completeGoogleLogin', 'api', 'workspace', 'create']);
  assert.equal(returned.storage.has('hvr-return-view'), false);
});

test('failed authorization cannot open the form', async () => {
  const b = browser({ view: 'create' }, { 'hvr-session': 'expired' }, 'UNAUTHENTICATED');
  await b.init(); assert.deepEqual(b.events, ['api', 'login']);
  assert.equal(b.storage.has('hvr-session'), false);
});

test('normal visits and unknown views ignore old return intent', async () => {
  for (const boot of [{}, { view: 'team' }, { ticket: 'ticket' }]) {
    const b = browser(boot, { 'hvr-session': 'existing', 'hvr-return-view': boot.ticket ? 'team' : 'create', 'hvr-verifier': 'verifier' });
    await b.init(); assert.equal(b.events.includes('create'), false);
  }
});

test('OAuth errors retain the create intent for another login attempt', async () => {
  const b = browser({ error: 'Login cancelled' }, { 'hvr-return-view': 'create' });
  await b.init(); await b.login();
  assert.equal(b.storage.get('hvr-return-view'), 'create');
  assert.equal(b.events.includes('create'), false);
});

test('server renders only the supported create view into boot data', () => {
  const ctx = vm.createContext({ APP_: { name: 'Test' }, jsonForHtml_: JSON.stringify });
  let template;
  ctx.HtmlService = { createTemplateFromFile: () => (template = { evaluate: () => ({ setTitle() { return this; }, addMetaTag() { return this; } }) }) };
  vm.runInContext(fs.readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8'), ctx);
  for (const [view, expected] of [['create', 'create'], ['team', ''], ['<script>', ''], [undefined, '']]) {
    ctx.doGet({ parameter: { view } });
    assert.equal(JSON.parse(template.bootJson).view, expected);
  }
});
