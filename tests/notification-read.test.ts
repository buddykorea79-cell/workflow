import assert from 'node:assert/strict';
import test from 'node:test';
import { createNotificationReadQueue } from '../src/lib/notification-read';

test('failed read retries only on the next load and clears after success', async () => {
  const calls: unknown[] = [];
  let success = false;
  const queue = createNotificationReadQueue(() => ({ actorId: 'user-a', generation: 1 }), async payload => { calls.push(payload); return success; });
  await queue.request(['n-1']);
  assert.deepEqual(calls, [{ notificationId: 'n-1' }]);
  success = true;
  await queue.retry([{ id: 'n-1', read: false }]);
  await queue.retry([{ id: 'n-1', read: false }]);
  assert.equal(calls.length, 2);
});

test('in-flight reads are not duplicated by clicks or workspace loads', async () => {
  let finish!: (value: boolean) => void;
  let calls = 0;
  const queue = createNotificationReadQueue(() => ({ actorId: 'user-a', generation: 1 }), () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  const first = queue.request(['n-1']);
  await queue.request(['n-1']);
  await queue.retry([{ id: 'n-1', read: false }]);
  assert.equal(calls, 1);
  finish(true); await first;
});

test('all-read uses one command and retries only still unread accessible IDs', async () => {
  const calls: unknown[] = [];
  const queue = createNotificationReadQueue(() => ({ actorId: 'user-a', generation: 1 }), async payload => { calls.push(payload); return false; });
  await queue.request(['n-1', 'n-2', 'n-3'], true);
  await queue.retry([{ id: 'n-1', read: true }, { id: 'n-2', read: false }]);
  assert.deepEqual(calls, [{ all: true }, { notificationId: 'n-2' }]);
});

test('a new login session cannot retry an old user read or be changed by its late response', async () => {
  let current: { actorId: string; generation: number } | null = { actorId: 'user-a', generation: 1 };
  let finish!: (value: boolean) => void;
  const calls: unknown[] = [];
  const queue = createNotificationReadQueue(() => current, payload => {
    calls.push(payload);
    return calls.length === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(false);
  });
  const first = queue.request(['n-1']);
  current = { actorId: 'user-b', generation: 2 };
  await queue.retry([{ id: 'n-1', read: false }, { id: 'n-2', read: false }]);
  assert.equal(calls.length, 1);
  await queue.request(['n-2']);
  finish(true); await first;
  await queue.retry([{ id: 'n-2', read: false }]);
  assert.deepEqual(calls, [{ notificationId: 'n-1' }, { notificationId: 'n-2' }, { notificationId: 'n-2' }]);
  current = null;
  await queue.request(['n-3']);
  assert.equal(calls.length, 3);
});

test('thrown read failures remain retryable without rejecting UI actions', async () => {
  let calls = 0;
  const queue = createNotificationReadQueue(() => ({ actorId: 'user-a', generation: 1 }), async () => { calls++; throw new Error('offline'); });
  await queue.request(['n-1']);
  await queue.retry([{ id: 'n-1', read: false }]);
  assert.equal(calls, 2);
});
