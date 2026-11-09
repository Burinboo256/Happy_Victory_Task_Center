import { z } from 'zod';
import { after } from 'next/server';
import { protectedContext } from './context';
import { requireCsrf } from './auth/security';
import { route, json, readBody } from './http';
import { AppError, forbidden } from './errors';
import { requireWrites } from './runtime';
import { lineConfigured, lineProfile } from './line/client';
import {
  startLink,
  linkCandidate,
  confirmLink,
  disconnectLine,
  setRecipient,
} from './line/accounts';
import { safelyDrainLineQueue } from './line/queue';

export function lineRead() {
  return route(async () => {
    const c = await protectedContext();
    if (!['Admin', 'Secretary'].includes(c.user.role)) throw forbidden();
    const setting = (
      await c.db.query('SELECT enabled FROM hvr_line_settings WHERE environment=$1', [
        c.config.APP_ENV,
      ])
    ).rows[0];
    const accounts = (
      await c.db.query(
        `SELECT user_id,display_name,binding,enabled FROM hvr_line_accounts WHERE environment=$1 AND ($2 OR user_id=$3) ORDER BY linked_at`,
        [c.config.APP_ENV, c.user.role === 'Admin', c.user.id],
      )
    ).rows;
    let candidate: { id: string; name: string } | null = null;
    if (c.user.role === 'Secretary' && lineConfigured(c.config)) {
      const id = await linkCandidate(c.db, c.config, c.user);
      if (id) candidate = { id, name: await lineProfile(c.config, id) };
    }
    const deliveries =
      c.user.role === 'Admin'
        ? (
            await c.db.query(
              `SELECT id,task_id,user_id,state,attempts,error_code,created_at FROM hvr_line_deliveries WHERE environment=$1 ORDER BY created_at DESC LIMIT 50`,
              [c.config.APP_ENV],
            )
          ).rows
        : [];
    return json({
      configured: lineConfigured(c.config),
      sendingAllowed: c.config.ENABLE_LINE_NOTIFICATIONS,
      enabled: setting?.enabled === true,
      oaId: c.config.LINE_OA_ID || '',
      accounts,
      candidate,
      deliveries,
    });
  });
}
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('confirm'), candidateId: z.string() }),
  z.object({ action: z.literal('disconnect') }),
  z.object({
    action: z.literal('recipient'),
    userId: z.string().regex(/^rec[a-zA-Z0-9]{14}$/),
    binding: z.uuid(),
    enabled: z.boolean(),
  }),
  z.object({ action: z.literal('switch'), enabled: z.boolean() }),
  z.object({ action: z.literal('drain') }),
]);
export function lineWrite(request: Request) {
  return route(async () => {
    const c = await protectedContext();
    requireCsrf(request, c.csrfToken, c.config);
    await requireWrites(c.db, c.config);
    const input = actionSchema.parse(await readBody(request));
    if (input.action === 'start') return json(await startLink(c.db, c.config, c.user));
    if (input.action === 'confirm') await confirmLink(c.db, c.config, c.user, input.candidateId);
    else if (input.action === 'disconnect') await disconnectLine(c.db, c.config, c.user);
    else {
      if (c.user.role !== 'Admin') throw forbidden();
      if (input.action === 'recipient')
        await setRecipient(
          c.db,
          c.config,
          c.repo,
          c.user,
          input.userId,
          input.binding,
          input.enabled,
        );
      if (input.action === 'switch') {
        if (input.enabled && (!lineConfigured(c.config) || !c.config.ENABLE_LINE_NOTIFICATIONS))
          throw new AppError(409, 'LINE_SETUP', 'กรุณาตั้งค่า OA และเปิดสิทธิ์ส่งบนเซิร์ฟเวอร์ก่อน');
        if (
          input.enabled &&
          !(
            await c.db.query(
              'SELECT 1 FROM hvr_line_accounts WHERE environment=$1 AND enabled LIMIT 1',
              [c.config.APP_ENV],
            )
          ).rows.length
        )
          throw new AppError(409, 'LINE_RECIPIENT', 'กรุณาเลือกเลขาผู้รับก่อนเปิดส่ง');
        await c.db.query(
          `INSERT INTO hvr_line_settings(environment,enabled) VALUES($1,$2)
          ON CONFLICT(environment) DO UPDATE SET enabled=EXCLUDED.enabled,updated_at=clock_timestamp()`,
          [c.config.APP_ENV, input.enabled],
        );
      }
      if (input.action === 'drain') {
        // Confirmed HTTP rejection can be retried after configuration is repaired,
        // but never change a retry key or restart an expired deduplication window.
        await c.db.query(
          `UPDATE hvr_line_deliveries SET state='pending',next_attempt_at=clock_timestamp()
          WHERE environment=$1 AND state='failed' AND error_code='LINE_REJECTED'
            AND first_attempt_at>clock_timestamp()-interval '23 hours'`,
          [c.config.APP_ENV],
        );
        after(() => safelyDrainLineQueue(c.db, c.config, c.repo));
      }
    }
    return json({ saved: true });
  });
}
