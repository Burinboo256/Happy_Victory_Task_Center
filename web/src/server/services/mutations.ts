import { z } from 'zod';
import { categories, priorities, statuses, isManager, isOpen, type User } from '../../domain/model';
import { userDto, followupDto, taskDto } from '../airtable/dto';
import { formulaValue, type AirtableRepository } from '../airtable/client';
import { forbidden, AppError } from '../errors';
import { ownTask } from './reads';
import type { Steps } from '../operations/journal';
import { patchStep, upsertStep } from '../operations/writes';

const id = z.string().regex(/^rec[a-zA-Z0-9]{14}$/);
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s);
const message = (max: number) => z.string().trim().max(max);
const schemas = {
  create: z.object({
    title: message(180).min(1),
    description: message(5000).min(1),
    priority: z.enum(priorities),
    category: z.enum(categories),
    dueDate: day,
    referenceUrl: z
      .union([z.literal(''), z.url().refine((s) => new URL(s).protocol === 'https:')])
      .default(''),
    agentId: id.optional(),
  }),
  status: z.object({
    id,
    version: z.string().min(1),
    status: z.enum(statuses),
    message: message(2000).default(''),
  }),
  edit: z
    .object({
      id,
      version: z.string().min(1),
      title: message(180).min(1),
      description: message(5000).min(1),
      agentId: id,
      priority: z.enum(priorities),
      dueDate: day,
    })
    .strict(),
  comment: z.object({ id, message: message(3000).min(1), visible: z.boolean().default(true) }),
  followup: z.object({ id, date: day, notes: message(2000).default('') }),
  resolveFollowup: z.object({
    id,
    followupId: id,
    status: z.enum(['Done', 'Skipped']),
    notes: message(2000).min(1),
  }),
};
export type Action = keyof typeof schemas;
export function validateMutation(action: Action, input: unknown, user: User) {
  if (['edit', 'status', 'followup', 'resolveFollowup'].includes(action) && !isManager(user))
    throw forbidden();
  return schemas[action].parse(input);
}
async function audit(
  steps: Steps,
  repo: AirtableRepository,
  user: User,
  taskId: string,
  key: string,
  type: string,
  text: string,
  visible: boolean,
  oldStatus = '',
  newStatus = '',
) {
  return upsertStep(steps, 'audit', repo, 'updates', 'Operation Key', {
    'Operation Key': key,
    Task: [taskId],
    'Updated By': [user.id],
    'Actor Name': user.name,
    'Update Type': type,
    Message: text,
    'Visible to Agent': visible,
    'Old Status': oldStatus,
    'New Status': newStatus,
  });
}
async function nextFollowup(steps: Steps, repo: AirtableRepository, taskId: string) {
  const date = await steps.run(
    'next-value',
    async () => {
      const pending = (
        await repo.list(
          'followups',
          `AND({Task Record ID}=${formulaValue(taskId)},{Follow-up Status}="Pending")`,
        )
      )
        .filter((r) => Array.isArray(r.fields.Task) && r.fields.Task.includes(taskId))
        .map(followupDto)
        .filter((f) => f.taskId === taskId && f.status === 'Pending' && f.date)
        .map((f) => f.date.slice(0, 10))
        .sort();
      return pending[0] || null;
    },
    false,
  );
  return patchStep(steps, 'next', repo, 'tasks', taskId, { 'Next Follow-up': date });
}
export async function mutate(
  repo: AirtableRepository,
  user: User,
  action: Action,
  input: unknown,
  steps: Steps,
) {
  if (action === 'create') {
    const data = schemas.create.parse(input);
    const owner = await steps.run(
      'owner',
      async () => {
        if (!isManager(user)) return user.id;
        if (!data.agentId) throw new AppError(422, 'AGENT_REQUIRED', 'กรุณาเลือก Agent');
        return data.agentId;
      },
      false,
    );
    // A stored step cannot restore privileges that the caller no longer has.
    if (!isManager(user) && owner !== user.id) throw forbidden();
    if (isManager(user)) {
      const agent = userDto(await repo.get('users', owner));
      if (!agent.active || agent.role !== 'Agent')
        throw new AppError(422, 'AGENT_INACTIVE', 'กรุณาเลือก Agent ที่เปิดใช้งาน');
    }
    const fields = {
      'Request Key': steps.key,
      'Task Title': data.title,
      Description: data.description,
      Agent: [owner],
      'Assigned Secretary': isManager(user) ? [user.id] : [],
      Category: data.category,
      Priority: data.priority,
      Status: 'New',
      'Due Date': data.dueDate,
      'Reference URL': data.referenceUrl,
    };
    const taskId = await steps.run(
      'task',
      async () => {
        const matches = await repo.list('tasks', `{Request Key}=${formulaValue(steps.key)}`);
        if (matches.length > 1) throw new AppError(409, 'DUPLICATE_KEY', 'พบคำขอซ้ำ กรุณาติดต่อผู้ดูแล');
        if (matches.length) {
          if (taskDto(matches[0]).agentId !== owner) throw forbidden();
          return matches[0].id;
        }
        return (await repo.upsert('tasks', 'Request Key', fields)).id;
      },
      true,
      { kind: 'upsert', table: 'tasks', keyField: 'Request Key', fields },
    );
    await ownTask(repo, user, taskId);
    await audit(
      steps,
      repo,
      user,
      taskId,
      steps.key + ':audit',
      'Created',
      'ส่งงานใหม่: ' + data.title,
      true,
    );
    return { id: taskId };
  }
  if (action === 'comment') {
    const data = schemas.comment.parse(input),
      task = await ownTask(repo, user, data.id);
    await audit(
      steps,
      repo,
      user,
      task.id,
      steps.key + ':audit',
      'Comment',
      data.message,
      !isManager(user) || data.visible,
    );
    return { id: task.id };
  }
  if (!isManager(user)) throw forbidden();
  if (action === 'edit') {
    const data = schemas.edit.parse(input);
    const original = await steps.run(
      'snapshot',
      async () => {
        const task = await ownTask(repo, user, data.id);
        if (task.version !== data.version)
          throw new AppError(409, 'VERSION_CONFLICT', 'งานนี้มีการแก้ไขแล้ว กรุณาโหลดรายละเอียดใหม่');
        return task;
      },
      false,
    );
    // Keep an existing inactive owner when editing other fields; new owners must be active Agents.
    if (data.agentId !== original.agentId) {
      const owner = userDto(await repo.get('users', data.agentId));
      if (!owner.active || owner.role !== 'Agent')
        throw new AppError(422, 'AGENT_INACTIVE', 'กรุณาเลือก Agent ที่เปิดใช้งาน');
    }
    const labels = {
      title: 'ชื่องาน',
      description: 'รายละเอียดงาน',
      agentId: 'Agent เจ้าของงาน',
      priority: 'ความเร่งด่วน',
      dueDate: 'กำหนดส่ง',
    } as const;
    const changed = (Object.keys(labels) as (keyof typeof labels)[]).filter(
      (key) => data[key] !== original[key],
    );
    if (!changed.length) return { id: data.id };
    await patchStep(steps, 'patch', repo, 'tasks', data.id, {
      'Task Title': data.title,
      Description: data.description,
      Agent: [data.agentId],
      Priority: data.priority,
      'Due Date': data.dueDate,
    });
    await audit(
      steps,
      repo,
      user,
      data.id,
      steps.key + ':audit',
      'Comment',
      'แก้ไขข้อมูลงาน: ' + changed.map((key) => labels[key]).join(', '),
      true,
    );
    return { id: data.id };
  }
  if (action === 'status') {
    const data = schemas.status.parse(input);
    const snapshot = await steps.run(
      'snapshot',
      async () => {
        const task = await ownTask(repo, user, data.id);
        if (task.version !== data.version)
          throw new AppError(409, 'VERSION_CONFLICT', 'งานนี้มีการแก้ไขแล้ว กรุณาโหลดรายละเอียดใหม่');
        return {
          task,
          completedAt:
            data.status === 'Completed'
              ? task.status === 'Completed'
                ? task.completedAt || null
                : new Date().toISOString()
              : null,
        };
      },
      false,
    );
    await patchStep(steps, 'patch', repo, 'tasks', data.id, {
      Status: data.status,
      'Completed At': snapshot.completedAt,
    });
    await audit(
      steps,
      repo,
      user,
      data.id,
      steps.key + ':audit',
      'Status',
      data.message || 'อัปเดตสถานะงาน',
      true,
      snapshot.task.status,
      data.status,
    );
    await upsertStep(steps, 'notification', repo, 'notifications', 'Operation Key', {
      'Operation Key': steps.key + ':notification',
      Task: [data.id],
      Recipient: [snapshot.task.agentId],
      Channel: 'Email',
      'Event Type': 'Status Changed',
      Message:
        snapshot.task.title + '\nสถานะ: ' + data.status + (data.message ? '\n' + data.message : ''),
      'Delivery Status': 'Pending',
    });
    return { id: data.id };
  }
  if (action === 'followup') {
    const data = schemas.followup.parse(input);
    await steps.run(
      'snapshot',
      async () => {
        const task = await ownTask(repo, user, data.id);
        if (!isOpen(task)) throw new AppError(409, 'TASK_CLOSED', 'งานปิดแล้ว ไม่สามารถเพิ่มนัดติดตาม');
        return task.id;
      },
      false,
    );
    await upsertStep(steps, 'followup', repo, 'followups', 'Operation Key', {
      'Operation Key': steps.key,
      Task: [data.id],
      'Follow-up Date': data.date,
      'Assigned To': [user.id],
      'Follow-up Status': 'Pending',
      'Result / Notes': data.notes,
    });
    await nextFollowup(steps, repo, data.id);
    await audit(
      steps,
      repo,
      user,
      data.id,
      steps.key + ':audit',
      'Follow-up',
      'นัดติดตาม ' + data.date + (data.notes ? '\n' + data.notes : ''),
      false,
    );
    return { id: data.id };
  }
  const data = schemas.resolveFollowup.parse(input);
  await steps.run(
    'snapshot',
    async () => {
      await ownTask(repo, user, data.id);
      const followup = followupDto(await repo.get('followups', data.followupId));
      if (followup.taskId !== data.id) throw forbidden();
      if (followup.status !== 'Pending')
        throw new AppError(409, 'FOLLOWUP_CLOSED', 'นัดติดตามนี้ถูกปิดแล้ว กรุณาโหลดใหม่');
      return true;
    },
    false,
  );
  const completedAt = await steps.run('completedAt', async () => new Date().toISOString(), false);
  await patchStep(steps, 'resolve', repo, 'followups', data.followupId, {
    'Follow-up Status': data.status,
    'Result / Notes': data.notes,
    'Completed At': completedAt,
  });
  await nextFollowup(steps, repo, data.id);
  await audit(
    steps,
    repo,
    user,
    data.id,
    steps.key + ':audit',
    'Follow-up',
    (data.status === 'Done' ? 'ติดตามแล้ว: ' : 'ข้ามนัดติดตาม: ') + data.notes,
    false,
  );
  return { id: data.id };
}
