import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace, reconcileDueHandovers, assertDefinitionWritable } from '../src/lib/domain';
import { canEditDepartmentDefinitions, departmentWorkPlan, isDepartmentConfirmed } from '../src/lib/work-division';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-10-31T03:00:00Z');
const dataTaskId = 'budget-demo-task-data-platform';
const dataUnitId = 'budget-demo-unit-it-execution';
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown> = {}, requestId: string = randomUUID(), expectedRevision = state.revision) {
  const next = structuredClone(state); executeCommand(next, actor, { type, payload, requestId, expectedRevision }, now); Object.assign(state, next);
}
function rejects(code: string, action: () => void) { assert.throws(action, error => error instanceof DomainError && error.code === code); }
function makeDraft(state: WorkspaceData, title = '확정할 새 업무') {
  dispatch(state, 'u-support-member', 'task.create', { title, description: '부서 전체 검토와 업무분장 확정 대상', unitId: dataUnitId, primaryId: 'u-support-member', reviewerId: 'u-support-head', dueDate: '2026-11-30', frequency: 'monthly' });
  return state.tasks[0].id;
}
function confirmData(state: WorkspaceData) { dispatch(state, 'u-support-head', 'department.confirm'); }

test('work division: old stores start editable without mutation and only the department head/admin may confirm or reopen', () => {
  const state = createSeed(now); const before = JSON.stringify(state);
  assert.deepEqual(departmentWorkPlan(state, 'dept-support'), { departmentId: 'dept-support', status: 'draft', version: 0 });
  assert.equal(isDepartmentConfirmed(state, 'dept-support'), false);
  assert.equal(canEditDepartmentDefinitions(state, state.users.find(user => user.id === 'u-support-member')!, 'dept-support'), true);
  assert.equal(canEditDepartmentDefinitions(state, state.users.find(user => user.id === 'u-support-head')!, 'dept-support'), false);
  getWorkspace(state, 'u-support-head', now); assert.equal(JSON.stringify(state), before);
  for (const actor of ['u-doyun', 'u-support-lead', 'u-support-member']) rejects('OUTSIDE_SCOPE', () => dispatch(state, actor, 'department.confirm'));
  rejects('OUTSIDE_SCOPE', () => dispatch(state, 'u-head', 'department.confirm', { departmentId: 'dept-support' }));
  confirmData(state); assert.equal(departmentWorkPlan(state, 'dept-support').version, 1);
  rejects('OUTSIDE_SCOPE', () => dispatch(state, 'u-head', 'department.reopen', { departmentId: 'dept-support', reason: '타부서 변경' }));
  dispatch(state, 'u-admin', 'department.reopen', { departmentId: 'dept-support', reason: '업무분장 검토 후 보완' });
  assert.equal(isDepartmentConfirmed(state, 'dept-support'), false);
});

test('work division: confirmation publishes drafts, preserves confirmed work and old runs, and captures immutable scoped history', () => {
  const state = createSeed(now); const draftId = makeDraft(state);
  const preserved = structuredClone(state.tasks.find(task => task.id === dataTaskId));
  const preservedRuns = structuredClone(state.runs.filter(run => run.taskId === dataTaskId));
  confirmData(state);
  const task = state.tasks.find(task => task.id === draftId)!; assert.equal(task.status, 'confirmed'); assert.equal(task.versions.length, 1);
  assert.equal(task.versions[0].confirmedBy, 'u-support-head'); assert.equal(state.runs.filter(run => run.taskId === draftId).length, 1);
  assert.deepEqual(state.tasks.find(task => task.id === dataTaskId), preserved); assert.deepEqual(state.runs.filter(run => run.taskId === dataTaskId), preservedRuns);
  const first = structuredClone(departmentWorkPlan(state, 'dept-support').snapshot);
  assert.ok(first?.tasks.some(task => task.id === draftId)); assert.ok(first?.tasks.every(task => task.departmentId === 'dept-support'));
  dispatch(state, 'u-support-head', 'department.reopen', { reason: '업무 명칭과 범위 보완' });
  dispatch(state, 'u-support-member', 'task.configure', { taskId: draftId, description: '수정한 업무 범위' });
  assert.deepEqual(departmentWorkPlan(state, 'dept-support').snapshot, first);
  confirmData(state); const plan = departmentWorkPlan(state, 'dept-support');
  assert.equal(plan.version, 2); assert.equal(plan.history?.length, 2); assert.deepEqual(plan.history?.[0].snapshot, first);
  assert.equal(plan.snapshot?.tasks.find(task => task.id === draftId)?.description, '수정한 업무 범위');
  assert.equal(state.runs.filter(run => run.taskId === draftId).length, 1);
});

test('work division: one invalid definition rejects the whole confirmation without publishing any draft or changing revision', () => {
  const state = createSeed(now); const firstId = makeDraft(state, '검증 실패 업무'); const secondId = makeDraft(state, '유효한 첫 처리 대상');
  state.tasks.find(task => task.id === firstId)!.workflow[0].dependsOn = ['missing-step'];
  const before = JSON.stringify(state);
  rejects('WORKFLOW_REFERENCE', () => executeCommand(state, 'u-support-head', { type: 'department.confirm', payload: {}, expectedRevision: state.revision, requestId: 'atomic-confirm' }, now));
  assert.equal(JSON.stringify(state), before); assert.equal(state.tasks.find(task => task.id === secondId)?.status, 'draft');
});

test('work division: all personal definition routes, trash restore, admin overrides and legacy commands respect the department lock', () => {
  const state = createSeed(now); confirmData(state);
  const commands: [string, Record<string, unknown>][] = [
    ['unit.create', { title: '새 업무', description: '잠금 우회' }], ['unit.update', { unitId: dataUnitId, title: '수정', description: '수정' }],
    ['unit.delete', { unitId: dataUnitId }], ['unit.restore', { unitId: dataUnitId }],
    ['task.create', { unitId: dataUnitId }], ...['configure', 'update', 'delete', 'restore', 'submit', 'confirm', 'revise', 'archive'].map(command => [`task.${command}`, { taskId: dataTaskId, unitId: dataUnitId }] as [string, Record<string, unknown>]),
    ['delegation.create', { taskId: dataTaskId }], ['handover.create', { taskIds: [dataTaskId], toId: 'u-doyun' }],
  ];
  for (const [type, payload] of commands) { const before = JSON.stringify(state); rejects('DEPARTMENT_CONFIRMED', () => dispatch(state, 'u-support-member', type, payload)); assert.equal(JSON.stringify(state), before); }
  rejects('DEPARTMENT_CONFIRMED', () => dispatch(state, 'u-admin', 'task.configure', { taskId: dataTaskId, description: '관리자 우회' }));
  rejects('DEPARTMENT_CONFIRMED', () => dispatch(state, 'u-admin', 'unit.create', { departmentId: 'dept-support', ownerId: 'u-support-member', title: '우회', description: '우회' }));
  rejects('DEPARTMENT_CONFIRMED', () => assertDefinitionWritable(state, state.users.find(user => user.id === 'u-support-member')!, 'dept-support'));
  dispatch(state, 'u-jiho', 'unit.create', { title: '다른 부서 독립 작성', description: '잠금 범위 밖' });
});

test('work division: common delivery can reach a confirmed inbox while staged and legacy assignments remain locked', () => {
  const state = createSeed(now);
  dispatch(state, 'u-jiho', 'common.create', { title: '배정 대기 공통업무', description: '잠금 전에 접수', departmentIds: ['dept-support'], dueDate: '2026-11-30', frequency: 'once', requiredSteps: ['자료 확인', '부서장 검토'] });
  const commonId = state.commonTasks[0].id; const distributionId = state.commonTasks[0].distributions[0].id;
  confirmData(state);
  for (const type of ['common.assignTeam', 'common.assignPerson', 'common.register']) rejects('DEPARTMENT_CONFIRMED', () => dispatch(state, 'u-admin', type, { commonId, distributionId, unitId: dataUnitId }));
  rejects('DEPARTMENT_CONFIRMED', () => dispatch(state, 'u-admin', 'common.assign', { commonId, departmentId: 'dept-support' }));
  const beforeTasks = structuredClone(state.tasks), beforeUnits = structuredClone(state.units);
  for (const kind of ['common', 'directive']) {
    dispatch(state, 'u-jiho', 'common.create', { kind, title: '확정 후 추가', description: '접수함에 보관', departmentIds: ['dept-support'], dueDate: '2026-11-30', frequency: 'once', requiredSteps: ['검토'], ...(kind === 'directive' ? { directiveIssuer: 'minister', instructedOn: '2026-10-31' } : {}) });
    assert.equal(state.commonTasks[0].distributions[0].status, 'pending');
    assert.equal(state.commonTasks[0].distributions[0].taskId, undefined);
  }
  assert.deepEqual(state.tasks, beforeTasks); assert.deepEqual(state.units, beforeUnits);
  dispatch(state, 'u-jiho', 'common.create', { title: '기획부서용', description: '잠금되지 않은 부서', departmentIds: ['dept-plan'], dueDate: '2026-11-30', frequency: 'once', requiredSteps: ['검토'] });
  dispatch(state, 'u-jiho', 'common.distribute', { commonId: state.commonTasks[0].id, departmentIds: ['dept-support'] });
  assert.equal(state.commonTasks[0].distributions.at(-1)?.status, 'pending');
});

test('work division: scheduled handovers cannot silently change a confirmed division and resume only after reopening', () => {
  const state = createSeed(now); dispatch(state, 'u-head', 'department.confirm');
  const task = structuredClone(state.tasks.find(task => task.id === 'task-plan'));
  const later = new Date('2026-11-20T00:00:00Z'); assert.equal(reconcileDueHandovers(state, later), false);
  assert.deepEqual(state.tasks.find(task => task.id === 'task-plan'), task);
  assert.match(state.handovers.find(handover => handover.id === 'handover-plan')?.feedback ?? '', /업무분장/);
  rejects('DEPARTMENT_CONFIRMED', () => dispatch(state, 'u-minseo', 'handover.update', { handoverId: 'handover-plan', summary: '우회' }));
  dispatch(state, 'u-head', 'department.reopen', { reason: '예정된 책임 이전을 반영' });
  assert.equal(reconcileDueHandovers(state, later), true); assert.equal(state.tasks.find(task => task.id === 'task-plan')?.primaryId, 'u-seoyeon');
});

test('work division: execution checks, notes, new occurrences and performance evaluation remain available while definitions are locked', () => {
  const state = createSeed(now); confirmData(state);
  const task = state.tasks.find(task => task.id === dataTaskId)!; const nextStep = task.workflow.find(step => !step.done)!;
  dispatch(state, 'u-support-head', 'task.setProgress', { taskId: task.id, stepId: nextStep.id, done: true });
  const run = state.runs.find(run => run.taskId === task.id)!;
  dispatch(state, 'u-support-member', 'run.note', { runId: run.id, body: '분장 확정 후 정상 수행 기록' });
  assert.equal(state.runs.find(item => item.id === run.id)?.notes.at(-1)?.body, '분장 확정 후 정상 수행 기록');
  dispatch(state, 'u-support-member', 'run.create', { taskId: task.id, period: '2027-01' });
  dispatch(state, 'u-support-member', 'performance.submitHalf', { taskId: task.id, period: '2026-H2', title: '하반기 집행 관리', description: '확정된 업무분장에 따른 수행', evidence: '시범 증빙' });
  const allocations = state.units.filter(unit => unit.ownerId === 'u-support-member' && !unit.deletedAt).map(unit => ({ unitId: unit.id, maxScore: unit.id === task.unitId ? 50 : 0 }));
  dispatch(state, 'u-support-member', 'performance.setWeights', { period: '2026-H2', allocations });
  dispatch(state, 'u-support-member', 'performance.submitPerson', { period: '2026-H2', planVersion: 1 });
  dispatch(state, 'u-support-head', 'performance.evaluatePerson', { personId: 'u-support-member', period: '2026-H2', planVersion: 1, scores: allocations.map(allocation => ({ unitId: allocation.unitId, score: allocation.maxScore ? 45 : 0 })), comment: '정상 수행 확인' });
  assert.equal(state.performances[0].status, 'confirmed'); assert.equal(isDepartmentConfirmed(state, 'dept-support'), true);
});

test('work division: heads use department review rather than individual registration or definition mutation', () => {
  const state = createSeed(now); state.users.find(user => user.id === 'u-support-head')!.commonTaskPermission = true;
  for (const type of ['unit.create', 'task.create', 'common.create', 'common.register', 'common.assign']) rejects('HEAD_REGISTRATION_DENIED', () => dispatch(state, 'u-support-head', type, { taskId: dataTaskId, unitId: dataUnitId }));
  for (const type of ['unit.update', 'unit.delete', 'unit.restore', 'task.configure', 'task.update', 'task.revise', 'task.confirm', 'task.submit', 'task.delete', 'task.restore', 'task.archive']) rejects('HEAD_DEFINITION_DENIED', () => dispatch(state, 'u-support-head', type, { taskId: dataTaskId, unitId: dataUnitId }));
  confirmData(state); assert.equal(departmentWorkPlan(state, 'dept-support').confirmedBy, 'u-support-head');
});

test('work division: foreign personnel privileges and contacts are absent while common managers retain required identities and aggregate summaries', () => {
  const state = createSeed(now); confirmData(state);
  const member = getWorkspace(state, 'u-support-member', now); const head = getWorkspace(state, 'u-support-head', now); const manager = getWorkspace(state, 'u-jiho', now); const admin = getWorkspace(state, 'u-admin', now);
  for (const workspace of [member, head, manager]) {
    assert.ok(workspace.users.every(user => user.departmentId === workspace.currentUser.departmentId)); assert.ok(workspace.departments.every(department => department.id === workspace.currentUser.departmentId));
    for (const identity of workspace.identities ?? []) assert.deepEqual(Object.keys(identity).sort(), ['departmentId', 'id', 'name', 'team']);
    assert.ok(workspace.departmentWorkPlans?.every(plan => plan.departmentId === workspace.currentUser.departmentId));
  }
  assert.equal(member.departmentWorkPlans?.[0].snapshot, undefined); assert.equal(member.departmentWorkPlans?.[0].history, undefined);
  assert.ok(head.departmentWorkPlans?.[0].snapshot); assert.equal(admin.users.length, state.users.length); assert.equal(admin.departments.length, state.departments.length);
  const common = manager.commonTasks.find(common => common.id === 'budget-demo-common-demand')!; assert.equal(common.distributions.length, 3); assert.equal(common.summary?.totalDepartments, 3);
  assert.ok(manager.identities?.some(identity => identity.id === 'u-support-member')); assert.equal(manager.users.some(user => user.id === 'u-support-member'), false);
  assert.equal(manager.tasks.some(task => task.id === 'budget-demo-task-data-demand'), false);
});

test('work division: confirmation/reopening keep optimistic concurrency, idempotency and mandatory reasons', () => {
  const state = createSeed(now); const revision = state.revision;
  dispatch(state, 'u-support-head', 'department.confirm', {}, 'confirm-once', revision); const after = JSON.stringify(state);
  dispatch(state, 'u-support-head', 'department.confirm', {}, 'confirm-once', revision); assert.equal(JSON.stringify(state), after);
  rejects('DEPARTMENT_ALREADY_CONFIRMED', () => dispatch(state, 'u-support-head', 'department.confirm'));
  rejects('VALIDATION_ERROR', () => dispatch(state, 'u-support-head', 'department.reopen', { reason: '  ' }));
  rejects('VERSION_CONFLICT', () => dispatch(state, 'u-support-head', 'department.reopen', { reason: '이전 화면 변경' }, 'stale', revision));
  dispatch(state, 'u-support-head', 'department.reopen', { reason: '구체적인 재작성 사유' });
  assert.equal(departmentWorkPlan(state, 'dept-support').reason, '구체적인 재작성 사유'); assert.equal(departmentWorkPlan(state, 'dept-support').version, 1);
  assert.ok(state.audit.some(event => event.action === 'department.confirm')); assert.ok(state.audit.some(event => event.action === 'department.reopen'));
});
