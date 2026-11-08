const views = ['dashboard', 'personal', 'department', 'budgets', 'allocation', 'division', 'delegation', 'common', 'schedule', 'performance', 'handover', 'organization', 'admin'] as const;
const taskTabs = ['overview', 'workflow', 'schedule', 'performance', 'references', 'budget', 'monthly'] as const;
export type View = typeof views[number];
export type TaskTab = typeof taskTabs[number];
export type HashRoute = { view: View; taskId?: string; tab?: TaskTab; focus?: string };

const knownViews = new Set<string>(views);
const knownTabs = new Set<string>(taskTabs);
const focusViews = new Set<View>(['common', 'allocation', 'handover', 'personal', 'organization', 'division']);
const safeId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,150}$/.test(value);
const isView = (value: unknown): value is View => typeof value === 'string' && knownViews.has(value);
const isTab = (value: unknown): value is TaskTab => typeof value === 'string' && knownTabs.has(value);

function decode(value: string): string | undefined {
  try { return decodeURIComponent(value); } catch { return undefined; }
}

function queryFocus(query: string): string | undefined {
  const values: string[] = [];
  for (const entry of query.split('&')) {
    const separator = entry.indexOf('=');
    const key = separator < 0 ? entry : entry.slice(0, separator);
    if (decode(key.replace(/\+/g, ' ')) === 'focus') values.push(separator < 0 ? '' : entry.slice(separator + 1));
  }
  // Do not pick an arbitrary target when a link names more than one focus.
  if (values.length !== 1) return undefined;
  const value = decode(values[0].replace(/\+/g, ' '));
  return safeId(value) ? value : undefined;
}

/** Parse the fragment directly so URL normalization cannot hide traversal or extra path segments. */
export function parseHash(hash: string): HashRoute {
  if (typeof hash !== 'string' || hash.length > 1024 || /[\u0000-\u001f\u007f]/.test(hash)) return { view: 'dashboard' };
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const separator = fragment.indexOf('?');
  const path = separator < 0 ? fragment : fragment.slice(0, separator);
  const query = separator < 0 ? '' : fragment.slice(separator + 1);
  const segments = path.split('/');
  if (!isView(segments[0])) return { view: 'dashboard' };
  const route: HashRoute = { view: segments[0] };
  if ((segments.length === 3 || segments.length === 4) && segments[1] === 'task') {
    const taskId = decode(segments[2]);
    if (safeId(taskId)) {
      route.taskId = taskId;
      const tab = decode(segments[3] ?? 'overview');
      route.tab = isTab(tab) ? tab : 'overview';
    }
  }
  const focus = focusViews.has(route.view) ? queryFocus(query) : undefined;
  if (focus) route.focus = focus;
  return route;
}

/** One canonical fragment per route; omitted/unknown task tabs normalize to overview. */
export function formatHash(route: HashRoute): string {
  if (!route || !isView(route.view)) return '#dashboard';
  const detail = safeId(route.taskId) ? `/task/${encodeURIComponent(route.taskId)}/${isTab(route.tab) ? route.tab : 'overview'}` : '';
  const focus = focusViews.has(route.view) && safeId(route.focus) ? `?focus=${encodeURIComponent(route.focus)}` : '';
  return `#${route.view}${detail}${focus}`;
}
