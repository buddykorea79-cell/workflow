import { formatHash, parseHash, type HashRoute, type TaskTab } from './hash-route';

type Snapshot = { hash: string; state: unknown };
type Entry = { session: string; index: number; token: string; hash: string; parent?: { index: number; token: string } };
type Location = { route: HashRoute; entry: Entry };
export type HashNavigationOptions = {
  read: () => Snapshot;
  push: (hash: string, state: unknown) => void;
  replace: (hash: string, state: unknown) => void;
  go: (delta: number) => void;
  apply: (route: HashRoute) => void;
  confirm: (accept: () => void, cancel: () => void) => void;
};

const stateKey = '__ieumHashNavigation';
let sequence = 0;
const token = () => `${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const normalize = (route: HashRoute) => parseHash(formatHash(route));
const copy = (route: HashRoute): HashRoute => ({ ...route });

/** Browser-independent history bookkeeping. Only external traversal requests confirmation. */
export function createHashNavigation(options: HashNavigationOptions) {
  let session = token();
  const entries = new Map<number, Entry>();
  let accepted: Location | undefined;
  let observed = '';
  let pending: object | undefined;
  let restoring: Location | undefined;
  let approvedClose: { index: number; token: string } | undefined;

  function metadata(snapshot: Snapshot): Entry | undefined {
    const value = record(snapshot.state) ? snapshot.state[stateKey] : undefined;
    if (!record(value) || value.session !== session || !Number.isSafeInteger(value.index) || Number(value.index) < 0 || typeof value.token !== 'string' || value.hash !== snapshot.hash) return undefined;
    const known = entries.get(Number(value.index));
    return known && known.token === value.token && known.hash === snapshot.hash ? known : undefined;
  }
  function key(snapshot: Snapshot): string {
    const value = record(snapshot.state) ? snapshot.state[stateKey] : undefined;
    return `${snapshot.hash}\n${record(value) ? [value.session, value.index, value.token, value.hash].join('|') : ''}`;
  }
  function stateWith(snapshot: Snapshot, entry: Entry) {
    return { ...(record(snapshot.state) ? snapshot.state : {}), [stateKey]: entry };
  }
  function same(entry: Entry | undefined, location: Location) {
    return !!entry && entry.session === location.entry.session && entry.index === location.entry.index && entry.token === location.entry.token && entry.hash === location.entry.hash;
  }
  function write(route: HashRoute, entry: Entry, replace: boolean) {
    const snapshot = options.read();
    entries.set(entry.index, entry);
    (replace ? options.replace : options.push)(entry.hash, stateWith(snapshot, entry));
    accepted = { route: copy(route), entry };
    observed = key(options.read());
  }
  function establish(route: HashRoute, snapshot = options.read()) {
    session = token(); entries.clear();
    const entry: Entry = { session, index: 0, token: token(), hash: formatHash(route) };
    entries.set(0, entry);
    options.replace(entry.hash, stateWith(snapshot, entry));
    accepted = { route: copy(route), entry };
    observed = key(options.read());
  }
  function start() {
    if (accepted) return;
    const snapshot = options.read(), route = parseHash(snapshot.hash);
    establish(route, snapshot);
    options.apply(copy(route));
  }
  function clearTransition() { pending = undefined; restoring = undefined; approvedClose = undefined; }
  function internalBase() {
    start(); clearTransition();
    // An authorized internal action supersedes an outstanding external anchor.
    // Its parent must be the route on screen, not an unaccepted browser location.
    if (!same(metadata(options.read()), accepted!)) establish(accepted!.route);
    return accepted!;
  }
  function adopt(snapshot: Snapshot) {
    const route = parseHash(snapshot.hash), priorHash = accepted!.entry.hash;
    const entry = metadata(snapshot);
    if (entry) { accepted = { route, entry }; observed = key(snapshot); }
    else establish(route, snapshot);
    if (formatHash(route) !== priorHash) options.apply(copy(route));
  }
  function restore(origin: Location) {
    const snapshot = options.read(), entry = metadata(snapshot);
    if (same(entry, origin)) { restoring = undefined; observed = key(snapshot); return; }
    if (entry && entry.session === origin.entry.session && entries.get(origin.entry.index)?.token === origin.entry.token && entry.index !== origin.entry.index) {
      restoring = origin;
      options.go(origin.entry.index - entry.index);
      return;
    }
    // External hash writes have no trustworthy history distance. Replace only that
    // entry and begin a new sequence, so later closes cannot mistake it for a pushed detail.
    restoring = undefined;
    establish(origin.route, snapshot);
  }
  function receive() {
    if (!accepted) { start(); return; }
    const snapshot = options.read(), observation = key(snapshot);
    if (observation === observed) return;
    observed = observation;
    if (restoring) { restore(restoring); return; }
    if (pending) return; // The callbacks read the latest location after any additional Back/Forward.
    const entry = metadata(snapshot);
    if (approvedClose) {
      const approved = entry?.index === approvedClose.index && entry.token === approvedClose.token;
      approvedClose = undefined;
      if (approved) { adopt(snapshot); return; }
    }
    if (formatHash(parseHash(snapshot.hash)) === accepted.entry.hash) { adopt(snapshot); return; }
    const request = {}; pending = request;
    const origin = accepted;
    options.confirm(() => {
      if (pending !== request) return;
      pending = undefined; adopt(options.read());
    }, () => {
      if (pending !== request) return;
      pending = undefined; restore(origin);
    });
  }
  function navigate(input: HashRoute, settings: { replace?: boolean } = {}) {
    start();
    const route = normalize(input), hash = formatHash(route);
    if (hash === accepted!.entry.hash) return;
    const base = internalBase(), index = base.entry.index + (settings.replace ? 0 : 1);
    if (!settings.replace) for (const position of entries.keys()) if (position > base.entry.index) entries.delete(position);
    write(route, { session, index, token: token(), hash }, !!settings.replace);
    options.apply(copy(route));
  }
  function openTask(id: string) {
    start();
    if (accepted!.route.taskId === id) return;
    const route = normalize({ ...accepted!.route, taskId: id, tab: 'overview' });
    if (route.taskId !== id) return;
    const base = internalBase();
    for (const position of entries.keys()) if (position > base.entry.index) entries.delete(position);
    const parent = { index: base.entry.index, token: base.entry.token };
    write(route, { session, index: base.entry.index + 1, token: token(), hash: formatHash(route), parent }, false);
    options.apply(copy(route));
  }
  function setTab(tab: TaskTab) {
    start();
    if (!accepted!.route.taskId) return;
    const route = normalize({ ...accepted!.route, tab });
    if (formatHash(route) === accepted!.entry.hash) return;
    const base = internalBase();
    write(route, { ...base.entry, hash: formatHash(route) }, true);
    options.apply(copy(route));
  }
  function closeTask() {
    start();
    if (!accepted!.route.taskId || approvedClose) return;
    const base = internalBase(), parent = base.entry.parent;
    if (parent && parent.index === base.entry.index - 1 && entries.get(parent.index)?.token === parent.token) {
      approvedClose = parent;
      options.go(-1);
      return;
    }
    const { taskId: _taskId, tab: _tab, ...route } = base.route;
    write(route, { session, index: base.entry.index, token: token(), hash: formatHash(route) }, true);
    options.apply(copy(route));
  }
  function reset(input: HashRoute) {
    start(); clearTransition();
    const route = normalize(input), snapshot = options.read(), entry = metadata(snapshot);
    if (entry) write(route, { session, index: entry.index, token: token(), hash: formatHash(route) }, true);
    else establish(route, snapshot);
    options.apply(copy(route));
  }
  function current(): HashRoute { start(); return copy(accepted!.route); }
  return { start, receive, navigate, openTask, setTab, closeTask, reset, current };
}
