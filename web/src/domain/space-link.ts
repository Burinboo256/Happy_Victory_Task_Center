import { eventKinds } from './customer-care';

// Root-level application routes cannot be Space links.
export const reservedSpaceSlugs = new Set([
  'api',
  'login',
  'register',
  'spaces',
  'tasks',
  'forms',
  'local',
  'inbox',
  'followups',
  'calendar',
  'reports',
  'team',
  'history',
  'notifications',
  'assets',
  'robots',
  'sitemap',
  'favicon',
]);
export function isSpaceSlug(value: string) {
  return (
    value.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && !reservedSpaceSlugs.has(value)
  );
}

export const spaceViews = [
  'inbox',
  'followups',
  'calendar',
  'reports',
  'team',
  'history',
  'notifications',
] as const;
export const carePaths = {
  overview: '/customer-care',
  queue: '/customer-care/queue',
  policies: '/customer-care/policies',
  register: '/customer-care/register',
} as const;
const pages = new Set([
  '/',
  '/tasks',
  '/tasks/new',
  '/forms',
  ...Object.values(carePaths),
  ...spaceViews.map((v) => '/' + v),
]);
export function isWorkspacePath(value: string) {
  if (
    pages.has(value) ||
    /^\/tasks\/rec[a-zA-Z0-9]{14}$/.test(value) ||
    /^\/forms\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\/open)?$/.test(value)
  )
    return true;
  const [path, query, extra] = value.split('?');
  if (!query || extra !== undefined) return false;
  const params = new URLSearchParams(query);
  if (path === carePaths.queue) {
    return params.size === 1 && eventKinds.some((kind) => kind === params.get('group'));
  }
  const key = path === '/forms' ? 'q' : path === '/tasks' ? 'status' : '';
  return (
    !!key &&
    [...params.keys()].every((k) => k === key) &&
    params.getAll(key).length === 1 &&
    (params.get(key)?.length || 0) <= 300
  );
}
export function parseSpacePath(value: string) {
  const match = /^\/([^/?#]+)(.*)$/.exec(value);
  if (!match || !isSpaceSlug(match[1])) return undefined;
  const path = match[2] || '/';
  return isWorkspacePath(path) ? { slug: match[1], path } : undefined;
}
export function spacePath(slug: string | undefined, path: string) {
  return slug ? '/' + slug + (path === '/' ? '' : path) : path;
}

export function registrationPath(slug?: string, id?: string) {
  return slug && isSpaceSlug(slug)
    ? '/' + slug + '/register'
    : '/register' + (id ? '?' + new URLSearchParams({ space: id }) : '');
}

export function registrationErrorPath(returnTo: string, id?: string) {
  const space = parseSpacePath(returnTo);
  const path = registrationPath(space?.path === '/' ? space.slug : undefined, id);
  return path + (path.includes('?') ? '&' : '?') + 'error=google';
}
