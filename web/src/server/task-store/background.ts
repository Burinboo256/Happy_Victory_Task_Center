import { after } from 'next/server';
import type { Sql } from '../db';
import type { Config } from '../config';
import { AirtableClient, type AirtableRepository } from '../airtable/client';
import { NeonTaskRepository } from './repository';
import { drainTaskMirror } from './sync';

// Best-effort low latency delivery. The persistent outbox + independent scheduler provide recovery.
export function scheduleTaskMirror(db: Sql, rootDb: Sql, c: Config, repo: AirtableRepository) {
  if (!(repo instanceof NeonTaskRepository)) return;
  after(async () => {
    try {
      await drainTaskMirror(db, c, new AirtableClient(c, rootDb), 2);
    } catch {
      console.error('task_mirror_deferred');
    }
  });
}
