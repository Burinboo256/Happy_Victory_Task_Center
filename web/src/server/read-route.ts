import { RequestReadScope } from './airtable/read-scope';
import { protectedContext } from './context';
import { route } from './http';

export function readRoute(
  work: (context: Awaited<ReturnType<typeof protectedContext>>) => Promise<Response>,
) {
  return route(async () => {
    const scope = new RequestReadScope();
    const start = performance.now();
    try {
      const context = await protectedContext(undefined, scope);
      const authorized = performance.now();
      const response = await work(context);
      response.headers.set(
        'Server-Timing',
        `auth;dur=${(authorized - start).toFixed(1)}, data;dur=${(performance.now() - authorized).toFixed(1)}`,
      );
      return response;
    } finally {
      // after() jobs must re-read current recipient permissions, never this snapshot.
      scope.close();
    }
  });
}
