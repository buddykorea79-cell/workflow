import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { residualTransferRoles } from '../src/lib/transfer-roles';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-05T03:00:00Z');
const fromId = 'u-support-member', toId = 'u-role-successor', managerId = 'u-doyun', headId = 'u-support-head', departmentId = 'dept-support';
function fixture() {
  const state = createSeed(now); state.handovers = [];
  state.users.push({ ...state.users.find(user => user.id === fromId)!, id: toId, name: '역할후임', role: 'lead', commonTaskPermission: false });
  return state;
}
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, minutes = 0) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, new Date(now.getTime() + minutes * 60_000));
  Object.assign(state, candidate);
}
function request(state: WorkspaceData, roleIds: string[], target = toId, actor = managerId) {
  dispatch(state, actor, 'transfer.rolesRequest', { departmentId, fromId, toId: target, roleIds, reason: '전보 전 잔여 책임 정리' });
  return state.workTransfers![0].id;
}
function denied(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, code: string) {
  const before = structuredClone(state);
  assert.throws(() => dispatch(state, actor, type, payload, 3), error => error instanceof DomainError && error.code === code);
  assert.deepEqual(state, before);
}
function supportFixture() {
  const state = fixture(), task = state.tasks.find(task => task.id === 'task-assets')!, run = state.runs.find(run => run.taskId === task.id)!;
  task.supportIds = [fromId]; task.versions.at(-1)!.supportIds = [fromId]; run.supportIds = [fromId];
  return state;
}
function addCommon(state: WorkspaceData) {
  state.commonTasks.push({ id: 'common-roles', title: '역할 정리 공통업무', description: '배정 대기 책임', managerId: fromId, dueDate: '2026-12-01', frequency: 'once', version: 1, requiredSteps: ['검토'], departmentIds: [departmentId], distributions: [{ id: 'dist-roles', departmentId, status: 'person_assigned', distributedAt: now.toISOString(), team: '데이터팀', leadId: fromId, assigneeId: fromId }] });
}

test('role transfer: support role waits for department head and preserves completed execution authors', () => {
  const state = supportFixture(), run = state.runs.find(run => run.taskId === 'task-assets')!;
  const completed = { ...structuredClone(run), id: 'completed-role-history', status: 'completed' as const };
  state.runs.push(completed);
  const transferId = request(state, ['task_support:task-assets', `run_support:${run.id}`]);
  assert.deepEqual(state.tasks.find(task => task.id === 'task-assets')!.supportIds, [fromId]);
  denied(state, 'u-support-admin', 'transfer.approve', { transferId }, 'TRANSFER_HEAD_REQUIRED');
  const beforeSteps = structuredClone(run.steps);
  dispatch(state, headId, 'transfer.approve', { transferId }, 2);
  const saved = state.tasks.find(task => task.id === 'task-assets')!;
  assert.deepEqual(saved.supportIds, [toId]); assert.deepEqual(saved.versions.at(-1)!.supportIds, [toId]);
  assert.deepEqual(state.runs.find(item => item.id === run.id)!.steps, beforeSteps);
  assert.deepEqual(state.runs.find(item => item.id === run.id)!.supportIds, [toId]);
  assert.deepEqual(state.runs.find(item => item.id === completed.id), completed);
  assert.ok(!getWorkspace(state, fromId, now).tasks.some(task => task.id === saved.id));
  assert.equal(state.workTransfers![0].events.at(-1)?.action, 'approved');
});

test('role transfer: reviewer replacement updates future definitions and only open run assignments', () => {
  const state = fixture(), task = state.tasks.find(task => task.id === 'task-assets')!, run = state.runs.find(run => run.taskId === task.id)!;
  task.reviewerId = fromId; task.versions.at(-1)!.reviewerId = fromId; run.reviewerId = fromId;
  const beforeVersions = structuredClone(task.versions);
  const transferId = request(state, ['task_reviewer:task-assets', `run_reviewer:${run.id}`]);
  dispatch(state, headId, 'transfer.approve', { transferId });
  const saved = state.tasks.find(task => task.id === 'task-assets')!;
  assert.equal(saved.reviewerId, toId); assert.equal(saved.versions.at(-1)!.reviewerId, toId);
  assert.deepEqual(saved.versions.slice(0, -1), beforeVersions);
  assert.equal(state.runs.find(item => item.id === run.id)!.reviewerId, toId);
});

test('role transfer: self review and unqualified reviewer recipients are rejected', () => {
  for (const recipientId of [managerId, 'u-it-resources-member-1']) {
    const state = fixture(), task = state.tasks.find(task => task.id === 'task-assets')!;
    task.reviewerId = fromId; task.versions.at(-1)!.reviewerId = fromId;
    denied(state, managerId, 'transfer.rolesRequest', { departmentId, fromId, toId: recipientId, roleIds: ['task_reviewer:task-assets'], reason: '잘못된 후임' }, 'TRANSFER_ROLE_RECIPIENT');
  }
});

test('role transfer: common coordinator and pre-registration team/person assignment move after approval', () => {
  const state = fixture(); addCommon(state);
  const transferId = request(state, ['common_manager:common-roles', 'distribution_lead:dist-roles', 'distribution_assignee:dist-roles']);
  dispatch(state, headId, 'transfer.approve', { transferId });
  const common = state.commonTasks.find(common => common.id === 'common-roles')!;
  assert.equal(common.managerId, toId); assert.equal(common.distributions[0].leadId, toId); assert.equal(common.distributions[0].assigneeId, toId);
  assert.equal(common.distributions[0].status, 'person_assigned');
});

test('role transfer: recipient authority and team are checked again when approving', () => {
  for (const kind of ['common_manager', 'distribution_lead'] as const) {
    const state = fixture(); addCommon(state);
    const transferId = request(state, [`${kind}:${kind === 'common_manager' ? 'common-roles' : 'dist-roles'}`]);
    const target = state.users.find(user => user.id === toId)!;
    if (kind === 'common_manager') target.role = 'head'; else target.team = '정보기획팀';
    denied(state, headId, 'transfer.approve', { transferId }, 'TRANSFER_ROLE_RECIPIENT');
  }
});

test('role transfer: overlapping role or primary handover requests are blocked', () => {
  const state = supportFixture(); request(state, ['task_support:task-assets']);
  denied(state, managerId, 'transfer.rolesRequest', { departmentId, fromId, toId, roleIds: ['task_support:task-assets'], reason: '중복 요청' }, 'DUPLICATE_HANDOVER');
  denied(state, managerId, 'transfer.request', { departmentId, fromId: managerId, toId, taskIds: ['task-assets'], reason: '같은 업무 주담당 변경' }, 'DUPLICATE_HANDOVER');
});

test('role transfer: changed assignments invalidate approval atomically', () => {
  const state = supportFixture(); const transferId = request(state, ['task_support:task-assets']);
  state.tasks.find(task => task.id === 'task-assets')!.supportIds.push('u-it-resources-member-1');
  denied(state, headId, 'transfer.approve', { transferId }, 'TRANSFER_ROLE_CHANGED');
});

test('role transfer: execution progress during review does not invalidate a role request', () => {
  const state = supportFixture(), run = state.runs.find(run => run.taskId === 'task-assets')!;
  const transferId = request(state, ['task_support:task-assets', `run_support:${run.id}`]);
  dispatch(state, fromId, 'run.note', { runId: run.id, body: '지원 담당자의 최신 메모' }, 1);
  const step = run.steps.find(step => step.status !== 'completed')!;
  dispatch(state, step.role === 'reviewer' ? headId : managerId, 'run.check', { runId: run.id, stepId: step.stepId, checkId: step.checklist[0].id, done: true }, 1);
  dispatch(state, headId, 'transfer.approve', { transferId }, 2);
  assert.equal(state.runs.find(item => item.id === run.id)!.notes.at(-1)!.body, '지원 담당자의 최신 메모');
});

test('role transfer: delegated access can be revoked with head approval without granting a new delegation', () => {
  const state = fixture();
  state.delegations.push({ id: 'role-delegation', taskId: 'task-assets', fromId: managerId, toId: fromId, startsAt: now.toISOString(), endsAt: '2026-12-01T00:00:00Z', actions: ['run.note'], approvedBy: headId });
  const transferId = request(state, ['delegation_revoke:role-delegation']);
  assert.equal(state.delegations.find(item => item.id === 'role-delegation')!.revokedAt, undefined);
  dispatch(state, headId, 'transfer.approve', { transferId }, 2);
  assert.ok(state.delegations.find(item => item.id === 'role-delegation')!.revokedAt);
  assert.ok(!state.delegations.some(item => item.toId === toId));
});

test('role transfer: current and confirmed responsibilities are both inventoried', () => {
  const state = supportFixture();
  state.tasks.find(task => task.id === 'task-assets')!.supportIds = [];
  assert.ok(residualTransferRoles(state, fromId, departmentId, now).some(role => role.id === 'task_support:task-assets'));
  const transferId = request(state, ['task_support:task-assets']);
  dispatch(state, headId, 'transfer.approve', { transferId });
  const task = state.tasks.find(task => task.id === 'task-assets')!;
  assert.deepEqual(task.supportIds, []); assert.deepEqual(task.versions.at(-1)!.supportIds, [toId]);
});

test('role transfer: unrelated members cannot request another persons responsibility changes', () => {
  const state = supportFixture();
  denied(state, 'u-it-resources-member-1', 'transfer.rolesRequest', { departmentId, fromId, toId, roleIds: ['task_support:task-assets'], reason: '권한 없음' }, 'TRANSFER_REQUEST_DENIED');
});
