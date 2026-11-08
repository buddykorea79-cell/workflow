import assert from 'node:assert/strict';
import test from 'node:test';
import { createUnsavedChangesRegistry } from '../src/lib/unsaved-changes';

test('draft registration follows edits, saved values and unmount cleanup', () => {
  const registry = createUnsavedChangesRegistry();
  assert.equal(registry.hasChanges(), false);
  registry.register('task', false, '업무 기준');
  assert.deepEqual(registry.draftIds(), []);
  registry.register('task', true, '업무 기준');
  registry.register('task', true, '업무 기준');
  assert.deepEqual(registry.draftIds(), ['task']);
  assert.equal(registry.hasChanges(), true);
  registry.register('task', false, '업무 기준');
  assert.equal(registry.hasChanges(), false);
});

test('saving one form never removes another form with the same label', () => {
  const registry = createUnsavedChangesRegistry();
  registry.register('first', true, '성과');
  registry.register('second', true, '성과');
  assert.deepEqual(registry.labels(), ['성과']);
  registry.clearDraft('first');
  assert.deepEqual(registry.draftIds(), ['second']);
  assert.deepEqual(registry.labels(), ['성과']);
  assert.equal(registry.hasChanges(), true);
});

test('nested navigation preserves background drafts without discarding their protection', () => {
  const registry = createUnsavedChangesRegistry();
  registry.register('page', true, '공통업무');
  const preserved = registry.draftIds();
  registry.register('modal', true, '업무 기준');
  assert.deepEqual(registry.labels(preserved), ['업무 기준']);
  assert.deepEqual(registry.draftIds(preserved), ['modal']);
  registry.clearDraft('modal');
  assert.deepEqual(registry.labels(preserved), []);
  assert.deepEqual(registry.labels(), ['공통업무']);
  assert.equal(registry.hasChanges(), true);
});

test('successful saves clear selected drafts synchronously before navigation checks', () => {
  const registry = createUnsavedChangesRegistry();
  registry.register('task', true, '업무 기준');
  registry.register('schedule', true, '일정');
  registry.register('performance', true, '성과');
  registry.clearDrafts(['task', 'schedule', 'missing']);
  assert.deepEqual(registry.labels(), ['성과']);
  registry.clearDraft('performance');
  assert.equal(registry.hasChanges(), false);
  assert.deepEqual(registry.labels(), []);
});

test('new typing after a saved draft can register the same form again', () => {
  const registry = createUnsavedChangesRegistry();
  registry.register('task', true, '업무 기준');
  registry.clearDraft('task');
  registry.register('task', true, '업무 기준');
  assert.equal(registry.hasChanges(), true);
  assert.deepEqual(registry.draftIds(), ['task']);
});

test('dirty subscribers can attach and remove unload protection as the last draft changes', () => {
  const registry = createUnsavedChangesRegistry();
  const changes: boolean[] = [];
  const unsubscribe = registry.subscribe(() => changes.push(registry.hasChanges()));
  registry.register('task', true, '업무 기준');
  registry.register('task', true, '업무 기준');
  registry.register('performance', true, '성과');
  registry.clearDraft('task');
  registry.clearDraft('performance');
  registry.clearDraft('performance');
  assert.deepEqual(changes, [true, true, true, false]);
  unsubscribe();
  registry.register('later', true, '새 초안');
  assert.deepEqual(changes, [true, true, true, false]);
});

test('registry snapshots cannot mutate stored drafts and labels can be updated', () => {
  const registry = createUnsavedChangesRegistry();
  registry.register('task', true, '기존 이름');
  registry.draftIds().pop();
  registry.labels().push('잘못된 이름');
  registry.register('task', true, '업무 기준');
  assert.deepEqual(registry.draftIds(), ['task']);
  assert.deepEqual(registry.labels(), ['업무 기준']);
});
