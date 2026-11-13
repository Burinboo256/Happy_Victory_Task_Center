import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Config } from '../config';
import type { Sql } from '../db';
import type { User } from '../../domain/model';
import type { AirtableRepository } from '../airtable/client';
import { userDto } from '../airtable/dto';
import { hash } from '../auth/security';
import { AppError, forbidden } from '../errors';
import { lineId, lineProfile, verifySignature } from '../line/client';
import { verifyInstance } from '../runtime';
import { aiContext } from './context';
import {
  taskSearchIntent,
  taskSearchContext,
  renderTaskSearchReply,
  type TaskSearch,
} from './task-search';
import {
  aiDocuments,
  currentDocumentMemory,
  documentIntent,
  documentRefs,
  renderDocumentReply,
  type AiDocuments,
} from './documents';
import {
  beginMemory,
  cleanMemory,
  memoryIsCurrent,
  memorySession,
  readMemory,
  rememberReply,
} from './memory';
import {
  draftInput,
  draftPostback,
  finishDraft,
  type DraftContext,
  type DraftReply,
} from './drafts';

export function aiConfigured(c: Config) {
  return !!(
    c.AI_LINE_ENABLED &&
    c.AI_LINE_CHANNEL_ACCESS_TOKEN &&
    c.AI_LINE_CHANNEL_SECRET &&
    c.AI_LINE_OA_ID
  );
}
const identities = new Map<string, { id: string; until: number }>();
async function botIdentity(c: Config) {
  const key = hash((c.AI_LINE_CHANNEL_ACCESS_TOKEN || '') + c.AI_LINE_OA_ID);
  const known = identities.get(key);
  if (known && known.until > Date.now()) return known.id;
  const response = await fetch('https://api.line.me/v2/bot/info', {
    headers: { Authorization: 'Bearer ' + c.AI_LINE_CHANNEL_ACCESS_TOKEN },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new AppError(503, 'AI_SETUP', 'ตรวจ OA ไม่สำเร็จ');
  const bot = z.object({ userId: lineId, basicId: z.string() }).parse(await response.json());
  if (bot.basicId !== c.AI_LINE_OA_ID) throw forbidden();
  identities.clear();
  identities.set(key, { id: bot.userId, until: Date.now() + 300000 });
  return bot.userId;
}
export function aiLineConfig(c: Config): Config {
  return {
    ...c,
    LINE_CHANNEL_ACCESS_TOKEN: c.AI_LINE_CHANNEL_ACCESS_TOKEN,
    LINE_CHANNEL_SECRET: c.AI_LINE_CHANNEL_SECRET,
    LINE_OA_ID: c.AI_LINE_OA_ID,
    LINE_BOT_USER_ID: c.AI_LINE_BOT_USER_ID,
  };
}
function requireSetup(c: Config) {
  if (!aiConfigured(c)) throw new AppError(503, 'AI_SETUP', 'ช่องถาม AI ยังไม่เปิดใช้งาน');
}
export async function startAiLink(db: Sql, c: Config, user: User) {
  requireSetup(c);
  if (!user.active) throw forbidden();
  const code = randomBytes(12).toString('hex');
  await db.query(
    `INSERT INTO hvr_ai_links(environment,user_id,code_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '10 minutes')
    ON CONFLICT(environment,user_id) DO UPDATE SET code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,candidate_id=NULL`,
    [c.APP_ENV, user.id, hash(code)],
  );
  return { code: 'RINAI ' + code };
}
export async function aiLinkState(db: Sql, c: Config, user: User, transport: typeof fetch = fetch) {
  const account = (
    await db.query('SELECT display_name FROM hvr_ai_accounts WHERE environment=$1 AND user_id=$2', [
      c.APP_ENV,
      user.id,
    ])
  ).rows[0];
  const candidate = (
    await db.query(
      'SELECT candidate_id FROM hvr_ai_links WHERE environment=$1 AND user_id=$2 AND expires_at>clock_timestamp()',
      [c.APP_ENV, user.id],
    )
  ).rows[0]?.candidate_id;
  return {
    configured: aiConfigured(c),
    oaId: c.AI_LINE_OA_ID || '',
    account: account?.display_name || '',
    candidate:
      candidate && aiConfigured(c)
        ? { id: candidate, name: await lineProfile(aiLineConfig(c), candidate, transport) }
        : null,
  };
}
export async function confirmAiLink(
  db: Sql,
  c: Config,
  user: User,
  candidate: string,
  transport: typeof fetch = fetch,
) {
  requireSetup(c);
  if (!user.active) throw forbidden();
  lineId.parse(candidate);
  if (
    !(
      await db.query(
        'SELECT 1 FROM hvr_ai_links WHERE environment=$1 AND user_id=$2 AND candidate_id=$3 AND expires_at>clock_timestamp()',
        [c.APP_ENV, user.id, candidate],
      )
    ).rows.length
  )
    throw forbidden();
  const name = await lineProfile(aiLineConfig(c), candidate, transport);
  try {
    const result = await db.query(
      `WITH used AS (DELETE FROM hvr_ai_links WHERE environment=$1 AND user_id=$2 AND candidate_id=$3 AND expires_at>clock_timestamp() RETURNING user_id)
      INSERT INTO hvr_ai_accounts(environment,user_id,line_id,display_name) SELECT $1,user_id,$3,$4 FROM used
      ON CONFLICT(environment,user_id) DO UPDATE SET line_id=EXCLUDED.line_id,display_name=EXCLUDED.display_name,binding=gen_random_uuid(),linked_at=clock_timestamp() RETURNING user_id`,
      [c.APP_ENV, user.id, candidate, name],
    );
    if (!result.rows.length) throw forbidden();
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw new AppError(409, 'AI_LINK_USED', 'LINE นี้เชื่อมกับสมาชิกอื่นแล้ว');
    throw e;
  }
}
export async function disconnectAi(db: Sql, c: Config, user: User) {
  await db.query(
    `WITH removed AS (DELETE FROM hvr_ai_accounts WHERE environment=$1 AND user_id=$2)
    DELETE FROM hvr_ai_links WHERE environment=$1 AND user_id=$2`,
    [c.APP_ENV, user.id],
  );
}
const envelope = z.object({
  destination: lineId,
  events: z
    .array(
      z.object({
        webhookEventId: z.string().min(1).max(100),
        type: z.string(),
        timestamp: z.number().int(),
        replyToken: z.string().min(1).max(200).optional(),
        source: z.object({ type: z.string(), userId: lineId.optional() }).optional(),
        message: z.object({ type: z.string(), text: z.string().optional() }).optional(),
        postback: z.object({ data: z.string().max(300) }).optional(),
      }),
    )
    .max(100),
});
export type AiJob = {
  ticket: string;
  needsAi: boolean;
  question: string;
  context?: Awaited<ReturnType<typeof aiContext>>['context'];
  draft?: DraftContext;
  documents?: AiDocuments;
  taskSearch?: TaskSearch;
  contractVersion?: 2;
};
const fallback = 'ขณะนี้ AI สรุปไม่สำเร็จ กรุณาถามใหม่อีกครั้ง หรือเปิดงานในเว็บ';

// n8n forwards the ORIGINAL raw bytes (as a string), never JSON.stringify(parsedBody).
// LINE's signature proves the sender; no caller-selected email, role, or user ID is trusted.
export async function receiveAi(
  db: Sql,
  c: Config,
  repo: AirtableRepository,
  raw: string,
  signature: string,
  now = Date.now(),
) {
  requireSetup(c);
  verifySignature(raw, signature, c.AI_LINE_CHANNEL_SECRET || '');
  const body = envelope.parse(JSON.parse(raw));
  if (body.destination !== (c.AI_LINE_BOT_USER_ID || (await botIdentity(c)))) throw forbidden();
  await verifyInstance(db, c);
  await cleanMemory(db, c);
  await db.query(
    "DELETE FROM hvr_ai_events WHERE environment=$1 AND created_at<clock_timestamp()-interval '1 day'",
    [c.APP_ENV],
  );
  const jobs: AiJob[] = [];
  let taskConfirmed = false;
  for (const e of body.events) {
    if (Math.abs(now - e.timestamp) > 120000 || e.source?.type !== 'user' || !e.source.userId)
      continue;
    const sender = e.source.userId;
    if (e.type === 'unfollow') {
      await db.query(
        'DELETE FROM hvr_ai_accounts WHERE environment=$1 AND line_id=$2 AND linked_at<=to_timestamp($3/1000.0)',
        [c.APP_ENV, sender, e.timestamp],
      );
      continue;
    }
    if (!['message', 'postback'].includes(e.type) || !e.replyToken) continue;
    const ticket = randomBytes(32).toString('hex');
    const claim = await db.query(
      `INSERT INTO hvr_ai_events(environment,event_id,line_id,ticket_hash,reply_token,fallback_answer)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(environment,event_id) DO NOTHING RETURNING event_id`,
      [c.APP_ENV, e.webhookEventId, sender, hash(ticket), e.replyToken, fallback],
    );
    if (!claim.rows.length) continue;
    let answer = '',
      context: AiJob['context'];
    let draft: DraftContext | undefined,
      draftId: string | undefined,
      draftRevision: number | undefined;
    let replyActions: DraftReply['actions'];
    let memoryTurnId: string | undefined;
    let documents: AiDocuments | undefined;
    let taskSearch: TaskSearch | undefined;
    let user: User | undefined,
      binding: string | undefined,
      taskIds: string[] = [];
    const question = (e.message?.text || '').trim();
    try {
      const recent = (
        await db.query(
          "SELECT count(*)::int AS n FROM hvr_ai_events WHERE environment=$1 AND line_id=$2 AND created_at>clock_timestamp()-interval '1 minute'",
          [c.APP_ENV, sender],
        )
      ).rows[0].n;
      const global = (
        await db.query(
          "SELECT count(*)::int AS n FROM hvr_ai_events WHERE environment=$1 AND created_at>clock_timestamp()-interval '1 day'",
          [c.APP_ENV],
        )
      ).rows[0].n;
      if (recent > 10 || global > 1000) answer = 'ถึงจำนวนคำถามที่รองรับในช่วงนี้แล้ว กรุณาลองภายหลัง';
      else if (e.type !== 'postback' && e.message?.type !== 'text')
        answer = 'กรุณาพิมพ์คำถาม เช่น สรุปงานวันนี้ หรือพิมพ์ “ส่งงาน” ตามด้วยรายละเอียด';
      else if (question.length > 2000) answer = 'กรุณาย่อคำถามให้ไม่เกิน 2,000 ตัวอักษร';
      else {
        const link = /^RINAI ([a-f0-9]{24})$/i.exec(question);
        if (link) {
          const linked = await db.query(
            `UPDATE hvr_ai_links SET candidate_id=$3 WHERE environment=$1 AND code_hash=$2 AND expires_at>clock_timestamp() AND (candidate_id IS NULL OR candidate_id=$3) RETURNING user_id`,
            [c.APP_ENV, hash(link[1].toLowerCase()), sender],
          );
          answer = linked.rows.length
            ? 'รับรหัสแล้ว กลับไปที่เว็บ กดตรวจการเชื่อมต่อ แล้วตรวจชื่อ LINE และยืนยันบัญชีของคุณ'
            : 'รหัสไม่ถูกต้อง หมดอายุ หรือถูกใช้แล้ว กรุณาสร้างรหัสใหม่ในเว็บ';
        } else {
          const account = (
            await db.query(
              'SELECT user_id,binding FROM hvr_ai_accounts WHERE environment=$1 AND line_id=$2',
              [c.APP_ENV, sender],
            )
          ).rows[0];
          if (!account)
            answer =
              'กรุณาเข้าสู่ระบบ RINLYN Secretary แล้วเชื่อมบัญชีในส่วน “ถาม AI ผ่าน LINE” ก่อน\n' +
              c.APP_ORIGIN +
              '/notifications';
          else {
            user = userDto(await repo.get('users', account.user_id));
            if (!user.active) throw forbidden();
            binding = account.binding;
            if (e.type === 'postback') {
              const result = await draftPostback(
                db,
                c,
                repo,
                user,
                sender,
                account.binding,
                e.postback?.data || '',
              );
              answer = result.text;
              replyActions = result.actions;
              taskConfirmed ||= !!result.created;
              if (result.taskId) taskIds = [result.taskId];
            } else if (/^(ล้างความจำ|เริ่มคุยใหม่)$/.test(question)) {
              await memorySession(db, c, user, account.binding, true);
              answer =
                'ล้างความจำบทสนทนาแล้ว เริ่มถามเรื่องใหม่ได้เลย งานและร่างส่งงานยังอยู่ หากต้องการยกเลิกร่างให้พิมพ์ “ยกเลิก”';
            } else {
              const epoch = await memorySession(db, c, user, account.binding);
              const rawMemory = await readMemory(db, c, user, epoch);
              const memory = await currentDocumentMemory(db, c, user, rawMemory);
              const wantsDocuments =
                c.FORMS_ENABLED && c.AI_FORMS_ENABLED && documentIntent(question, rawMemory);
              const wantsTaskSearch =
                !wantsDocuments && c.AI_TASK_SEARCH_ENABLED && taskSearchIntent(question);
              const result =
                wantsDocuments || wantsTaskSearch
                  ? null
                  : await draftInput(db, c, repo, user, sender, account.binding, question);
              if (result) {
                answer = result.reply?.text || '';
                replyActions = result.reply?.actions;
                draft = result.context;
                draftId = result.draft?.id;
                draftRevision = result.draft?.revision;
              } else {
                if (wantsDocuments) documents = await aiDocuments(db, c, user, question, memory);
                const data =
                  !documents || documents.mixed
                    ? await aiContext(db, c, repo, user, question, memory, {
                        search: wantsTaskSearch,
                      })
                    : null;
                if (wantsTaskSearch && data) {
                  taskSearch = taskSearchContext(data);
                  if (!taskSearch.items.length) {
                    answer = taskSearch.limited
                      ? 'มีงานหรือข้อมูลประกอบหลายรายการ กรุณาจำกัดประเภท เจ้าของ หรือระบุรหัส HVR เพื่อค้นให้ครบและตรงขึ้น'
                      : 'ไม่พบงานตามเงื่อนไขในขอบเขตที่คุณมีสิทธิ์เห็น ลองระบุชื่องานหรือรหัส HVR';
                    taskSearch = undefined;
                  }
                } else context = data?.context;
                taskIds = data?.taskIds || [];
                memoryTurnId = await beginMemory(
                  db,
                  c,
                  user,
                  epoch,
                  e.webhookEventId,
                  question,
                  taskIds,
                  data?.taskRefs || [],
                  documents ? documentRefs(documents) : [],
                );
                // Additive schema is only needed once the separately gated search mode is enabled.
                if (taskSearch)
                  await db.query(
                    'UPDATE hvr_ai_events SET task_search_context=$3::jsonb WHERE environment=$1 AND event_id=$2',
                    [c.APP_ENV, e.webhookEventId, JSON.stringify(taskSearch)],
                  );
              }
            }
          }
        }
      }
    } catch {
      // Do not expose provider errors, account existence, SQL, or partially loaded task data.
      answer =
        e.type === 'postback'
          ? 'ยังยืนยันผลคำขอนี้ไม่ได้ กรุณาตรวจสิทธิ์บัญชีและพิมพ์ “ดูร่าง” เพื่อตรวจคำขอเดิม หรือตรวจงานในเว็บก่อนส่งงานใหม่'
          : 'อ่านข้อมูลงานไม่ได้ กรุณาตรวจว่าบัญชีเว็บยังเปิดใช้งานอยู่ แล้วลองอีกครั้ง';
      context = undefined;
      draft = undefined;
      draftId = undefined;
      draftRevision = undefined;
      replyActions = undefined;
      memoryTurnId = undefined;
      documents = undefined;
      taskSearch = undefined;
      user = undefined;
      binding = undefined;
      taskIds = [];
    }
    await db.query(
      `UPDATE hvr_ai_events SET state='ready',user_id=$3,role=$4,binding=$5,task_ids=$6::jsonb,direct_answer=$7,
        draft_id=$8,draft_revision=$9,reply_actions=$10,memory_turn_id=$11,document_context=$12 WHERE environment=$1 AND event_id=$2`,
      [
        c.APP_ENV,
        e.webhookEventId,
        user?.id || null,
        user?.role || null,
        binding || null,
        JSON.stringify(taskIds),
        answer || null,
        draftId || null,
        draftRevision ?? null,
        replyActions ? JSON.stringify(replyActions) : null,
        memoryTurnId || null,
        documents
          ? JSON.stringify({ search: documents, taskUrls: context?.items.map((t) => t.url) || [] })
          : null,
      ],
    );
    jobs.push({
      ticket,
      needsAi: !!context || !!draft || !!documents || !!taskSearch,
      question: context || draft || documents || taskSearch ? question : '',
      ...(context ? { context } : {}),
      ...(draft ? { draft } : {}),
      ...(taskSearch ? { taskSearch } : {}),
      ...(documents ? { documents, contractVersion: 2 as const } : {}),
    });
  }
  return { jobs, taskConfirmed };
}

export async function replyAi(
  db: Sql,
  c: Config,
  repo: AirtableRepository,
  ticket: string,
  text: string,
  transport: typeof fetch = fetch,
) {
  requireSetup(c);
  z.string()
    .regex(/^[a-f0-9]{64}$/)
    .parse(ticket);
  await verifyInstance(db, c);
  const row = (
    await db.query(
      `UPDATE hvr_ai_events SET state='sending' WHERE environment=$1 AND ticket_hash=$2 AND state='ready' AND created_at>clock_timestamp()-interval '2 minutes' RETURNING *`,
      [c.APP_ENV, hash(ticket)],
    )
  ).rows[0];
  if (!row) throw new AppError(409, 'AI_REPLY_USED', 'คำตอบนี้หมดอายุหรือถูกส่งแล้ว');
  try {
    let currentUser: User | undefined;
    if (row.user_id) {
      const account = (
        await db.query(
          'SELECT 1 FROM hvr_ai_accounts WHERE environment=$1 AND user_id=$2 AND line_id=$3 AND binding=$4',
          [c.APP_ENV, row.user_id, row.line_id, row.binding],
        )
      ).rows[0];
      const user = userDto(await repo.get('users', row.user_id));
      if (!account || !user.active || user.role !== row.role) throw forbidden();
      currentUser = user;
      // Ownership may change while the model is generating. Fail closed before disclosing a reply.
      if (user.role === 'Agent' && row.task_ids.length) {
        const ids = z.array(z.string()).parse(row.task_ids);
        // One list request avoids one Airtable request per case.
        const current = await repo.list('tasks', `{Agent Record ID}="${user.id}"`, ['Agent']);
        const owned = new Set(
          current
            .filter((r) => Array.isArray(r.fields.Agent) && r.fields.Agent.includes(user.id))
            .map((r) => r.id),
        );
        if (ids.some((id) => !owned.has(id))) throw forbidden();
      }
    }
    const draftReply =
      row.draft_id && currentUser
        ? await finishDraft(
            db,
            c,
            repo,
            currentUser,
            row.draft_id,
            row.draft_revision,
            row.binding,
            text,
          )
        : undefined;
    if (row.document_context && (!currentUser || !c.FORMS_ENABLED || !c.AI_FORMS_ENABLED))
      throw forbidden();
    const documentReply =
      row.document_context && currentUser
        ? await renderDocumentReply(
            db,
            c,
            currentUser,
            row.document_context.search,
            text,
            row.document_context.taskUrls,
          )
        : undefined;
    if (row.task_search_context && (!currentUser || !c.AI_TASK_SEARCH_ENABLED)) throw forbidden();
    const taskSearchReply =
      row.task_search_context && currentUser
        ? await renderTaskSearchReply(db, c, repo, currentUser, row.task_search_context, text)
        : undefined;
    const answer = String(
      taskSearchReply?.answer ||
        documentReply?.answer ||
        draftReply?.text ||
        row.direct_answer ||
        text.trim() ||
        row.fallback_answer,
    ).slice(0, 4500);
    const buttons: DraftReply['actions'] = draftReply?.actions || row.reply_actions;
    if (row.memory_turn_id && !(await memoryIsCurrent(db, c, row.memory_turn_id)))
      throw new AppError(409, 'AI_MEMORY_CLEARED', 'บทสนทนานี้ถูกล้างหรือหมดอายุแล้ว กรุณาถามใหม่');
    const response = await transport('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + c.AI_LINE_CHANNEL_ACCESS_TOKEN,
      },
      body: JSON.stringify({
        replyToken: row.reply_token,
        messages: [
          { type: 'text', text: answer },
          ...(buttons?.length
            ? [
                {
                  type: 'template',
                  altText: 'เลือกการดำเนินการกับร่างงาน',
                  template: {
                    type: 'buttons',
                    text: 'ตรวจข้อมูลด้านบนก่อนยืนยัน',
                    actions: buttons.map((a) => ({ type: 'postback', ...a, displayText: a.label })),
                  },
                },
              ]
            : []),
        ],
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new AppError(503, 'AI_REPLY_FAILED', 'LINE ไม่รับคำตอบ กรุณาถามใหม่');
    await db.query(
      "UPDATE hvr_ai_events SET state='sent',reply_token=NULL WHERE environment=$1 AND event_id=$2",
      [c.APP_ENV, row.event_id],
    );
    if (
      row.memory_turn_id &&
      (text.trim() || documentReply || taskSearchReply) &&
      !row.direct_answer &&
      !row.draft_id
    ) {
      // A storage failure after a successful LINE send must not turn into a duplicate-send retry.
      try {
        await rememberReply(
          db,
          c,
          row.memory_turn_id,
          answer,
          documentReply?.refs,
          taskSearchReply?.ids,
        );
      } catch {
        console.error('ai_memory_save_failed');
      }
    }
    return { sent: true };
  } catch (e) {
    // Never blindly retry an ambiguous LINE send; reply tokens are single-use.
    await db.query(
      "UPDATE hvr_ai_events SET state='failed',reply_token=NULL WHERE environment=$1 AND event_id=$2",
      [c.APP_ENV, row.event_id],
    );
    throw e;
  }
}
