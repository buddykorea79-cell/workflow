import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand } from '../src/lib/domain';
import { commonDistributionStatus } from '../src/lib/common-status';
import { commonDeadline } from '../src/lib/common-deadline';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-05T03:00:00Z');
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown> = {}, requestId = randomUUID()) {
  const next = structuredClone(state);
  executeCommand(next, actor, { type, payload, expectedRevision: state.revision, requestId }, now);
  Object.assign(state, next);
}
const rejects = (code: string, fn: () => void) => assert.throws(fn, error => error instanceof DomainError && error.code === code);
const taskOf = (state: WorkspaceData) => state.tasks.find(task => task.id === 'task-data')!;

test('records: confirmed definitions and run evidence stay frozen while expenses and produced documents gain an audit trail', () => {
  const state = createSeed(now);
  taskOf(state).references = [{ id: 'law', type: 'law', title: '업무 기준', content: '변경하지 않는 기준' }];
  dispatch(state, 'u-support-head', 'department.confirm');
  const beforeTask = structuredClone(taskOf(state));
  const beforeRuns = structuredClone(state.runs);
  const beforePlan = structuredClone(state.departmentWorkPlans);
  const payload = { taskId: 'task-data', expenses: [{ id: 'expense', date: '2026-11-05', description: '결과보고서 인쇄', amount: 12000 }], documents: [{ id: 'result', type: 'document', title: '진단 결과보고', content: '오류 3건 정비' }] };
  const requestId = randomUUID();
  dispatch(state, 'u-support-member', 'task.record', payload, requestId);
  dispatch(state, 'u-support-member', 'task.record', payload, requestId);
  const task = taskOf(state);
  assert.equal(task.expenses?.[0].amount, 12000);
  assert.equal(task.references?.length, 2);
  assert.equal(task.recordHistory?.length, 1);
  assert.deepEqual(task.recordHistory?.[0].expensesBefore, beforeTask.expenses ?? []);
  assert.equal(task.recordHistory?.[0].recordedBy, task.primaryId);
  assert.deepEqual(task.versions, beforeTask.versions);
  assert.equal(task.version, beforeTask.version);
  assert.deepEqual(task.workflow, beforeTask.workflow);
  assert.deepEqual(state.runs, beforeRuns);
  assert.deepEqual(state.departmentWorkPlans, beforePlan);
  dispatch(state, 'u-support-member', 'task.record', { taskId: task.id, expenses: [] });
  assert.equal(taskOf(state).recordHistory?.length, 2);
  assert.equal(taskOf(state).recordHistory?.[1].expensesBefore[0].amount, 12000);
  assert.equal(taskOf(state).references?.find(reference => reference.id === 'law')?.content, '변경하지 않는 기준');
});

test('records: support staff may record but cannot smuggle definitions, foreign attachments, or duplicate IDs', () => {
  const state = createSeed(now); taskOf(state).supportIds = ['u-doyun'];
  dispatch(state, 'u-support-head', 'department.confirm');
  dispatch(state, 'u-doyun', 'task.record', { taskId: 'task-data', documents: [{ id: 'doc', type: 'document', title: '지원 결과', content: '확인 완료' }] });
  const before = JSON.stringify(state);
  rejects('RECORD_DENIED', () => dispatch(state, 'u-support-head', 'task.record', { taskId: 'task-data', expenses: [] }));
  rejects('TASK_ACCESS_DENIED', () => dispatch(state, 'u-seoyeon', 'task.record', { taskId: 'task-data', expenses: [] }));
  rejects('VALIDATION_ERROR', () => dispatch(state, 'u-support-member', 'task.record', { taskId: 'task-data', expenses: [], budget: 9000 }));
  rejects('RECORD_DOCUMENT_ONLY', () => dispatch(state, 'u-support-member', 'task.record', { taskId: 'task-data', documents: [{ id: 'law', type: 'law', title: '기준 변경', content: '금지' }] }));
  rejects('REFERENCE_ATTACHMENT_INVALID', () => dispatch(state, 'u-support-member', 'task.record', { taskId: 'task-data', documents: [{ id: 'doc', type: 'document', title: '외부 파일', content: '', attachmentId: 'other-task-file' }] }));
  const expense = { id: 'dup', date: '2026-11-05', description: '중복', amount: 1 };
  rejects('DUPLICATE_DETAIL', () => dispatch(state, 'u-support-member', 'task.record', { taskId: 'task-data', expenses: [expense, expense] }));
  rejects('DEPARTMENT_CONFIRMED', () => dispatch(state, 'u-support-member', 'task.configure', { taskId: 'task-data', description: '업무 기준 변경' }));
  assert.equal(JSON.stringify(state), before);
});

test('common delivery: confirmed sending and receiving departments can receive inbox items without changing approved assignments', () => {
  const state = createSeed(now);
  dispatch(state, 'u-support-head', 'department.confirm');
  dispatch(state, 'u-head', 'department.confirm');
  const plans = structuredClone(state.departmentWorkPlans), units = structuredClone(state.units), tasks = structuredClone(state.tasks);
  for (const kind of ['common', 'directive']) {
    dispatch(state, 'u-jiho', 'common.create', { kind, title: '새 긴급 요청', description: '확정 후에도 접수', departmentIds: ['dept-support'], dueDate: '2026-11-30', frequency: 'once', requiredSteps: ['자료 확인', '부서장 검토'], ...(kind === 'directive' ? { directiveIssuer: 'minister', instructedOn: '2026-11-05' } : {}) });
    const common = state.commonTasks[0], distribution = common.distributions[0];
    assert.equal(distribution.status, 'pending');
    assert.equal(distribution.taskId, undefined);
    rejects('DEPARTMENT_CONFIRMED', () => dispatch(state, 'u-doyun', 'common.assignTeam', { commonId: common.id, distributionId: distribution.id, team: '데이터팀', leadId: 'u-support-lead' }));
  }
  assert.deepEqual(state.departmentWorkPlans, plans);
  assert.deepEqual(state.units, units);
  assert.deepEqual(state.tasks, tasks);
  const commonId = state.commonTasks[0].id;
  dispatch(state, 'u-jiho', 'common.distribute', { commonId, departmentIds: ['dept-plan'] });
  assert.equal(state.commonTasks[0].distributions.length, 2);
  assert.deepEqual(state.units, units);
  assert.deepEqual(state.tasks, tasks);
  dispatch(state, 'u-support-head', 'department.reopen', { reason: '새 접수 업무 배정' });
  const distributionId = state.commonTasks[0].distributions[0].id;
  dispatch(state, 'u-doyun', 'common.assignTeam', { commonId, distributionId, team: '데이터팀', leadId: 'u-support-lead' });
  dispatch(state, 'u-support-lead', 'common.assignPerson', { commonId, distributionId, assigneeId: 'u-support-member' });
  dispatch(state, 'u-support-member', 'common.register', { commonId, distributionId, unitId: 'unit-data' });
  assert.ok(state.commonTasks[0].distributions[0].taskId);
});

test('common deadline: postponing the run does not hide a missed central submission date', () => {
  const state = createSeed(now);
  const task = state.tasks.find(task => task.id === 'task-budget')!;
  const run = state.runs.find(run => run.taskId === task.id)!;
  const common = state.commonTasks.find(common => common.id === task.commonId)!;
  const distribution = common.distributions.find(item => item.taskId === task.id)!;
  const initialDeadline = commonDistributionStatus(state, common, distribution, now).dueDate;
  dispatch(state, task.primaryId, 'run.schedule', { taskId: task.id, runId: run.id, startDate: '2026-11-01', dueDate: '2027-12-31', steps: run.steps.map(step => ({ stepId: step.stepId })) });
  const view = commonDistributionStatus(state, state.commonTasks.find(item => item.id === common.id)!, distribution, new Date('2026-11-10T03:00:00Z'));
  assert.equal(initialDeadline, '2026-11-08');
  assert.equal(view.dueDate, initialDeadline);
  assert.equal(view.executionDueDate, '2027-12-31');
  assert.equal(view.scheduleExceedsDeadline, true);
  assert.equal(view.overdue, true);
});

test('common deadline: recurring periods preserve the central rule, including short months', () => {
  assert.equal(commonDeadline({ frequency: 'monthly', dueDate: '2025-01-31' }, { period: '' }), '2025-01-31');
  assert.equal(commonDeadline({ frequency: 'monthly', dueDate: '2025-01-31' }, { period: '  ' }), '2025-01-31');
  assert.equal(commonDeadline({ frequency: 'monthly', dueDate: '2026-01-31' }, { period: '2027년 2월' }), '2027-02-28');
  assert.equal(commonDeadline({ frequency: 'quarterly', dueDate: '2026-11-08' }, { period: '2027년 1분기' }), '2027-02-08');
  assert.equal(commonDeadline({ frequency: 'once', dueDate: '2026-11-08' }, { period: '2028년' }), '2026-11-08');
});

test('completed step evidence: a later definition edit cannot replace a completed checklist', () => {
  const state = createSeed(now), task = taskOf(state);
  const completed = task.workflow.find(step => step.done)!;
  assert.ok(completed);
  const workflow = structuredClone(task.workflow);
  workflow.find(step => step.id === completed.id)!.checklist = ['나중에 추가한 확인'];
  const before = JSON.stringify(state);
  rejects('COMPLETED_STEP_LOCKED', () => dispatch(state, task.primaryId, 'task.configure', { taskId: task.id, workflow }));
  assert.equal(JSON.stringify(state), before);
});
