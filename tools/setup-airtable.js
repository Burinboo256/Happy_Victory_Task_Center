// Run in Airtable's official Scripting extension, in this base only.
// Adds missing tables/fields. Never reads, creates, updates, or deletes records.
// Computed fields and single-link preferences must be configured in the UI.
// Reference: docs/database-schema.md and Airtable Scripting API documentation.
const expectedBaseId = 'appDS1Ji5cqIohPq3';
const text = name => ({ name, type: 'singleLineText' });
const long = name => ({ name, type: 'multilineText' });
const select = (name, choices) => ({ name, type: 'singleSelect', options: { choices: choices.map(name => ({ name })) } });
const check = name => ({ name, type: 'checkbox', options: { icon: 'check', color: 'greenBright' } });
const date = name => ({ name, type: 'date', options: { dateFormat: { name: 'iso' } } });
const datetime = name => ({ name, type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'Asia/Bangkok' } });
const computed = (name, type, setup, primary = false) => ({ name, type, setup, primary });
const link = (name, table) => ({ name, type: 'multipleRecordLinks', linkedTable: table });
const schema = [
  { name: 'Users', fields: [
    text('User ID'), text('Full Name'), { name: 'Email', type: 'email' }, text('Google Subject'),
    select('Role', ['Agent', 'Secretary', 'Admin']), check('Active'),
    computed('Record ID', 'formula', 'RECORD_ID()'), computed('Created At', 'createdTime', 'Created time; include time'),
    datetime('Last Login'), text('LINE User ID'), check('LINE Notifications'),
  ] },
  { name: 'Tasks', fields: [
    computed('Task ID', 'formula', '"HVR-" & RIGHT("00000" & {Sequence}, 5)', true),
    computed('Sequence', 'autoNumber', 'Autonumber'), text('Task Title'), long('Description'),
    link('Agent', 'Users'), computed('Agent Record ID', 'multipleLookupValues', 'Agent -> Record ID'),
    link('Assigned Secretary', 'Users'),
    select('Category', ['เอกสารกรมธรรม์', 'บริการลูกค้า', 'นัดหมาย', 'การเงิน', 'งานทั่วไป']),
    select('Status', ['New', 'In Progress', 'Waiting', 'On Hold', 'Completed', 'Cancelled']),
    select('Priority', ['Low', 'Normal', 'High', 'Urgent']), date('Due Date'), date('Next Follow-up'),
    computed('Created At', 'createdTime', 'Created time; include time'),
    computed('Last Update', 'lastModifiedTime', 'Track all editable fields; include time'),
    datetime('Completed At'), { name: 'Attachments', type: 'multipleAttachments' },
    { name: 'Reference URL', type: 'url' }, text('Request Key'), computed('Record ID', 'formula', 'RECORD_ID()'),
  ] },
  { name: 'Task Updates', fields: [
    computed('Update ID', 'autoNumber', 'Autonumber', true), link('Task', 'Tasks'),
    computed('Task Record ID', 'multipleLookupValues', 'Task -> Record ID'), link('Updated By', 'Users'),
    text('Actor Name'), select('Update Type', ['Created', 'Comment', 'Status', 'Follow-up']),
    text('Old Status'), text('New Status'), long('Message'),
    computed('Updated At', 'createdTime', 'Created time; include time'), check('Visible to Agent'), text('Operation Key'),
  ] },
  { name: 'Follow-ups', fields: [
    computed('Follow-up ID', 'autoNumber', 'Autonumber', true), link('Task', 'Tasks'),
    computed('Task Record ID', 'multipleLookupValues', 'Task -> Record ID'), date('Follow-up Date'),
    link('Assigned To', 'Users'), select('Follow-up Status', ['Pending', 'Done', 'Skipped']),
    long('Result / Notes'), datetime('Completed At'), text('Operation Key'),
  ] },
  { name: 'Notifications', fields: [
    computed('Notification ID', 'autoNumber', 'Autonumber', true), link('Task', 'Tasks'), link('Recipient', 'Users'),
    select('Channel', ['Email', 'LINE']), select('Event Type', ['Status Changed', 'Daily Summary']), long('Message'),
    select('Delivery Status', ['Pending', 'Sending', 'Sent', 'Failed']), datetime('Sent At'), text('Operation Key'),
    date('Digest Date'), select('Digest Round', ['Morning', 'Evening']), text('LINE User ID'), text('LINE Role'),
    text('LINE Retry Key'), text('Scope Fingerprint'), datetime('Delivery Started At'), long('Last Error'),
  ] },
];

if (base.id !== expectedBaseId) throw new Error('Wrong base; no changes made. Expected ' + expectedBaseId);

// Validate existing names/types before adding anything. Do not repair conflicts silently.
for (const spec of schema) {
  const table = base.tables.find(t => t.name.toLowerCase() === spec.name.toLowerCase());
  if (!table) continue;
  if (table.name !== spec.name) throw new Error('Table name differs in case: ' + table.name);
  for (const field of spec.fields) {
    const current = table.fields.find(f => f.name.toLowerCase() === field.name.toLowerCase());
    if (!current) continue;
    const placeholder = field.primary && current.type === 'singleLineText';
    if (current.name !== field.name || (current.type !== field.type && !placeholder)) {
      throw new Error('Review existing field before continuing: ' + spec.name + '.' + field.name);
    }
    if (field.linkedTable && current.options.linkedTableId !== base.getTable(field.linkedTable).id) {
      throw new Error('Existing link targets a different table: ' + spec.name + '.' + field.name);
    }
    if (field.type === 'singleSelect') {
      const names = current.options.choices.map(c => c.name);
      if (field.options.choices.some(c => !names.includes(c.name))) {
        throw new Error('Existing select is missing required options: ' + spec.name + '.' + field.name);
      }
    }
  }
}

// Create all tables before links. Computed primary fields start as empty text fields.
for (const spec of schema) {
  if (base.tables.some(t => t.name === spec.name)) continue;
  const initial = spec.fields.filter(f => !f.linkedTable && (!f.setup || f.primary)).map(f => {
    if (f.setup) return text(f.name);
    const { name, type, options } = f;
    return options ? { name, type, options } : { name, type };
  });
  await base.createTableAsync(spec.name, initial);
  output.text('Created table: ' + spec.name);
}

for (const spec of schema) {
  const table = base.getTable(spec.name);
  for (const field of spec.fields) {
    if (field.setup || table.fields.some(f => f.name === field.name)) continue;
    const options = field.linkedTable ? { linkedTableId: base.getTable(field.linkedTable).id } : field.options;
    await table.createFieldAsync(field.name, field.type, options);
    output.text('Added: ' + spec.name + '.' + field.name);
  }
}

const remaining = [];
for (const spec of schema) {
  const table = base.getTable(spec.name);
  for (const field of spec.fields) {
    const actual = table.fields.find(f => f.name === field.name);
    if (field.setup && (!actual || actual.type !== field.type)) {
      remaining.push({ table: spec.name, field: field.name, type: field.type, setup: field.setup });
    }
    if (field.linkedTable && !actual.options.prefersSingleRecordLink) {
      remaining.push({ table: spec.name, field: field.name, type: field.type, setup: 'Disable Allow linking to multiple records' });
    }
  }
}
output.markdown('## Remaining UI configuration');
output.table(remaining);
output.markdown('## Table IDs for Script Properties');
output.table(schema.map(s => ({ table: s.name, id: base.getTable(s.name).id })));
output.text('No records were read or written. Finish UI configuration before connecting the app.');
