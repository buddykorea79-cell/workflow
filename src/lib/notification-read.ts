type Scope = { actorId: string; generation: number };
type ReadPayload = { notificationId: string } | { all: true };
type ReadItem = { id: string; read: boolean };

/** Retry only on a later successful workspace load, and only in the same login session. */
export function createNotificationReadQueue(
  scope: () => Scope | null,
  send: (payload: ReadPayload) => Promise<boolean>,
) {
  let owner = '';
  const pending = new Set<string>();
  const inFlight = new Set<string>();
  function currentKey() {
    const current = scope();
    return current ? `${current.actorId}:${current.generation}` : '';
  }
  function sync() {
    const key = currentKey();
    if (key !== owner) { owner = key; pending.clear(); inFlight.clear(); }
    return key;
  }
  async function request(ids: readonly string[], all = false) {
    const key = sync();
    if (!key) return;
    const targets = [...new Set(ids)].filter(id => id && !inFlight.has(id));
    if (!targets.length) return;
    targets.forEach(id => { pending.add(id); inFlight.add(id); });
    const batches = all ? [targets] : targets.map(id => [id]);
    await Promise.all(batches.map(async batch => {
      try {
        // The workspace command queue still verifies actor and generation at execution time.
        const saved = await send(all ? { all: true } : { notificationId: batch[0] });
        if (owner === key && currentKey() === key && saved) batch.forEach(id => pending.delete(id));
      } catch { /* A read failure stays queued without interrupting navigation or editing. */ }
      finally { if (owner === key) batch.forEach(id => inFlight.delete(id)); }
    }));
  }
  function retry(items: readonly ReadItem[]) {
    sync();
    const unread = new Set(items.filter(item => !item.read).map(item => item.id));
    for (const id of pending) if (!unread.has(id)) pending.delete(id);
    return request([...pending]);
  }
  return { request, retry };
}
