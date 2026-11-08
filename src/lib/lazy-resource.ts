export type LazyResourceState<Value> =
  | { status: 'idle' }
  | { status: 'pending'; promise: Promise<Value> }
  | { status: 'resolved'; value: Value }
  | { status: 'rejected'; error: unknown };

/** Cache code only. Props, users, workspaces and drafts must never enter this resource. */
export function createLazyResource<Value>(loader: () => Promise<Value>) {
  let state: LazyResourceState<Value> = { status: 'idle' };
  function load(): Promise<Value> {
    if (state.status === 'pending') return state.promise;
    if (state.status === 'resolved') return Promise.resolve(state.value);
    if (state.status === 'rejected') return Promise.reject(state.error);
    const promise = Promise.resolve().then(loader).then(value => {
      state = { status: 'resolved', value }; return value;
    }, error => {
      state = { status: 'rejected', error }; throw error;
    });
    state = { status: 'pending', promise };
    return promise;
  }
  function resetFailure() {
    if (state.status === 'rejected') state = { status: 'idle' };
  }
  async function preload() {
    try { await load(); }
    catch { resetFailure(); }
  }
  return { load, preload, resetFailure, state: () => state };
}
