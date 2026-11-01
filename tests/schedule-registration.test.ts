import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { runWorkflow, taskCycleState } from '../src/lib/work-cycles';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-01T03:00:00Z');
const taskId = 'task-data';
const owner = 'u-support-member';
const taskOf = (state: WorkspaceData) => state.tasks.find(task => task.id === taskId)!;
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, requestId = randomUUID()) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId }, now);
  Object.assign(state, candidate);
}
function rejects(code: string, fn: () => void) { assert.throws(fn, error => error instanceof DomainError && error.code === code); }
function schedule(state: WorkspaceData) {
  const task = taskOf(state); const run = taskCycleState(state, task).latest;
  return { taskId, runId: run?.id, title: '11월 자료 점검', startDate: '2026-11-01', dueDate: '2026-11-30', scheduleDetails: '월별 실적을 확인하고 결과를 제출합니다.', steps: (run ? runWorkflow(task, run) : task.workflow).map((step, index) => ({ stepId: step.id, startDate: `2026-11-${String(index * 2 + 1).padStart(2, '0')}`, dueDate: `2026-11-${String(index * 2 + 2).padStart(2, '0')}`, scheduleDetails: `${step.title} 진행 내용` })) };
}
function complete(state: WorkspaceData) {
  for (const step of taskOf(state).workflow) {
    const task = taskOf(state); const run = taskCycleState(state, task).latest;
    if (run?.steps.find(item => item.stepId === step.id)?.status === 'completed') continue;
    dispatch(state, step.role === 'reviewer' ? task.reviewerId : task.primaryId, 'task.setProgress', { taskId, stepId: step.id, done: true });
  }
}

test('schedule: dates and details persist as execution data while locked definitions and evidence stay intact', () => {
  const state = createSeed(now); dispatch(state, 'u-support-head', 'department.confirm', {});
  const task = structuredClone(taskOf(state)); const plans = structuredClone(state.departmentWorkPlans);
  const previous = structuredClone(taskCycleState(state, taskOf(state)).latest!); const input = schedule(state);
  dispatch(state, owner, 'run.schedule', input);
  const run = taskCycleState(state, taskOf(state)).latest!;
  assert.equal(run.id, previous.id); assert.equal(run.scheduleDetails, input.scheduleDetails); assert.equal(run.title, input.title);
  assert.equal(run.workflowSnapshot![1].scheduleDetails, input.steps[1].scheduleDetails);
  assert.deepEqual(run.steps, previous.steps); assert.deepEqual(run.notes, previous.notes);
  assert.deepEqual(taskOf(state).versions, task.versions); assert.equal(taskOf(state).dueDate, task.dueDate); assert.deepEqual(state.departmentWorkPlans, plans);
  const view = getWorkspace(state, owner, now).tasks.find(task => task.id === taskId)!;
  assert.equal(view.workflow[1].scheduleDetails, input.steps[1].scheduleDetails); assert.equal(view.dueDate, input.dueDate);
});

test('schedule: full set, dependency order, bounds, current run and ownership are enforced atomically', () => {
  const state = createSeed(now); const input = schedule(state); const before = JSON.stringify(state);
  rejects('CYCLE_OWNER_REQUIRED', () => dispatch(state, 'u-support-head', 'run.schedule', input));
  rejects('TASK_ACCESS_DENIED', () => dispatch(state, 'u-jiho', 'run.schedule', input));
  rejects('CYCLE_CHANGED', () => dispatch(state, owner, 'run.schedule', { ...input, runId: undefined }));
  rejects('CYCLE_CHANGED', () => dispatch(state, owner, 'run.schedule', { ...input, runId: 'old-run' }));
  rejects('VALIDATION_ERROR', () => dispatch(state, owner, 'run.schedule', { ...input, dueDate: '2026-02-30' }));
  rejects('CYCLE_STEPS_REQUIRED', () => dispatch(state, owner, 'run.schedule', { ...input, steps: input.steps.slice(1) }));
  rejects('CYCLE_STEP_DATE_RANGE', () => dispatch(state, owner, 'run.schedule', { ...input, steps: input.steps.map((step, index) => index ? step : { ...step, startDate: '2026-10-31' }) }));
  rejects('CYCLE_DEPENDENCY_DATE', () => dispatch(state, owner, 'run.schedule', { ...input, steps: input.steps.map((step, index) => index === 1 ? { ...step, startDate: '2026-11-01' } : step) }));
  assert.equal(JSON.stringify(state), before);
});

test('schedule: first task-only cycle preserves known progress and can explicitly complete then repeat', () => {
  const state = createSeed(now); state.runs = state.runs.filter(run => run.taskId !== taskId); taskOf(state).workflow[0].done = true;
  const input = schedule(state); const requestId = randomUUID();
  dispatch(state, owner, 'run.schedule', input, requestId); const run = taskCycleState(state, taskOf(state)).latest!;
  assert.equal(run.steps[0].status, 'completed'); assert.equal(run.steps[0].completedBy, undefined); assert.equal(run.cycleNumber, 1);
  dispatch(state, owner, 'run.schedule', input, requestId); assert.equal(state.runs.filter(item => item.taskId === taskId).length, 1);
  rejects('CYCLE_NOT_COMPLETED', () => dispatch(state, owner, 'run.completeCycle', { taskId, runId: run.id }));
  complete(state); dispatch(state, owner, 'run.completeCycle', { taskId, runId: run.id });
  const frozen = structuredClone(taskCycleState(state, taskOf(state)).latest!);
  rejects('RUN_COMPLETED', () => dispatch(state, owner, 'run.schedule', schedule(state)));
  dispatch(state, owner, 'run.nextCycle', { ...input, previousRunId: run.id, scheduleDetails: '다음 달 후속 점검', steps: input.steps.map(step => ({ ...step, scheduleDetails: '새 회차 상세' })) });
  const next = taskCycleState(state, taskOf(state)).latest!;
  assert.equal(next.scheduleDetails, '다음 달 후속 점검'); assert.equal(next.workflowSnapshot![0].scheduleDetails, '새 회차 상세');
  assert.deepEqual(state.runs.find(item => item.id === run.id), frozen); assert.ok(next.steps.every(step => step.status !== 'completed'));
});

test('schedule: explicit completion freezes a legacy completed cycle and rejects an outdated run', () => {
  const state = createSeed(now); complete(state); const run = taskCycleState(state, taskOf(state)).latest!;
  assert.equal(run.cycleManaged, undefined);
  rejects('CYCLE_CHANGED', () => dispatch(state, owner, 'run.completeCycle', { taskId, runId: 'outdated' }));
  dispatch(state, owner, 'run.completeCycle', { taskId, runId: run.id });
  assert.equal(taskCycleState(state, taskOf(state)).latest!.cycleManaged, true);
  rejects('RUN_COMPLETED', () => dispatch(state, owner, 'task.setProgress', { taskId, stepId: run.steps.at(-1)!.stepId, done: false }));
});

test('schedule: incomplete legacy completion records, missing procedure definitions and inverted partial dates are protected', () => {
  const state = createSeed(now); const input = schedule(state); const run = taskCycleState(state, taskOf(state)).latest!;
  const partial = input.steps.map((step, index) => index === 0 ? { stepId: step.stepId, startDate: '2026-11-06' } : index === 1 ? { stepId: step.stepId, dueDate: '2026-11-05' } : step);
  rejects('CYCLE_DEPENDENCY_DATE', () => dispatch(state, owner, 'run.schedule', { ...input, steps: partial }));
  run.status = 'completed';
  rejects('RUN_COMPLETED', () => dispatch(state, owner, 'run.schedule', input));
  run.status = 'in_progress'; delete run.workflowSnapshot; taskOf(state).versions = [];
  rejects('DEFINITION_MISSING', () => dispatch(state, owner, 'run.schedule', input));
});

test('references: produced documents support file-only content and reject another task attachment', () => {
  const state = createSeed(now);
  state.attachments.push({ id: 'own-file', taskId, name: '보고서.pdf', size: 10, mime: 'application/pdf', sha256: 'test', storageKey: 'file', status: 'quarantined', uploadedBy: owner, createdAt: now.toISOString() });
  const reference = { id: 'report-reference', type: 'document', title: '생산한 결과 보고서', content: '', attachmentId: 'own-file' };
  dispatch(state, owner, 'task.configure', { taskId, references: [reference] });
  assert.deepEqual(taskOf(state).references, [reference]);
  state.attachments.push({ ...state.attachments.at(-1)!, id: 'foreign-file', taskId: 'task-budget' });
  rejects('REFERENCE_ATTACHMENT_INVALID', () => dispatch(state, owner, 'task.configure', { taskId, references: [{ ...reference, attachmentId: 'foreign-file' }] }));
  const task = taskOf(state); task.status = 'revision';
  rejects('REFERENCE_ATTACHMENT_INVALID', () => dispatch(state, owner, 'task.update', { taskId, references: [{ ...reference, attachmentId: 'missing-file' }] }));
});
