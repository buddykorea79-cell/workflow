/** Dirty drafts are keyed by mounted form, so unrelated forms cannot clear each other. */
export function createUnsavedChangesRegistry() {
  const entries = new Map<string, string>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of listeners) listener(); };
  const clear = (ids: readonly string[]) => {
    let changed = false;
    for (const id of ids) changed = entries.delete(id) || changed;
    if (changed) notify();
  };
  return {
    register(id: string, dirty: boolean, label = '작성 중인 내용') {
      if (!dirty) { clear([id]); return; }
      if (entries.get(id) === label) return;
      entries.set(id, label); notify();
    },
    clearDraft: (id: string) => clear([id]),
    clearDrafts: clear,
    draftIds: (preservedIds: readonly string[] = []) => [...entries.keys()].filter(id => !preservedIds.includes(id)),
    labels: (preservedIds: readonly string[] = []) => [...new Set([...entries].filter(([id]) => !preservedIds.includes(id)).map(([, label]) => label))],
    hasChanges: () => entries.size > 0,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
