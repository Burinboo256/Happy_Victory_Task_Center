export const roles = ['Agent', 'Secretary', 'Admin'] as const;
export type Role = (typeof roles)[number];
export const statuses = [
  'New',
  'In Progress',
  'Waiting',
  'On Hold',
  'Completed',
  'Cancelled',
] as const;
export type Status = (typeof statuses)[number];
export const priorities = ['Low', 'Normal', 'High', 'Urgent'] as const;
export type Priority = (typeof priorities)[number];
export const categories = [
  'ตัวแทนใหม่',
  'ตัวแทนเก่า',
  'ลูกค้าใหม่',
  'ลูกค้าเก่า',
  'วันเกิดตัวแทนและลูกค้า',
  'งานเคลม',
] as const;
export const legacyCategories = ['เอกสารกรมธรรม์', 'บริการลูกค้า', 'นัดหมาย', 'การเงิน', 'งานทั่วไป'] as const;
export const statusNames: Record<Status, string> = {
  New: 'งานเข้าใหม่',
  'In Progress': 'กำลังดำเนินการ',
  Waiting: 'รอข้อมูล',
  'On Hold': 'พักงาน',
  Completed: 'เสร็จสิ้น',
  Cancelled: 'ยกเลิก',
};
export const priorityNames: Record<Priority, string> = {
  Low: 'ต่ำ',
  Normal: 'ปกติ',
  High: 'สูง',
  Urgent: 'ด่วนมาก',
};

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  sub: string;
  lineId: string;
  lineEnabled: boolean;
}
export interface PublicUser {
  id: string;
  name: string;
  role: Role;
  active: boolean;
}
export interface TaskSummary {
  continuingFollowup?: boolean;
  workflowSummary?: string;
  id: string;
  code: string;
  title: string;
  description: string;
  agentId: string;
  category: string;
  status: Status;
  priority: Priority;
  dueDate: string;
  followupDate: string;
}
export interface Task extends TaskSummary {
  secretaryId: string;
  createdAt: string;
  completedAt: string;
  version: string;
  referenceUrl: string;
  attachments: { name: string; url: string }[];
}
export interface Followup {
  id: string;
  taskId: string;
  date: string;
  status: 'Pending' | 'Done' | 'Skipped';
  notes: string;
  completedAt: string;
}
export interface TaskUpdate {
  id: string;
  type: string;
  message: string;
  actor: string;
  createdAt: string;
  visible: boolean;
  oldStatus: string;
  newStatus: string;
}
export interface Bootstrap {
  user: Pick<User, 'id' | 'name' | 'email' | 'role'>;
  users: PublicUser[];
  tasks: TaskSummary[];
  tasksIncluded: boolean;
  categories: readonly string[];
  today: string;
  syncedAt: string;
  csrfToken: string;
  writesEnabled: boolean;
}
export interface Detail {
  caseWorkflow?: import('./case-workflow').CaseView;
  workflow?: import('./onboarding').WorkflowView;
  task: Task;
  updates: TaskUpdate[];
  followups: Followup[];
}
export const isManager = (user: Pick<User, 'role'>) =>
  user.role === 'Secretary' || user.role === 'Admin';
export const isOpen = (task: Pick<Task, 'status'>) =>
  !['Completed', 'Cancelled'].includes(task.status);
export const todayBangkok = (date = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
