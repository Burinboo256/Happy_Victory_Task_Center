import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { config, database, repository, rid } from '../fixtures';
import {
  ControlPlane,
  workspaceRepository,
  controlFingerprint,
} from '../../src/server/workspaces/control';
import { createOperationalSchema, workspaceDatabase } from '../../src/server/workspaces/database';
import { operationalMigrations } from '../../src/server/workspaces/schema-bundle';
import {
  baseCredentials,
  decryptCredentials,
  encryptCredentials,
} from '../../src/server/workspaces/credentials';
import {
  authorizeSpace,
  listSpaces,
  spaceServices,
  updateMember,
  modeGuard,
  createSpace,
  workspaceCsrf,
  enrollMember,
} from '../../src/server/workspaces/service';
import { workspaceUrl } from '../../src/server/workspaces/url';
import { initializeSpaces } from '../../src/server/workspaces/bootstrap';
import {
  registerLineCode,
  selectAiSpace,
  receiveSpaceAi,
  replySpaceAi,
  receiveSpaceNotifications,
} from '../../src/server/workspaces/line-routing';
import { startAiLink, confirmAiLink } from '../../src/server/ai/line';
import { startLink } from '../../src/server/line/accounts';
import { userDto } from '../../src/server/airtable/dto';
import { bootstrap, ownTask } from '../../src/server/services/reads';
import { atomic } from '../../src/server/db';
import { requireCsrf, hash, safeReturnTo } from '../../src/server/auth/security';
import { sqlStatements } from '../../tools/sql-statements';
import { AppError } from '../../src/server/errors';
import { schemaFixture } from '../schema-fixture';
import { isSpaceSlug, reservedSpaceSlugs } from '../../src/domain/space-link';
import { requestSpace } from '../../src/server/workspaces/request';
import { registrationSpace } from '../../src/server/workspaces/registration';
import {
  rememberSpace,
  resumeSpace,
  spaceLoginDestination,
} from '../../src/server/workspaces/preference';

const a = '00000000-0000-4000-8000-000000000001';
const b = '00000000-0000-4000-8000-000000000002';
const schemaB = 'hvr_ws_' + b.replaceAll('-', '');
const baseB = 'app00000000000099';
const lineId = 'U' + '1'.repeat(32),
  bot = 'U' + 'a'.repeat(32);
const c = {
  ...config,
  WORKSPACES_ENABLED: true,
  WORKSPACE_ENCRYPTION_KEY: '9'.repeat(64),
  AI_LINE_ENABLED: true,
  AI_LINE_CHANNEL_SECRET: 'test-ai-secret-never-live',
  AI_LINE_CHANNEL_ACCESS_TOKEN: 'test-ai-token-never-live',
  AI_LINE_BOT_USER_ID: bot,
  AI_LINE_OA_ID: '@test-ai',
  LINE_BOT_USER_ID: bot,
  LINE_CHANNEL_ACCESS_TOKEN: 'test-line-token-never-live',
  LINE_CHANNEL_SECRET: 'test-line-secret-never-live',
  LINE_OA_ID: '@test-notifications',
};
function credentials() {
  const {
    AIRTABLE_TOKEN,
    AIRTABLE_USERS_TABLE,
    AIRTABLE_TASKS_TABLE,
    AIRTABLE_UPDATES_TABLE,
    AIRTABLE_FOLLOWUPS_TABLE,
    AIRTABLE_NOTIFICATIONS_TABLE,
  } = c;
  return baseCredentials.parse({
    AIRTABLE_BASE_ID: baseB,
    AIRTABLE_TOKEN,
    AIRTABLE_USERS_TABLE,
    AIRTABLE_TASKS_TABLE,
    AIRTABLE_UPDATES_TABLE,
    AIRTABLE_FOLLOWUPS_TABLE,
    AIRTABLE_NOTIFICATIONS_TABLE,
  });
}
async function fixture() {
  const { db, engine } = await database();
  const central = repository(),
    spaces = repository(),
    members = repository(),
    first = repository(),
    second = repository();
  spaces.tables.users = [];
  members.tables.users = [];
  central.tables.users[0].fields['System Role'] = 'Owner';
  // Deliberately conflicting local roles and identical record IDs in both Bases.
  first.tables.users.forEach((u) => {
    u.fields.Role = 'Admin';
    u.fields.Active = true;
  });
  second.tables.users.forEach((u) => {
    u.fields.Role = 'Admin';
    u.fields.Active = true;
  });
  first.tables.tasks[0].fields['Task Title'] = 'SPACE A ONLY';
  second.tables.tasks[0].fields['Task Title'] = 'SPACE B ONLY';
  second.tables.tasks[0].fields.Agent = [rid(1)];
  const control = new ControlPlane(c, db, {
    users: central.repo,
    spaces: spaces.repo,
    members: members.repo,
    base: (target) => (target.AIRTABLE_BASE_ID === baseB ? second.repo : first.repo),
  });
  for (const [id, record, base, name] of [
    [a, rid(101), c.AIRTABLE_BASE_ID, 'Team A'],
    [b, rid(102), baseB, 'Team B'],
  ])
    spaces.tables.users.push({
      id: record,
      fields: { 'Workspace ID': id, 'Base ID': base, Name: name, Active: true },
    });
  const addMember = (workspace: string, user: number, role: string) =>
    members.tables.users.push({
      id: rid(200 + members.tables.users.length),
      fields: {
        'Membership Key': (workspace === rid(101) ? a : b) + ':' + rid(user),
        Workspace: [workspace],
        User: [rid(user)],
        'Local User ID': rid(user),
        Role: role,
        Active: true,
      },
    });
  addMember(rid(101), 1, 'Admin');
  addMember(rid(101), 2, 'Agent');
  addMember(rid(102), 1, 'Agent');
  addMember(rid(102), 3, 'Admin');
  await atomic(db, (tx) => createOperationalSchema(tx, schemaB, c.APP_ENV, baseB));
  await db.query(
    'INSERT INTO public.hvr_workspace_control(environment,fingerprint) VALUES($1,$2)',
    [c.APP_ENV, controlFingerprint(c)],
  );
  await db.query(
    `INSERT INTO hvr_workspaces(environment,id,name,schema_name,base_id,control_id,is_default,credentials)
    VALUES($1,$2,'A','public',$3,$4,true,NULL),($1,$5,'B',$6,$7,$8,false,$9)`,
    [
      c.APP_ENV,
      a,
      c.AIRTABLE_BASE_ID,
      rid(101),
      b,
      schemaB,
      baseB,
      rid(102),
      encryptCredentials(c, b, credentials()),
    ],
  );
  return { db, engine, control, central, spaces, members, first, second };
}

test('workspace migrations match sources and credentials bind to environment and Space', async () => {
  const source = (await readdir('db/migrations'))
    .filter(
      (n) =>
        n.endsWith('.sql') &&
        ![
          '013_workspaces.sql',
          '014_workspace_preferences.sql',
          '015_workspace_slugs.sql',
        ].includes(n),
    )
    .sort();
  assert.deepEqual(
    operationalMigrations.map((m) => m.name),
    source,
  );
  for (const m of operationalMigrations) {
    const sql = (await readFile('db/migrations/' + m.name, 'utf8')).replaceAll('\r\n', '\n');
    assert.equal(m.checksum, createHash('sha256').update(sql).digest('hex'));
    assert.deepEqual(m.statements, sqlStatements(sql));
  }
  const encrypted = encryptCredentials(c, b, credentials());
  assert.ok(!encrypted.includes(c.AIRTABLE_TOKEN));
  assert.deepEqual(decryptCredentials(c, b, encrypted), credentials());
  assert.throws(() => decryptCredentials(c, a, encrypted));
  assert.throws(() => decryptCredentials({ ...c, APP_ENV: 'staging' }, b, encrypted));
  assert.throws(() => decryptCredentials(c, b, encrypted.slice(0, -8) + 'aaaaaaaa'));
});

test('slug migration backfills populated Spaces without changing their identities', async () => {
  const engine = new PGlite();
  try {
    for (const file of (await readdir('db/migrations'))
      .filter((n) => n.endsWith('.sql') && n < '015_workspace_slugs.sql')
      .sort())
      await engine.exec(await readFile('db/migrations/' + file, 'utf8'));
    await engine.query('INSERT INTO hvr_instances(environment,base_id) VALUES($1,$2)', [
      c.APP_ENV,
      c.AIRTABLE_BASE_ID,
    ]);
    await engine.query(
      `INSERT INTO hvr_workspaces(environment,id,name,schema_name,base_id,control_id,is_default,credentials)
      VALUES($1,$2,'RINLYN','public',$3,'first',true,NULL),($1,$4,'RINLYN',$5,$6,'second',false,'fixture')`,
      [c.APP_ENV, a, c.AIRTABLE_BASE_ID, b, schemaB, baseB],
    );
    await engine.exec(await readFile('db/migrations/015_workspace_slugs.sql', 'utf8'));
    const result = await engine.query('SELECT id,slug FROM hvr_workspaces ORDER BY id');
    assert.deepEqual(result.rows, [
      { id: a, slug: 'rinlyn' },
      { id: b, slug: 'rinlyn-2' },
    ]);
  } finally {
    await engine.close();
  }
});

test('Space short links are stable, unique and cannot collide with app routes', async () => {
  const f = await fixture();
  try {
    const insert = async (name: string, slug?: string) => {
      const id = randomUUID();
      const result = await f.db.query(
        `INSERT INTO hvr_workspaces(environment,id,name,schema_name,base_id,control_id,credentials,slug)
        VALUES($1,$2,$3,$4,$5,$6,'test-encrypted-placeholder',$7) RETURNING id,slug`,
        [
          c.APP_ENV,
          id,
          name,
          'hvr_ws_' + id.replaceAll('-', ''),
          'base-' + id,
          'control-' + id,
          slug || null,
        ],
      );
      return result.rows[0];
    };
    const first = await insert('RINLYN'),
      second = await insert('RINLYN');
    assert.equal(first.slug, 'rinlyn');
    assert.equal(second.slug, 'rinlyn-2');
    assert.equal((await insert('ทีมภาษาไทย', 'team-thai')).slug, 'team-thai');
    assert.ok(isSpaceSlug((await insert('ภาษาไทย')).slug));
    assert.equal((await insert('Other team', 'rinlyn')).slug, 'rinlyn-3');
    for (const name of reservedSpaceSlugs) assert.equal((await insert(name)).slug, 'space-' + name);
    await f.db.query('UPDATE hvr_workspaces SET name=$1 WHERE id=$2', [
      'New display name',
      first.id,
    ]);
    assert.equal(
      (await f.db.query('SELECT slug FROM hvr_workspaces WHERE id=$1', [first.id])).rows[0].slug,
      'rinlyn',
    );
    const member = userDto(f.central.tables.users[1]);
    const listed = await listSpaces(f.db, c, f.control, member);
    assert.deepEqual(
      listed.items.map((s) => ({ id: s.id, slug: s.slug })),
      [{ id: a, slug: 'a' }],
    );
    assert.equal(
      (await f.db.query(`SELECT to_regclass('${schemaB}.hvr_workspaces') AS name`)).rows[0].name,
      null,
    );
  } finally {
    await f.engine.close();
  }
});

test('URL Space overrides cookies while membership, expected ID and scoped CSRF remain enforced', async () => {
  const f = await fixture();
  try {
    const owner = userDto(f.central.tables.users[0]),
      agent = userDto(f.central.tables.users[1]);
    const first = await requestSpace(f.db, c, f.control, owner, b, 'a', a);
    const second = await requestSpace(f.db, c, f.control, owner, a, 'b', b);
    assert.equal(first.row.id, a);
    assert.equal(second.row.id, b);
    assert.equal((await ownTask(first.repo, first.user, rid(11))).title, 'SPACE A ONLY');
    assert.equal((await ownTask(second.repo, second.user, rid(11))).title, 'SPACE B ONLY');
    assert.equal(second.user.role, 'Admin');
    await assert.rejects(requestSpace(f.db, c, f.control, agent, a, 'b'), {
      code: 'WORKSPACE_REQUIRED',
    });
    await assert.rejects(requestSpace(f.db, c, f.control, owner, a, 'missing'), {
      code: 'WORKSPACE_REQUIRED',
    });
    await assert.rejects(requestSpace(f.db, c, f.control, owner, a, '../b'), {
      code: 'WORKSPACE_REQUIRED',
    });
    await assert.rejects(requestSpace(f.db, c, f.control, owner, a, 'b', a), {
      code: 'WORKSPACE_CHANGED',
    });
    assert.throws(() =>
      requireCsrf(
        new Request(c.APP_ORIGIN + '/api/tasks', {
          method: 'POST',
          headers: { origin: c.APP_ORIGIN, 'x-csrf-token': workspaceCsrf('session', a) },
        }),
        workspaceCsrf('session', b),
        c,
      ),
    );
    f.spaces.tables.users[1].fields.Active = false;
    await assert.rejects(requestSpace(f.db, c, f.control, owner, a, 'b'), {
      code: 'WORKSPACE_REQUIRED',
    });
    f.spaces.tables.users[1].fields.Active = true;
    f.central.tables.users[0].fields.Active = false;
    await assert.rejects(requestSpace(f.db, c, f.control, owner, a, 'b'), {
      code: 'WORKSPACE_REQUIRED',
    });
  } finally {
    await f.engine.close();
  }
});

test('Owner enters every active Space and manages Admins without leaving implicit access after revocation', async () => {
  const h = await fixture();
  try {
    const owner = userDto(h.central.tables.users[0]);
    h.members.tables.users = h.members.tables.users.filter(
      (m) => !(String(m.fields.Workspace) === rid(102) && String(m.fields.User) === owner.id),
    );
    h.second.tables.users = h.second.tables.users.filter((u) => u.id !== owner.id);
    const before = h.members.tables.users.length;
    const spaces = await listSpaces(h.db, c, h.control, owner);
    assert.equal(spaces.owner, true);
    assert.equal(spaces.items.length, 2);
    assert.ok(spaces.items.every((s) => s.role === 'Admin' && s.approved));
    // Owner can grant or change Admins before ever joining or opening this Space.
    await h.control.requireAdmin(rid(102), owner.id);
    await updateMember(h.db, c, h.control, owner, b, {
      email: 'agent-a@gmail.com',
      role: 'Admin',
      active: true,
    });
    await updateMember(h.db, c, h.control, owner, b, {
      email: 'agent-b@gmail.com',
      role: 'Secretary',
      active: true,
    });
    assert.equal((await h.control.member(rid(102), rid(2))).role, 'Admin');
    assert.equal((await h.control.member(rid(102), rid(3))).role, 'Secretary');
    assert.equal((await h.control.member(rid(101), rid(2))).role, 'Agent');
    await assert.rejects(
      updateMember(h.db, c, h.control, owner, b, {
        email: 'agent-a@gmail.com',
        role: 'Agent',
        active: true,
      }),
      { code: 'LAST_WORKSPACE_ADMIN' },
    );
    const context = await authorizeSpace(h.db, c, h.control, owner, b);
    assert.equal(context.user.role, 'Admin');
    assert.equal(context.user.active, true);
    assert.notEqual(context.user.id, owner.id);
    assert.ok(h.second.tables.users.some((u) => u.id === context.user.id));
    assert.equal((await ownTask(context.repo, context.user, rid(12))).id, rid(12));
    assert.equal((await bootstrap(context.repo, context.user)).user.role, 'Admin');
    const linked = await h.control.member(rid(102), owner.id);
    assert.equal(linked.role, 'Agent');
    assert.equal(linked.active, false);
    await authorizeSpace(h.db, c, h.control, owner, b);
    assert.equal(h.members.tables.users.length, before + 2);
    assert.equal(
      (await h.db.query("SELECT * FROM hvr_workspace_events WHERE action='owner-identity-linked'"))
        .rows.length,
      1,
    );
    await assert.rejects(
      updateMember(h.db, c, h.control, userDto(h.central.tables.users[1]), b, {
        email: owner.email,
        role: 'Agent',
        active: false,
      }),
      { code: 'SYSTEM_OWNER' },
    );
    h.spaces.tables.users[1].fields.Active = false;
    await assert.rejects(authorizeSpace(h.db, c, h.control, owner, b), {
      code: 'WORKSPACE_PAUSED',
    });
    await updateMember(h.db, c, h.control, owner, b, {
      email: 'agent-b@gmail.com',
      role: 'Admin',
      active: true,
    });
    assert.equal((await h.control.member(rid(102), rid(3))).role, 'Admin');
    await assert.rejects(
      updateMember(h.db, c, h.control, userDto(h.central.tables.users[1]), b, {
        email: 'agent-b@gmail.com',
        role: 'Secretary',
        active: true,
      }),
      { code: 'WORKSPACE_PAUSED' },
    );
    h.spaces.tables.users[1].fields.Active = true;
    h.central.tables.users[0].fields.Active = false;
    await assert.rejects(authorizeSpace(h.db, c, h.control, owner, b));
    await assert.rejects(h.control.requireAdmin(rid(102), owner.id));
    h.central.tables.users[0].fields.Active = true;
    delete h.central.tables.users[0].fields['System Role'];
    await assert.rejects(authorizeSpace(h.db, c, h.control, owner, b), {
      code: 'WORKSPACE_PENDING',
    });
    await assert.rejects(h.control.requireAdmin(rid(102), owner.id));
    const revoked = userDto(await context.repo.get('users', linked.localUserId));
    assert.equal(revoked.active, false);
    assert.equal(revoked.role, 'Agent');
    // An explicitly granted membership is preserved after losing the global Owner role.
    assert.equal((await authorizeSpace(h.db, c, h.control, owner, a)).user.role, 'Admin');
  } finally {
    await h.engine.close();
  }
});

test('public registration slug selects one Space and never falls back to a conflicting ID or default', async () => {
  const h = await fixture();
  try {
    const target = await registrationSpace(h.db, c, h.control, a, 'b');
    assert.equal(target.row.id, b);
    assert.equal((await registrationSpace(h.db, c, h.control, b)).row.slug, 'b');
    assert.equal((await registrationSpace(h.db, c, h.control)).row.id, a);
    for (const slug of ['missing', '../a', 'register', 'a/register'])
      await assert.rejects(registrationSpace(h.db, c, h.control, a, slug), {
        code: 'SPACE_NOT_FOUND',
      });
    await assert.rejects(registrationSpace(h.db, { ...c, APP_ENV: 'staging' }, h.control, a, 'b'), {
      code: 'SPACE_NOT_FOUND',
    });
    const agent = userDto(h.central.tables.users[1]);
    assert.equal(
      await enrollMember(h.db, c, h.control, target.row.id, agent, agent.name),
      'pending',
    );
    const signup = await h.control.member(rid(102), agent.id);
    assert.equal(signup.role, 'Agent');
    assert.equal(signup.active, false);
    assert.equal((await h.control.member(rid(101), agent.id)).active, true);
    assert.equal(
      await enrollMember(h.db, c, h.control, target.row.id, agent, agent.name),
      'pending',
    );
    h.spaces.tables.users[1].fields.Active = false;
    await assert.rejects(registrationSpace(h.db, c, h.control, undefined, 'b'), {
      code: 'WORKSPACE_PAUSED',
    });
    await assert.rejects(enrollMember(h.db, c, h.control, b, agent, agent.name), {
      code: 'WORKSPACE_PAUSED',
    });
    h.spaces.tables.users[1].fields.Active = true;
    h.spaces.tables.users[1].fields['Base ID'] = c.AIRTABLE_BASE_ID;
    await assert.rejects(registrationSpace(h.db, c, h.control, undefined, 'b'), {
      code: 'WORKSPACE_PAUSED',
    });
  } finally {
    await h.engine.close();
  }
});

test('last Space persists per account and environment; restoration rechecks authorization', async () => {
  const f = await fixture();
  delete f.central.tables.users[0].fields['System Role'];
  const user = userDto(f.central.tables.users[0]);
  const agent = userDto(f.central.tables.users[1]);
  try {
    assert.equal(await resumeSpace(f.db, c, f.control, user), undefined);
    await rememberSpace(f.db, c, f.control, user, b);
    assert.equal((await resumeSpace(f.db, c, f.control, user))?.row.id, b);
    assert.equal((await resumeSpace(f.db, c, f.control, user))?.user.role, 'Agent');
    assert.equal(await resumeSpace(f.db, c, f.control, agent), undefined);
    assert.equal(await resumeSpace(f.db, { ...c, APP_ENV: 'staging' }, f.control, user), undefined);
    assert.equal(
      await resumeSpace(f.db, c, f.control, { ...user, sub: 'other-account' }),
      undefined,
    );
    // Existing tabs keep their explicitly selected Space when another device changes preference.
    assert.equal((await resumeSpace(f.db, c, f.control, user, a))?.row.id, a);
    await rememberSpace(f.db, c, f.control, user, a);
    await rememberSpace(f.db, c, f.control, agent, a);
    assert.equal((await resumeSpace(f.db, c, f.control, user))?.row.id, a);
    await assert.rejects(rememberSpace(f.db, c, f.control, agent, b));
    assert.equal((await resumeSpace(f.db, c, f.control, agent))?.row.id, a);
    // Preference is outside both operational schemas and never changes LINE routing.
    assert.equal((await f.db.query('SELECT * FROM hvr_workspace_line_routes')).rows.length, 0);
    assert.equal(
      (await f.db.query(`SELECT to_regclass('${schemaB}.hvr_workspace_preferences') AS name`))
        .rows[0].name,
      null,
    );
    await rememberSpace(f.db, c, f.control, user, b);
    f.spaces.tables.users[1].fields.Active = false;
    assert.equal(await resumeSpace(f.db, c, f.control, user), undefined);
    f.spaces.tables.users[1].fields.Active = true;
    const member = f.members.tables.users.find(
      (m) =>
        Array.isArray(m.fields.Workspace) &&
        m.fields.Workspace[0] === rid(102) &&
        Array.isArray(m.fields.User) &&
        m.fields.User[0] === user.id,
    );
    assert.ok(member);
    member.fields.Active = false;
    assert.equal(await resumeSpace(f.db, c, f.control, user), undefined);
    member.fields.Active = true;
    f.central.tables.users[0].fields.Active = false;
    assert.equal(await resumeSpace(f.db, c, f.control, user), undefined);
    await assert.rejects(resumeSpace(f.db, c, f.control, { ...user, active: false }));
    f.central.tables.users[0].fields.Active = true;
    f.members.tables.users.splice(f.members.tables.users.indexOf(member), 1);
    assert.equal(await resumeSpace(f.db, c, f.control, user), undefined);
    f.control.member = async () => {
      throw new AppError(503, 'AIRTABLE_UNAVAILABLE', 'temporary outage');
    };
    await assert.rejects(resumeSpace(f.db, c, f.control, user), { status: 503 });
  } finally {
    await f.engine.close();
  }
});

test('login resumes last Space without overriding explicit destinations or the manual chooser', () => {
  assert.equal(spaceLoginDestination('/', true, a), '/');
  assert.equal(spaceLoginDestination('/', true), '/spaces');
  assert.equal(spaceLoginDestination('/', false), '/');
  assert.equal(spaceLoginDestination('/', true, a, 'team-a'), '/team-a');
  assert.equal(spaceLoginDestination('/tasks/new', true, a, 'team-a'), '/team-a/tasks/new');
  assert.equal(spaceLoginDestination('/team-b/inbox', true, a, 'team-a'), '/team-b/inbox');
  assert.equal(spaceLoginDestination('/spaces', true, a, 'team-a'), '/spaces');
  assert.equal(
    workspaceUrl({ ...c, workspace: { id: b, name: 'B', slug: 'team-b' } }, '/tasks/' + rid(11)),
    c.APP_ORIGIN + '/team-b/tasks/' + rid(11),
  );
  for (const destination of [
    '/tasks/new',
    '/forms?q=HC1',
    '/spaces',
    '/spaces/open?' + new URLSearchParams({ space: b, next: '/tasks/new' }),
  ])
    assert.equal(spaceLoginDestination(destination, true, a), destination);
  assert.equal(spaceLoginDestination('https://example.test/', true, a), '/');
});

test('central membership overrides local roles; Base isolation, fresh revocation and last Admin checks', async () => {
  const h = await fixture();
  delete h.central.tables.users[0].fields['System Role'];
  try {
    const identity = userDto(h.central.tables.users[0]);
    const first = await authorizeSpace(h.db, c, h.control, identity, a);
    const second = await authorizeSpace(h.db, c, h.control, identity, b);
    assert.equal(first.user.role, 'Admin');
    assert.equal(second.user.role, 'Agent');
    assert.equal((await ownTask(first.repo, first.user, rid(11))).title, 'SPACE A ONLY');
    assert.equal((await ownTask(second.repo, second.user, rid(11))).title, 'SPACE B ONLY');
    h.second.tables.tasks.push({ id: rid(90), fields: { ...h.second.tables.tasks[0].fields } });
    assert.equal((await ownTask(second.repo, second.user, rid(90))).title, 'SPACE B ONLY');
    await assert.rejects(ownTask(first.repo, first.user, rid(90)), {
      status: 404,
      code: 'TASK_NOT_FOUND',
      message: 'ไม่พบงานใน Space นี้ กรุณาตรวจ Space ที่เลือก',
    });
    const listCalls: string[] = [];
    const unavailable = workspaceRepository(
      {
        ...h.first.repo,
        async list(_table, formula) {
          listCalls.push(formula || '');
          throw new AppError(503, 'AIRTABLE_ERROR', 'บริการข้อมูลไม่พร้อมใช้งาน');
        },
      },
      h.control,
      rid(101),
    );
    await assert.rejects(unavailable.get('tasks', '../other-base'));
    assert.equal(listCalls.length, 0);
    await assert.rejects(unavailable.get('tasks', rid(90)), {
      status: 503,
      code: 'AIRTABLE_ERROR',
    });
    assert.deepEqual(listCalls, ['RECORD_ID()="' + rid(90) + '"']);
    await assert.rejects(ownTask(second.repo, second.user, rid(12)));
    await assert.rejects(authorizeSpace(h.db, c, h.control, userDto(h.central.tables.users[1]), b));
    await assert.rejects(h.control.requireOwner(rid(3)));
    await assert.rejects(
      updateMember(h.db, c, h.control, identity, b, {
        email: 'agent-a@gmail.com',
        role: 'Admin',
        active: true,
      }),
    );
    await assert.rejects(
      updateMember(h.db, c, h.control, identity, a, {
        email: identity.email,
        role: 'Agent',
        active: true,
      }),
      { code: 'LAST_WORKSPACE_ADMIN' },
    );
    await assert.rejects(createSpace(h.db, c, h.control, userDto(h.central.tables.users[2]), {}));
    await updateMember(h.db, c, h.control, identity, a, {
      email: 'agent-b@gmail.com',
      role: 'Secretary',
      active: false,
    });
    assert.equal((await h.control.member(rid(101), rid(3))).active, false);
    assert.equal((await h.control.member(rid(102), rid(3))).role, 'Admin');
    const directory = await bootstrap(first.repo, first.user);
    assert.equal(directory.users.find((u) => u.id === rid(2))?.role, 'Agent');
    h.members.tables.users[0].fields.Active = false;
    await assert.rejects(authorizeSpace(h.db, c, h.control, identity, a));
    h.members.tables.users[0].fields.Active = true;
    h.central.tables.users[0].fields.Active = false;
    await assert.rejects(authorizeSpace(h.db, c, h.control, identity, b));
    h.central.tables.users[0].fields.Active = true;
    h.spaces.tables.users[1].fields.Active = false;
    await assert.rejects(spaceServices(h.db, c, h.control, b), { code: 'WORKSPACE_PAUSED' });
    await assert.rejects(modeGuard(h.db, config), { code: 'WORKSPACE_MODE_REQUIRED' });
    await modeGuard(h.db, c);
    await assert.rejects(modeGuard(h.db, { ...c, AIRTABLE_CONTROL_BASE_ID: baseB }), {
      code: 'WORKSPACE_CONTROL_MISMATCH',
    });
    await assert.rejects(
      workspaceRepository(h.first.repo, h.control, rid(101)).patch('users', rid(2), {
        Role: 'Admin',
      }),
    );
  } finally {
    await h.engine.close();
  }
});

test('SQL scopes preserve default data, fail closed without tables, and rollback without leaking search_path', async () => {
  const h = await fixture();
  try {
    const dbB = workspaceDatabase(h.db, schemaB);
    await h.db.query(
      "INSERT INTO hvr_registrations(environment,subject,email,profile,state) VALUES($1,'same','a@test.local','{}','review')",
      [c.APP_ENV],
    );
    await dbB.query(
      "INSERT INTO hvr_registrations(environment,subject,email,profile,state) VALUES($1,'same','b@test.local','{}','review')",
      [c.APP_ENV],
    );
    assert.equal(
      (await h.db.query('SELECT email FROM hvr_registrations')).rows[0].email,
      'a@test.local',
    );
    assert.equal(
      (await dbB.query('SELECT email FROM hvr_registrations')).rows[0].email,
      'b@test.local',
    );
    await assert.rejects(
      dbB.transaction(async (tx) => {
        await tx.query('DELETE FROM hvr_registrations');
        throw new Error('rollback');
      }),
    );
    assert.equal((await dbB.query('SELECT count(*)::int n FROM hvr_registrations')).rows[0].n, 1);
    await assert.rejects(dbB.query('SELECT * FROM hvr_workspaces')); // No public fallback.
    assert.equal((await h.db.query('SELECT count(*)::int n FROM hvr_workspaces')).rows[0].n, 2);
    assert.throws(() => workspaceDatabase(h.db, 'public; DROP SCHEMA public'));
    const csrfA = workspaceCsrf('a'.repeat(64), a),
      csrfB = workspaceCsrf('a'.repeat(64), b);
    assert.notEqual(csrfA, csrfB);
    await assert.rejects(async () =>
      requireCsrf(
        new Request(c.APP_ORIGIN, { headers: { Origin: c.APP_ORIGIN, 'X-CSRF-Token': csrfA } }),
        csrfB,
        c,
      ),
    );
    const link = workspaceUrl({ ...c, workspace: { id: b, name: 'B' } }, '/tasks/' + rid(11));
    const returnTo = new URL(link).pathname + new URL(link).search;
    assert.equal(safeReturnTo(returnTo), returnTo);
  } finally {
    await h.engine.close();
  }
});

test('LINE uses explicit Space: link codes, tickets, replay, ownership and unfollow stay isolated', async () => {
  const h = await fixture();
  delete h.central.tables.users[0].fields['System Role'];
  const signed = (body: unknown) => {
    const raw = JSON.stringify(body);
    return [
      raw,
      createHmac('sha256', c.AI_LINE_CHANNEL_SECRET).update(raw).digest('base64'),
    ] as const;
  };
  const event = (text: string, type = 'message') => ({
    destination: bot,
    events: [
      {
        webhookEventId: randomUUID(),
        type,
        timestamp: Date.now(),
        source: { type: 'user', userId: lineId },
        replyToken: 'synthetic-reply',
        message: { type: 'text', text },
      },
    ],
  });
  const transport: typeof fetch = async () =>
    Response.json({ userId: lineId, displayName: 'Synthetic LINE' });
  try {
    const identity = userDto(h.central.tables.users[0]);
    const first = await authorizeSpace(h.db, c, h.control, identity, a),
      second = await authorizeSpace(h.db, c, h.control, identity, b);
    const code = await startAiLink(second.db, second.config, second.user);
    await registerLineCode(h.db, second.config, 'ai', code.code);
    const payload = event(code.code);
    await assert.rejects(
      receiveSpaceAi(h.db, c, h.control, signed(payload)[0] + ' ', signed(payload)[1]),
    );
    await receiveSpaceAi(h.db, c, h.control, ...signed(payload));
    assert.equal((await first.db.query('SELECT * FROM hvr_ai_links')).rows.length, 0);
    await confirmAiLink(second.db, second.config, second.user, lineId, transport);
    await selectAiSpace(h.db, second.db, second.config, second.user);
    const question = event('สรุปงานวันนี้');
    const result = await receiveSpaceAi(h.db, c, h.control, ...signed(question));
    assert.ok(JSON.stringify(result).includes('SPACE B ONLY'));
    assert.ok(!JSON.stringify(result).includes('SPACE A ONLY'));
    let sent = '';
    await replySpaceAi(
      h.db,
      c,
      h.control,
      result.jobs[0].ticket,
      'สถานะทีม B',
      async (_url, options) => {
        sent = String(options?.body);
        return Response.json({});
      },
    );
    assert.ok(sent.includes('[Space: Team B]'));
    const waiting = await receiveSpaceAi(h.db, c, h.control, ...signed(event('สรุปงานวันนี้')));
    await first.db.query(
      'INSERT INTO hvr_ai_accounts(environment,user_id,line_id,display_name) VALUES($1,$2,$3,$4)',
      [c.APP_ENV, first.user.id, lineId, 'Synthetic LINE'],
    );
    await selectAiSpace(h.db, first.db, first.config, first.user);
    await assert.rejects(
      replySpaceAi(h.db, c, h.control, waiting.jobs[0].ticket, 'old answer', transport),
    );
    assert.equal((await receiveSpaceAi(h.db, c, h.control, ...signed(question))).jobs.length, 0);
    await selectAiSpace(h.db, second.db, second.config, second.user);
    await assert.rejects(
      replySpaceAi(h.db, c, h.control, waiting.jobs[0].ticket, 'old answer', transport),
    );
    const link = await startLink(second.db, second.config, second.user);
    await registerLineCode(h.db, second.config, 'notifications', link.code);
    await receiveSpaceNotifications(h.db, c, h.control, event(link.code));
    assert.equal(
      (await second.db.query('SELECT candidate_id FROM hvr_line_links')).rows[0].candidate_id,
      lineId,
    );
    assert.equal((await first.db.query('SELECT * FROM hvr_line_links')).rows.length, 0);
    await receiveSpaceAi(h.db, c, h.control, ...signed(event('', 'unfollow')));
    assert.equal((await first.db.query('SELECT * FROM hvr_ai_accounts')).rows.length, 0);
    assert.equal((await second.db.query('SELECT * FROM hvr_ai_accounts')).rows.length, 0);
  } finally {
    await h.engine.close();
  }
});

test('default bootstrap keeps business records and maps identities into a separate Control Base', async () => {
  const { db, engine } = await database();
  const old = repository(),
    central = repository(),
    spaces = repository(),
    members = repository();
  central.tables.users = [];
  spaces.tables.users = [];
  members.tables.users = [];
  old.tables.users[0].fields.Role = 'Admin';
  const control = new ControlPlane(c, db, {
    users: central.repo,
    spaces: spaces.repo,
    members: members.repo,
  });
  try {
    await db.query(
      'INSERT INTO hvr_identity_bindings(environment,user_id,subject) VALUES($1,$2,$3)',
      [c.APP_ENV, rid(1), 'secretary'],
    );
    await db.query(
      `INSERT INTO hvr_sessions(environment,token_hash,user_id,subject,csrf_token,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '1 hour')`,
      [c.APP_ENV, hash('old-token'), rid(1), 'secretary', 'a'.repeat(64)],
    );
    const before = structuredClone(old.tables.tasks);
    const result = await initializeSpaces(db, c, control, old.repo, 'secretary@example.test');
    assert.equal(result.members, 3);
    assert.deepEqual(old.tables.tasks, before);
    assert.equal((await db.query('SELECT * FROM hvr_sessions')).rows.length, 0);
    const owner = central.tables.users.find((u) => u.fields['System Role'] === 'Owner');
    assert.ok(owner);
    assert.equal(owner.fields['Google Subject'], 'secretary');
    assert.equal(
      (await db.query('SELECT user_id FROM hvr_identity_bindings')).rows[0].user_id,
      owner.id,
    );
    assert.equal((await control.member(rid(1000), owner.id)).localUserId, rid(1));
    await assert.rejects(initializeSpaces(db, c, control, old.repo, 'secretary@example.test'), {
      code: 'WORKSPACES_INITIALIZED',
    });
  } finally {
    await engine.close();
  }
});

test('Owner setup validates an empty Base, completes once and blocks retries after uncertain control writes', async () => {
  const h = await fixture();
  try {
    const input = {
      requestId: randomUUID(),
      name: 'Synthetic New Team',
      adminEmail: 'agent-b@gmail.com',
      credentials: { ...credentials(), AIRTABLE_BASE_ID: 'app00000000000097' },
      schemaToken: 'schema-test-token-never-live',
    };
    let calls = 0,
      nonempty = true;
    const transport: typeof fetch = async (url, options) => {
      calls++;
      if (String(url).includes('/meta/')) return Response.json(schemaFixture().value);
      if (String(url).includes(c.AIRTABLE_TASKS_TABLE) && nonempty)
        return Response.json({ records: h.first.tables.tasks });
      if (options?.method === 'PATCH') {
        const body = JSON.parse(String(options.body));
        return Response.json({ records: [{ id: rid(500), fields: body.records[0].fields }] });
      }
      return Response.json({ records: [] });
    };
    const owner = userDto(h.central.tables.users[0]);
    await assert.rejects(createSpace(h.db, c, h.control, owner, input, transport), {
      code: 'WORKSPACE_NOT_EMPTY',
    });
    assert.equal((await h.db.query('SELECT * FROM hvr_workspace_setups')).rows.length, 0);
    nonempty = false;
    const result = await createSpace(h.db, c, h.control, owner, input, transport);
    assert.equal(result.id, input.requestId);
    const row = (await h.db.query('SELECT * FROM hvr_workspaces WHERE id=$1', [result.id])).rows[0];
    assert.equal(row.active, true);
    assert.ok(!row.credentials.includes(input.credentials.AIRTABLE_TOKEN));
    assert.equal(
      (await workspaceDatabase(h.db, row.schema_name).query('SELECT * FROM hvr_instances')).rows[0]
        .base_id,
      input.credentials.AIRTABLE_BASE_ID,
    );
    const before = calls;
    assert.deepEqual(await createSpace(h.db, c, h.control, owner, input, transport), result);
    assert.equal(calls, before);
    h.control.spaces.upsert = async () => {
      throw new Error('uncertain control write');
    };
    const next = {
      ...input,
      requestId: randomUUID(),
      credentials: { ...input.credentials, AIRTABLE_BASE_ID: 'app00000000000098' },
    };
    await assert.rejects(createSpace(h.db, c, h.control, owner, next, transport), {
      code: 'WORKSPACE_SETUP_REVIEW',
    });
    const afterFailure = calls;
    await assert.rejects(createSpace(h.db, c, h.control, owner, next, transport), {
      code: 'WORKSPACE_SETUP_REVIEW',
    });
    assert.equal(calls, afterFailure);
    assert.equal(
      (await h.db.query('SELECT * FROM hvr_workspaces WHERE id=$1', [next.requestId])).rows.length,
      0,
    );
  } finally {
    await h.engine.close();
  }
});
