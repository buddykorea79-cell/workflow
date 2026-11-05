import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { canReadTask, DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import type { Task, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-05T03:00:00Z');
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown> = {}) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now);
  Object.assign(state, candidate);
}
function privateFixture() {
  const state = createSeed(now);
  const task: Task = { ...structuredClone(state.tasks.find(item => item.id === 'task-assets')!), id: 'division-private-task', title: '다른 팀의 공개 분장 제목', code: 'DIV-PRIVATE', primaryId: 'u-doyun', supportIds: [], reviewerId: 'u-support-head', description: 'private-task-description', completionCriteria: 'private-completion', card: { ...state.tasks[0].card, documents: 'private-document' }, references: [{ id: 'private-ref', type: 'document', title: 'private-document-title', content: 'private-document-body' }] };
  state.tasks.push(task);
  return { state, task };
}

test('department division: members and leads see own department assignment titles without receiving private task bodies or new write access', () => {
  const { state, task } = privateFixture();
  for (const actor of ['u-support-member', 'u-support-lead']) {
    const before = structuredClone(state), user = state.users.find(item => item.id === actor)!;
    const expectedTaskIds = state.tasks.filter(item => canReadTask(state, user, item, now)).map(item => item.id);
    const workspace = getWorkspace(state, actor, now), division = workspace.departmentDivision!;
    assert.equal(division.departmentId, 'dept-support');
    assert.ok(division.tasks.some(item => item.id === task.id && item.title === task.title));
    assert.deepEqual(workspace.tasks.map(item => item.id), expectedTaskIds);
    assert.equal(workspace.tasks.some(item => item.id === task.id), false);
    for (const privateContent of ['private-task-description', 'private-completion', 'private-document']) assert.equal(JSON.stringify(division).includes(privateContent), false);
    assert.deepEqual(Object.keys(division).sort(), ['departmentId', 'members', 'status', 'tasks', 'units', 'version']);
    for (const unit of division.units) assert.deepEqual(Object.keys(unit).sort(), ['id', 'ownerId', 'title']);
    for (const row of division.tasks) assert.deepEqual(Object.keys(row).sort(), ['code', ...(row.commonId ? ['commonId'] : []), 'frequency', 'id', 'primaryId', 'reviewerId', 'status', 'supportIds', 'title', 'unitId']);
    for (const member of division.members) assert.deepEqual(Object.keys(member).sort(), ['id', 'name', 'team']);
    assert.deepEqual(state, before);
    assert.throws(() => dispatch(state, actor, 'task.configure', { taskId: task.id, description: '분장표에서 무단 수정' }), error => error instanceof DomainError && error.code === 'TASK_ACCESS_DENIED');
    assert.throws(() => dispatch(state, actor, 'department.confirm'), error => error instanceof DomainError && error.code === 'OUTSIDE_SCOPE');
    assert.deepEqual(state, before);
  }
});

test('department division: excludes foreign, archived, deleted, orphan and unpublished or unregistered common tasks', () => {
  const { state, task } = privateFixture();
  const hiddenUnit = { ...state.units.find(item => item.id === task.unitId)!, id: 'division-deleted-unit', deletedAt: now.toISOString() };
  state.units.push(hiddenUnit);
  state.tasks.push(
    { ...structuredClone(task), id: 'division-archived', status: 'archived' },
    { ...structuredClone(task), id: 'division-deleted', deletedAt: now.toISOString() },
    { ...structuredClone(task), id: 'division-deleted-parent', unitId: hiddenUnit.id },
    { ...structuredClone(task), id: 'division-missing-parent', unitId: 'missing-unit' },
    { ...structuredClone(task), id: 'division-foreign', departmentId: 'dept-plan', unitId: 'unit-budget' },
  );
  for (const mode of ['unregistered', 'pending', 'rejected', 'registered'] as const) {
    const commonId = `division-common-${mode}`, taskId = `division-task-${mode}`;
    state.tasks.push({ ...structuredClone(task), id: taskId, commonId });
    state.commonTasks.push({ ...structuredClone(state.commonTasks[0]), id: commonId, ...(mode === 'pending' || mode === 'rejected' ? { publicationStatus: mode } : {}), departmentIds: ['dept-support'], distributions: [{ id: `division-dist-${mode}`, taskId, departmentId: 'dept-support', distributedAt: now.toISOString(), status: mode === 'unregistered' ? 'pending' : 'registered' }] });
  }
  const division = getWorkspace(state, 'u-support-member', now).departmentDivision!;
  for (const id of ['division-archived', 'division-deleted', 'division-deleted-parent', 'division-missing-parent', 'division-foreign', 'division-task-unregistered', 'division-task-pending', 'division-task-rejected']) assert.equal(division.tasks.some(item => item.id === id), false, id);
  assert.ok(division.tasks.some(item => item.id === 'division-task-registered'));
  assert.equal(division.units.some(item => item.id === hiddenUnit.id), false);
  assert.ok(division.units.every(item => state.units.find(unit => unit.id === item.id)!.departmentId === 'dept-support'));
  assert.ok(division.members.every(item => state.users.find(user => user.id === item.id)!.departmentId === 'dept-support'));
});

test('department division: plan confirmation and reopening are distinct from each task definition status and never expose snapshots', () => {
  const state = createSeed(now);
  assert.equal(getWorkspace(state, 'u-support-member', now).departmentDivision!.status, 'draft');
  dispatch(state, 'u-support-head', 'department.confirm');
  const confirmed = getWorkspace(state, 'u-support-member', now).departmentDivision!;
  assert.equal(confirmed.status, 'confirmed'); assert.equal(confirmed.version, 1); assert.equal(confirmed.confirmedAt, now.toISOString());
  assert.ok(confirmed.tasks.every(task => task.status === 'confirmed'));
  assert.equal('snapshot' in confirmed, false); assert.equal('history' in confirmed, false);
  dispatch(state, 'u-support-head', 'department.reopen', { reason: '부서 업무분장 보완' });
  const reopened = getWorkspace(state, 'u-support-member', now).departmentDivision!;
  assert.equal(reopened.status, 'draft'); assert.equal(reopened.version, 1);
  assert.ok(reopened.tasks.every(task => task.status === 'confirmed'));
  for (const actor of ['u-support-head', 'u-doyun', 'u-admin']) {
    const workspace = getWorkspace(state, actor, now), user = state.users.find(item => item.id === actor)!;
    assert.deepEqual(workspace.tasks.map(task => task.id), state.tasks.filter(task => canReadTask(state, user, task, now)).map(task => task.id));
    assert.equal(workspace.departmentDivision!.departmentId, user.departmentId);
  }
});

test('department division: referenced former members remain identifiable and read model changes cannot mutate stored assignments', () => {
  const { state, task } = privateFixture();
  state.users.push({ ...state.users.find(user => user.id === 'u-doyun')!, id: 'division-former-member', active: false }, { ...state.users.find(user => user.id === 'u-doyun')!, id: 'division-expired-unassigned', endsAt: now.toISOString() });
  task.supportIds = ['division-former-member'];
  const division = getWorkspace(state, 'u-support-member', now).departmentDivision!;
  assert.ok(division.members.some(member => member.id === 'division-former-member'));
  assert.equal(division.members.some(member => member.id === 'division-expired-unassigned'), false);
  const before = structuredClone(state);
  division.tasks.find(item => item.id === task.id)!.supportIds.push('u-support-member');
  division.units[0].title = '읽기 모델 변경'; division.members[0].name = '읽기 모델 변경';
  assert.deepEqual(state, before);
});
