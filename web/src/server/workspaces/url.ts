import type { Config } from '../config';
import { safeReturnTo } from '../auth/security';
import { spacePath } from '../../domain/space-link';

export function workspaceUrl(c: Pick<Config, 'APP_ORIGIN' | 'workspace'>, path: string) {
  return (
    c.APP_ORIGIN +
    (c.workspace?.slug
      ? spacePath(c.workspace.slug, safeReturnTo(path))
      : c.workspace
        ? '/spaces/open?' + new URLSearchParams({ space: c.workspace.id, next: safeReturnTo(path) })
        : path)
  );
}
