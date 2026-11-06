import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DomainError, executeCommand, getWorkspace, canReadTask, canReadSource } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import { activeTaskDelegations, canActAsDeputy, delegationStatus } from '../src/lib/delegations';
import { residualTransferRoles } from '../src/lib/transfer-roles';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-06T03:00:00Z');
const owner = 'u-seoyeon', deputy = 'u-jiho', manager = 'u-minseo', head = 'u-head';
const nomination = { toId: deputy, startsAt: '2026-11-06T00:00:00Z', endsAt: '2026-11-20T00:00:00Z', reason: '출장 중 업무 연속성 유지' };
const taskInput = { title: '대행할 세부업무', description: '원본 업무에서 수행 결과를 함께 기록합니다.', unitId: 'unit-record', primaryId: owner, supportIds: [], frequency: 'monthly', dueDate: '2026-11-30' };
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown> = {}, at = now) {
  executeCommand(state, actor, { type, payload, requestId: randomUUID(), expectedRevision: state.revision }, at);
}
function fixture(confirmed = false) {
  const state = createSeed(now);
  dispatch(state, owner, 'task.create', taskInput);
  const taskId = state.tasks[0].id;
  if (confirmed) dispatch(state, head, 'department.confirm');
  return { state, task: state.tasks.find(task => task.id === taskId)! };
}
function request(state: WorkspaceData, taskId: string, actor = owner, extra: Record<string, unknown> = {}) {
  dispatch(state, actor, 'delegation.request', { taskId, ...nomination, ...extra }); return state.delegations[0];
}
function denied(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, code: string, at = now) {
  const before = structuredClone(state);
  assert.throws(() => dispatch(state, actor, type, payload, at), error => error instanceof DomainError && error.code === code);
  assert.deepEqual(state, before);
}

test('delegation approval: nomination creates a pending record and only the source head can grant execution', () => {
  const { state, task } = fixture(true), beforeTasks = structuredClone(state.tasks), beforeUnits = structuredClone(state.units);
  const delegation = request(state, task.id);
  assert.equal(delegation.status, 'pending'); assert.equal(delegation.approvedBy, undefined);
  assert.equal(delegation.taskVersion, task.version); assert.equal(delegation.taskTitle, task.title);
  const beforeApproval = getWorkspace(state, deputy, now);
  assert.ok(beforeApproval.delegations.some(item => item.id === delegation.id));
  assert.equal(beforeApproval.tasks.some(item => item.id === task.id), false);
  assert.deepEqual(beforeApproval.delegatedTaskIds, []);
  const run = state.runs.find(run => run.taskId === task.id)!;
  denied(state, deputy, 'run.note', { runId: run.id, body: '승인 전 수행' }, 'TASK_ACCESS_DENIED');
  for (const actor of [owner, manager, deputy, 'u-admin', 'u-support-head']) denied(state, actor, 'delegation.approve', { delegationId: delegation.id }, 'DELEGATION_HEAD_REQUIRED');
  dispatch(state, head, 'delegation.approve', { delegationId: delegation.id });
  assert.equal(delegation.status, 'approved'); assert.equal(delegation.approvedBy, head);
  assert.deepEqual(state.tasks, beforeTasks); assert.deepEqual(state.units, beforeUnits);
  const approved = getWorkspace(state, deputy, now);
  assert.ok(approved.delegatedTaskIds!.includes(task.id)); assert.ok(approved.tasks.some(item => item.id === task.id));
  assert.equal(approved.tasks.find(item => item.id === task.id)!.primaryId, owner);
  assert.ok(state.audit.some(item => item.action === 'delegation.request' && item.targetId === delegation.id));
  assert.ok(state.audit.some(item => item.action === 'delegation.approve' && item.targetId === delegation.id));
  denied(state, head, 'delegation.approve', { delegationId: delegation.id }, 'DELEGATION_STATE');
});

test('delegation approval: member and department manager requests are allowed after division confirmation; self, foreign, expired and overlapping nominations are rejected', () => {
  const { state, task } = fixture(true);
  for (const toId of [owner, head, 'u-support-member']) denied(state, owner, 'delegation.request', { taskId: task.id, ...nomination, toId }, 'DELEGATION_RECIPIENT');
  denied(state, 'u-plan-lead', 'delegation.request', { taskId: task.id, ...nomination }, 'DELEGATION_REQUEST_DENIED');
  denied(state, owner, 'delegation.request', { taskId: task.id, ...nomination, endsAt: now.toISOString() }, 'DELEGATION_PERIOD');
  const delegation = request(state, task.id, manager);
  denied(state, owner, 'delegation.request', { taskId: task.id, ...nomination, toId: 'u-plan-lead' }, 'DELEGATION_OVERLAP');
  dispatch(state, head, 'delegation.approve', { delegationId: delegation.id });
  denied(state, owner, 'delegation.request', { taskId: task.id, ...nomination }, 'DELEGATION_OVERLAP');
  request(state, task.id, owner, { startsAt: nomination.endsAt, endsAt: '2026-11-21T00:00:00Z' });
  assert.equal(state.delegations.length, 2);
});

test('delegation approval: the legacy create endpoint requests approval instead of granting immediate authority', () => {
  const { state, task } = fixture();
  dispatch(state, manager, 'delegation.create', { taskId: task.id, ...nomination, actions: ['run.note'] });
  assert.equal(state.delegations[0].status, 'pending');
  assert.equal(canActAsDeputy(state, state.users.find(user => user.id === deputy)!, task, undefined, now), false);
});

test('delegation approval: changed owner, version, description and recipient employment are rechecked atomically', () => {
  for (const change of ['owner', 'version', 'description', 'recipient', 'requester'] as const) {
    const { state, task } = fixture(), delegation = request(state, task.id);
    if (change === 'owner') task.primaryId = manager;
    if (change === 'version') task.version++;
    if (change === 'description') dispatch(state, owner, 'task.update', { taskId: task.id, description: '요청 뒤 수정한 설명' });
    if (change === 'recipient') state.users.find(user => user.id === deputy)!.endsAt = now.toISOString();
    if (change === 'requester') state.users.find(user => user.id === owner)!.active = false;
    denied(state, head, 'delegation.approve', { delegationId: delegation.id }, change === 'recipient' ? 'DELEGATION_RECIPIENT' : change === 'requester' ? 'DELEGATION_OWNER_CHANGED' : 'DELEGATION_STALE');
  }
  const { state, task } = fixture(), delegation = request(state, task.id);
  denied(state, head, 'delegation.approve', { delegationId: delegation.id }, 'DELEGATION_EXPIRED', new Date(nomination.endsAt));
});

test('delegation approval: approved deputy records shared execution but never changes the definition or completes reviewer steps', () => {
  const { state, task } = fixture(true), delegation = request(state, task.id);
  dispatch(state, head, 'delegation.approve', { delegationId: delegation.id });
  const run = state.runs.find(run => run.taskId === task.id)!, step = run.steps[0];
  dispatch(state, deputy, 'run.note', { runId: run.id, body: '업무대행 수행 기록' });
  for (const check of step.checklist) dispatch(state, deputy, 'run.check', { runId: run.id, stepId: step.stepId, checkId: check.id, done: true });
  dispatch(state, deputy, 'run.completeStep', { runId: run.id, stepId: step.stepId, output: '대행자의 확인 결과' });
  assert.equal(step.completedBy, deputy); assert.equal(task.workflow[0].done, true);
  dispatch(state, deputy, 'task.record', { taskId: task.id, documents: [{ id: 'deputy-result', type: 'document', title: '대행 결과', content: '원본 업무에 저장한 생산 문서' }] });
  assert.equal(task.recordHistory!.at(-1)!.recordedBy, deputy);
  const reviewerStep = run.steps.find(item => item.role === 'reviewer')!;
  denied(state, deputy, 'run.completeStep', { runId: run.id, stepId: reviewerStep.stepId, output: '검토권한 우회' }, 'EXECUTION_DENIED');
  denied(state, deputy, 'task.setProgress', { taskId: task.id, stepId: reviewerStep.stepId, done: true }, 'EXECUTION_DENIED');
  denied(state, deputy, 'task.configure', { taskId: task.id, description: '원본 기준 변경' }, 'DEPARTMENT_CONFIRMED');
  dispatch(state, head, 'department.reopen', { reason: '정의 편집 권한 재확인' });
  denied(state, deputy, 'task.configure', { taskId: task.id, description: '원본 기준 변경' }, 'EDIT_DENIED');
  assert.equal(state.tasks.find(item => item.id === task.id)!.primaryId, owner);
});

test('delegation approval: scheduling and a subsequent cycle keep the original owner and reviewer', () => {
  const { state, task } = fixture(), delegation = request(state, task.id);
  dispatch(state, head, 'delegation.approve', { delegationId: delegation.id });
  const schedule = { taskId: task.id, startDate: '2026-11-06', dueDate: '2026-11-10', scheduleDetails: '대행 기간 중 회차', steps: task.workflow.map(step => ({ stepId: step.id })) };
  dispatch(state, deputy, 'run.schedule', schedule);
  const first = state.runs.find(run => run.taskId === task.id)!;
  for (const step of first.steps) dispatch(state, step.role === 'reviewer' ? head : deputy, 'task.setProgress', { taskId: task.id, stepId: step.stepId, done: true });
  dispatch(state, deputy, 'run.nextCycle', { ...schedule, previousRunId: first.id, startDate: '2026-11-11', dueDate: '2026-11-19' });
  const next = state.runs[0]; assert.equal(next.primaryId, owner); assert.equal(next.reviewerId, head); assert.equal(next.previousRunId, first.id); assert.equal(first.status, 'completed');
});

test('delegation approval: future, expired, revoked, moved and transferred grants stop access without a scheduler', () => {
  for (const change of ['future', 'expired', 'revoked', 'moved', 'transferred'] as const) {
    const { state, task } = fixture(), delegation = request(state, task.id, owner, change === 'future' ? { startsAt: '2026-11-07T00:00:00Z' } : {});
    dispatch(state, head, 'delegation.approve', { delegationId: delegation.id });
    if (change === 'revoked') dispatch(state, owner, 'delegation.revoke', { delegationId: delegation.id, reason: '담당자 업무 복귀' });
    if (change === 'moved') state.users.find(user => user.id === deputy)!.departmentId = 'dept-support';
    if (change === 'transferred') task.primaryId = manager;
    const at = change === 'expired' ? new Date(nomination.endsAt) : now;
    assert.equal(activeTaskDelegations(state, task, undefined, at).length, 0);
    assert.equal(canReadTask(state, state.users.find(user => user.id === deputy)!, task, at), false);
    assert.equal(getWorkspace(state, deputy, at).delegatedTaskIds!.includes(task.id), false);
  }
});

test('delegation approval: rejection and cancellation preserve history, need reasons and release the period for a new request', () => {
  const { state, task } = fixture(), rejected = request(state, task.id);
  denied(state, head, 'delegation.reject', { delegationId: rejected.id }, 'REASON_REQUIRED');
  dispatch(state, head, 'delegation.reject', { delegationId: rejected.id, reason: '기간 보완' });
  const cancelled = request(state, task.id);
  denied(state, deputy, 'delegation.cancel', { delegationId: cancelled.id, reason: '타인 요청 취소' }, 'DELEGATION_CANCEL_DENIED');
  dispatch(state, owner, 'delegation.cancel', { delegationId: cancelled.id, reason: '출장 일정 변경' });
  assert.equal(delegationStatus(rejected), 'rejected'); assert.equal(delegationStatus(cancelled), 'cancelled');
  assert.equal(residualTransferRoles(state, deputy, task.departmentId, now).some(role => role.kind === 'delegation_revoke' && role.taskId === task.id), false);
  request(state, task.id); assert.equal(state.delegations.length, 3);
});

test('delegation approval: create with a nomination is atomic and the reviewer is always the source head', () => {
  const state = createSeed(now), before = structuredClone(state);
  denied(state, owner, 'task.create', { ...taskInput, reviewerId: deputy, deputy: { ...nomination, toId: owner } }, 'DELEGATION_RECIPIENT');
  assert.deepEqual(state, before);
  dispatch(state, owner, 'task.create', { ...taskInput, reviewerId: deputy, deputy: nomination });
  assert.equal(state.tasks[0].reviewerId, head); assert.equal(state.delegations[0].taskId, state.tasks[0].id); assert.equal(state.delegations[0].status, 'pending');
  dispatch(state, owner, 'task.update', { taskId: state.tasks[0].id, reviewerId: deputy });
  assert.equal(state.tasks[0].reviewerId, head);
});

test('delegation approval: restricted linked evidence becomes readable only during approved delegation', () => {
  const { state, task } = fixture();
  const source = { ...state.sources[0], id: 'delegated-restricted-source', ownerId: owner, classification: 'restricted' as const };
  state.sources.push(source); task.sourceIds = [source.id];
  const user = state.users.find(user => user.id === deputy)!, delegation = request(state, task.id);
  assert.equal(canReadSource(state, user, source, now), false);
  dispatch(state, head, 'delegation.approve', { delegationId: delegation.id });
  assert.equal(canReadSource(state, user, source, now), true);
  dispatch(state, deputy, 'delegation.revoke', { delegationId: delegation.id, reason: '대행 종료 확인' });
  assert.equal(canReadSource(state, user, source, now), false);
});
