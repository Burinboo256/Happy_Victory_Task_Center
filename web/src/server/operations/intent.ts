import type { Table } from '../airtable/client';

export type WriteIntent =
  | {
      kind: 'upsert';
      table: Table;
      keyField: string;
      fields: Record<string, unknown>;
    }
  | {
      kind: 'patch';
      table: Table;
      recordId: string;
      fields: Record<string, unknown>;
    };

export interface StoredStep {
  state: 'started' | 'completed';
  value?: unknown;
  write: boolean;
  intent?: WriteIntent;
}
