import { z } from 'zod';
import { roles, statuses, priorities, categories } from '../../domain/model';
import type { Config } from '../config';
import type { Table } from './client';
import { AppError } from '../errors';

type Spec = {
  type: string;
  choices?: readonly string[];
  link?: Table;
  lookup?: { link: string; table: Table };
  formula?: 'record' | 'task';
};
const field = (type: string): Spec => ({ type });
const select = (choices: readonly string[]): Spec => ({ type: 'singleSelect', choices });
const link = (table: Table): Spec => ({ type: 'multipleRecordLinks', link: table });
const lookup = (name: string, table: Table): Spec => ({
  type: 'multipleLookupValues',
  lookup: { link: name, table },
});
const recordId: Spec = { type: 'formula', formula: 'record' };
export const schemaContract: Record<Table, { primary: string; fields: Record<string, Spec> }> = {
  users: {
    primary: 'User ID',
    fields: {
      'User ID': field('singleLineText'),
      'Full Name': field('singleLineText'),
      'Agent Code': field('singleLineText'),
      Phone: field('phoneNumber'),
      Email: field('email'),
      'Google Subject': field('singleLineText'),
      Role: select(roles),
      Active: field('checkbox'),
      'Record ID': recordId,
      'Created At': field('createdTime'),
      'Last Login': field('dateTime'),
      'LINE User ID': field('singleLineText'),
      'LINE Notifications': field('checkbox'),
    },
  },
  tasks: {
    primary: 'Task ID',
    fields: {
      'Task ID': { type: 'formula', formula: 'task' },
      Sequence: field('autoNumber'),
      'Task Title': field('singleLineText'),
      Description: field('multilineText'),
      Agent: link('users'),
      'Agent Record ID': lookup('Agent', 'users'),
      'Assigned Secretary': link('users'),
      Category: select(categories),
      Status: select(statuses),
      Priority: select(priorities),
      'Due Date': field('date'),
      'Next Follow-up': field('date'),
      'Created At': field('createdTime'),
      'Last Update': field('lastModifiedTime'),
      'Completed At': field('dateTime'),
      Attachments: field('multipleAttachments'),
      'Reference URL': field('url'),
      'Request Key': field('singleLineText'),
      'Record ID': recordId,
    },
  },
  updates: {
    primary: 'Update ID',
    fields: {
      'Update ID': field('autoNumber'),
      Task: link('tasks'),
      'Task Record ID': lookup('Task', 'tasks'),
      'Updated By': link('users'),
      'Actor Name': field('singleLineText'),
      'Update Type': select(['Created', 'Comment', 'Status', 'Follow-up']),
      'Old Status': field('singleLineText'),
      'New Status': field('singleLineText'),
      Message: field('multilineText'),
      'Updated At': field('createdTime'),
      'Visible to Agent': field('checkbox'),
      'Operation Key': field('singleLineText'),
    },
  },
  followups: {
    primary: 'Follow-up ID',
    fields: {
      'Follow-up ID': field('autoNumber'),
      Task: link('tasks'),
      'Task Record ID': lookup('Task', 'tasks'),
      'Follow-up Date': field('date'),
      'Assigned To': link('users'),
      'Follow-up Status': select(['Pending', 'Done', 'Skipped']),
      'Result / Notes': field('multilineText'),
      'Completed At': field('dateTime'),
      'Operation Key': field('singleLineText'),
    },
  },
  notifications: {
    primary: 'Notification ID',
    fields: {
      'Notification ID': field('autoNumber'),
      Task: link('tasks'),
      Recipient: link('users'),
      Channel: select(['Email', 'LINE']),
      'Event Type': select(['Status Changed', 'Daily Summary']),
      Message: field('multilineText'),
      'Delivery Status': select(['Pending', 'Sending', 'Sent', 'Failed']),
      'Sent At': field('dateTime'),
      'Operation Key': field('singleLineText'),
      'Digest Date': field('date'),
      'Digest Round': select(['Morning', 'Evening']),
      'LINE User ID': field('singleLineText'),
      'LINE Role': field('singleLineText'),
      'LINE Retry Key': field('singleLineText'),
      'Scope Fingerprint': field('singleLineText'),
      'Delivery Started At': field('dateTime'),
      'Last Error': field('multilineText'),
    },
  },
};

const column = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  options: z.record(z.string(), z.unknown()).optional(),
});
const metadata = z.object({
  tables: z.array(
    z.object({ id: z.string(), primaryFieldId: z.string(), fields: z.array(column) }),
  ),
});
export type SchemaIssue = { table: Table; field: string; code: string };
const sameChoices = (actual: unknown, expected: readonly string[]) => {
  const choices = z.array(z.object({ name: z.string() })).safeParse(actual);
  if (!choices.success) return false;
  const names = choices.data.map((c) => c.name);
  return (
    names.length === expected.length &&
    new Set(names).size === names.length &&
    expected.every((name) => names.includes(name))
  );
};
const resultType = (value: unknown) => z.object({ type: z.string() }).safeParse(value).data?.type;
// Preserve string literals while ignoring whitespace outside them.
const formulaTokens = (value: string) => {
  const tokens =
    value.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\{[^}]+\}|[a-z_][a-z0-9_]*|[^\s]/gi) || [];
  return tokens
    .map((token, i) =>
      token.startsWith("'")
        ? '"' + token.slice(1, -1) + '"'
        : tokens[i + 1] === '('
          ? token.toUpperCase()
          : token,
    )
    .join('');
};

export function inspectSchema(value: unknown, config: Config): SchemaIssue[] {
  const parsed = metadata.safeParse(value);
  if (!parsed.success) throw new AppError(503, 'SCHEMA_RESPONSE', 'Schema metadata is invalid.');
  const ids: Record<Table, string> = {
    users: config.AIRTABLE_USERS_TABLE,
    tasks: config.AIRTABLE_TASKS_TABLE,
    updates: config.AIRTABLE_UPDATES_TABLE,
    followups: config.AIRTABLE_FOLLOWUPS_TABLE,
    notifications: config.AIRTABLE_NOTIFICATIONS_TABLE,
  };
  const issues: SchemaIssue[] = [];
  for (const tableName of Object.keys(schemaContract) as Table[]) {
    const contract = schemaContract[tableName],
      matches = parsed.data.tables.filter((table) => table.id === ids[tableName]);
    const issue = (fieldName: string, code: string) =>
      issues.push({ table: tableName, field: fieldName, code });
    if (matches.length !== 1) {
      issue('', 'TABLE_MAPPING');
      continue;
    }
    const table = matches[0];
    for (const [name, spec] of Object.entries(contract.fields)) {
      const fields = table.fields.filter((f) => f.name === name);
      if (fields.length !== 1) {
        issue(name, 'FIELD_MISSING_OR_DUPLICATE');
        continue;
      }
      const f = fields[0],
        options = f.options || {};
      if (f.type !== spec.type) {
        issue(name, 'FIELD_TYPE');
        continue;
      }
      if (name === contract.primary && table.primaryFieldId !== f.id) issue(name, 'PRIMARY_FIELD');
      if (spec.choices && !sameChoices(options.choices, spec.choices))
        issue(name, 'SELECT_OPTIONS');
      if (
        spec.link &&
        (options.linkedTableId !== ids[spec.link] || options.prefersSingleRecordLink !== true)
      )
        issue(name, 'LINK_TARGET_OR_CARDINALITY');
      if (spec.lookup) {
        const source = spec.lookup;
        const parent = table.fields.find((c) => c.name === source.link);
        const target = parsed.data.tables.find((t) => t.id === ids[source.table]);
        const targetField = target?.fields.find((c) => c.name === 'Record ID');
        if (
          options.isValid !== true ||
          !parent ||
          !targetField ||
          options.recordLinkFieldId !== parent.id ||
          options.fieldIdInLinkedTable !== targetField.id ||
          resultType(options.result) !== 'singleLineText'
        )
          issue(name, 'LOOKUP_SOURCE');
      }
      if (spec.formula) {
        const formula = typeof options.formula === 'string' ? options.formula : '';
        const sequence = table.fields.find((c) => c.name === 'Sequence');
        const expected =
          spec.formula === 'record' ? 'RECORD_ID()' : `"HVR-"&RIGHT("00000"&{${sequence?.id}},5)`;
        if (
          options.isValid !== true ||
          resultType(options.result) !== 'singleLineText' ||
          formulaTokens(formula) !== formulaTokens(expected)
        )
          issue(name, 'FORMULA');
      }
      if (spec.type === 'lastModifiedTime') {
        const readonly = new Set([
          'formula',
          'autoNumber',
          'createdTime',
          'lastModifiedTime',
          'createdBy',
          'lastModifiedBy',
          'multipleLookupValues',
          'rollup',
          'count',
          'button',
        ]);
        const writable = table.fields.filter((c) => !readonly.has(c.type)).map((c) => c.id);
        const references = options.referencedFieldIds;
        const allFields =
          references === null ||
          // Airtable's "All editable fields" UI also returns [] (verified on the local test Base).
          (Array.isArray(references) &&
            (references.length === 0 || writable.every((id) => references.includes(id))));
        if (options.isValid !== true || resultType(options.result) !== 'dateTime' || !allFields)
          issue(name, 'LAST_MODIFIED_SCOPE_OR_TIME');
      }
    }
  }
  return issues;
}
