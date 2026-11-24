import { z } from 'zod';
import {
  AirtableClient,
  formulaValue,
  recordId,
  type AirtableRepository,
  type RecordData,
} from '../airtable/client';
import { userDto } from '../airtable/dto';
import type { Config } from '../config';
import type { Sql } from '../db';
import { AppError, forbidden } from '../errors';
import { roles } from '../../domain/model';
import { hash } from '../auth/security';
import type { RequestReadScope } from '../airtable/read-scope';

export function controlFingerprint(c: Config) {
  return hash(
    JSON.stringify([
      c.AIRTABLE_CONTROL_BASE_ID || c.AIRTABLE_BASE_ID,
      c.AIRTABLE_CONTROL_USERS_TABLE || c.AIRTABLE_USERS_TABLE,
      c.AIRTABLE_WORKSPACES_TABLE,
      c.AIRTABLE_WORKSPACE_MEMBERS_TABLE,
    ]),
  );
}

const linked = (value: unknown) =>
  z
    .array(z.string().regex(/^rec[a-zA-Z0-9]{14}$/))
    .length(1)
    .parse(value)[0];
export function membership(record: RecordData) {
  return {
    id: record.id,
    workspace: linked(record.fields.Workspace),
    user: linked(record.fields.User),
    localUserId: z
      .string()
      .regex(/^rec[a-zA-Z0-9]{14}$/)
      .parse(record.fields['Local User ID']),
    role: z.enum(roles).parse(record.fields.Role),
    active: record.fields.Active === true,
  };
}
export type Membership = ReturnType<typeof membership>;
export function isSystemOwner(record: RecordData) {
  return record.fields.Active === true && record.fields['System Role'] === 'Owner';
}
export class ControlPlane {
  readonly users: AirtableRepository;
  readonly spaces: AirtableRepository;
  readonly members: AirtableRepository;
  readonly repository: (c: Config, db: Sql) => AirtableRepository;
  readonly withDatabase: (db: Sql) => ControlPlane;
  constructor(
    c: Config,
    db: Sql,
    repositories?: {
      users: AirtableRepository;
      spaces: AirtableRepository;
      members: AirtableRepository;
      base?: (c: Config, db: Sql) => AirtableRepository;
    },
    readScope?: RequestReadScope,
  ) {
    const wrap = (repo: AirtableRepository) => readScope?.wrap(repo) || repo;
    this.withDatabase = (connection) => new ControlPlane(c, connection, repositories, readScope);
    const base =
      repositories?.base || ((config: Config, root: Sql) => new AirtableClient(config, root));
    this.repository = (config, root) => wrap(base(config, root));
    if (repositories) {
      this.users = wrap(repositories.users);
      this.spaces = wrap(repositories.spaces);
      this.members = wrap(repositories.members);
      return;
    }
    if (!c.AIRTABLE_WORKSPACES_TABLE || !c.AIRTABLE_WORKSPACE_MEMBERS_TABLE)
      throw new AppError(503, 'WORKSPACE_SETUP', 'ยังไม่ได้ตั้งค่าตารางกลางสำหรับ Space');
    const make = (table: string) =>
      new AirtableClient(
        {
          ...c,
          AIRTABLE_BASE_ID: c.AIRTABLE_CONTROL_BASE_ID || c.AIRTABLE_BASE_ID,
          AIRTABLE_TOKEN: c.AIRTABLE_CONTROL_TOKEN || c.AIRTABLE_TOKEN,
          AIRTABLE_USERS_TABLE: table,
        },
        db,
      );
    this.users = wrap(make(c.AIRTABLE_CONTROL_USERS_TABLE || c.AIRTABLE_USERS_TABLE));
    this.spaces = wrap(make(c.AIRTABLE_WORKSPACES_TABLE));
    this.members = wrap(make(c.AIRTABLE_WORKSPACE_MEMBERS_TABLE));
  }
  async owner(userId: string) {
    const record = await this.users.get('users', userId);
    return isSystemOwner(record);
  }
  async requireOwner(userId: string) {
    if (!(await this.owner(userId))) throw forbidden();
  }
  async workspace(id: string) {
    z.uuid().parse(id);
    const rows = (await this.spaces.list('users', `{Workspace ID}=${formulaValue(id)}`)).filter(
      (row) => row.fields['Workspace ID'] === id,
    );
    if (rows.length !== 1) throw forbidden();
    return rows[0];
  }
  async roster(spaceRecordId: string) {
    return (
      await this.members.list('users', `{Workspace Record ID}=${formulaValue(spaceRecordId)}`)
    )
      .filter(
        (row) =>
          Array.isArray(row.fields.Workspace) &&
          row.fields.Workspace.length === 1 &&
          row.fields.Workspace[0] === spaceRecordId,
      )
      .map(membership);
  }
  async forUser(userId: string) {
    return (await this.members.list('users', `{User Record ID}=${formulaValue(userId)}`))
      .filter(
        (row) =>
          Array.isArray(row.fields.User) &&
          row.fields.User.length === 1 &&
          row.fields.User[0] === userId,
      )
      .map(membership);
  }
  async member(spaceRecordId: string, userId: string) {
    const rows = (await this.roster(spaceRecordId)).filter((row) => row.user === userId);
    if (rows.length !== 1) throw forbidden();
    return rows[0];
  }
  async requireAdmin(spaceRecordId: string, userId: string) {
    const user = await this.users.get('users', userId);
    if (isSystemOwner(user)) return;
    const member = await this.member(spaceRecordId, userId);
    if (!member.active || member.role !== 'Admin' || !userDto(user).active) throw forbidden();
    return member;
  }
  async memberUsers(members: Membership[]) {
    const ids = [...new Set(members.map((m) => m.user))],
      result = new Map<string, RecordData>();
    for (let offset = 0; offset < ids.length; offset += 50) {
      const batch = ids.slice(offset, offset + 50);
      for (const record of await this.users.list(
        'users',
        'OR(' + batch.map((id) => '{Record ID}=' + formulaValue(id)).join(',') + ')',
      ))
        if (batch.includes(record.id)) result.set(record.id, record);
    }
    if (result.size !== ids.length) throw forbidden();
    return members.map((member) => result.get(member.user) as RecordData);
  }
}

// Base-local Users only provide linked-record IDs. Roles and Active always come from Control Base.
export function workspaceRepository(
  raw: AirtableRepository,
  control: ControlPlane,
  spaceRecordId: string,
): AirtableRepository {
  async function project(
    record: RecordData,
    members: Membership[],
    users?: Map<string, RecordData>,
  ) {
    const matches = members.filter((member) => member.localUserId === record.id);
    if (matches.length !== 1) throw forbidden();
    const member = matches[0],
      user = users?.get(member.user) || (await control.users.get('users', member.user));
    return {
      id: record.id,
      fields: {
        ...record.fields,
        ...user.fields,
        Role: isSystemOwner(user) ? 'Admin' : member.role,
        Active: isSystemOwner(user) || (member.active && user.fields.Active === true),
      },
    };
  }
  return {
    async list(table, formula, fields) {
      if (table !== 'users') return raw.list(table, formula, fields);
      const [members, records] = await Promise.all([
        control.roster(spaceRecordId),
        raw.list('users'),
      ]);
      const central = new Map((await control.memberUsers(members)).map((u) => [u.id, u]));
      const ids = new Set(members.map((member) => member.localUserId));
      return Promise.all(
        records.filter((row) => ids.has(row.id)).map((row) => project(row, members, central)),
      );
    },
    async get(table, id) {
      if (table === 'tasks') {
        // A direct record GET may return 403 for an ID from another Base.
        // Query only the selected Base so absence is distinct from a permission failure.
        const taskId = recordId(id);
        const records = await raw.list('tasks', 'RECORD_ID()=' + formulaValue(taskId));
        const task = records.find((record) => record.id === taskId);
        if (!task)
          throw new AppError(404, 'TASK_NOT_FOUND', 'ไม่พบงานใน Space นี้ กรุณาตรวจ Space ที่เลือก');
        return task;
      }
      if (table !== 'users') return raw.get(table, id);
      return project(await raw.get('users', id), await control.roster(spaceRecordId));
    },
    async patch(table, id, fields) {
      if (table === 'users') throw forbidden();
      return raw.patch(table, id, fields);
    },
    async upsert(table, key, fields) {
      if (table === 'users') throw forbidden();
      return raw.upsert(table, key, fields);
    },
  };
}
