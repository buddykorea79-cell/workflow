import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DomainError, executeCommand } from '../src/lib/domain';
import { authorizeProcedureExtraction } from '../src/lib/procedure-extraction-access';
import { createSeed } from '../src/lib/seed';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-06T03:00:00Z');
const owner = 'u-seoyeon', deputy = 'u-jiho', head = 'u-head', manager = 'u-minseo', support = 'u-plan-lead';
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown> = {}) {
  executeCommand(state, actor, { type, payload, requestId: randomUUID(), expectedRevision: state.revision }, now);
}
function fixture() {
  const state = createSeed(now);
  dispatch(state, owner, 'task.create', { title: '생산문서 본문 읽기', description: '확정된 업무에서 생산문서를 기록합니다.', unitId: 'unit-record', primaryId: owner, supportIds: [support], frequency: 'monthly', dueDate: '2026-11-30' });
  const task = state.tasks[0];
  state.attachments.push({ id: 'extraction-file', taskId: task.id, name: '생산 결과.txt', size: 30, mime: 'text/plain', sha256: 'test-hash', storageKey: 'test.bin', status: 'quarantined', uploadedBy: owner, createdAt: now.toISOString() });
  dispatch(state, head, 'department.confirm');
  return { state, task: state.tasks.find(item => item.id === task.id)!, fileId: 'extraction-file' };
}
function denied(action: () => unknown, code: string) {
  assert.throws(action, error => error instanceof DomainError && error.code === code);
}

test('stored evidence can be extracted after division confirmation by readers without changing definitions', () => {
  const { state, task, fileId } = fixture();
  const before = structuredClone(state);
  for (const actor of [owner, support, manager, head, 'u-admin']) assert.equal(authorizeProcedureExtraction(state, actor, task.id, fileId, now)?.id, fileId);
  assert.deepEqual(state, before);
  denied(() => authorizeProcedureExtraction(state, owner, task.id, undefined, now), 'DEPARTMENT_CONFIRMED');
  denied(() => authorizeProcedureExtraction(state, manager, task.id, undefined, now), 'DEPARTMENT_CONFIRMED');
  denied(() => authorizeProcedureExtraction(state, head, task.id, undefined, now), 'HEAD_DEFINITION_DENIED');
});

test('approved deputies can extract stored production files only while their original task access is active', () => {
  const { state, task, fileId } = fixture();
  denied(() => authorizeProcedureExtraction(state, deputy, task.id, fileId, now), 'PROCEDURE_ACCESS_DENIED');
  dispatch(state, owner, 'delegation.requestBatch', { fromId: owner, taskIds: [task.id], toId: deputy, startsAt: '2026-11-06T00:00:00Z', endsAt: '2026-11-20T00:00:00Z', reason: '생산문서 등록 대행' });
  const batchId = state.delegations[0].batchId;
  dispatch(state, head, 'delegation.approve', { batchId });
  assert.equal(authorizeProcedureExtraction(state, deputy, task.id, fileId, now)?.id, fileId);
  denied(() => authorizeProcedureExtraction(state, deputy, task.id, undefined, now), 'PROCEDURE_EDIT_DENIED');
  denied(() => authorizeProcedureExtraction(state, deputy, task.id, fileId, new Date('2026-11-20T00:00:00Z')), 'PROCEDURE_ACCESS_DENIED');
  dispatch(state, owner, 'delegation.revoke', { batchId, reason: '담당자 복귀' });
  denied(() => authorizeProcedureExtraction(state, deputy, task.id, fileId, now), 'PROCEDURE_ACCESS_DENIED');
});

test('extraction cannot cross task boundaries and new procedure imports still require definition permission', () => {
  const { state, task, fileId } = fixture();
  state.attachments.push({ ...state.attachments.find(file => file.id === fileId)!, id: 'another-task-file', taskId: 'another-task' });
  denied(() => authorizeProcedureExtraction(state, owner, task.id, 'another-task-file', now), 'ATTACHMENT_NOT_FOUND');
  denied(() => authorizeProcedureExtraction(state, 'u-support-member', task.id, fileId, now), 'PROCEDURE_ACCESS_DENIED');
  denied(() => authorizeProcedureExtraction(state, support, task.id, undefined, now), 'PROCEDURE_EDIT_DENIED');
  dispatch(state, head, 'department.reopen', { reason: '절차 자료 갱신' });
  assert.equal(authorizeProcedureExtraction(state, owner, task.id, undefined, now), undefined);
  assert.equal(authorizeProcedureExtraction(state, manager, task.id, undefined, now), undefined);
  denied(() => authorizeProcedureExtraction(state, support, task.id, undefined, now), 'PROCEDURE_EDIT_DENIED');
});

test('extraction preserves archived, deleted, inactive-account and oversized-file guards', () => {
  for (const change of ['archived', 'deleted', 'unitDeleted', 'inactive', 'oversized'] as const) {
    const { state, task, fileId } = fixture();
    if (change === 'archived') task.status = 'archived';
    if (change === 'deleted') task.deletedAt = now.toISOString();
    if (change === 'unitDeleted') state.units.find(unit => unit.id === task.unitId)!.deletedAt = now.toISOString();
    if (change === 'inactive') state.users.find(user => user.id === owner)!.active = false;
    if (change === 'oversized') state.attachments.find(file => file.id === fileId)!.size = 10 * 1024 * 1024 + 1;
    denied(() => authorizeProcedureExtraction(state, owner, task.id, fileId, now), { archived: 'TASK_ARCHIVED', deleted: 'TASK_DELETED', unitDeleted: 'UNIT_DELETED', inactive: 'ACCOUNT_INACTIVE', oversized: 'FILE_TOO_LARGE' }[change]);
  }
});
