import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyStatisticsDemo, STATISTICS_DEMO_IDS as ids, STATISTICS_DEMO_MARKER } from '../src/lib/statistics-demo';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace, validateWorkflow } from '../src/lib/domain';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-06T03:00:00Z');
function oldWorkspace() {
  const state = createSeed(now);
  state.units = state.units.filter(unit => !unit.id.startsWith('statistics-demo-'));
  state.tasks = state.tasks.filter(task => task.id !== ids.task);
  state.commonTasks = state.commonTasks.filter(common => common.id !== ids.common);
  state.notifications = state.notifications.filter(notification => notification.id !== ids.notification);
  state.audit = state.audit.filter(event => event.targetId !== STATISTICS_DEMO_MARKER);
  return state;
}
function dispatch(state: WorkspaceData, userId: string, type: string, payload: Record<string, unknown>) {
  const candidate = structuredClone(state);
  executeCommand(candidate, userId, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now);
  Object.assign(state, candidate);
}

test('statistics demo adds the requested hierarchy and pending common work without changing existing records', () => {
  const state = oldWorkspace(); state.tasks[0].code = 'WK-999'; const before = structuredClone(state);
  const result = applyStatisticsDemo(state, now);
  assert.deepEqual(result, { changed: true, addedUnits: 2, addedTasks: 1, addedCommonTasks: 1, addedNotifications: 1, revision: before.revision + 1 });
  for (const key of ['users', 'departments', 'units', 'tasks', 'runs', 'commonTasks', 'sources', 'performances', 'handovers', 'attachments', 'notifications', 'audit'] as const) for (const original of before[key]) assert.deepEqual(state[key].find(item => item.id === original.id), original, `${key}:${original.id}`);
  const task = state.tasks.find(task => task.id === ids.task)!;
  assert.equal(task.title, '행정안전 통계연보 발간'); assert.equal(task.primaryId, ids.sender); assert.equal(task.reviewerId, 'u-support-head');
  assert.equal(task.code, 'WK-1000'); assert.equal(task.unitId, ids.senderUnit); assert.equal(task.commonId, undefined); validateWorkflow(task, state);
  assert.equal(state.units.find(unit => unit.id === ids.senderUnit)!.title, '통계 간행물 발간');
  const common = state.commonTasks.find(common => common.id === ids.common)!;
  assert.equal(common.managerId, ids.sender); assert.equal(common.publicationStatus, 'pending'); assert.deepEqual(common.departmentIds, []); assert.deepEqual(common.distributions, []);
  assert.deepEqual(common.approvalRequests?.[0].targetDepartmentIds, [ids.recipientDepartment]);
  assert.equal(getWorkspace(state, ids.recipient, now).commonTasks.some(common => common.id === ids.common), false);
  assert.equal(getWorkspace(state, ids.sender, now).commonTasks.some(common => common.id === ids.common), true);
});

test('statistics demo replay preserves approval progress, user edits, deleted items and changed account roles', () => {
  const state = oldWorkspace(); applyStatisticsDemo(state, now);
  state.tasks.find(task => task.id === ids.task)!.description = '사용자가 수정한 설명';
  state.units.find(unit => unit.id === ids.senderUnit)!.deletedAt = now.toISOString();
  state.commonTasks.find(common => common.id === ids.common)!.publicationStatus = 'rejected';
  state.users.find(user => user.id === ids.sender)!.role = 'manager';
  const before = JSON.stringify(state); const result = applyStatisticsDemo(state, new Date('2027-01-01'));
  assert.equal(result.changed, false); assert.equal(JSON.stringify(state), before);
});

test('statistics demo checks all identities before mutation and never overwrites conflicting or deleted IDs', () => {
  for (const change of [
    (state: WorkspaceData) => { state.users.find(user => user.id === ids.recipient)!.departmentId = 'dept-plan'; },
    (state: WorkspaceData) => { state.units.push({ ...state.units[0], id: ids.senderUnit, deletedAt: now.toISOString() }); },
    (state: WorkspaceData) => { state.tasks.push({ ...state.tasks[0], id: ids.task }); },
  ]) {
    const state = oldWorkspace(); change(state); const before = JSON.stringify(state);
    assert.throws(() => applyStatisticsDemo(state, now)); assert.equal(JSON.stringify(state), before);
  }
});

test('statistics demo follows source head approval, recipient department allocation and personal registration', () => {
  const state = createSeed(now);
  assert.throws(() => dispatch(state, 'u-innovation-head', 'common.approve', { commonId: ids.common, requestId: ids.approval }), error => error instanceof DomainError && error.code === 'COMMON_HEAD_APPROVAL_REQUIRED');
  dispatch(state, 'u-support-head', 'common.approve', { commonId: ids.common, requestId: ids.approval });
  let common = state.commonTasks.find(common => common.id === ids.common)!;
  assert.equal(common.publicationStatus, 'approved'); const distributionId = common.distributions[0].id;
  assert.equal(common.distributions[0].departmentId, ids.recipientDepartment);
  dispatch(state, 'u-innovation-manager', 'common.assignTeam', { commonId: ids.common, distributionId, team: '혁신팀', leadId: 'u-innovation-lead' });
  dispatch(state, 'u-innovation-lead', 'common.assignPerson', { commonId: ids.common, distributionId, assigneeId: ids.recipient });
  dispatch(state, ids.recipient, 'common.register', { commonId: ids.common, distributionId, unitId: ids.recipientUnit, reviewerId: 'u-innovation-head' });
  common = state.commonTasks.find(common => common.id === ids.common)!;
  const task = state.tasks.find(task => task.id === common.distributions[0].taskId)!;
  assert.equal(task.primaryId, ids.recipient); assert.equal(task.unitId, ids.recipientUnit); assert.equal(task.commonId, ids.common);
  assert.ok(getWorkspace(state, ids.recipient, now).tasks.some(item => item.id === task.id));
  assert.equal(state.tasks.filter(task => task.id === ids.task).length, 1);
  const before = JSON.stringify(state); assert.equal(applyStatisticsDemo(state, now).changed, false); assert.equal(JSON.stringify(state), before);
});
