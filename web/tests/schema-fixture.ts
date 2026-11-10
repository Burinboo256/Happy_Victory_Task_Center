import { config } from './fixtures';

// Synthetic Metadata API response, transcribed from docs/database-schema.md.
// Do not derive this fixture from the validator's contract.
export function schemaFixture() {
  let sequence = 0;
  const make = (id: string, primary: string, groups: Record<string, string[]>) => {
    const fields = Object.entries(groups).flatMap(([type, names]) =>
      names.map((name) => ({
        id: 'fld' + String(++sequence).padStart(14, '0'),
        name,
        type,
        options: {} as Record<string, unknown>,
      })),
    );
    return { id, primaryFieldId: fields.find((f) => f.name === primary)?.id || '', fields };
  };
  const tables = {
    users: make(config.AIRTABLE_USERS_TABLE, 'User ID', {
      singleLineText: ['User ID', 'Full Name', 'Agent Code', 'Google Subject', 'LINE User ID'],
      phoneNumber: ['Phone'],
      email: ['Email'],
      singleSelect: ['Role'],
      checkbox: ['Active', 'LINE Notifications'],
      formula: ['Record ID'],
      createdTime: ['Created At'],
      dateTime: ['Last Login'],
    }),
    tasks: make(config.AIRTABLE_TASKS_TABLE, 'Task ID', {
      formula: ['Task ID', 'Record ID'],
      autoNumber: ['Sequence'],
      singleLineText: ['Task Title', 'Request Key'],
      multilineText: ['Description'],
      multipleRecordLinks: ['Agent', 'Assigned Secretary'],
      multipleLookupValues: ['Agent Record ID'],
      singleSelect: ['Category', 'Status', 'Priority'],
      date: ['Due Date', 'Next Follow-up'],
      createdTime: ['Created At'],
      lastModifiedTime: ['Last Update'],
      dateTime: ['Completed At'],
      multipleAttachments: ['Attachments'],
      url: ['Reference URL'],
    }),
    updates: make(config.AIRTABLE_UPDATES_TABLE, 'Update ID', {
      autoNumber: ['Update ID'],
      multipleRecordLinks: ['Task', 'Updated By'],
      multipleLookupValues: ['Task Record ID'],
      singleLineText: ['Actor Name', 'Old Status', 'New Status', 'Operation Key'],
      singleSelect: ['Update Type'],
      multilineText: ['Message'],
      createdTime: ['Updated At'],
      checkbox: ['Visible to Agent'],
    }),
    followups: make(config.AIRTABLE_FOLLOWUPS_TABLE, 'Follow-up ID', {
      autoNumber: ['Follow-up ID'],
      multipleRecordLinks: ['Task', 'Assigned To'],
      multipleLookupValues: ['Task Record ID'],
      date: ['Follow-up Date'],
      singleSelect: ['Follow-up Status'],
      multilineText: ['Result / Notes'],
      dateTime: ['Completed At'],
      singleLineText: ['Operation Key'],
    }),
    notifications: make(config.AIRTABLE_NOTIFICATIONS_TABLE, 'Notification ID', {
      autoNumber: ['Notification ID'],
      multipleRecordLinks: ['Task', 'Recipient'],
      singleSelect: ['Channel', 'Event Type', 'Delivery Status', 'Digest Round'],
      multilineText: ['Message', 'Last Error'],
      dateTime: ['Sent At', 'Delivery Started At'],
      date: ['Digest Date'],
      singleLineText: [
        'Operation Key',
        'LINE User ID',
        'LINE Role',
        'LINE Retry Key',
        'Scope Fingerprint',
      ],
    }),
  };
  const field = (table: keyof typeof tables, name: string) => {
    const result = tables[table].fields.find((f) => f.name === name);
    if (!result) throw new Error('Missing schema fixture field');
    return result;
  };
  const select = (table: keyof typeof tables, name: string, names: string[]) => {
    field(table, name).options.choices = names.map((name, n) => ({ id: 'sel' + n, name }));
  };
  select('users', 'Role', ['Agent', 'Secretary', 'Admin']);
  select('tasks', 'Status', ['New', 'In Progress', 'Waiting', 'On Hold', 'Completed', 'Cancelled']);
  select('tasks', 'Priority', ['Low', 'Normal', 'High', 'Urgent']);
  select('tasks', 'Category', ['ตัวแทนใหม่', 'ตัวแทนเก่า', 'ลูกค้าใหม่', 'ลูกค้าเก่า', 'วันเกิดตัวแทนและลูกค้า', 'งานเคลม']);
  select('updates', 'Update Type', ['Created', 'Comment', 'Status', 'Follow-up']);
  select('followups', 'Follow-up Status', ['Pending', 'Done', 'Skipped']);
  select('notifications', 'Channel', ['Email', 'LINE']);
  select('notifications', 'Event Type', ['Status Changed', 'Daily Summary']);
  select('notifications', 'Delivery Status', ['Pending', 'Sending', 'Sent', 'Failed']);
  select('notifications', 'Digest Round', ['Morning', 'Evening']);
  const connect = (table: keyof typeof tables, name: string, target: keyof typeof tables) => {
    field(table, name).options = {
      linkedTableId: tables[target].id,
      prefersSingleRecordLink: true,
    };
  };
  connect('tasks', 'Agent', 'users');
  connect('tasks', 'Assigned Secretary', 'users');
  connect('updates', 'Task', 'tasks');
  connect('updates', 'Updated By', 'users');
  connect('followups', 'Task', 'tasks');
  connect('followups', 'Assigned To', 'users');
  connect('notifications', 'Task', 'tasks');
  connect('notifications', 'Recipient', 'users');
  for (const table of ['users', 'tasks'] as const)
    field(table, 'Record ID').options = {
      isValid: true,
      formula: 'RECORD_ID()',
      referencedFieldIds: [],
      result: { type: 'singleLineText' },
    };
  field('tasks', 'Task ID').options = {
    isValid: true,
    formula: `"HVR-" & RIGHT("00000" & {${field('tasks', 'Sequence').id}}, 5)`,
    referencedFieldIds: [field('tasks', 'Sequence').id],
    result: { type: 'singleLineText' },
  };
  for (const [table, name, parent, target] of [
    ['tasks', 'Agent Record ID', 'Agent', 'users'],
    ['updates', 'Task Record ID', 'Task', 'tasks'],
    ['followups', 'Task Record ID', 'Task', 'tasks'],
  ] as const)
    field(table, name).options = {
      isValid: true,
      recordLinkFieldId: field(table, parent).id,
      fieldIdInLinkedTable: field(target, 'Record ID').id,
      result: { type: 'singleLineText' },
    };
  field('tasks', 'Last Update').options = {
    isValid: true,
    referencedFieldIds: null,
    result: { type: 'dateTime' },
  };
  return { value: { tables: Object.values(tables) }, tables, field };
}
