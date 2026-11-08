import assert from 'node:assert/strict';
import test from 'node:test';
import { createCommandQueue } from '../src/lib/command-queue';

test('queued saves run in order and read the revision immediately before execution', async () => {
  let revision = 7;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const started: number[] = [];
  const pending: number[] = [];
  const queue = createCommandQueue(() => revision, count => pending.push(count));
  const first = queue.enqueue(async current => { started.push(current); await held; revision++; return 'first'; });
  const second = queue.enqueue(current => { started.push(current); revision++; return 'second'; });
  const third = queue.enqueue(current => { started.push(current); revision++; return 'third'; });
  await Promise.resolve();
  assert.deepEqual(started, [7]);
  assert.equal(queue.pending, 3);
  release();
  assert.deepEqual(await Promise.all([first, second, third]), ['first', 'second', 'third']);
  assert.deepEqual(started, [7, 8, 9]);
  assert.deepEqual(pending, [1, 2, 3, 2, 1, 0]);
  assert.equal(queue.pending, 0);
});

test('a rejected command preserves its error and does not discard the next command', async () => {
  let revision = 1;
  const queue = createCommandQueue(() => revision);
  const results: number[] = [];
  const first = queue.enqueue(current => { results.push(current); revision++; });
  const failed = queue.enqueue(current => { results.push(current); throw new Error('저장 실패'); });
  const last = queue.enqueue(current => { results.push(current); revision++; return revision; });
  const settled = await Promise.allSettled([first, failed, last]);
  assert.equal(settled[1].status, 'rejected');
  if (settled[1].status === 'rejected') assert.equal(settled[1].reason.message, '저장 실패');
  assert.deepEqual(results, [1, 2, 2]);
  assert.deepEqual(settled[2], { status: 'fulfilled', value: 3 });
  await queue.whenIdle();
  assert.equal(queue.pending, 0);
});

test('session changes can join the queue without overtaking pending writes', async () => {
  let actor = '담당자';
  const queue = createCommandQueue(() => actor);
  const events: string[] = [];
  const saving = queue.enqueue(current => { events.push(`저장:${current}`); });
  const switching = queue.enqueue(() => { actor = '부서장'; events.push('전환'); });
  const after = queue.enqueue(current => { events.push(`조회:${current}`); });
  await Promise.all([saving, switching, after]);
  assert.deepEqual(events, ['저장:담당자', '전환', '조회:부서장']);
});

test('silent-only work remains pending and awaited without issuing any visible pending callback', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const visible: number[] = [], events: string[] = [];
  const queue = createCommandQueue(() => null, count => visible.push(count));
  const first = queue.enqueue(async () => { events.push('read:start'); await held; events.push('read:end'); }, { silent: true });
  const second = queue.enqueue(() => { events.push('next:read'); }, { silent: true });
  let idle = false;
  const waiting = queue.whenIdle().then(() => { idle = true; });
  await Promise.resolve();
  assert.equal(queue.pending, 2);
  assert.equal(idle, false);
  assert.deepEqual(events, ['read:start']);
  assert.deepEqual(visible, []);
  release(); await Promise.all([first, second, waiting]);
  assert.equal(idle, true);
  assert.equal(queue.pending, 0);
  assert.deepEqual(events, ['read:start', 'read:end', 'next:read']);
  assert.deepEqual(visible, [], 'silent operations must not emit redundant zero callbacks');
});

test('silent notifications between visible saves keep execution order and count only the visible operations', async () => {
  let revision = 10, releaseFirst!: () => void, rejectSilent!: (error: Error) => void;
  const heldFirst = new Promise<void>(resolve => { releaseFirst = resolve; });
  const heldSilent = new Promise<void>((_resolve, reject) => { rejectSilent = reject; });
  const visible: number[] = [], starts: string[] = [];
  const queue = createCommandQueue(() => revision, count => visible.push(count));
  const first = queue.enqueue(async current => { starts.push(`save:${current}`); await heldFirst; revision++; });
  const silent = queue.enqueue(async current => { starts.push(`read:${current}`); await heldSilent; }, { silent: true });
  const last = queue.enqueue(current => { starts.push(`save:${current}`); revision++; return revision; });
  const settled = Promise.allSettled([first, silent, last]);
  await Promise.resolve();
  assert.equal(queue.pending, 3);
  assert.deepEqual(visible, [1, 2]);
  releaseFirst(); await first;
  await Promise.resolve();
  assert.equal(queue.pending, 2);
  assert.deepEqual(starts, ['save:10', 'read:11']);
  assert.deepEqual(visible, [1, 2, 1]);
  rejectSilent(new Error('알림 읽음 실패'));
  const results = await settled; await queue.whenIdle();
  assert.equal(results[1].status, 'rejected');
  assert.deepEqual(results[2], { status: 'fulfilled', value: 12 });
  assert.deepEqual(starts, ['save:10', 'read:11', 'save:11']);
  assert.deepEqual(visible, [1, 2, 1, 0], 'silent start/failure cannot flicker or change the visible count');
  assert.equal(queue.pending, 0);
});

test('whenIdle still waits for a trailing silent operation after the visible saving indicator reaches zero', async () => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const visible: number[] = [];
  const queue = createCommandQueue(() => null, count => visible.push(count));
  const saved = queue.enqueue(() => 'saved');
  const read = queue.enqueue(() => held, { silent: true });
  let idle = false;
  const waiting = queue.whenIdle().then(() => { idle = true; });
  assert.equal(await saved, 'saved');
  assert.deepEqual(visible, [1, 0]);
  assert.equal(queue.pending, 1);
  assert.equal(idle, false);
  release(); await Promise.all([read, waiting]);
  assert.equal(queue.pending, 0);
  assert.equal(idle, true);
  assert.deepEqual(visible, [1, 0]);
});
