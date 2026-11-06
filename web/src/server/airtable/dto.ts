import {
  roles,
  statuses,
  priorities,
  type User,
  type Task,
  type TaskSummary,
  type Followup,
  type PublicUser,
  type TaskUpdate,
} from '../../domain/model';
import type { RecordData } from './client';
import { forbidden } from '../errors';
import { day, timestamp, createdTime, text, singleLink, httpsUrl, invalidData } from './values';

export const taskSummaryFields = [
  'Task ID',
  'Task Title',
  'Description',
  'Agent',
  'Category',
  'Status',
  'Priority',
  'Due Date',
  'Next Follow-up',
] as const;
export const publicUserFields = ['Full Name', 'Role', 'Active'] as const;
export function userDto(record: RecordData): User {
  const f = record.fields;
  if (!roles.includes(f.Role as User['role'])) throw forbidden();
  return {
    id: record.id,
    name: text(f['Full Name']),
    email: text(f.Email),
    role: f.Role as User['role'],
    active: f.Active === true,
    sub: text(f['Google Subject']),
    lineId: text(f['LINE User ID']),
    lineEnabled: f['LINE Notifications'] === true,
  };
}
export const publicUser = (user: User): PublicUser => ({
  id: user.id,
  name: user.name,
  role: user.role,
  active: user.active,
});
export function taskSummaryDto(record: RecordData): TaskSummary {
  const f = record.fields;
  if (
    !statuses.includes(f.Status as Task['status']) ||
    !priorities.includes(f.Priority as Task['priority'])
  )
    throw invalidData();
  return {
    id: record.id,
    code: text(f['Task ID']) || record.id,
    title: text(f['Task Title']),
    description: text(f.Description),
    agentId: singleLink(f.Agent, true),
    category: text(f.Category) || 'งานทั่วไป',
    status: f.Status as Task['status'],
    priority: f.Priority as Task['priority'],
    dueDate: day(f['Due Date']),
    followupDate: day(f['Next Follow-up']),
  };
}
export function taskDto(record: RecordData): Task {
  const f = record.fields;
  return {
    ...taskSummaryDto(record),
    secretaryId: singleLink(f['Assigned Secretary']),
    createdAt: createdTime(f['Created At']),
    completedAt: timestamp(f['Completed At']),
    version: text(f['Last Update']),
    referenceUrl: httpsUrl(f['Reference URL']),
    attachments: Array.isArray(f.Attachments)
      ? f.Attachments.filter((a) => a && typeof a === 'object' && httpsUrl(a.url)).map((a) => ({
          name: text(a.filename) || 'เอกสารแนบ',
          url: httpsUrl(a.url),
        }))
      : [],
  };
}
export function followupDto(record: RecordData): Followup {
  const f = record.fields;
  if (
    !['Pending', 'Done', 'Skipped'].includes(text(f['Follow-up Status'])) ||
    !day(f['Follow-up Date'])
  )
    throw invalidData();
  return {
    id: record.id,
    taskId: singleLink(f.Task, true),
    date: day(f['Follow-up Date']),
    status: f['Follow-up Status'] as Followup['status'],
    notes: text(f['Result / Notes']),
    completedAt: timestamp(f['Completed At']),
  };
}
export function updateDto(record: RecordData): TaskUpdate {
  const f = record.fields;
  singleLink(f.Task, true);
  return {
    id: record.id,
    type: text(f['Update Type']),
    message: text(f.Message),
    actor: text(f['Actor Name']) || 'ผู้ใช้งาน',
    createdAt: createdTime(f['Updated At']),
    visible: f['Visible to Agent'] === true,
    oldStatus: text(f['Old Status']),
    newStatus: text(f['New Status']),
  };
}
