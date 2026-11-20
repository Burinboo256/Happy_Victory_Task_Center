// Run in the official Airtable Scripting extension of a NEW Control Base.
// Set the expected Base ID explicitly. Adds schema only; never touches records.
const expectedBaseId = 'REPLACE_WITH_CONTROL_BASE_ID';
const text = (name) => ({ name, type: 'singleLineText' });
const select = (name, choices) => ({ name, type: 'singleSelect', options: { choices: choices.map(name => ({ name })) } });
const check = (name) => ({ name, type: 'checkbox', options: { icon: 'check', color: 'greenBright' } });
const schema = [
  { name: 'Users', fields: [
    text('User ID'), text('Full Name'), text('Agent Code'),
    { name: 'Phone', type: 'phoneNumber' }, { name: 'Email', type: 'email' },
    text('Google Subject'), select('Role', ['Agent', 'Secretary', 'Admin']), check('Active'),
    { name: 'Last Login', type: 'dateTime', options: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' }, timeZone: 'Asia/Bangkok' } },
    text('LINE User ID'), check('LINE Notifications'), select('System Role', ['Owner', 'User']),
  ] },
  { name: 'Workspaces', fields: [text('Workspace ID'), text('Name'), text('Base ID'), check('Active')] },
  { name: 'Workspace Members', fields: [text('Membership Key'), text('Local User ID'), select('Role', ['Admin', 'Secretary', 'Agent']), check('Active')] },
];
if (base.id !== expectedBaseId) throw new Error('Wrong Base; no changes made.');
for (const spec of schema) {
  const existing = base.tables.find(t => t.name.toLowerCase() === spec.name.toLowerCase());
  if (!existing) continue;
  if (existing.name !== spec.name || existing.primaryField.name !== spec.fields[0].name) throw new Error('Review table: ' + spec.name);
  for (const field of spec.fields) {
    const current = existing.fields.find(f => f.name.toLowerCase() === field.name.toLowerCase());
    if (current && (current.name !== field.name || current.type !== field.type)) throw new Error('Review field: ' + spec.name + '.' + field.name);
    if (current && field.type === 'singleSelect' && field.options.choices.some(c => !current.options.choices.some(v => v.name === c.name))) throw new Error('Review options: ' + spec.name + '.' + field.name);
  }
}
for (const spec of schema) {
  if (!base.tables.some(t => t.name === spec.name)) await base.createTableAsync(spec.name, spec.fields);
  const table = base.getTable(spec.name);
  for (const f of spec.fields) if (!table.fields.some(existing => existing.name === f.name)) await table.createFieldAsync(f.name, f.type, f.options);
}
const members = base.getTable('Workspace Members');
for (const [name, target] of [['Workspace', 'Workspaces'], ['User', 'Users']]) {
  const existing = members.fields.find(f => f.name === name);
  const linkedTableId = base.getTable(target).id;
  if (existing && (existing.type !== 'multipleRecordLinks' || existing.options.linkedTableId !== linkedTableId)) throw new Error('Review link: ' + name);
  if (!existing) await members.createFieldAsync(name, 'multipleRecordLinks', { linkedTableId });
}
output.table(schema.map(s => ({ table: s.name, id: base.getTable(s.name).id })));
output.markdown('## Finish in the Airtable UI\n- Users: Record ID formula `RECORD_ID()`, Created At (Created time).\n- Workspaces: Record ID formula `RECORD_ID()`.\n- Workspace Members: disable multiple links for Workspace and User; add Workspace Record ID and User Record ID lookups to the matching Record ID fields.\n- Verify every field before bootstrap. No records were changed.');
