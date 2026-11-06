import type { AirtableRepository, Table } from '../airtable/client';
import type { Steps } from './journal';

export function upsertStep(
  steps: Steps,
  name: string,
  repo: AirtableRepository,
  table: Table,
  keyField: string,
  fields: Record<string, unknown>,
) {
  return steps.run(name, async () => (await repo.upsert(table, keyField, fields)).id, true, {
    kind: 'upsert',
    table,
    keyField,
    fields,
  });
}
export function patchStep(
  steps: Steps,
  name: string,
  repo: AirtableRepository,
  table: Table,
  recordId: string,
  fields: Record<string, unknown>,
) {
  return steps.run(
    name,
    async () => {
      await repo.patch(table, recordId, fields);
      return true;
    },
    true,
    { kind: 'patch', table, recordId, fields },
  );
}
