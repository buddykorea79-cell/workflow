import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { executeCommand } from '../src/lib/domain';
import { canCancelTransfer } from '../src/lib/transfer-permissions';
import { notificationDestination } from '../src/lib/notification-navigation';
import type { Notification, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-07T03:00:00Z');
const command = (state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) => executeCommand(state, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now);

test('transfer cancellation shown in the UI agrees with server permissions across roles', () => {
  for (const [actor, allowed] of [['u-support-member', true], ['u-doyun', true], ['u-support-admin', true], ['u-support-head', false], ['u-minseo', false]] as const) {
    const state = createSeed(now); state.handovers = [];
    state.users.push({ ...state.users.find(user => user.id === 'u-support-member')!, id: 'new-recipient' });
    command(state, 'u-support-member', 'transfer.request', { departmentId: 'dept-support', fromId: 'u-support-member', toId: 'new-recipient', taskIds: ['task-data'], unitIds: [], reason: '취소 권한 검증' });
    const transfer = state.workTransfers![0];
    assert.equal(canCancelTransfer(state.users.find(user => user.id === actor)!, transfer), allowed, actor);
    if (allowed) { command(state, actor, 'transfer.cancel', { transferId: transfer.id }); assert.equal(transfer.status, 'pending'); assert.equal(state.workTransfers![0].status, 'cancelled'); }
    else { assert.throws(() => command(state, actor, 'transfer.cancel', { transferId: transfer.id })); assert.equal(state.workTransfers![0].status, 'pending'); }
    assert.equal(canCancelTransfer(state.users.find(user => user.id === actor)!, { ...transfer, status: 'completed' }), false);
  }
});

test('delegation approval notifications open the exact request rather than the task', () => {
  const state = createSeed(now);
  command(state, 'u-seoyeon', 'task.create', { title: '승인 알림 업무', description: '대행 승인 알림 확인', unitId: 'unit-record', primaryId: 'u-seoyeon', supportIds: [], dueDate: '2026-11-30', frequency: 'once' });
  const task = state.tasks[0];
  command(state, 'u-seoyeon', 'delegation.request', { taskId: task.id, toId: 'u-jiho', startsAt: '2026-11-07T00:00:00Z', endsAt: '2026-11-20T00:00:00Z', reason: '출장 중 대행' });
  const notification = state.notifications.find(item => item.userId === 'u-head' && item.title === '업무대행 승인 요청')!;
  assert.deepEqual(notificationDestination(notification, state), { view: 'delegation', delegationId: state.delegations[0].id });
  const legacy = { ...notification }; delete legacy.destination;
  assert.deepEqual(notificationDestination(legacy, state), { view: 'delegation', delegationId: state.delegations[0].id });
});

test('performance notifications retain the exact author and half, including legacy messages', () => {
  const state = createSeed(now);
  command(state, 'u-support-member', 'performance.saveHalf', { taskId: 'task-data', period: '2026-H2', description: '성과 알림 연결 확인' });
  const record = state.performances.find(item => item.taskId === 'task-data' && item.period === '2026-H2')!;
  const notification: Notification = { id: 'performance-notification', title: '개인별 반기 성과 평가 요청', description: '담당자 · 2026-H2 · 업무 비중 50점', type: 'task', targetId: 'task-data', read: false, userId: 'u-support-head' };
  assert.deepEqual(notificationDestination(notification, state), { view: 'performance', personId: record.authorId, period: '2026-H2' });
  notification.destination = { view: 'performance', personId: record.authorId, period: '2026-H1' };
  assert.deepEqual(notificationDestination(notification, state), notification.destination);
});
