import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import { requestableDelegationTasks } from '../src/lib/delegations';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-06T03:00:00Z');
const owner = 'u-seoyeon', deputy = 'u-jiho', manager = 'u-minseo', head = 'u-head';
const nomination = { fromId: owner, toId: deputy, startsAt: '2026-11-06T00:00:00Z', endsAt: '2026-11-20T00:00:00Z', reason: '교육 기간 업무 전체·일부 대행' };
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown> = {}) {
  executeCommand(state, actor, { type, payload, requestId: randomUUID(), expectedRevision: state.revision }, now);
}
function fixture() {
  const state = createSeed(now), template = state.units.find(unit => unit.id === 'unit-record')!;
  state.units.push({ ...template, id: 'batch-extra-unit', title: '대행 시험 두 번째 단위업무' });
  const ids: string[] = [];
  for (const [index, unitId] of ['unit-record', 'unit-record', 'batch-extra-unit'].entries()) {
    dispatch(state, owner, 'task.create', { title: `일괄 대행 시험 ${index + 1}`, description: '원본을 복제하지 않고 선택한 업무만 대행합니다.', unitId, primaryId: owner, supportIds: [], frequency: 'monthly', dueDate: '2026-11-30' });
    ids.push(state.tasks[0].id);
  }
  return { state, ids };
}
function request(state: WorkspaceData, taskIds: string[], actor = owner) {
  dispatch(state, actor, 'delegation.requestBatch', { ...nomination, taskIds });
  return state.delegations[0].batchId!;
}
function denied(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, code: string) {
  const before = structuredClone(state);
  assert.throws(() => dispatch(state, actor, type, payload), error => error instanceof DomainError && error.code === code);
  assert.deepEqual(state, before);
}

test('batch delegation: selected detail tasks across units are approved together without copying originals', () => {
  const { state, ids } = fixture(); const originals = structuredClone({ tasks: state.tasks, units: state.units });
  const selected = [ids[0], ids[2]], batchId = request(state, selected);
  const records = state.delegations.filter(item => item.batchId === batchId);
  assert.equal(records.length, 2); assert.ok(records.every(item => item.status === 'pending' && !item.approvedBy));
  assert.deepEqual(records.find(item => item.batchTaskIds)!.batchTaskIds, selected);
  assert.equal(records.filter(item => item.batchTaskIds).length, 1);
  assert.ok(selected.every(id => !getWorkspace(state, deputy, now).delegatedTaskIds!.includes(id)));
  dispatch(state, head, 'delegation.approve', { batchId });
  assert.ok(records.every(item => item.status === 'approved' && item.approvedBy === head));
  const workspace = getWorkspace(state, deputy, now);
  assert.ok(selected.every(id => workspace.delegatedTaskIds!.includes(id))); assert.ok(!workspace.delegatedTaskIds!.includes(ids[1]));
  assert.deepEqual({ tasks: state.tasks, units: state.units }, originals);
  for (const record of records) assert.ok(state.audit.some(event => event.targetId === record.id && event.action === 'delegation.approve'));
  assert.ok(state.audit.some(event => event.targetId === batchId && event.detail.includes(ids[0]) && event.detail.includes(ids[2])));
});

test('batch delegation: all owner work can be selected and later-created tasks never enter the approved selection', () => {
  const { state } = fixture(); const source = state.users.find(person => person.id === owner)!;
  const ids = requestableDelegationTasks(state, source, now).filter(task => task.primaryId === owner).map(task => task.id);
  const batchId = request(state, ids, manager); dispatch(state, head, 'delegation.approve', { batchId });
  assert.deepEqual(new Set(getWorkspace(state, deputy, now).delegatedTaskIds), new Set(ids));
  dispatch(state, owner, 'task.create', { title: '대행 승인 뒤 추가한 업무', description: '추가 업무는 자동 대행하지 않습니다.', unitId: 'unit-record', primaryId: owner, frequency: 'monthly', dueDate: '2026-11-30' });
  assert.ok(!getWorkspace(state, deputy, now).delegatedTaskIds!.includes(state.tasks[0].id));
});

test('batch delegation: confirmed division snapshots stay unchanged while deputies receive only selected original work', () => {
  const { state, ids } = fixture();
  dispatch(state, head, 'department.confirm');
  const original = structuredClone({ plans: state.departmentWorkPlans, tasks: state.tasks, units: state.units });
  const selected = [ids[0], ids[2]], batchId = request(state, selected, manager);
  dispatch(state, head, 'delegation.approve', { batchId });
  assert.deepEqual({ plans: state.departmentWorkPlans, tasks: state.tasks, units: state.units }, original);
  const workspace = getWorkspace(state, deputy, now);
  assert.deepEqual(new Set(workspace.delegatedTaskIds), new Set(selected));
  assert.ok(selected.every(id => workspace.tasks.find(task => task.id === id)?.primaryId === owner));
  assert.ok(!workspace.units.some(unit => unit.id === '__personal_delegated_work__'));
  for (const taskId of selected) {
    const taskRow = workspace.organizationDivision!.departments.flatMap(department => department.people).flatMap(person => person.units).flatMap(unit => unit.tasks).find(task => task.id === taskId)!;
    assert.ok(taskRow.delegates.some(person => person.id === deputy));
  }
});

test('batch delegation: invalid selection and forbidden requesters cannot create any partial request', () => {
  const { state, ids } = fixture();
  denied(state, owner, 'delegation.requestBatch', { ...nomination, taskIds: [] }, 'VALIDATION_ERROR');
  denied(state, owner, 'delegation.requestBatch', { ...nomination, taskIds: [ids[0], ids[0]] }, 'DELEGATION_DUPLICATE_TASK');
  denied(state, owner, 'delegation.requestBatch', { ...nomination, taskIds: [ids[0], 'missing-task'] }, 'NOT_FOUND');
  denied(state, owner, 'delegation.requestBatch', { ...nomination, taskIds: ids, fromId: deputy }, 'DELEGATION_SELECTION_CHANGED');
  for (const actor of [deputy, head, 'u-doyun']) denied(state, actor, 'delegation.requestBatch', { ...nomination, taskIds: ids }, 'DELEGATION_REQUEST_DENIED');
  const foreign = state.tasks.find(task => task.departmentId !== state.tasks.find(task => task.id === ids[0])!.departmentId)!;
  denied(state, 'u-admin', 'delegation.requestBatch', { ...nomination, taskIds: [ids[0], foreign.id] }, 'DELEGATION_SELECTION_CHANGED');
});

test('batch delegation: overlap or an archived last member rejects the complete request atomically', () => {
  const { state, ids } = fixture();
  dispatch(state, owner, 'delegation.request', { taskId: ids[2], ...nomination });
  denied(state, owner, 'delegation.requestBatch', { ...nomination, taskIds: ids }, 'DELEGATION_OVERLAP');
  state.tasks.find(task => task.id === ids[1])!.status = 'archived';
  denied(state, owner, 'delegation.requestBatch', { ...nomination, taskIds: [ids[0], ids[1]] }, 'TASK_ARCHIVED');
});

test('batch delegation: a stale member prevents every approval and individual-ID approval cannot bypass the group', () => {
  const { state, ids } = fixture(), batchId = request(state, ids);
  const record = state.delegations.find(item => item.taskId === ids[0])!;
  state.tasks.find(task => task.id === ids[2])!.description = '요청 이후 바뀐 업무 기준';
  denied(state, head, 'delegation.approve', { batchId }, 'DELEGATION_STALE');
  denied(state, head, 'delegation.approve', { delegationId: record.id }, 'DELEGATION_STALE');
  assert.ok(state.delegations.every(item => item.status === 'pending'));
  dispatch(state, head, 'delegation.reject', { batchId, reason: '변경된 업무 기준으로 다시 요청' });
  assert.ok(state.delegations.every(item => item.status === 'rejected'));
});

test('batch delegation: only the source head approves; cancel and revoke close the complete group and retain records', () => {
  const { state, ids } = fixture(); let batchId = request(state, ids);
  for (const actor of [owner, deputy, manager, 'u-admin', 'u-support-head']) denied(state, actor, 'delegation.approve', { batchId }, 'DELEGATION_HEAD_REQUIRED');
  denied(state, deputy, 'delegation.cancel', { batchId, reason: '당사자 외 취소 시도' }, 'DELEGATION_CANCEL_DENIED');
  dispatch(state, owner, 'delegation.cancel', { batchId, reason: '기간 조정' });
  assert.ok(state.delegations.filter(item => item.batchId === batchId).every(item => item.status === 'cancelled'));
  batchId = request(state, ids); const record = state.delegations.find(item => item.batchId === batchId)!;
  dispatch(state, head, 'delegation.approve', { delegationId: record.id });
  assert.ok(state.delegations.filter(item => item.batchId === batchId).every(item => item.status === 'approved'));
  dispatch(state, deputy, 'delegation.revoke', { batchId, reason: '대행 종료 보고' });
  assert.ok(state.delegations.filter(item => item.batchId === batchId).every(item => item.status === 'revoked' && item.revokedAt));
  assert.equal(getWorkspace(state, deputy, now).delegatedTaskIds!.length, 0);
  assert.equal(state.delegations.length, 6);
});

test('batch delegation: a transfer-ended member blocks approval but remaining pending requests can be cancelled', () => {
  const { state, ids } = fixture(), batchId = request(state, ids);
  const ended = state.delegations.find(item => item.taskId === ids[0])!;
  ended.status = 'revoked'; ended.revokedAt = now.toISOString(); ended.resolutionReason = '인사이동으로 종료';
  denied(state, head, 'delegation.approve', { batchId }, 'DELEGATION_STATE');
  dispatch(state, owner, 'delegation.cancel', { batchId, reason: '인사이동 후 범위 재선정' });
  assert.equal(ended.status, 'revoked'); assert.equal(ended.resolutionReason, '인사이동으로 종료');
  assert.ok(state.delegations.filter(item => item.id !== ended.id).every(item => item.status === 'cancelled'));
});

test('batch delegation: missing group records and duplicate recorded task memberships cannot be approved', () => {
  const { state, ids } = fixture(), batchId = request(state, ids);
  state.delegations.pop();
  denied(state, head, 'delegation.approve', { batchId }, 'DELEGATION_BATCH_CHANGED');
  const duplicate = fixture(), duplicateBatchId = request(duplicate.state, duplicate.ids);
  duplicate.state.delegations[1].taskId = duplicate.state.delegations[0].taskId;
  denied(duplicate.state, head, 'delegation.approve', { batchId: duplicateBatchId }, 'DELEGATION_BATCH_CHANGED');
});
