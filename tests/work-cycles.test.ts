import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { taskExecution, commonDistributionStatus } from '../src/lib/common-status';
import { currentExecutionWorkflow, nextCycleWorkflow, runWorkflow, taskCycleState } from '../src/lib/work-cycles';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-10-31T13:00:00Z');
const taskId = 'task-data';
const owner = 'u-support-member';
const head = 'u-support-head';
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, requestId = randomUUID(), expectedRevision = state.revision) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision, requestId }, now);
  Object.assign(state, candidate);
}
function rejects(code: string, fn: () => void) { assert.throws(fn, error => error instanceof DomainError && error.code === code); }
const getTask = (state: WorkspaceData, id = taskId) => state.tasks.find(task => task.id === id)!;
function complete(state: WorkspaceData, id = taskId) {
  const task = getTask(state, id);
  for (const step of task.workflow) {
    if (taskExecution(state, getTask(state, id)).run?.steps.find(item => item.stepId === step.id)?.status === 'completed') continue;
    dispatch(state, step.role === 'reviewer' ? task.reviewerId : task.primaryId, 'task.setProgress', { taskId: id, stepId: step.id, done: true });
  }
}
function payload(state: WorkspaceData, id = taskId) {
  const task = getTask(state, id);
  return { taskId: id, previousRunId: taskCycleState(state, task).latest?.id, title: '12월 정기 점검', startDate: '2026-12-01', dueDate: '2026-12-20', steps: nextCycleWorkflow(task).map((step, index) => ({ stepId: step.id, startDate: `2026-12-${String(index * 2 + 1).padStart(2, '0')}`, dueDate: `2026-12-${String(index * 2 + 2).padStart(2, '0')}` })) };
}

test('cycles: completing then repeating resets only new execution while preserving procedure, dates and evidence', () => {
  const state = createSeed(now); complete(state);
  const previous = structuredClone(taskCycleState(state, getTask(state)).latest!);
  dispatch(state, owner, 'run.nextCycle', payload(state));
  const current = taskCycleState(state, getTask(state)).latest!;
  assert.notEqual(current.id, previous.id); assert.equal(current.previousRunId, previous.id); assert.equal(current.cycleNumber, 2);
  assert.equal(current.dueDate, '2026-12-20'); assert.equal(current.startDate, '2026-12-01');
  assert.ok(current.steps.every(step => step.status !== 'completed' && !step.output && !step.completedAt && step.checklist.every(check => !check.done)));
  assert.equal(taskExecution(state, getTask(state)).progress, 0); assert.equal(current.notes.length, 0);
  assert.deepEqual(state.runs.find(run => run.id === previous.id), previous);
  const view = getWorkspace(state, owner, now).tasks.find(task => task.id === taskId)!;
  assert.equal(view.cycleStartDate, '2026-12-01'); assert.equal(view.cycleDueDate, '2026-12-20'); assert.equal(view.workflow[0].startDate, '2026-12-01'); assert.equal(view.workflow[0].dueDate, '2026-12-02');
  assert.equal(getTask(state).dueDate, view.dueDate); // execution schedule is not a definition rewrite
  assert.notEqual(view.dueDate, view.cycleDueDate);
});

test('cycles: incomplete, paused and another open occurrence cannot be skipped', () => {
  const state = createSeed(now);
  rejects('CYCLE_NOT_COMPLETED', () => dispatch(state, owner, 'run.nextCycle', payload(state)));
  complete(state); const historical = structuredClone(state.runs.find(run => run.taskId === taskId)!);
  historical.id = 'another-open'; historical.startedAt = '2026-09-01T00:00:00Z'; historical.status = 'paused'; state.runs.push(historical);
  rejects('CYCLE_NOT_COMPLETED', () => dispatch(state, owner, 'run.nextCycle', payload(state)));
});

test('cycles: owner/admin only, including a confirmed department without changing its definitions', () => {
  const state = createSeed(now); complete(state); dispatch(state, head, 'department.confirm', {});
  const before = structuredClone(state.departmentWorkPlans);
  for (const actor of [head, 'u-doyun']) rejects('CYCLE_OWNER_REQUIRED', () => dispatch(state, actor, 'run.nextCycle', payload(state)));
  rejects('TASK_ACCESS_DENIED', () => dispatch(state, 'u-jiho', 'run.nextCycle', payload(state)));
  dispatch(state, owner, 'run.nextCycle', payload(state)); assert.deepEqual(state.departmentWorkPlans, before);
  complete(state); dispatch(state, 'u-admin', 'run.nextCycle', { ...payload(state), title: '관리자가 시작한 후속 회차' });
  assert.equal(taskCycleState(state, getTask(state)).latest?.cycleNumber, 3);
});

test('cycles: impossible dates, missing steps, schedule bounds and dependency inversion reject atomically', () => {
  const state = createSeed(now); complete(state); const input = payload(state); const before = JSON.stringify(state);
  rejects('VALIDATION_ERROR', () => dispatch(state, owner, 'run.nextCycle', { ...input, startDate: '2026-02-30' }));
  rejects('CYCLE_DATE_RANGE', () => dispatch(state, owner, 'run.nextCycle', { ...input, startDate: '2026-12-21' }));
  rejects('CYCLE_STEPS_REQUIRED', () => dispatch(state, owner, 'run.nextCycle', { ...input, steps: input.steps.slice(1) }));
  rejects('CYCLE_STEPS_REQUIRED', () => dispatch(state, owner, 'run.nextCycle', { ...input, steps: input.steps.map((step, index) => index ? step : input.steps[1]) }));
  rejects('CYCLE_STEP_DATE_RANGE', () => dispatch(state, owner, 'run.nextCycle', { ...input, steps: input.steps.map((step, index) => index ? step : { ...step, startDate: '2026-11-30' }) }));
  rejects('CYCLE_DEPENDENCY_DATE', () => dispatch(state, owner, 'run.nextCycle', { ...input, steps: input.steps.map((step, index) => index === 1 ? { ...step, startDate: '2026-12-01' } : step) }));
  assert.equal(JSON.stringify(state), before);
});

test('cycles: stale previous IDs, version conflict and duplicate submissions cannot create extra cycles', () => {
  const state = createSeed(now); complete(state); const input = payload(state); const requestId = randomUUID(); const revision = state.revision; const expected = { kind: 'task' as const, id: taskId, rev: getTask(state).rev ?? 0 };
  rejects('CYCLE_CHANGED', () => dispatch(state, owner, 'run.nextCycle', { ...input, previousRunId: 'outdated' }));
  dispatch(state, owner, 'run.nextCycle', input, requestId, revision); const count = state.runs.length;
  dispatch(state, owner, 'run.nextCycle', input, requestId, revision); assert.equal(state.runs.length, count);
  rejects('CYCLE_CHANGED', () => dispatch(state, owner, 'run.nextCycle', input));
  rejects('TARGET_CONFLICT', () => executeCommand(state, owner, { type: 'run.nextCycle', payload: payload(state), requestId: randomUUID(), expectedRevision: revision, expected }, now));
});

test('cycles: legacy completed task-only records are archived without fabricating completion actors', () => {
  const state = createSeed(now); state.runs = state.runs.filter(run => run.taskId !== taskId);
  const originalDueDate = getTask(state).dueDate;
  getTask(state).workflow.forEach(step => { step.done = true; });
  dispatch(state, owner, 'run.nextCycle', payload(state));
  const runs = taskCycleState(state, getTask(state)).runs;
  assert.equal(runs.length, 2); const previous = runs.find(run => run.status === 'completed')!;
  assert.ok(previous.workflowSnapshot); assert.ok(previous.steps.every(step => step.status === 'completed' && !step.completedBy && !step.completedAt));
  assert.equal(previous.completedAt, undefined); assert.equal(runs[0].previousRunId, previous.id);
  assert.equal(previous.dueDate, originalDueDate); assert.equal(getTask(state).dueDate, originalDueDate);
});

test('cycles: legacy run snapshots are captured and current schedule survives unrelated task edits', () => {
  const state = createSeed(now); complete(state); const old = taskCycleState(state, getTask(state)).latest!; delete old.workflowSnapshot;
  const oldSteps = structuredClone(old.steps); const oldDue = old.dueDate;
  dispatch(state, owner, 'run.nextCycle', payload(state));
  const current = taskCycleState(state, getTask(state)).latest!; const schedule = structuredClone(current.workflowSnapshot); const title = current.title;
  dispatch(state, owner, 'task.configure', { taskId, budget: 123456, description: '예산 정보 보충' });
  const updated = state.runs.find(run => run.id === current.id)!;
  assert.deepEqual(updated.workflowSnapshot, schedule); assert.equal(updated.title, title); assert.equal(updated.startDate, '2026-12-01'); assert.equal(updated.dueDate, '2026-12-20');
  const archived = state.runs.find(run => run.id === old.id)!;
  assert.deepEqual(archived.steps, oldSteps); assert.equal(archived.dueDate, oldDue); assert.ok(archived.workflowSnapshot);
  assert.deepEqual(runWorkflow(getTask(state), archived).map(step => step.title), oldSteps.map(step => step.title));
});

test('cycles: clearing optional step dates cannot reintroduce previous-cycle dates', () => {
  const state = createSeed(now); complete(state); const input = payload(state);
  dispatch(state, owner, 'run.nextCycle', { ...input, steps: input.steps.map(step => ({ stepId: step.stepId })) });
  const task = getWorkspace(state, owner, now).tasks.find(task => task.id === taskId)!;
  assert.ok(task.workflow.every(step => !step.startDate && !step.dueDate)); assert.equal(task.cycleDueDate, input.dueDate);
  assert.equal(task.dueDate, getTask(state).dueDate);
});

test('cycles: completed managed cycle execution is frozen and later recurring creation does not bypass history', () => {
  const state = createSeed(now); complete(state); dispatch(state, owner, 'run.nextCycle', payload(state)); complete(state);
  const finished = structuredClone(taskCycleState(state, getTask(state)).latest!);
  rejects('RUN_COMPLETED', () => dispatch(state, owner, 'task.setProgress', { taskId, stepId: finished.steps.at(-1)!.stepId, done: false }));
  rejects('RUN_COMPLETED', () => dispatch(state, owner, 'run.check', { runId: finished.id, stepId: finished.steps[0].stepId, checkId: finished.steps[0].checklist[0].id, done: false }));
  rejects('CYCLE_COMMAND_REQUIRED', () => dispatch(state, owner, 'run.create', { taskId, period: '2027-01' }));
  dispatch(state, head, 'reconcile', {}); assert.deepEqual(state.runs.find(run => run.id === finished.id), finished);
  assert.equal(state.runs.filter(run => run.taskId === taskId).length, 2);
});

test('cycles: common distribution returns to new execution with its own schedule and zero progress', () => {
  const state = createSeed(now); const commonTaskId = 'budget-demo-task-data-demand'; complete(state, commonTaskId);
  const task = getTask(state, commonTaskId); const common = state.commonTasks.find(common => common.id === task.commonId)!;
  const distribution = common.distributions.find(distribution => distribution.taskId === task.id)!;
  assert.equal(commonDistributionStatus(state, common, distribution, now).stage, 'completed');
  dispatch(state, owner, 'run.nextCycle', payload(state, commonTaskId));
  const next = commonDistributionStatus(state, common, distribution, now);
  assert.equal(next.stage, 'in_progress'); assert.equal(next.progress, 0);
  assert.equal(next.dueDate, '2026-11-20'); // Central quarterly deadline remains fixed within the reporting period.
  assert.equal(next.executionDueDate, '2026-12-20'); assert.equal(next.scheduleExceedsDeadline, true);
});

test('cycles: an unpublished revised procedure must be confirmed before repeating its execution', () => {
  const state = createSeed(now); complete(state);
  dispatch(state, 'u-admin', 'task.revise', { taskId, reason: '절차 구성 검토' });
  const original = getTask(state).workflow;
  dispatch(state, owner, 'task.update', { taskId, workflow: [...original, { ...original[0], id: 'new-pending-step', title: '검토 중인 추가 절차', dependsOn: [original.at(-1)!.id], done: false }] });
  const before = state.runs.length;
  rejects('CYCLE_DEFINITION_PENDING', () => dispatch(state, owner, 'run.nextCycle', payload(state)));
  assert.equal(state.runs.length, before);
});

test('cycles: display fallback cannot bypass missing authoritative procedure data during execution', () => {
  const state = createSeed(now); const run = taskCycleState(state, getTask(state)).latest!;
  delete run.workflowSnapshot;
  getTask(state).versions = [];
  const step = run.steps.find(step => step.status !== 'completed' && step.role !== 'reviewer')!;
  rejects('DEFINITION_MISSING', () => dispatch(state, owner, 'run.check', { runId: run.id, stepId: step.stepId, checkId: step.checklist[0].id, done: true }));
  rejects('DEFINITION_MISSING', () => dispatch(state, owner, 'task.setProgress', { taskId, stepId: step.stepId, done: true }));
});

test('cycles: calendar execution keeps frozen names and dates without replacing a newer editable definition', () => {
  const state = createSeed(now); complete(state);
  dispatch(state, owner, 'run.nextCycle', payload(state));
  const running = structuredClone(taskCycleState(state, getTask(state)).latest!);
  const originalProcedure = runWorkflow(getTask(state), running);
  dispatch(state, 'u-admin', 'task.revise', { taskId, reason: '다음 기준 보완' });
  dispatch(state, owner, 'task.update', { taskId, workflow: getTask(state).workflow.map(({ startDate: _start, dueDate: _due, ...step }) => ({ ...step, title: `새 기준 ${step.title}`, description: '새 기준의 수행 설명' })) });
  dispatch(state, owner, 'task.submit', { taskId });
  dispatch(state, 'u-admin', 'task.confirm', { taskId });
  dispatch(state, 'u-admin', 'task.revise', { taskId, reason: '같은 절차 ID의 초안 편집' });
  dispatch(state, owner, 'task.update', { taskId, workflow: getTask(state).workflow.map(step => ({ ...step, title: `검토 중 ${step.title}` })) });

  const beforeRead = structuredClone(state);
  const workspace = getWorkspace(state, owner, now);
  const task = workspace.tasks.find(item => item.id === taskId)!;
  assert.ok(task.version > running.definitionVersion);
  assert.deepEqual(task.workflow, getTask(state).workflow);
  assert.match(task.workflow[0].title, /^검토 중 새 기준 /);
  assert.equal(task.workflow[0].startDate, undefined);
  assert.deepEqual(currentExecutionWorkflow(workspace, task), originalProcedure);
  assert.equal(currentExecutionWorkflow(workspace, task)[0].startDate, '2026-12-01');
  assert.deepEqual(state, beforeRead);
});

test('cycles: execution schedule selects the new cycle and preserves completed, legacy and task-only fallbacks', () => {
  const legacyState = createSeed(now);
  const legacyTask = getTask(legacyState);
  const legacyRun = taskCycleState(legacyState, legacyTask).latest!;
  delete legacyRun.workflowSnapshot;
  const confirmedStep = legacyTask.versions.find(version => version.version === legacyRun.definitionVersion)!.workflow[0];
  legacyTask.workflow[0] = { ...legacyTask.workflow[0], title: '작성 중인 이름', startDate: '2027-01-01', dueDate: '2027-01-02' };
  const legacyProcedure = currentExecutionWorkflow(legacyState, legacyTask);
  assert.equal(legacyProcedure[0].title, legacyRun.steps[0].title);
  assert.equal(legacyProcedure[0].startDate, confirmedStep.startDate);
  assert.equal(legacyProcedure[0].dueDate, confirmedStep.dueDate);
  assert.equal(legacyRun.workflowSnapshot, undefined);
  legacyState.runs = legacyState.runs.filter(run => run.taskId !== taskId);
  assert.deepEqual(currentExecutionWorkflow(legacyState, legacyTask), legacyTask.workflow);

  const state = createSeed(now); complete(state);
  const completed = structuredClone(taskCycleState(state, getTask(state)).latest!);
  dispatch(state, 'u-admin', 'task.revise', { taskId, reason: '완료 후 다음 기준 작성' });
  dispatch(state, owner, 'task.update', { taskId, workflow: getTask(state).workflow.map(({ startDate: _start, dueDate: _due, ...step }) => ({ ...step, title: `다음 회차 ${step.title}` })) });
  dispatch(state, owner, 'task.submit', { taskId });
  dispatch(state, 'u-admin', 'task.confirm', { taskId });
  const waiting = getWorkspace(state, owner, now);
  const waitingTask = waiting.tasks.find(item => item.id === taskId)!;
  assert.equal(taskExecution(waiting, waitingTask).run, undefined);
  assert.deepEqual(currentExecutionWorkflow(waiting, waitingTask), waitingTask.workflow);
  assert.ok(currentExecutionWorkflow(waiting, waitingTask).every(step => !step.startDate && !step.dueDate));

  dispatch(state, owner, 'run.nextCycle', payload(state));
  const current = getWorkspace(state, owner, now);
  const currentTask = current.tasks.find(item => item.id === taskId)!;
  const workflow = currentExecutionWorkflow(current, currentTask);
  assert.match(workflow[0].title, /^다음 회차 /);
  assert.equal(workflow[0].startDate, '2026-12-01');
  assert.equal(workflow[0].dueDate, '2026-12-02');
  assert.ok(workflow.every(step => !step.done));
  assert.deepEqual(state.runs.find(run => run.id === completed.id), completed);
});
