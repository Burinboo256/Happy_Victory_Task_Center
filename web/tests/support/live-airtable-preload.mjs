// Explicit local HTTP rehearsal only. Real auth/DB/upstream; lost ACK or bounded two-request barrier.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = 'appoQzvQwGShlq4OJ';
const folder = resolve(dirname(fileURLToPath(import.meta.url)), '../../../artifacts/vercel');
const controlFile = resolve(process.env.HVR_LIVE_REHEARSAL_FILE || '.');
if (
  dirname(controlFile) !== folder ||
  !/^live-http-[a-f0-9-]{36}\.json$/.test(controlFile.slice(folder.length + 1)) ||
  process.env.APP_ORIGIN !== 'http://localhost:3001'
)
  throw new Error('Explicit isolated local HTTP rehearsal configuration required');

const upstream = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== 'https://api.airtable.com') return upstream(input, init);
  if (
    process.env.APP_ENV !== 'development' ||
    process.env.AIRTABLE_BASE_ID !== base ||
    process.env.JOBS_ENABLED !== 'false' ||
    process.env.ENABLE_EMAIL_NOTIFICATIONS !== 'false' ||
    process.env.ENABLE_LINE_NOTIFICATIONS !== 'false' ||
    !url.pathname.startsWith('/v0/' + base + '/')
  )
    throw new Error('Live rehearsal is restricted to the configured isolated test Base');
  const control = JSON.parse(readFileSync(controlFile, 'utf8'));
  if (![undefined, 'lost-ack', 'barrier'].includes(control.mode))
    throw new Error('Unknown rehearsal mode');
  const method = init?.method || (input instanceof Request ? input.method : 'GET');
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
  const fields = body.fields || body.records?.[0]?.fields || {};
  const create =
    method === 'PATCH' &&
    url.pathname.split('/')[3] === process.env.AIRTABLE_TASKS_TABLE &&
    typeof fields['Request Key'] === 'string' &&
    String(fields['Task Title'] || '').startsWith(
      control.mode === 'barrier' ? '[HTTP CONCURRENT TEST]' : '[HTTP LIVE TEST]',
    );
  const participant =
    control.mode === 'barrier' &&
    typeof fields['Operation Key'] === 'string' &&
    fields['Operation Key'].endsWith(':audit')
      ? control.participants?.[fields['Operation Key'].slice(0, -6)]
      : undefined;
  const audit =
    method === 'PATCH' &&
    url.pathname.split('/')[3] === process.env.AIRTABLE_UPDATES_TABLE &&
    (participant || fields['Operation Key'] === control.operationKey + ':audit');
  if (create) {
    control.taskWriteRequests = (control.taskWriteRequests || 0) + 1;
    if (control.mode === 'barrier') {
      control.participants ||= {};
      control.participants[fields['Request Key']] ||= {
        ownerId: fields.Agent?.[0],
        receivedAt: new Date().toISOString(),
        taskWriteRequests: 0,
      };
      control.participants[fields['Request Key']].taskWriteRequests++;
      if (Object.keys(control.participants).length > 2)
        throw new Error('Only two deliberate concurrent requests are allowed');
    } else control.operationKey = fields['Request Key'];
  }
  if (audit) {
    control.auditWriteRequests = (control.auditWriteRequests || 0) + 1;
    if (participant) participant.auditWriteRequests = (participant.auditWriteRequests || 0) + 1;
  }
  if (create || audit) writeFileSync(controlFile, JSON.stringify(control, null, 2));
  const response = await upstream(input, init);
  if (create && control.mode === 'barrier' && response.ok) {
    const bytes = await response.arrayBuffer();
    const latest = JSON.parse(readFileSync(controlFile, 'utf8'));
    latest.participants[fields['Request Key']].acceptedAt = new Date().toISOString();
    if (Object.values(latest.participants).filter((p) => p.acceptedAt).length === 2)
      latest.releaseAt ||= Date.now() + 1500;
    writeFileSync(controlFile, JSON.stringify(latest, null, 2));
    // Keep both journals running long enough for the independent SQL observer to verify overlap.
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      const current = JSON.parse(readFileSync(controlFile, 'utf8'));
      if (current.releaseAt && Date.now() >= current.releaseAt)
        return new Response(bytes, { status: response.status, headers: response.headers });
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    throw new TypeError('Concurrent partner did not arrive; inspect the existing operation');
  }
  if (create && control.armed === true && response.ok) {
    await response.arrayBuffer();
    const latest = JSON.parse(readFileSync(controlFile, 'utf8'));
    if (latest.armed === true) {
      latest.armed = false;
      latest.lossApplied = true;
      writeFileSync(controlFile, JSON.stringify(latest, null, 2));
      throw new TypeError('Injected response loss after real Airtable acknowledgement');
    }
    throw new TypeError('Concurrent lost-ACK rehearsal is unsupported; inspect this operation');
  }
  return response;
};
