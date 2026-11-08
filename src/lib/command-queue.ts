/** Each operation reads its context when it starts, after preceding saves finish. */
export function createCommandQueue<Context>(
  readContext: () => Context,
  onPendingChange: (pending: number) => void = () => undefined,
) {
  let tail: Promise<void> = Promise.resolve();
  let pending = 0;
  let visiblePending = 0;
  return {
    get pending() { return pending; },
    enqueue<Result>(operation: (context: Context) => Result | Promise<Result>, options: { silent?: boolean } = {}): Promise<Result> {
      const visible = !options.silent;
      pending++;
      if (visible) onPendingChange(++visiblePending);
      const result = tail.then(() => operation(readContext())).finally(() => {
        pending--;
        if (visible) onPendingChange(--visiblePending);
      });
      // A failed operation rejects its own promise without breaking subsequent saves.
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
    whenIdle() { return tail; },
  };
}
