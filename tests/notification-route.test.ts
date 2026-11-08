import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorkspace } from '../src/lib/domain';
import { notificationDestination } from '../src/lib/notification-navigation';
import { notificationRoute } from '../src/lib/notification-route';
import { createSeed } from '../src/lib/seed';
import type { Notification, Workspace } from '../src/lib/types';

const now = new Date('2026-11-08T03:00:00Z');
const workspace = (actor = 'u-admin') => getWorkspace(createSeed(now), actor, now);
const notification = (changes: Partial<Notification> = {}): Notification => ({ id: 'notification-test', title: '알림', description: '', type: 'task', targetId: 'task-budget', read: false, userId: 'u-admin', ...changes });

test('task notifications open the readable task and canonical overview in a role-appropriate screen', () => {
  const admin = workspace(), head = workspace('u-head');
  const notice = notification({ targetType: 'task' });
  assert.deepEqual(notificationRoute(notice, admin), { view: 'personal', taskId: 'task-budget', tab: 'overview' });
  assert.deepEqual(notificationRoute(notice, head), { view: 'department', taskId: 'task-budget', tab: 'overview' });
  const before = structuredClone(admin);
  notificationRoute(notice, admin);
  assert.deepEqual(admin, before);
  for (const change of [
    (w: Workspace) => { w.tasks = w.tasks.filter(task => task.id !== notice.targetId); },
    (w: Workspace) => { w.tasks.find(task => task.id === notice.targetId)!.deletedAt = now.toISOString(); },
    (w: Workspace) => { const task = w.tasks.find(task => task.id === notice.targetId)!; w.units.find(unit => unit.id === task.unitId)!.deletedAt = now.toISOString(); },
  ]) {
    const scoped = structuredClone(admin); change(scoped);
    assert.deepEqual(notificationRoute(notice, scoped), { view: 'personal' });
  }
});

test('distribution notifications find their common parent and distinguish receiving from team or personal assignment', () => {
  const received = notification({ type: 'common', targetType: 'distribution', targetId: 'dist-security-innovation' });
  assert.deepEqual(notificationRoute(received, workspace('u-innovation-manager')), { view: 'allocation', focus: 'common-security' });
  assert.deepEqual(notificationRoute(received, workspace('u-admin')), { view: 'common', focus: 'common-security' }, 'admin allocation keeps its own default department');
  assert.deepEqual(notificationRoute(notification({ type: 'common', targetType: 'distribution', targetId: 'dist-security-plan' }), workspace('u-plan-lead')), { view: 'common', focus: 'common-security' });
  assert.deepEqual(notificationRoute(notification({ type: 'common', targetType: 'distribution', targetId: 'dist-security-support' }), workspace('u-support-member')), { view: 'common', focus: 'common-security' });
  assert.deepEqual(notificationRoute(received, workspace('u-plan-lead')), { view: 'common' }, 'another department’s distribution is not in the scoped workspace');
});

test('common approval targets stay focused and legacy common IDs can still find a receiving assignment', () => {
  const manager = workspace('u-minseo');
  manager.commonTasks.find(common => common.id === 'common-security')!.distributions.find(item => item.departmentId === 'dept-plan')!.status = 'pending';
  const legacy = notification({ type: 'common', targetId: 'common-security' });
  assert.deepEqual(notificationRoute(legacy, manager), { view: 'allocation', focus: 'common-security' });
  assert.deepEqual(notificationRoute({ ...legacy, targetType: 'common' }, workspace('u-head')), { view: 'common', focus: 'common-security' });
  manager.commonTasks.find(common => common.id === 'common-security')!.publicationStatus = 'pending';
  assert.deepEqual(notificationRoute(legacy, manager), { view: 'common', focus: 'common-security' });
  assert.deepEqual(notificationRoute({ ...legacy, targetId: 'inaccessible-common' }, manager), { view: 'common' });
});

test('visible handover and transfer records receive exact focus while stale IDs stay on the base screen', () => {
  const w = workspace('u-minseo');
  const legacy = notification({ type: 'handover', targetId: 'handover-meeting' });
  assert.deepEqual(notificationRoute(legacy, w), { view: 'handover', focus: 'handover-meeting' });
  assert.deepEqual(notificationRoute({ ...legacy, targetType: 'handover' }, w), { view: 'handover', focus: 'handover-meeting' });
  assert.deepEqual(notificationRoute({ ...legacy, targetType: 'transfer' }, w), { view: 'handover' }, 'metadata cannot resolve a different entity kind');
  assert.deepEqual(notificationRoute({ ...legacy, targetId: 'missing' }, w), { view: 'handover' });
});

test('performance and delegation preserve exact destinations separately from their canonical screen route', () => {
  const w = workspace();
  for (const destination of [{ view: 'delegation', delegationId: 'delegation-specific' }, { view: 'performance', personId: 'u-seoyeon', period: '2025-H2' }] as const) {
    const notice = notification({ destination });
    assert.deepEqual(notificationRoute(notice, w), { view: destination.view });
    assert.deepEqual(notificationDestination(notice, w), destination);
  }
  for (const targetType of ['performance', 'delegation'] as const) assert.deepEqual(notificationRoute(notification({ targetType, targetId: 'unavailable' }), w), { view: targetType });
});

test('new metadata takes priority over old title inference and old records need no migration', () => {
  const w = workspace();
  const legacy = notification({ title: '업무대행 승인 요청' });
  assert.deepEqual(notificationRoute(legacy, w), { view: 'delegation' });
  assert.deepEqual(notificationRoute({ ...legacy, targetType: 'task' }, w), { view: 'personal', taskId: 'task-budget', tab: 'overview' });
  assert.deepEqual(notificationRoute(notification({ title: '반기 성과 평가 완료' }), w), { view: 'performance' });
  assert.deepEqual(notificationRoute(notification({ targetId: 'missing-task' }), w), { view: 'personal' });
  assert.equal(legacy.createdAt, undefined);
});

test('untrusted target identifiers cannot introduce hash paths even when an old workspace contains them', () => {
  const w = workspace(); w.tasks[0].id = '../escape';
  assert.deepEqual(notificationRoute(notification({ targetType: 'task', targetId: '../escape' }), w), { view: 'personal' });
  w.commonTasks[0].id = 'common/a';
  assert.deepEqual(notificationRoute(notification({ type: 'common', targetType: 'common', targetId: 'common/a' }), w), { view: 'common' });
});
