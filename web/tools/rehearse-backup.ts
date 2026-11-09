// Opt-in staging-only rehearsal. No restore destination supplied by the operator is accepted.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { getCACertificates } from 'node:tls';
import { parseArgs } from 'node:util';
import { Pool, type PoolClient } from 'pg';
import { readMigrationConfig } from '../src/server/config';
import { localEnvironment } from './environment';

const testBase = 'appoQzvQwGShlq4OJ';
const { values } = parseArgs({ options: { 'confirm-test-base': { type: 'string' } } });
const config = readMigrationConfig(localEnvironment());
const source = new URL(config.DATABASE_URL);
if (
  values['confirm-test-base'] !== testBase ||
  config.APP_ENV !== 'staging' ||
  config.AIRTABLE_BASE_ID !== testBase ||
  !source.hostname.endsWith('.neon.tech') ||
  source.hostname.includes('-pooler') ||
  !/^[a-f0-9]{64}$/i.test(process.env.HVR_BACKUP_ENCRYPTION_KEY || '')
)
  throw new Error(
    'Explicit staging/test Base, direct Neon TLS connection and backup encryption key required',
  );

const key = Buffer.from(process.env.HVR_BACKUP_ENCRYPTION_KEY || '', 'hex');
const magic = Buffer.from('HVRBACKUP1');
function encrypt(data: Buffer) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(magic);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([magic, iv, cipher.getAuthTag(), ciphertext]);
}
function decrypt(data: Buffer) {
  assert.ok(data.subarray(0, magic.length).equals(magic), 'Known backup envelope required');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    key,
    data.subarray(magic.length, magic.length + 12),
  );
  cipher.setAAD(magic);
  cipher.setAuthTag(data.subarray(magic.length + 12, magic.length + 28));
  return Buffer.concat([cipher.update(data.subarray(magic.length + 28)), cipher.final()]);
}
async function command(args: string[], input?: Buffer, env = process.env, allowFailure = false) {
  return new Promise<{ code: number | null; output: Buffer; error: string }>((done, reject) => {
    const child = spawn('docker', args, { env, windowsHide: true, timeout: 45000 });
    const chunks: Buffer[] = [],
      errors: Buffer[] = [];
    child.stdout.on('data', (chunk) => chunks.push(chunk));
    child.stderr.on('data', (chunk) => errors.push(chunk));
    child.stdin.on('error', () => {});
    child.once('error', reject);
    child.once('close', (code) => {
      const result = {
        code,
        output: Buffer.concat(chunks),
        error: Buffer.concat(errors).toString(),
      };
      if (code !== 0 && !allowFailure) {
        void writeFile(resolve(directory, 'command-error.private.txt'), result.error).then(
          () => reject(new Error('Docker/PostgreSQL command failed')),
          reject,
        );
      } else done(result);
    });
    child.stdin.end(input);
  });
}

const runId = randomUUID(),
  fixture = `hvr_backup_${runId.replaceAll('-', '')}`;
const container = `hvr-restore-${runId}`,
  dumpContainer = `hvr-dump-${runId}`;
const image = 'postgres:18.6';
const directory = resolve(import.meta.dirname, '../../artifacts/vercel/backups', runId);
const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 2,
  connectionTimeoutMillis: 15000,
});
let snapshot: PoolClient | undefined,
  fixtureAttempted = false;
const report: Record<string, unknown> = {
  runId,
  fixture,
  startedAt: new Date().toISOString(),
  passed: false,
  phase: 'preflight',
  scope:
    'Neon staging public schema plus isolated synthetic fixture; encrypted archive; network-isolated local restore',
};
await mkdir(directory, { recursive: true });
const persist = () => writeFile(resolve(directory, 'report.json'), JSON.stringify(report, null, 2));
const phase = async (value: string) => {
  report.phase = value;
  await persist();
};
const tables = [
  'hvr_identity_bindings',
  'hvr_instances',
  'hvr_migrations',
  'hvr_oauth',
  'hvr_operations',
  'hvr_rate_limits',
  'hvr_recovery_events',
  'hvr_registrations',
  'hvr_resources',
  'hvr_runtime',
  'hvr_sessions',
  'hvr_workflow_history',
  'hvr_workflows',
  'hvr_line_settings',
  'hvr_line_links',
  'hvr_line_accounts',
  'hvr_line_deliveries',
];
const digestQuery = (schema: string, table: string) =>
  `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C"),'[]'::jsonb)::text FROM "${schema}"."${table}" t`;
const objectsQuery = (
  schema: string,
) => `SELECT COALESCE(jsonb_agg(x ORDER BY x::text COLLATE "C"),'[]'::jsonb)::text FROM (
  SELECT c.relname AS table_name,k.conname,k.contype,pg_get_constraintdef(k.oid) AS definition
  FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='${schema}' AND c.relname LIKE 'hvr_%') x`;
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
async function restored(sql: string) {
  return (
    (
      await command([
        'exec',
        container,
        'psql',
        '-U',
        'postgres',
        '-d',
        'hvr_restore_test',
        '-XAt',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        `SET timezone='UTC';SET search_path=pg_catalog;${sql}`,
      ])
    ).output
      .toString()
      .trim()
      .split('\n')
      .at(-1) || ''
  );
}
async function removeOwnedContainer(name: string, role: string) {
  const found = await command(
    ['inspect', '--type', 'container', name],
    undefined,
    process.env,
    true,
  );
  if (found.code !== 0) {
    if (/No such (object|container)/i.test(found.error)) return true;
    throw new Error('Container cleanup could not be verified');
  }
  const current = JSON.parse(found.output.toString())[0];
  assert.equal(current.Config.Labels?.['hvr.run'], runId);
  assert.equal(current.Config.Labels?.['hvr.role'], role);
  assert.equal(current.Name, `/${name}`);
  if (role === 'restore') assert.equal(current.HostConfig.NetworkMode, 'none');
  await command(['stop', current.Id]);
  return true;
}
try {
  await persist();
  const metadata = JSON.parse((await command(['image', 'inspect', image])).output.toString())[0];
  report.imageId = metadata.Id;
  const bindings = (
    await pool.query(
      'SELECT i.environment,i.base_id,r.task_writes,r.jobs FROM hvr_instances i JOIN hvr_runtime r USING(environment)',
    )
  ).rows;
  assert.deepEqual(bindings, [
    { environment: 'staging', base_id: testBase, task_writes: false, jobs: false },
  ]);
  assert.equal(
    Number(
      (
        await pool.query(
          "SELECT count(*) AS n FROM hvr_operations WHERE state IN ('pending','running','review')",
        )
      ).rows[0].n,
    ),
    0,
    'Reconcile unfinished operations before rehearsal',
  );
  assert.equal(
    Number(
      (await pool.query("SELECT count(*) AS n FROM pg_namespace WHERE nspname LIKE 'hvr_backup_%'"))
        .rows[0].n,
    ),
    0,
    'Review any previous fixture before starting again',
  );
  assert.deepEqual(
    (
      await pool.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename),
    tables,
  );
  assert.match(fixture, /^hvr_backup_[a-f0-9]{32}$/);
  await phase('seed-isolated-fixture');
  const seed = await pool.connect();
  try {
    await seed.query('BEGIN');
    fixtureAttempted = true;
    await seed.query(`CREATE SCHEMA "${fixture}"`);
    await seed.query(`COMMENT ON SCHEMA "${fixture}" IS 'hvr-backup:${runId}'`);
    await seed.query(`SET LOCAL search_path="${fixture}",pg_catalog`);
    for (const name of (await readdir('db/migrations'))
      .filter((n) => /^\d+_[a-z_]+\.sql$/.test(n))
      .sort())
      await seed.query(await readFile(resolve('db/migrations', name), 'utf8'));
    await seed.query('CREATE TABLE hvr_migrations (LIKE public.hvr_migrations INCLUDING ALL)');
    await seed.query('INSERT INTO hvr_migrations SELECT * FROM public.hvr_migrations');
    await seed.query('INSERT INTO hvr_instances(environment,base_id) VALUES ($1,$2)', [
      'staging',
      testBase,
    ]);
    await seed.query("INSERT INTO hvr_runtime(environment) VALUES ('staging')");
    const user = 'rec00000000000002',
      subject = `backup-synthetic-${runId}`;
    await seed.query("INSERT INTO hvr_identity_bindings VALUES ('staging',$1,$2)", [user, subject]);
    await seed.query(
      "INSERT INTO hvr_sessions VALUES ('staging',$1,$2,$3,$4,clock_timestamp()+interval '1 hour')",
      [randomBytes(32).toString('hex'), user, subject, randomBytes(32).toString('hex')],
    );
    await seed.query(
      "INSERT INTO hvr_oauth(environment,state_hash,binding_hash,verifier,nonce,return_to,expires_at) VALUES ('staging',$1,$2,$3,$4,'/tasks/new',clock_timestamp()+interval '10 minutes')",
      Array.from({ length: 4 }, () => randomBytes(32).toString('hex')),
    );
    const reviewId = randomUUID(),
      completedId = randomUUID();
    const steps = {
      patch: {
        state: 'started',
        write: true,
        intent: {
          kind: 'patch',
          table: 'tasks',
          recordId: 'rec00000000000011',
          fields: { Status: 'Completed', 'Completed At': null },
        },
      },
    };
    for (const [id, state, resource] of [
      [reviewId, 'review', 'task:rec00000000000011'],
      [completedId, 'completed', 'task:rec00000000000012'],
    ])
      await seed.query(
        `INSERT INTO hvr_operations(environment,id,user_id,request_id,fingerprint,resource,action,payload,steps,state,result)
        VALUES ('staging',$1,$2,$3,$4,$5,'status',$6,$7,$8,$9)`,
        [
          id,
          user,
          randomUUID(),
          sha(id),
          resource,
          JSON.stringify({ id: resource.slice(5), status: 'Completed', label: '[BACKUP TEST]' }),
          JSON.stringify(state === 'review' ? steps : {}),
          state,
          state === 'completed' ? JSON.stringify({ id: resource.slice(5) }) : null,
        ],
      );
    await seed.query("INSERT INTO hvr_resources VALUES ('staging','task:rec00000000000011',$1)", [
      reviewId,
    ]);
    await seed.query(
      `INSERT INTO hvr_recovery_events(event_id,environment,operation_id,action,operator_label,evidence_ref,from_state,to_state)
      VALUES ($1,'staging',$2,'mark-stopped','backup-rehearsal',$3,'running','review')`,
      [randomUUID(), reviewId, `test/backup/${runId}`],
    );
    await seed.query('INSERT INTO hvr_rate_limits(base_id) VALUES ($1)', [testBase]);
    await seed.query('COMMIT');
  } catch (error) {
    await seed.query('ROLLBACK');
    throw error;
  } finally {
    seed.release();
  }

  await phase('snapshot-and-dump');
  snapshot = await pool.connect();
  await snapshot.query(
    "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;SET LOCAL timezone='UTC';SET LOCAL search_path=pg_catalog",
  );
  const snapshotId = (await snapshot.query('SELECT pg_export_snapshot() AS id')).rows[0]
    .id as string;
  const expected: { schema: string; table: string; hash: string }[] = [];
  const objectHashes: Record<string, string> = {};
  for (const schema of ['public', fixture]) {
    for (const table of tables)
      expected.push({
        schema,
        table,
        hash: sha((await snapshot.query(digestQuery(schema, table))).rows[0].coalesce),
      });
    objectHashes[schema] = sha((await snapshot.query(objectsQuery(schema))).rows[0].coalesce);
  }
  const pgEnv = {
    ...process.env,
    PGHOST: source.hostname,
    PGPORT: source.port || '5432',
    PGUSER: decodeURIComponent(source.username),
    PGPASSWORD: decodeURIComponent(source.password),
    PGDATABASE: decodeURIComponent(source.pathname.slice(1)),
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: '/hvr-ca.pem',
  };
  // The minimal PostgreSQL image has no system CA bundle. Use the same trust roots
  // as this Node client, mounted read-only; never weaken verify-full.
  const certificates = [...new Set(getCACertificates('default'))];
  assert.ok(certificates.length > 0, 'Trusted CA certificates required');
  const caPath = resolve(directory, 'trusted-ca.pem');
  await writeFile(caPath, certificates.join('\n'), { flag: 'wx' });
  report.caSource = 'Node default trust store';
  report.caCertificates = certificates.length;
  report.dumpSslMode = 'verify-full';
  const dump = (
    await command(
      [
        'run',
        '--rm',
        '--pull=never',
        '--name',
        dumpContainer,
        '--label',
        `hvr.run=${runId}`,
        '--label',
        'hvr.role=dump',
        '--mount',
        `type=bind,source=${caPath},target=/hvr-ca.pem,readonly`,
        ...[
          'PGHOST',
          'PGPORT',
          'PGUSER',
          'PGPASSWORD',
          'PGDATABASE',
          'PGSSLMODE',
          'PGSSLROOTCERT',
        ].flatMap((k) => ['-e', k]),
        image,
        'pg_dump',
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        '--no-comments',
        '--strict-names',
        '--schema=public',
        `--schema=${fixture}`,
        `--snapshot=${snapshotId}`,
        '--lock-wait-timeout=5s',
      ],
      undefined,
      pgEnv,
    )
  ).output;
  assert.ok(dump.subarray(0, 5).equals(Buffer.from('PGDMP')));
  await snapshot.query('COMMIT');
  snapshot.release();
  snapshot = undefined;
  const archivePath = resolve(directory, 'operational.dump.enc');
  await writeFile(archivePath, encrypt(dump), { flag: 'wx', mode: 0o600 });
  const encrypted = await readFile(archivePath);
  const tampered = Buffer.from(encrypted);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decrypt(tampered), 'Corrupt archives must fail authentication');
  const restoredBytes = decrypt(encrypted);
  assert.equal(sha(restoredBytes), sha(dump));
  report.archiveBytes = encrypted.length;
  report.archiveSha256 = sha(encrypted);
  report.tamperRejected = true;

  await phase('restore-in-quarantine');
  const id = (
    await command([
      'run',
      '--detach',
      '--rm',
      '--pull=never',
      '--network=none',
      '--name',
      container,
      '--label',
      `hvr.run=${runId}`,
      '--label',
      'hvr.role=restore',
      '-e',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      '-e',
      'POSTGRES_DB=hvr_restore_test',
      image,
    ])
  ).output
    .toString()
    .trim();
  assert.match(id, /^[a-f0-9]{64}$/);
  const startupDeadline = Date.now() + 30000;
  let ready = false;
  while (Date.now() < startupDeadline) {
    ready =
      (
        await command(
          // The image first starts a Unix-socket-only temporary server during init.
          // Wait for TCP so a passing probe cannot race that server's shutdown.
          [
            'exec',
            container,
            'pg_isready',
            '-h',
            '127.0.0.1',
            '-U',
            'postgres',
            '-d',
            'hvr_restore_test',
          ],
          undefined,
          process.env,
          true,
        )
      ).code === 0;
    if (ready) break;
    await new Promise((done) => setTimeout(done, 200));
  }
  assert.ok(ready, 'Scratch PostgreSQL must start');
  await command(
    [
      'exec',
      '-i',
      container,
      'pg_restore',
      '-U',
      'postgres',
      '-d',
      'hvr_restore_test',
      '--exit-on-error',
      '--single-transaction',
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
    ],
    restoredBytes,
  );
  await phase('verify-restored-data');
  for (const item of expected)
    assert.equal(
      sha(await restored(digestQuery(item.schema, item.table))),
      item.hash,
      'Restored rows must match the exported snapshot',
    );
  for (const schema of ['public', fixture])
    assert.equal(
      sha(await restored(objectsQuery(schema))),
      objectHashes[schema],
      'Restored constraints must match',
    );
  const state =
    await restored(`SELECT json_build_object('review',(SELECT count(*) FROM "${fixture}".hvr_operations WHERE state='review'),
    'reservation',(SELECT count(*) FROM "${fixture}".hvr_resources),'writes',(SELECT task_writes FROM public.hvr_runtime WHERE environment='staging'),
    'jobs',(SELECT jobs FROM public.hvr_runtime WHERE environment='staging'))::text`);
  assert.deepEqual(JSON.parse(state), { review: 1, reservation: 1, writes: false, jobs: false });
  report.verifiedTables = expected.length;
  report.constraintSetsVerified = 2;
  report.restoredReviewReservation = true;
  report.quarantineNetwork = 'none';
  report.noPublishedPorts = true;
  report.verificationPassed = true;
} catch (error) {
  report.failedPhase = report.phase;
  report.failureType = error instanceof Error ? error.name : 'UnknownError';
  report.failure = 'Rehearsal failed; inspect phase and retained report before retrying';
  process.exitCode = 1;
} finally {
  if (snapshot) {
    try {
      await snapshot.query('ROLLBACK');
    } catch {
      report.snapshotRollbackFailed = true;
    } finally {
      snapshot.release();
    }
  }
  try {
    if (fixtureAttempted) {
      assert.match(fixture, /^hvr_backup_[a-f0-9]{32}$/);
      const marker = (
        await pool.query(
          "SELECT obj_description(oid,'pg_namespace') AS marker FROM pg_namespace WHERE nspname=$1",
          [fixture],
        )
      ).rows[0];
      if (marker) {
        assert.equal(marker.marker, `hvr-backup:${runId}`);
        await pool.query(`DROP SCHEMA "${fixture}" CASCADE`);
      }
      assert.equal(
        Number(
          (await pool.query('SELECT count(*) AS n FROM pg_namespace WHERE nspname=$1', [fixture]))
            .rows[0].n,
        ),
        0,
      );
    }
    report.fixtureRemoved = true;
  } catch {
    report.cleanupFailed = true;
    process.exitCode = 1;
  }
  for (const [name, role] of [
    [dumpContainer, 'dump'],
    [container, 'restore'],
  ]) {
    try {
      report[`${role}ContainerRemoved`] = await removeOwnedContainer(name, role);
    } catch {
      report.cleanupFailed = true;
      process.exitCode = 1;
    }
  }
  await pool.end();
  report.passed = report.verificationPassed === true && report.cleanupFailed !== true;
  report.finishedAt = new Date().toISOString();
  report.phase = 'finished';
  await persist();
  console.log(JSON.stringify(report));
}
