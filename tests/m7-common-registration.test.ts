import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { commandExpectation } from '../src/lib/command-targets';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import type { Command, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-08T03:00:00Z');
const recipientId = 'u-m7-new-member';
function makeCommand(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>): Command {
  const expected = commandExpectation(state, type, payload, actor);
  return { type, payload, expectedRevision: state.revision, requestId: randomUUID(), ...(expected ? { expected } : {}) };
}
function commit(state: WorkspaceData, actor: string, command: Command) {
  // Match the storage transaction: failed commands do not commit their candidate state.
  const candidate = structuredClone(state);
  const changes = executeCommand(candidate, actor, command, now);
  Object.assign(state, candidate);
  return changes;
}
function send(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) {
  return commit(state, actor, makeCommand(state, actor, type, payload));
}
function assignedWithoutUnits() {
  const state = createSeed(now);
  state.users.push({ ...state.users.find(user => user.id === 'u-support-member')!, id: recipientId, name: '처음 등록 담당자' });
  send(state, 'u-seoyeon', 'common.create', { title: '새 담당자의 공통업무', projectName: '공동 자료 관리', description: '단위업무를 만든 뒤 이 공통업무를 연결합니다.', dueDate: '2026-11-30', frequency: 'once', requiredSteps: ['자료 준비', '부서장 검토'], departmentIds: ['dept-support'] });
  const commonId = state.commonTasks[0].id;
  send(state, 'u-head', 'common.approve', { commonId, requestId: state.commonTasks[0].approvalRequests![0].id });
  const ref = { commonId, distributionId: state.commonTasks[0].distributions[0].id };
  send(state, 'u-doyun', 'common.assignTeam', { ...ref, team: '데이터팀', leadId: 'u-support-lead' });
  send(state, 'u-support-lead', 'common.assignPerson', { ...ref, assigneeId: recipientId });
  const workspace = getWorkspace(state, recipientId, now);
  assert.equal(workspace.units.filter(unit => unit.ownerId === recipientId && !unit.deletedAt).length, 0);
  assert.equal(workspace.tasks.filter(task => task.primaryId === recipientId).length, 0);
  assert.equal(workspace.commonTasks.find(common => common.id === commonId)!.distributions[0].status, 'person_assigned');
  return { state, ref };
}
function createUnit(state: WorkspaceData) {
  send(state, recipientId, 'unit.create', { title: '공동 자료 관리', description: '배정받은 자료 준비와 검토 업무를 관리합니다.' });
  return state.units.find(unit => unit.ownerId === recipientId)!;
}

test('a recipient with no units creates one and registers the assigned common task through two commands', () => {
  const { state, ref } = assignedWithoutUnits();
  const revisionBeforeUnit = state.revision;
  const expectedBeforeUnit = commandExpectation(state, 'common.register', ref, recipientId)!;
  const unit = createUnit(state);
  const command: Command = { type: 'common.register', payload: { ...ref, unitId: unit.id }, requestId: randomUUID(), expectedRevision: revisionBeforeUnit, expected: expectedBeforeUnit };
  assert.ok(state.revision > command.expectedRevision);
  commit(state, recipientId, command);
  const workspace = getWorkspace(state, recipientId, now);
  const distribution = workspace.commonTasks.find(common => common.id === ref.commonId)!.distributions.find(item => item.id === ref.distributionId)!;
  const task = workspace.tasks.find(item => item.id === distribution.taskId)!;
  assert.equal(distribution.status, 'registered');
  assert.equal(task.unitId, unit.id);
  assert.equal(task.primaryId, recipientId);
  assert.equal(task.reviewerId, 'u-support-head');
  assert.equal(workspace.units.filter(item => item.ownerId === recipientId).length, 1);
  assert.equal(workspace.tasks.filter(item => item.commonId === ref.commonId && item.primaryId === recipientId).length, 1);
});

test('failed registration preserves the created unit and an explicit refreshed retry creates no duplicate unit or task', () => {
  const { state, ref } = assignedWithoutUnits();
  const expectedBeforeUnit = commandExpectation(state, 'common.register', ref, recipientId)!;
  const unit = createUnit(state);
  const registration = makeCommand(state, recipientId, 'common.register', { ...ref, unitId: unit.id });
  registration.expected = expectedBeforeUnit;
  send(state, 'u-seoyeon', 'common.distribute', { commonId: ref.commonId, departmentIds: ['dept-innovation'] });
  const beforeFailure = structuredClone(state);
  assert.throws(() => commit(state, recipientId, registration), error => error instanceof DomainError && error.code === 'TARGET_CONFLICT');
  assert.deepEqual(state, beforeFailure);
  const refreshed = getWorkspace(state, recipientId, now);
  const retainedUnit = refreshed.units.find(item => item.id === unit.id)!;
  assert.equal(retainedUnit.ownerId, recipientId);
  assert.equal(refreshed.units.filter(item => item.ownerId === recipientId).length, 1);
  assert.equal(refreshed.tasks.filter(item => item.commonId === ref.commonId).length, 0);
  assert.equal(refreshed.commonTasks.find(common => common.id === ref.commonId)!.distributions.find(item => item.id === ref.distributionId)!.status, 'person_assigned');
  // The user has reviewed the refreshed common task and retries only registration.
  const retry = makeCommand(state, recipientId, 'common.register', { ...ref, unitId: retainedUnit.id });
  commit(state, recipientId, retry);
  const afterRetry = structuredClone(state);
  assert.deepEqual(commit(state, recipientId, retry), []);
  assert.deepEqual(state, afterRetry);
  assert.equal(state.units.filter(item => item.ownerId === recipientId).length, 1);
  assert.equal(state.tasks.filter(item => item.commonId === ref.commonId && item.primaryId === recipientId).length, 1);
  assert.equal(state.audit.filter(item => item.actorId === recipientId && item.action === 'unit.create').length, 1);
  assert.equal(state.audit.filter(item => item.actorId === recipientId && item.action === 'common.register').length, 1);
});
