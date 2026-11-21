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
