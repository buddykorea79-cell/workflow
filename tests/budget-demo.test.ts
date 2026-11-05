import { approveLatestCommon } from './common-approval-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyBudgetDemo, BUDGET_COMMON_DEMAND, BUDGET_COMMON_EXECUTION, BUDGET_DEMO_MARKER, BUDGET_DEMO_PREFIX } from '../src/lib/budget-demo';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace, validateWorkflow } from '../src/lib/domain';
import { currentPeriod, dueDateForPeriod } from '../src/lib/schedule';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-10-31T03:00:00Z');
function oldWorkspace(): WorkspaceData {
  const state = createSeed(now);
  state.units = state.units.filter(unit => !unit.id.startsWith(BUDGET_DEMO_PREFIX));
  state.tasks = state.tasks.filter(task => !task.id.startsWith(BUDGET_DEMO_PREFIX));
  state.runs = state.runs.filter(run => !run.taskId.startsWith(BUDGET_DEMO_PREFIX));
  state.commonTasks = state.commonTasks.filter(common => !common.id.startsWith(BUDGET_DEMO_PREFIX));
  state.audit = state.audit.filter(event => event.targetId !== BUDGET_DEMO_MARKER);
  Object.assign(state.users.find(user => user.id === 'u-jiho')!, { title: '주무관', commonTaskPermission: false }); state.revision = 13;
  return state;
}
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) {
  const candidate = structuredClone(state); executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now); Object.assign(state, candidate);
}
function rejects(code: string, action: () => void) { assert.throws(action, error => error instanceof DomainError && error.code === code); }

test('budget demo: additive migration preserves all prior records and allocates unique task codes', () => {
  const state = oldWorkspace();
  dispatch(state, 'u-support-member', 'unit.create', { title: '사용자가 만든 단위', description: '기존 사용자 업무' }); const customUnit = state.units.at(-1)!;
  dispatch(state, 'u-support-member', 'task.create', { title: '사용자 세부업무', description: '고유한 사용자 입력', unitId: customUnit.id, primaryId: 'u-support-member', reviewerId: 'u-support-head', dueDate: '2026-12-31', frequency: 'once' }); state.tasks[0].code = 'WK-999';
  const before = structuredClone(state); const result = applyBudgetDemo(state, now);
  assert.deepEqual({ units: result.addedUnits, tasks: result.addedTasks, runs: result.addedRuns, common: result.addedCommonTasks, users: result.updatedUsers }, { units: 5, tasks: 9, runs: 9, common: 2, users: 1 });
  assert.equal(state.revision, before.revision + 1);
  for (const key of ['units', 'tasks', 'runs', 'commonTasks', 'sources', 'performances', 'handovers', 'notifications', 'attachments', 'audit'] as const) for (const previous of before[key]) assert.deepEqual(state[key].find(item => item.id === previous.id), previous, `${key}:${previous.id} was changed`);
  for (const previous of before.users.filter(user => user.id !== 'u-jiho')) assert.deepEqual(state.users.find(user => user.id === previous.id), previous);
  assert.equal(new Set(state.tasks.map(task => task.code)).size, state.tasks.length);
  assert.ok(state.tasks.filter(task => task.id.startsWith(BUDGET_DEMO_PREFIX)).every(task => Number(task.code.slice(3)) > 999));
  assert.equal(state.commonTasks.find(common => common.id === 'common-budget')!.managerId, 'u-minseo');
  assert.equal(state.audit.filter(event => event.targetId === BUDGET_DEMO_MARKER).length, 1);
});

test('budget demo: replay is byte-for-byte idempotent and preserves later edits and permission changes', () => {
  const state = oldWorkspace(); applyBudgetDemo(state, now);
  const beforeReplay = JSON.stringify(state); const replay = applyBudgetDemo(state, new Date('2027-01-20T00:00:00Z'));
  assert.equal(replay.changed, false); assert.equal(JSON.stringify(state), beforeReplay);
  const unit = state.units.find(item => item.id === 'budget-demo-unit-formulation')!; unit.title = '담당자가 변경한 단위명';
  const task = state.tasks.find(item => item.id === 'budget-demo-task-plan-review')!; task.title = '사용자 변경 업무명'; task.budget = 12345; task.references = [];
  const common = state.commonTasks.find(item => item.id === BUDGET_COMMON_DEMAND)!; common.description = '사용자 수정 공통업무 설명';
  const officer = state.users.find(user => user.id === 'u-jiho')!; officer.title = '변경한 직함'; officer.commonTaskPermission = false;
  const edited = JSON.stringify(state); const result = applyBudgetDemo(state, new Date('2027-02-01T00:00:00Z'));
  assert.equal(result.changed, false); assert.equal(JSON.stringify(state), edited); assert.equal(officer.commonTaskPermission, false);
});

test('budget demo: soft-deleted IDs are never recreated and unusable existing anchors are respected', () => {
  const state = createSeed(now);
  const task = state.tasks.find(item => item.id === 'budget-demo-task-plan-review')!; task.deletedAt = now.toISOString(); task.deletedFromStatus = task.status; task.status = 'archived';
  const unit = state.units.find(item => item.id === 'budget-demo-unit-formulation')!; unit.deletedAt = now.toISOString();
  const before = JSON.stringify(state); assert.equal(applyBudgetDemo(state, now).changed, false); assert.equal(JSON.stringify(state), before);
  const partial = oldWorkspace(); partial.units.push({ ...unit }); const result = applyBudgetDemo(partial, now);
  assert.ok(result.skippedIds.includes('budget-demo-task-plan-demand')); assert.ok(result.skippedIds.includes('budget-demo-task-plan-review'));
  assert.equal(partial.tasks.some(item => item.id === 'budget-demo-task-plan-demand'), false);
  assert.equal(partial.commonTasks.find(item => item.id === BUDGET_COMMON_DEMAND)!.distributions.find(item => item.departmentId === 'dept-plan')!.status, 'pending');
});

test('budget demo: task, unit, role, workflow snapshot, run, and distribution references agree', () => {
  const state = createSeed(now); const tasks = state.tasks.filter(task => task.id.startsWith(BUDGET_DEMO_PREFIX)); assert.equal(tasks.length, 9);
  for (const task of tasks) {
    const unit = state.units.find(item => item.id === task.unitId)!; const owner = state.users.find(user => user.id === task.primaryId)!; const reviewer = state.users.find(user => user.id === task.reviewerId)!;
    assert.equal(unit.ownerId, task.primaryId); assert.equal(unit.departmentId, task.departmentId); assert.equal(owner.departmentId, task.departmentId); assert.equal(reviewer.departmentId, task.departmentId); assert.equal(reviewer.role, 'head');
    assert.doesNotThrow(() => validateWorkflow(task, state));
    assert.ok(task.workflow.every(step => step.startDate && step.dueDate && step.startDate <= step.dueDate));
    const version = task.versions.at(-1)!; const run = state.runs.find(item => item.taskId === task.id)!;
    assert.equal(run.definitionVersion, version.version); assert.deepEqual(run.steps.map(step => step.stepId), version.workflow.map(step => step.id)); assert.deepEqual(run.steps.map(step => step.role), task.workflow.map(step => step.role));
    assert.equal(run.steps.filter(step => step.status === 'completed').length, task.workflow.filter(step => step.done).length);
    assert.equal(run.dueDate, task.dueDate); assert.equal(run.period, currentPeriod(task.frequency, new Date(`${task.dueDate}T12:00:00+09:00`))); assert.equal(run.dueDate, dueDateForPeriod(task.frequency, run.period, task.dueDate));
    assert.ok(task.budget! > 0); assert.ok(task.expenses!.reduce((sum, item) => sum + item.amount, 0) <= task.budget!); assert.equal(new Set(task.references!.map(reference => reference.type)).size, 4);
    assert.ok(task.references!.every(reference => /가상|시연/.test(reference.content)));
  }
  for (const common of state.commonTasks.filter(item => item.id.startsWith(BUDGET_DEMO_PREFIX))) for (const distribution of common.distributions.filter(item => item.status === 'registered')) {
    const task = state.tasks.find(item => item.id === distribution.taskId)!;
    assert.equal(task.commonId, common.id); assert.equal(task.primaryId, distribution.assigneeId); assert.equal(task.departmentId, distribution.departmentId); assert.equal(task.title, common.title); assert.equal(task.dueDate, common.dueDate);
  }
  assert.equal(state.commonTasks.find(item => item.id === BUDGET_COMMON_EXECUTION)!.distributions.find(item => item.departmentId === 'dept-support')!.status, 'person_assigned');
  assert.equal(state.commonTasks.find(item => item.id === BUDGET_COMMON_EXECUTION)!.distributions.find(item => item.departmentId === 'dept-innovation')!.status, 'team_assigned');
});

test('budget demo: the budget officer remains a member with common creation but no department/team allocation privilege', () => {
  const state = createSeed(now); const officer = state.users.find(user => user.id === 'u-jiho')!;
  assert.equal(officer.role, 'member'); assert.equal(officer.departmentId, 'dept-plan'); assert.equal(officer.title, '예산 담당 주무관'); assert.equal(officer.commonTaskPermission, undefined);
  const own = getWorkspace(state, officer.id, now);
  assert.equal(own.tasks.filter(task => task.id.startsWith(BUDGET_DEMO_PREFIX) && task.primaryId === officer.id).length, 6);
  assert.equal(own.commonTasks.filter(common => common.managerId === officer.id && common.id.startsWith(BUDGET_DEMO_PREFIX)).length, 2);
  assert.equal(own.tasks.some(task => task.id === 'budget-demo-task-data-demand'), false);
  assert.equal(getWorkspace(state, 'u-support-member', now).tasks.filter(task => task.id.startsWith(BUDGET_DEMO_PREFIX)).length, 3);
  dispatch(state, officer.id, 'common.create', { title: '예산 담당자가 추가한 공통업무', description: '업무 담당자의 승인 요청 확인', dueDate: '2026-12-31', frequency: 'once', requiredSteps: ['자료 준비', '부서장 검토'], departmentIds: ['dept-plan'] }); approveLatestCommon(state, now);
  const common = state.commonTasks[0]; const distributionId = common.distributions[0].id;
  rejects('DEPARTMENT_ASSIGNMENT_DENIED', () => dispatch(state, officer.id, 'common.assignTeam', { commonId: common.id, distributionId, team: '예산팀', leadId: 'u-budget-lead' }));
  dispatch(state, 'u-minseo', 'common.assignTeam', { commonId: common.id, distributionId, team: '예산팀', leadId: 'u-budget-lead' });
  rejects('TEAM_ASSIGNMENT_DENIED', () => dispatch(state, officer.id, 'common.assignPerson', { commonId: common.id, distributionId, assigneeId: 'u-jiho' }));
});

test('budget demo: conflicting demo IDs are preserved without creating invalid registered links', () => {
  const state = oldWorkspace(); const conflict = structuredClone(state.tasks.find(task => task.id === 'task-data')!); conflict.id = 'budget-demo-task-plan-demand'; conflict.code = 'CUSTOM-42'; conflict.title = '동일 ID에 있는 기존 사용자 자료'; state.tasks.push(conflict);
  const result = applyBudgetDemo(state, now); assert.equal(result.addedTasks, 8); assert.deepEqual(state.tasks.find(task => task.id === conflict.id), conflict);
  const distribution = state.commonTasks.find(item => item.id === BUDGET_COMMON_DEMAND)!.distributions.find(item => item.departmentId === 'dept-plan')!; assert.equal(distribution.status, 'pending'); assert.equal(distribution.taskId, undefined);
});

test('budget demo: unexpected user roles cause a non-destructive failure before additions', () => {
  const state = oldWorkspace(); state.users.find(user => user.id === 'u-jiho')!.role = 'manager'; const before = JSON.stringify(state);
  assert.throws(() => applyBudgetDemo(state, now), /기존 계정은 자동 변경하지 않았습니다/); assert.equal(JSON.stringify(state), before);
});
