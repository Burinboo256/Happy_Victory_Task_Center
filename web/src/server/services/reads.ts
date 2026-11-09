import { categories, isManager, roles, todayBangkok, type User } from '../../domain/model';
import { formulaValue, recordId, type AirtableRepository } from '../airtable/client';
import {
  taskDto,
  taskSummaryDto,
  taskSummaryFields,
  publicUserFields,
  updateDto,
  followupDto,
  publicUser,
  userDto,
} from '../airtable/dto';
import { forbidden } from '../errors';

export async function ownTask(repo: AirtableRepository, user: User, id: string) {
  const task = taskDto(await repo.get('tasks', recordId(id)));
  if (!isManager(user) && task.agentId !== user.id) throw forbidden();
  return task;
}
export async function bootstrap(
  repo: AirtableRepository,
  user: User,
  scope: 'full' | 'context' = 'full',
) {
  const records =
    scope === 'full'
      ? await repo.list(
          'tasks',
          isManager(user) ? undefined : `{Agent Record ID}=${formulaValue(user.id)}`,
          taskSummaryFields,
        )
      : [];
  const tasks = records
    .filter(
      (r) => isManager(user) || (Array.isArray(r.fields.Agent) && r.fields.Agent.includes(user.id)),
    )
    .map(taskSummaryDto);
  const users = isManager(user)
    ? (await repo.list('users', undefined, publicUserFields))
        // Airtable draft rows are not directory entries. Authentication still validates userDto.
        .filter((record) => roles.includes(record.fields.Role as User['role']))
        .map(userDto)
        .map(publicUser)
    : [publicUser(user)];
  return {
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    users,
    tasks,
    tasksIncluded: scope === 'full',
    today: todayBangkok(),
    categories,
    syncedAt: new Date().toISOString(),
  };
}
export async function detail(repo: AirtableRepository, user: User, id: string) {
  const task = await ownTask(repo, user, id);
  const filter = `{Task Record ID}=${formulaValue(task.id)}`;
  const updates = (await repo.list('updates', filter))
    .filter(
      (r) =>
        Array.isArray(r.fields.Task) &&
        r.fields.Task.includes(task.id) &&
        (isManager(user) || r.fields['Visible to Agent'] === true),
    )
    .map(updateDto)
    .sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
  const followups = isManager(user)
    ? (await repo.list('followups', filter))
        .filter((r) => Array.isArray(r.fields.Task) && r.fields.Task.includes(task.id))
        .map(followupDto)
    : [];
  return { task, updates, followups };
}
