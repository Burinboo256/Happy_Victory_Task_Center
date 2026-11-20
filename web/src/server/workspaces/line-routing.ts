import type { Config } from '../config';
import type { Sql } from '../db';
import type { User } from '../../domain/model';
import { hash } from '../auth/security';
import { AppError, forbidden } from '../errors';
import { receiveAi, replyAi, verifyAiEnvelope, type AiJob } from '../ai/line';
import { receiveWebhook } from '../line/accounts';
import { drainLineQueue } from '../line/queue';
import type { ControlPlane } from './control';
import { spaceServices, type SpaceRow } from './service';
import { workspaceDatabase } from './database';

export async function registerLineCode(
  root: Sql,
  c: Config,
  kind: 'ai' | 'notifications',
  code: string,
) {
  if (!c.workspace) return;
  const value = code.split(' ')[1];
  if (!/^[a-f0-9]{24}$/.test(value || '')) throw forbidden();
  await root.query(
    `DELETE FROM public.hvr_workspace_line_codes WHERE environment=$1 AND expires_at<clock_timestamp()`,
    [c.APP_ENV],
  );
  await root.query(
    `INSERT INTO public.hvr_workspace_line_codes(environment,kind,code_hash,workspace_id,expires_at)
    VALUES($1,$2,$3,$4,clock_timestamp()+interval '10 minutes')`,
    [c.APP_ENV, kind, hash(value), c.workspace.id],
  );
}

export async function selectAiSpace(root: Sql, db: Sql, c: Config, user: User) {
  if (!c.workspace) return;
  // A new binding invalidates previous tickets, memories and draft confirmations on returning to a Space.
  const account = (
    await db.query(
      `UPDATE hvr_ai_accounts SET binding=gen_random_uuid()
    WHERE environment=$1 AND user_id=$2 RETURNING line_id,binding`,
      [c.APP_ENV, user.id],
    )
  ).rows[0];
  if (!account) throw new AppError(409, 'AI_LINK_REQUIRED', 'กรุณาเชื่อม LINE ของคุณใน Space นี้ก่อน');
  await root.query(
    `INSERT INTO public.hvr_workspace_line_routes(environment,line_id,workspace_id,binding)
    VALUES($1,$2,$3,$4) ON CONFLICT(environment,line_id) DO UPDATE SET workspace_id=EXCLUDED.workspace_id,binding=EXCLUDED.binding`,
    [c.APP_ENV, account.line_id, c.workspace.id, account.binding],
  );
}
export async function aiSpaceSelected(root: Sql, db: Sql, c: Config, user: User) {
  if (!c.workspace) return undefined;
  const account = (
    await db.query(
      'SELECT line_id,binding FROM hvr_ai_accounts WHERE environment=$1 AND user_id=$2',
      [c.APP_ENV, user.id],
    )
  ).rows[0];
  if (!account) return false;
  return !!(
    await root.query(
      `SELECT 1 FROM public.hvr_workspace_line_routes WHERE environment=$1 AND line_id=$2 AND workspace_id=$3 AND binding=$4`,
      [c.APP_ENV, account.line_id, c.workspace.id, account.binding],
    )
  ).rows.length;
}
async function codeSpace(root: Sql, c: Config, kind: string, text: string) {
  const code = /^(?:RINAI|HVR) ([a-f0-9]{24})$/i.exec(text.trim());
  if (!code) return undefined;
  return (
    await root.query(
      `SELECT workspace_id FROM public.hvr_workspace_line_codes
    WHERE environment=$1 AND kind=$2 AND code_hash=$3 AND expires_at>clock_timestamp()`,
      [c.APP_ENV, kind, hash(code[1].toLowerCase())],
    )
  ).rows[0]?.workspace_id as string | undefined;
}
async function allSpaces(root: Sql, c: Config) {
  return (
    await root.query<SpaceRow>(
      'SELECT * FROM public.hvr_workspaces WHERE environment=$1 ORDER BY id',
      [c.APP_ENV],
    )
  ).rows;
}
export async function receiveSpaceAi(
  root: Sql,
  c: Config,
  control: ControlPlane,
  raw: string,
  signature: string,
) {
  const envelope = await verifyAiEnvelope(c, raw, signature);
  const jobs: AiJob[] = [];
  const confirmedSpaces = new Set<string>();
  await root.query(
    `DELETE FROM public.hvr_workspace_ai_tickets WHERE environment=$1 AND created_at<clock_timestamp()-interval '1 day'`,
    [c.APP_ENV],
  );
  await root.query(
    `DELETE FROM public.hvr_workspace_ai_events WHERE environment=$1 AND created_at<clock_timestamp()-interval '1 day'`,
    [c.APP_ENV],
  );
  for (const e of envelope.events) {
    if (
      Math.abs(Date.now() - e.timestamp) > 120000 ||
      e.source?.type !== 'user' ||
      !e.source.userId
    )
      continue;
    const sender = e.source.userId;
    if (e.type === 'unfollow') {
      for (const row of await allSpaces(root, c)) {
        await workspaceDatabase(root, row.schema_name).query(
          `DELETE FROM hvr_ai_accounts
          WHERE environment=$1 AND line_id=$2 AND linked_at<=to_timestamp($3/1000.0)`,
          [c.APP_ENV, sender, e.timestamp],
        );
      }
      // Stale routes cannot authorize a missing or newer binding; retain them to prevent fallback.
      continue;
    }
    if (!['message', 'postback'].includes(e.type) || !e.replyToken) continue;
    const route = (
      await root.query(
        'SELECT workspace_id,binding FROM public.hvr_workspace_line_routes WHERE environment=$1 AND line_id=$2',
        [c.APP_ENV, sender],
      )
    ).rows[0];
    const linking = /^RINAI /i.test(e.message?.text || '');
    const id = linking
      ? await codeSpace(root, c, 'ai', e.message?.text || '')
      : route?.workspace_id;
    const space = await spaceServices(root, c, control, id);
    // Pin redeliveries to their original Space. Switching must never execute the same event elsewhere.
    const pin = (
      await root.query(
        `INSERT INTO public.hvr_workspace_ai_events(environment,event_id,workspace_id)
      VALUES($1,$2,$3) ON CONFLICT(environment,event_id) DO UPDATE SET event_id=EXCLUDED.event_id RETURNING workspace_id`,
        [c.APP_ENV, e.webhookEventId, space.row.id],
      )
    ).rows[0];
    if (pin.workspace_id !== space.row.id) continue;
    let allowAccount = false;
    if (!linking && route?.workspace_id === space.row.id) {
      allowAccount = !!(
        await space.db.query(
          `SELECT 1 FROM hvr_ai_accounts WHERE environment=$1 AND line_id=$2 AND binding=$3`,
          [c.APP_ENV, sender, route.binding],
        )
      ).rows.length;
    }
    const result = await receiveAi(space.db, space.config, space.repo, raw, signature, Date.now(), {
      eventId: e.webhookEventId,
      allowAccount,
    });
    for (const job of result.jobs) {
      await root.query(
        `INSERT INTO public.hvr_workspace_ai_tickets(environment,ticket_hash,workspace_id) VALUES($1,$2,$3)`,
        [c.APP_ENV, hash(job.ticket), space.row.id],
      );
      jobs.push(job);
    }
    if (result.taskConfirmed) confirmedSpaces.add(space.row.id);
  }
  return { jobs, taskConfirmed: confirmedSpaces.size > 0, confirmedSpaces: [...confirmedSpaces] };
}
export async function replySpaceAi(
  root: Sql,
  c: Config,
  control: ControlPlane,
  ticket: string,
  text: string,
  transport: typeof fetch = fetch,
) {
  const target = (
    await root.query(
      `SELECT workspace_id FROM public.hvr_workspace_ai_tickets
    WHERE environment=$1 AND ticket_hash=$2 AND created_at>clock_timestamp()-interval '2 minutes'`,
      [c.APP_ENV, hash(ticket)],
    )
  ).rows[0];
  if (!target) throw forbidden();
  const space = await spaceServices(root, c, control, target.workspace_id);
  const event = (
    await space.db.query(
      'SELECT user_id,line_id,binding FROM hvr_ai_events WHERE environment=$1 AND ticket_hash=$2',
      [c.APP_ENV, hash(ticket)],
    )
  ).rows[0];
  if (!event) throw forbidden();
  if (
    event.user_id &&
    !(
      await root.query(
        `SELECT 1 FROM public.hvr_workspace_line_routes
    WHERE environment=$1 AND line_id=$2 AND workspace_id=$3 AND binding=$4`,
        [c.APP_ENV, event.line_id, space.row.id, event.binding],
      )
    ).rows.length
  )
    throw forbidden();
  return replyAi(space.db, space.config, space.repo, ticket, text, transport);
}
export async function receiveSpaceNotifications(
  root: Sql,
  c: Config,
  control: ControlPlane,
  input: unknown,
) {
  // This function is called only after the route verifies the original LINE signature.
  const { notificationEnvelope } = await import('../line/accounts');
  const body = notificationEnvelope.parse(input);
  if (body.destination !== c.LINE_BOT_USER_ID) throw forbidden();
  for (const event of body.events) {
    if (event.source?.type !== 'user' || !event.source.userId) continue;
    if (event.type === 'unfollow') {
      for (const row of await allSpaces(root, c))
        await receiveWebhook(workspaceDatabase(root, row.schema_name), c, {
          ...body,
          events: [event],
        });
    } else if (event.type === 'message' && event.message?.type === 'text') {
      const id = await codeSpace(root, c, 'notifications', event.message.text || '');
      if (!id) continue;
      const space = await spaceServices(root, c, control, id);
      await receiveWebhook(space.db, space.config, { ...body, events: [event] });
    }
  }
}
export async function drainSpaceQueue(root: Sql, c: Config, control: ControlPlane, id: string) {
  const space = await spaceServices(root, c, control, id);
  return drainLineQueue(space.db, space.config, space.repo);
}
