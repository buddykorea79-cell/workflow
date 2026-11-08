import assert from 'node:assert/strict';
import test from 'node:test';
import { createHashNavigation } from '../src/lib/hash-navigation';
import type { HashRoute } from '../src/lib/hash-route';

function browser(hash = '#personal') {
  const stack: { hash: string; state: unknown }[] = [{ hash, state: { __NA: true, tree: { segment: 'workspace' }, custom: 'preserved' } }];
  let position = 0;
  const applied: HashRoute[] = [], confirmations: { accept: () => void; cancel: () => void }[] = [], goes: number[] = [];
  const move = (delta: number) => { const target = position + delta; if (target >= 0 && target < stack.length) position = target; };
  const navigation = createHashNavigation({
    read: () => stack[position],
    push: (hash, state) => { stack.splice(position + 1); stack.push({ hash, state: structuredClone(state) }); position++; },
    replace: (hash, state) => { stack[position] = { hash, state: structuredClone(state) }; },
    go: delta => { goes.push(delta); move(delta); },
    apply: route => { applied.push(route); },
    confirm: (accept, cancel) => { confirmations.push({ accept, cancel }); },
  });
  navigation.start();
  return {
    navigation, stack, applied, confirmations, goes,
    position: () => position,
    currentEntry: () => stack[position],
    externalGo(delta: number) { move(delta); navigation.receive(); },
    externalHash(hash: string, state: unknown = null) { stack.splice(position + 1); stack.push({ hash, state }); position++; navigation.receive(); },
  };
}

test('open, Back, and Forward apply only accepted routes and preserve unrelated Next history state', () => {
  const b = browser();
  b.navigation.openTask('task-a');
  assert.deepEqual(b.navigation.current(), { view: 'personal', taskId: 'task-a', tab: 'overview' });
  assert.equal(b.stack.length, 2);
  assert.equal((b.currentEntry().state as { __NA: boolean }).__NA, true);
  assert.deepEqual((b.currentEntry().state as { tree: unknown }).tree, { segment: 'workspace' });
  b.externalGo(-1);
  assert.equal(b.confirmations.length, 1);
  assert.equal(b.navigation.current().taskId, 'task-a');
  assert.equal(b.applied.length, 2);
  b.confirmations[0].accept();
  assert.deepEqual(b.navigation.current(), { view: 'personal' });
  b.externalGo(1);
  assert.equal(b.confirmations.length, 2);
  assert.deepEqual(b.navigation.current(), { view: 'personal' });
  b.confirmations[1].accept();
  assert.equal(b.navigation.current().taskId, 'task-a');
});

test('tab changes replace one detail entry and selecting the same task preserves its draft tab and focus', () => {
  const b = browser('#common?focus=common-a');
  b.navigation.openTask('task-a');
  b.navigation.setTab('performance');
  assert.equal(b.stack.length, 2);
  assert.equal(b.currentEntry().hash, '#common/task/task-a/performance?focus=common-a');
  const state = structuredClone(b.currentEntry().state), applyCount = b.applied.length;
  b.navigation.openTask('task-a');
  b.navigation.setTab('performance');
  assert.deepEqual(b.currentEntry().state, state);
  assert.equal(b.applied.length, applyCount);
  assert.equal(b.confirmations.length, 0);
  b.navigation.closeTask(); b.navigation.receive();
  assert.deepEqual(b.navigation.current(), { view: 'common', focus: 'common-a' });
  assert.deepEqual(b.goes, [-1]);
});

test('an already approved close traverses its exact parent without asking the dirty guard again', () => {
  const b = browser();
  b.navigation.openTask('task-a');
  b.navigation.closeTask();
  assert.equal(b.confirmations.length, 0);
  assert.equal(b.navigation.current().taskId, 'task-a', 'wait for the browser traversal event');
  b.navigation.receive();
  assert.deepEqual(b.navigation.current(), { view: 'personal' });
  assert.equal(b.confirmations.length, 0);
  const applyCount = b.applied.length;
  b.navigation.receive(); b.navigation.receive();
  assert.equal(b.applied.length, applyCount);
  b.externalGo(1); b.confirmations[0].accept();
  b.navigation.closeTask(); b.navigation.receive();
  assert.equal(b.confirmations.length, 1);
  assert.deepEqual(b.goes, [-1, -1]);
});

test('cancelled dirty Back restores the real stack so another Back or close still reaches the list', () => {
  const b = browser();
  b.navigation.navigate({ view: 'common' });
  b.navigation.openTask('task-a'); b.navigation.setTab('performance');
  const hashes = b.stack.map(entry => entry.hash), applyCount = b.applied.length;
  b.externalGo(-1); b.confirmations[0].cancel();
  assert.deepEqual(b.goes, [1]);
  assert.equal(b.position(), 2);
  b.navigation.receive();
  assert.deepEqual(b.stack.map(entry => entry.hash), hashes, 'cancel must not overwrite the list entry with a detail');
  assert.equal(b.applied.length, applyCount);
  b.externalGo(-1); b.confirmations[1].cancel(); b.navigation.receive();
  assert.equal(b.navigation.current().tab, 'performance');
  b.navigation.closeTask(); b.navigation.receive();
  assert.deepEqual(b.navigation.current(), { view: 'common' });
  assert.equal(b.confirmations.length, 2);
  b.externalGo(-1); b.confirmations[2].accept();
  assert.deepEqual(b.navigation.current(), { view: 'personal' });
});

test('additional Back events while confirmation is open use the latest physical index for cancel and accept', () => {
  const b = browser();
  b.navigation.navigate({ view: 'common' }); b.navigation.navigate({ view: 'handover' }); b.navigation.openTask('task-a');
  b.externalGo(-1); b.externalGo(-1); b.externalGo(-1);
  assert.equal(b.confirmations.length, 1);
  assert.equal(b.position(), 0);
  b.confirmations[0].cancel();
  assert.deepEqual(b.goes, [3]);
  b.navigation.receive();
  assert.equal(b.position(), 3);
  assert.equal(b.navigation.current().taskId, 'task-a');
  b.externalGo(-1); b.externalGo(-1);
  assert.equal(b.confirmations.length, 2);
  b.confirmations[1].accept();
  assert.deepEqual(b.navigation.current(), { view: 'common' });
  assert.equal(b.position(), 1);
  assert.deepEqual(b.stack.map(entry => entry.hash), ['#personal', '#common', '#handover', '#handover/task/task-a/overview']);
});

test('a bookmarked detail closes by replacing its base and never assumes an app-owned previous page', () => {
  const b = browser('#common/task/task-a/performance?focus=common-a');
  b.navigation.closeTask();
  assert.equal(b.stack.length, 1);
  assert.equal(b.currentEntry().hash, '#common?focus=common-a');
  assert.deepEqual(b.navigation.current(), { view: 'common', focus: 'common-a' });
  assert.deepEqual(b.goes, []);
  assert.equal(b.confirmations.length, 0);
});

test('duplicate popstate/hashchange events and stale confirmation callbacks do not apply or confirm twice', () => {
  const b = browser(); b.navigation.openTask('task-a');
  b.externalGo(-1); b.navigation.receive(); b.navigation.receive();
  assert.equal(b.confirmations.length, 1);
  b.confirmations[0].cancel(); b.navigation.receive(); b.navigation.receive();
  const applyCount = b.applied.length;
  b.confirmations[0].accept(); b.confirmations[0].cancel();
  assert.equal(b.applied.length, applyCount);
  assert.equal(b.navigation.current().taskId, 'task-a');
  assert.deepEqual(b.goes, [1]);
});

test('external raw hashes cancel with a safe replacement and cannot retain a false app-owned close marker', () => {
  const b = browser(); b.navigation.openTask('task-a'); b.navigation.setTab('workflow');
  b.externalHash('#organization?focus=user-a', { __NA: true, tree: { segment: 'external' }, custom: 'retained' });
  b.confirmations[0].cancel(); b.navigation.receive();
  assert.equal(b.currentEntry().hash, '#personal/task/task-a/workflow');
  assert.equal((b.currentEntry().state as { custom: string }).custom, 'retained');
  assert.deepEqual(b.goes, []);
  b.navigation.closeTask();
  assert.equal(b.currentEntry().hash, '#personal');
  assert.equal(b.stack.length, 3);
  assert.deepEqual(b.goes, []);
  assert.equal(b.confirmations.length, 1);
});

test('accepted external links are canonicalized and internal replace navigation keeps the current stack length', () => {
  const b = browser();
  b.externalHash('#common/task/task-a?focus=common-a');
  b.confirmations[0].accept();
  assert.equal(b.currentEntry().hash, '#common/task/task-a/overview?focus=common-a');
  assert.deepEqual(b.navigation.current(), { view: 'common', taskId: 'task-a', tab: 'overview', focus: 'common-a' });
  const length = b.stack.length;
  b.navigation.navigate({ view: 'organization', focus: 'user-a' }, { replace: true });
  assert.equal(b.stack.length, length);
  assert.deepEqual(b.navigation.current(), { view: 'organization', focus: 'user-a' });
  assert.equal(b.confirmations.length, 1);
});

test('reset replaces the actual current entry, clears stale confirmation, and invalidates replaced detail parents', () => {
  const b = browser(); b.navigation.openTask('task-a'); b.externalGo(-1);
  b.navigation.reset({ view: 'dashboard' });
  const applyCount = b.applied.length;
  b.confirmations[0].accept(); b.confirmations[0].cancel();
  assert.equal(b.applied.length, applyCount);
  assert.deepEqual(b.navigation.current(), { view: 'dashboard' });
  assert.equal(b.currentEntry().hash, '#dashboard');
  b.externalGo(1); b.confirmations[1].accept();
  b.navigation.closeTask();
  assert.equal(b.currentEntry().hash, '#personal');
  assert.deepEqual(b.goes, [], 'the old parent token was replaced by reset');
});

test('current returns an isolated route, start is idempotent, and invalid task ids cannot disturb history', () => {
  const b = browser('#personal/task/task-a');
  const route = b.navigation.current(); route.view = 'admin'; route.taskId = 'changed';
  assert.deepEqual(b.navigation.current(), { view: 'personal', taskId: 'task-a', tab: 'overview' });
  b.navigation.start(); b.navigation.openTask('../escape');
  assert.equal(b.stack.length, 1);
  assert.equal(b.applied.length, 1);
  assert.equal(b.currentEntry().hash, '#personal/task/task-a/overview');
});
