import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { commonDistributionStatus, latestTaskRun, summarizeCommon } from '../src/lib/common-status';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-10-31T03:00:00Z');
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, at = now) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, at);
  Object.assign(state, candidate);
}
function rejects(code: string, action: () => void) { assert.throws(action, error => error instanceof DomainError && error.code === code); }
const common = (state: WorkspaceData, commonId = 'common-budget') => state.commonTasks.find(item => item.id === commonId)!;
const row = (state: WorkspaceData, commonId = 'common-budget', userId = 'u-minseo', departmentId = 'dept-plan', at = now) => getWorkspace(state, userId, at).commonTasks.find(item => item.id === commonId)!.distributions.find(item => item.departmentId === departmentId)!;
function createShared(state: WorkspaceData) {
  dispatch(state, 'u-minseo', 'common.create', { title: '공통 배정 대시보드 검증', description: '부서별 배정과 실제 수행 확인', dueDate: '2026-11-30', frequency: 'quarterly', requiredSteps: ['자료 준비', '수행', '결과 검토', '제출'], departmentIds: ['dept-plan', 'dept-support', 'dept-innovation'] }); return state.commonTasks[0].id;
}
function registerData(state: WorkspaceData, commonId: string) {
  const distributionId = common(state, commonId).distributions.find(item => item.departmentId === 'dept-support')!.id;
  dispatch(state, 'u-doyun', 'common.assignTeam', { commonId, distributionId, team: '데이터팀', leadId: 'u-support-lead' }, new Date('2026-10-31T03:01:00Z'));
  dispatch(state, 'u-support-lead', 'common.assignPerson', { commonId, distributionId, assigneeId: 'u-support-member' }, new Date('2026-10-31T03:02:00Z'));
  dispatch(state, 'u-support-member', 'common.register', { commonId, distributionId, unitId: 'unit-data' }, new Date('2026-10-31T03:03:00Z'));
  return common(state, commonId).distributions.find(item => item.id === distributionId)!.taskId!;
}

test('common dashboard: every allocation stage reports its responsible role and assignment timestamps', () => {
  const state = createSeed(now); const commonId = createShared(state);
  let current = row(state, commonId, 'u-minseo', 'dept-support');
  assert.equal(current.stage, 'team_pending'); assert.deepEqual(current.nextActorIds, ['u-doyun']); assert.equal(current.progress, 0); assert.equal(current.totalSteps, 0);
  const distributionId = current.id;
  dispatch(state, 'u-doyun', 'common.assignTeam', { commonId, distributionId, team: '데이터팀', leadId: 'u-support-lead' }, new Date('2026-10-31T03:01:00Z'));
  current = row(state, commonId, 'u-minseo', 'dept-support'); assert.equal(current.stage, 'person_pending'); assert.deepEqual(current.nextActorIds, ['u-support-lead']); assert.equal(current.teamAssignedAt, '2026-10-31T03:01:00.000Z');
  dispatch(state, 'u-support-lead', 'common.assignPerson', { commonId, distributionId, assigneeId: 'u-support-member' }, new Date('2026-10-31T03:02:00Z'));
  current = row(state, commonId, 'u-minseo', 'dept-support'); assert.equal(current.stage, 'registration_pending'); assert.deepEqual(current.nextActorIds, ['u-support-member']); assert.equal(current.personAssignedAt, '2026-10-31T03:02:00.000Z');
  dispatch(state, 'u-support-member', 'common.register', { commonId, distributionId, unitId: 'unit-data' }, new Date('2026-10-31T03:03:00Z'));
  current = row(state, commonId, 'u-minseo', 'dept-support'); assert.equal(current.stage, 'in_progress'); assert.equal(current.executionStatus, 'not_started'); assert.equal(current.registeredAt, '2026-10-31T03:03:00.000Z'); assert.equal(current.updatedAt, current.registeredAt); assert.equal(current.currentAssigneeId, 'u-support-member'); assert.equal(current.unitTitle, '공공데이터 품질 관리'); assert.equal(current.totalSteps, 4);
});

test('common dashboard: aggregates use visible assignments, zeroes before registration, and do not expose foreign task bodies', () => {
  const state = createSeed(now); const commonId = createShared(state); const taskId = registerData(state, commonId);
  const task = state.tasks.find(item => item.id === taskId)!; task.description = 'FOREIGN_PRIVATE_DESCRIPTION'; task.budget = 987654321; task.references = [{ id: 'private-ref', type: 'other', title: '비공개 근거', content: 'FOREIGN_PRIVATE_EVIDENCE' }];
  dispatch(state, 'u-support-member', 'task.setProgress', { taskId, stepId: 's1', done: true });
  const ownerView = getWorkspace(state, 'u-minseo', now); const ownerCommon = ownerView.commonTasks.find(item => item.id === commonId)!;
  assert.equal(ownerCommon.summary?.totalDepartments, 3); assert.equal(ownerCommon.summary?.averageProgress, 8); assert.equal(ownerCommon.summary?.teamPending, 2); assert.equal(ownerCommon.summary?.inProgress, 1);
  assert.equal(ownerView.tasks.some(item => item.id === taskId), false); assert.equal(ownerView.runs.some(item => item.taskId === taskId), false);
  const serialized = JSON.stringify(ownerCommon); assert.equal(serialized.includes('FOREIGN_PRIVATE'), false); assert.equal(serialized.includes('987654321'), false); assert.equal(serialized.includes('workflow'), false);
  const departmentView = getWorkspace(state, 'u-doyun', now).commonTasks.find(item => item.id === commonId)!;
  assert.equal(departmentView.distributions.length, 1); assert.equal(departmentView.summary?.totalDepartments, 1); assert.equal(departmentView.summary?.averageProgress, 25);
  const unrelated = getWorkspace(state, 'u-innovation-member', now).commonTasks.find(item => item.id === commonId)!; assert.equal(unrelated.summary?.averageProgress, 0); assert.equal(unrelated.summary?.inProgress, 0);
});

test('common dashboard: run completion is authoritative over stale workflow flags and submitted distribution status', () => {
  const state = createSeed(now); const task = state.tasks.find(item => item.id === 'task-budget')!;
  task.workflow.forEach(step => { step.done = true; }); common(state).distributions[0].status = 'submitted';
  const before = JSON.stringify(state); const current = row(state);
  assert.equal(current.progressSource, 'run'); assert.equal(current.progress, 50); assert.equal(current.completedSteps, 2); assert.equal(current.totalSteps, 4); assert.equal(current.stage, 'in_progress'); assert.equal(current.status, 'registered'); assert.equal(current.executionStatus, 'review'); assert.deepEqual(current.nextActorIds, ['u-head']);
  assert.deepEqual(getWorkspace(state, 'u-minseo', now).tasks.find(item => item.id === task.id)!.workflow.map(step => step.done), [true, true, false, false]);
  assert.equal(JSON.stringify(state), before, 'Read models must not mutate stored data.');
});

test('common dashboard: a fresh occurrence starts at zero and task progress updates that occurrence without skipping dependencies', () => {
  const state = createSeed(now); const taskId = 'task-budget';
  dispatch(state, 'u-head', 'task.setProgress', { taskId, stepId: 's3', done: true }); dispatch(state, 'u-minseo', 'task.setProgress', { taskId, stepId: 's4', done: true });
  const previousRun = structuredClone(latestTaskRun(state, taskId)!); assert.equal(row(state).stage, 'completed');
  dispatch(state, 'u-minseo', 'run.create', { taskId, period: '2027-Q1' }, new Date('2026-11-01T00:00:00Z'));
  const createdRun = latestTaskRun(state, taskId)!;
  let current = row(state); assert.equal(current.progress, 0); assert.equal(current.runId, createdRun.id); assert.equal(current.stage, 'in_progress'); assert.equal(current.status, 'registered'); assert.equal(current.dueDate, createdRun.dueDate);
  assert.ok(state.tasks.find(item => item.id === taskId)!.workflow.every(step => !step.done));
  rejects('PREREQUISITE_REQUIRED', () => dispatch(state, 'u-minseo', 'task.setProgress', { taskId, stepId: 's4', done: true }));
  dispatch(state, 'u-jiho', 'task.setProgress', { taskId, stepId: 's1', done: true }); current = row(state); assert.equal(current.progress, 25); assert.equal(current.completedSteps, 1); assert.equal(latestTaskRun(state, taskId)!.status, 'in_progress');
  assert.deepEqual(state.runs.find(item => item.id === previousRun.id), previousRun);
  const step = latestTaskRun(state, taskId)!.steps.find(item => item.stepId === 's2')!;
  dispatch(state, 'u-minseo', 'run.check', { runId: createdRun.id, stepId: step.id, checkId: step.checklist[0].id, done: true });
  assert.equal(row(state).progress, 25, 'A checked item alone is not a completed procedure.');
});

test('common dashboard: old occurrence notes and equal timestamps do not select an older completed occurrence', () => {
  const state = createSeed(now); const taskId = 'task-budget';
  dispatch(state, 'u-head', 'task.setProgress', { taskId, stepId: 's3', done: true }); dispatch(state, 'u-minseo', 'task.setProgress', { taskId, stepId: 's4', done: true });
  const previousId = latestTaskRun(state, taskId)!.id;
  dispatch(state, 'u-minseo', 'run.create', { taskId, period: '2027-Q1' }); const latestId = state.runs[0].id;
  dispatch(state, 'u-minseo', 'run.note', { runId: previousId, body: '이전 완료 회차의 후속 메모' }, new Date('2026-12-01T00:00:00Z'));
  const current = row(state); assert.equal(current.runId, latestId); assert.equal(current.progress, 0); assert.equal(current.stage, 'in_progress'); assert.notEqual(current.updatedAt, '2026-12-01T00:00:00.000Z');
});

test('common dashboard: new procedures after a completed occurrence use the new task plan until a new run exists', () => {
  const state = createSeed(now); const taskId = 'task-budget';
  dispatch(state, 'u-head', 'task.setProgress', { taskId, stepId: 's3', done: true }); dispatch(state, 'u-minseo', 'task.setProgress', { taskId, stepId: 's4', done: true });
  const workflow = structuredClone(state.tasks.find(item => item.id === taskId)!.workflow); workflow.push({ id: 'supplement', title: '추가 자료 제출', role: 'primary', description: '추가 증빙 보완', output: '증빙', required: true, dependsOn: ['s4'], checklist: [] });
  dispatch(state, 'u-minseo', 'task.configure', { taskId, workflow });
  const current = row(state); assert.equal(current.progressSource, 'task'); assert.equal(current.progress, 80); assert.equal(current.stage, 'in_progress'); assert.equal(current.runId, undefined);
});

test('common dashboard: pause, archive, and deletion are distinct from completion and suppress overdue', () => {
  for (const lifecycle of ['paused', 'archived', 'deleted', 'parent_deleted'] as const) {
    const state = createSeed(now); const task = state.tasks.find(item => item.id === 'task-budget')!; const run = latestTaskRun(state, task.id)!;
    run.dueDate = '2026-10-01'; run.steps.forEach(step => { step.status = 'completed'; });
    if (lifecycle === 'paused') run.status = 'paused';
    if (lifecycle === 'archived') task.status = 'archived';
    if (lifecycle === 'deleted') task.deletedAt = now.toISOString();
    if (lifecycle === 'parent_deleted') state.units.find(unit => unit.id === task.unitId)!.deletedAt = now.toISOString();
    const current = row(state); assert.equal(current.stage, 'in_progress'); assert.equal(current.overdue, false); assert.equal(current.executionStatus, lifecycle === 'parent_deleted' ? 'deleted' : lifecycle);
    const summary = getWorkspace(state, 'u-minseo', now).commonTasks.find(item => item.id === 'common-budget')!.summary!; assert.equal(summary.completed, 0);
    if (lifecycle === 'paused') rejects('RUN_PAUSED', () => dispatch(state, 'u-minseo', 'task.setProgress', { taskId: task.id, stepId: 's4', done: false }));
  }
});

test('common dashboard: overdue uses the Korean calendar boundary and applies before registration', () => {
  const state = createSeed(now); common(state).dueDate = '2026-10-31';
  const beforeMidnight = new Date('2026-10-31T14:59:59Z'); const afterMidnight = new Date('2026-10-31T15:00:00Z');
  assert.equal(row(state, 'common-budget', 'u-minseo', 'dept-support', beforeMidnight).overdue, false);
  const overdue = row(state, 'common-budget', 'u-minseo', 'dept-support', afterMidnight); assert.equal(overdue.overdue, true); assert.equal(overdue.stage, 'team_pending'); assert.equal(overdue.dueDate, '2026-10-31');
  assert.deepEqual(summarizeCommon([]), { totalDepartments: 0, teamPending: 0, personPending: 0, registrationPending: 0, inProgress: 0, completed: 0, overdue: 0, paused: 0, archived: 0, deleted: 0, averageProgress: 0, completedSteps: 0, totalSteps: 0 });
});

test('common dashboard: ready support procedures name all permitted actors and exclude expired accounts', () => {
  const state = createSeed(now); const task = state.tasks.find(item => item.id === 'task-budget')!; const run = latestTaskRun(state, task.id)!;
  run.steps.forEach(step => { step.status = 'pending'; }); run.steps = [run.steps[2], run.steps[0], run.steps[1], run.steps[3]];
  let current = row(state); assert.deepEqual(new Set(current.nextActorIds), new Set(['u-minseo', 'u-jiho']));
  state.users.find(user => user.id === 'u-jiho')!.endsAt = '2026-10-30T00:00:00Z'; current = row(state); assert.deepEqual(current.nextActorIds, ['u-minseo']);
  run.steps.find(step => step.stepId === 's1')!.status = 'completed'; run.steps.find(step => step.stepId === 's2')!.status = 'completed'; current = row(state); assert.equal(current.executionStatus, 'review'); assert.deepEqual(current.nextActorIds, ['u-head']);
});

test('common dashboard: current execution assignee and task owner are separated from the original assignment after handover', () => {
  for (const includeRun of [false, true]) {
    const state = createSeed(now); const taskId = 'task-budget'; const runId = latestTaskRun(state, taskId)!.id;
    dispatch(state, 'u-minseo', 'handover.create', { taskIds: [taskId], runIds: includeRun ? [runId] : [], toId: 'u-seoyeon', effectiveAt: now.toISOString(), summary: '담당 변경', pendingItems: '검토·제출', nextAction: '검토 요청' });
    const handoverId = state.handovers[0].id; dispatch(state, 'u-head', 'handover.approve', { handoverId });
    for (const checkId of ['hc-1', 'hc-2', 'hc-3']) dispatch(state, 'u-seoyeon', 'handover.check', { handoverId, checkId, checked: true });
    dispatch(state, 'u-seoyeon', 'handover.accept', { handoverId });
    const current = row(state); assert.equal(current.assigneeId, 'u-minseo'); assert.equal(current.taskOwnerId, 'u-seoyeon'); assert.equal(current.currentAssigneeId, includeRun ? 'u-seoyeon' : 'u-minseo');
  }
});

test('common dashboard: registered missing or empty legacy work has finite zero progress without false completion', () => {
  const state = createSeed(now); const model = common(state); const distribution = model.distributions[0];
  distribution.taskId = 'missing-task'; distribution.status = 'submitted';
  let current = commonDistributionStatus(state, model, distribution, now); assert.equal(current.progress, 0); assert.equal(current.totalSteps, 0); assert.equal(current.stage, 'in_progress'); assert.equal(current.status, 'registered'); assert.deepEqual(current.nextActorIds, ['u-minseo']);
  distribution.taskId = 'task-budget'; latestTaskRun(state, 'task-budget')!.steps = [];
  current = commonDistributionStatus(state, model, distribution, now); assert.equal(current.stage, 'in_progress'); assert.equal(current.progress, 0); assert.equal(current.executionStatus, 'in_progress');
});
