import type { AirtableRepository } from './client';

// One instance per HTTP read request, never a module-level or cross-request cache.
// Writes invalidate the entire scope, including Control Base projections.
export class RequestReadScope {
  private entries = new Map<string, Promise<unknown>>();
  private nextRepository = 0;
  private closed = false;

  close() {
    this.closed = true;
    this.entries.clear();
  }

  wrap(repo: AirtableRepository): AirtableRepository {
    const namespace = this.nextRepository++;
    const read = async <T>(key: unknown[], work: () => Promise<T>): Promise<T> => {
      if (this.closed) return work();
      const id = JSON.stringify([namespace, ...key]);
      let pending = this.entries.get(id) as Promise<T> | undefined;
      if (!pending) {
        pending = work().then((value) => structuredClone(value));
        this.entries.set(id, pending);
      }
      // Callers must not mutate another consumer's authorization snapshot.
      return structuredClone(await pending);
    };
    const write = async <T>(work: () => Promise<T>): Promise<T> => {
      this.entries.clear();
      try {
        return await work();
      } finally {
        // Also clear after uncertain writes and any reads during the write.
        this.entries.clear();
      }
    };
    return {
      get: (table, id) => read(['get', table, id], () => repo.get(table, id)),
      list: (table, formula, fields) =>
        read(['list', table, formula, fields], () => repo.list(table, formula, fields)),
      patch: (table, id, fields) => write(() => repo.patch(table, id, fields)),
      upsert: (table, key, fields) => write(() => repo.upsert(table, key, fields)),
    };
  }
}
