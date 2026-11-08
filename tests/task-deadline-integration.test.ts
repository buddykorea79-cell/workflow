import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import { koreaDate } from '../src/lib/seed-helpers';
import { taskExecution } from '../src/lib/common-status';
import { deadlineState } from '../src/lib/task-deadline';
import { taskCycleState } from '../src/lib/work-cycles';
import { moveProcedureStep } from '../src/lib/procedure-order';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-07T03:00:00Z');
const owner = 'u-seoyeon';
const taskOf = (state: WorkspaceData, id: string) => state.tasks.find(task => task.id === id)!;
const runOf = (state: WorkspaceData, id: string) => taskCycleState(state, taskOf(state, id)).latest!;

function dispatch(state: WorkspaceData, type: string, payload: Record<string, unknown>, actor = owner, at = now) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, at);
  Object.assign(state, candidate);
}

function createTask(state: WorkspaceData, dueDate = '2025-01-01') {
  dispatch(state, 'task.create', {
    title: '업무 마감과 회차 일정 분리 확인', description: '정기 자료 작성과 결과 검토',
    unitId: 'unit-record', primaryId: owner, supportIds: [], dueDate, frequency: 'monthly',
    workflow: [
      { id: 'prepare', title: '자료 작성', role: 'primary', description: '자료를 작성합니다.', output: '', required: true, dependsOn: [], checklist: [] },
      { id: 'review', title: '결과 검토', role: 'reviewer', description: '결과를 검토합니다.', output: '', required: true, dependsOn: ['prepare'], checklist: [] },
    ],
  });
  return state.tasks[0].id;
}

function scheduleInput(state: WorkspaceData, taskId: string, startDate = '2026-11-20', dueDate = '2026-11-25') {
  const task = taskOf(state, taskId);
  return {
    taskId, runId: runOf(state, taskId)?.id, title: '정기 자료 검토 회차', startDate, dueDate,
    scheduleDetails: '이번 회차에서 처리할 범위를 확인합니다.',
    steps: task.workflow.map((step, index) => ({ stepId: step.id, startDate: index ? dueDate : startDate, dueDate: index ? dueDate : startDate, scheduleDetails: `${step.title} 일정 메모` })),
  };
}

function finishCycle(state: WorkspaceData, taskId: string) {
  for (const step of taskOf(state, taskId).workflow) {
    const task = taskOf(state, taskId);
    dispatch(state, 'task.setProgress', { taskId, stepId: step.id, done: true }, step.role === 'reviewer' ? task.reviewerId : task.primaryId);
  }
  dispatch(state, 'run.completeCycle', { taskId, runId: runOf(state, taskId).id });
}

function deadlineFor(state: WorkspaceData, taskId: string, at = now) {
  const workspace = getWorkspace(state, owner, at);
  const task = workspace.tasks.find(item => item.id === taskId)!;
  const execution = taskExecution(workspace, task);
  return deadlineState({ taskDueDate: task.dueDate, cycleDueDate: task.cycleDueDate, progress: execution.progress, runStatus: execution.run?.status, taskStatus: task.status, deletedAt: task.deletedAt }, koreaDate(new Date(workspace.serverTime)));
}

test('deadline integration: future schedules and repeated cycles never replace the task deadline', () => {
  const state = createSeed(now);
  const taskId = createTask(state);
  dispatch(state, 'run.schedule', scheduleInput(state, taskId));
  let view = getWorkspace(state, owner, now).tasks.find(task => task.id === taskId)!;
  assert.equal(taskOf(state, taskId).dueDate, '2025-01-01');
  assert.equal(view.dueDate, '2025-01-01');
  assert.equal(view.cycleStartDate, '2026-11-20');
  assert.equal(view.cycleDueDate, '2026-11-25');
  assert.equal(view.workflow[0].startDate, '2026-11-20');
  assert.equal(deadlineFor(state, taskId).overdue, true);

  const scheduled = structuredClone(runOf(state, taskId));
  dispatch(state, 'task.configure', { taskId, title: '제목만 수정한 업무', description: '업무 설명을 보충했습니다.' });
  assert.equal(taskOf(state, taskId).dueDate, '2025-01-01');
  assert.equal(runOf(state, taskId).title, scheduled.title);
  assert.equal(runOf(state, taskId).startDate, scheduled.startDate);
  assert.equal(runOf(state, taskId).dueDate, scheduled.dueDate);
  assert.equal(runOf(state, taskId).scheduleDetails, scheduled.scheduleDetails);
  assert.deepEqual(runOf(state, taskId).workflowSnapshot, scheduled.workflowSnapshot);

  dispatch(state, 'task.configure', { taskId, dueDate: '2026-12-31' });
  assert.equal(taskOf(state, taskId).dueDate, '2026-12-31');
  assert.equal(runOf(state, taskId).dueDate, '2026-11-25');
  assert.deepEqual(runOf(state, taskId).workflowSnapshot, scheduled.workflowSnapshot);
  finishCycle(state, taskId);
  const previous = structuredClone(runOf(state, taskId));
  dispatch(state, 'run.nextCycle', { ...scheduleInput(state, taskId, '2027-01-10', '2027-01-15'), previousRunId: previous.id });
  assert.equal(taskOf(state, taskId).dueDate, '2026-12-31');
  assert.deepEqual(state.runs.find(run => run.id === previous.id), previous);
  view = getWorkspace(state, owner, now).tasks.find(task => task.id === taskId)!;
  assert.equal(view.dueDate, '2026-12-31');
  assert.equal(view.cycleStartDate, '2027-01-10');
  assert.equal(view.cycleDueDate, '2027-01-15');
  assert.match(state.audit.find(entry => entry.action === 'run.nextCycle' && entry.targetId === runOf(state, taskId).id)!.detail, /업무 마감일 초과.*2026-12-31.*2027-01-15/);
});

test('deadline integration: legacy task.update changes business dates without rewriting a managed schedule', () => {
  const state = createSeed(now);
  const taskId = createTask(state);
  dispatch(state, 'run.schedule', scheduleInput(state, taskId));
  const scheduled = structuredClone(runOf(state, taskId));
  dispatch(state, 'task.update', { taskId, title: '수정 경로를 확인한 업무' });
  assert.equal(taskOf(state, taskId).dueDate, '2025-01-01');
  assert.equal(runOf(state, taskId).dueDate, scheduled.dueDate);
  dispatch(state, 'task.update', { taskId, dueDate: '2026-12-31' });
  assert.equal(taskOf(state, taskId).dueDate, '2026-12-31');
  assert.equal(runOf(state, taskId).startDate, scheduled.startDate);
  assert.equal(runOf(state, taskId).dueDate, scheduled.dueDate);
  assert.deepEqual(runOf(state, taskId).workflowSnapshot, scheduled.workflowSnapshot);
  const view = getWorkspace(state, owner, now).tasks.find(task => task.id === taskId)!;
  assert.equal(view.dueDate, '2026-12-31');
  assert.equal(view.cycleDueDate, '2026-11-25');
});

test('deadline integration: both active and completed older runs retain cycle metadata without replacing a newer workflow', () => {
  const initial = createSeed(now);
  const taskId = createTask(initial);
  dispatch(initial, 'run.schedule', scheduleInput(initial, taskId));
  for (const status of ['in_progress', 'completed'] as const) {
    const state = structuredClone(initial);
    const task = taskOf(state, taskId), run = runOf(state, taskId);
    task.version += 1;
    task.workflow[0].title = '새 기준의 자료 작성';
    run.status = status;
    if (status === 'completed') run.steps.forEach(step => { step.status = 'completed'; });
    const workflow = structuredClone(task.workflow);
    const view = getWorkspace(state, owner, now).tasks.find(item => item.id === taskId)!;
    assert.equal(view.dueDate, '2025-01-01');
    assert.equal(view.cycleStartDate, '2026-11-20');
    assert.equal(view.cycleDueDate, '2026-11-25');
    assert.deepEqual(view.workflow, workflow);
  }
});

test('deadline integration: unmanaged legacy runs retain their business deadline synchronization', () => {
  const state = createSeed(now);
  const taskId = 'task-data';
  assert.equal(runOf(state, taskId).cycleManaged, undefined);
  dispatch(state, 'task.configure', { taskId, dueDate: '2026-12-31' }, 'u-support-member');
  assert.equal(taskOf(state, taskId).dueDate, '2026-12-31');
  assert.equal(runOf(state, taskId).dueDate, '2026-12-31');
  const view = getWorkspace(state, 'u-support-member', now).tasks.find(task => task.id === taskId)!;
  assert.equal(view.dueDate, '2026-12-31');
  assert.equal(view.cycleDueDate, '2026-12-31');
});

test('deadline integration: Seoul midnight changes overdue state even while the UTC day is unchanged', () => {
  const state = createSeed(now);
  const taskId = createTask(state, '2026-11-07');
  dispatch(state, 'run.schedule', scheduleInput(state, taskId));
  const beforeMidnight = new Date('2026-11-07T14:59:59Z');
  const afterMidnight = new Date('2026-11-07T15:00:00Z');
  assert.equal(koreaDate(beforeMidnight), '2026-11-07');
  assert.equal(koreaDate(afterMidnight), '2026-11-08');
  assert.equal(deadlineFor(state, taskId, beforeMidnight).overdue, false);
  assert.equal(deadlineFor(state, taskId, afterMidnight).overdue, true);
  assert.equal(deadlineFor(state, taskId, afterMidnight).cycleOverdue, false);
});

test('deadline integration: an elapsed cycle is separate from an unexpired business deadline', () => {
  const state = createSeed(now);
  const taskId = createTask(state, '2026-12-31');
  dispatch(state, 'run.schedule', scheduleInput(state, taskId, '2026-11-01', '2026-11-05'));
  assert.deepEqual(deadlineFor(state, taskId), { deadline: '2026-12-31', cycleDue: '2026-11-05', overdue: false, cycleOverdue: true });
});

test('deadline integration: audit records only schedules strictly beyond the task deadline', () => {
  const state = createSeed(now);
  const taskId = createTask(state, '2026-11-25');
  dispatch(state, 'run.schedule', scheduleInput(state, taskId));
  const first = state.audit.find(entry => entry.action === 'run.schedule' && entry.targetId === runOf(state, taskId).id)!;
  assert.doesNotMatch(first.detail, /업무 마감일 초과/);
  dispatch(state, 'run.schedule', scheduleInput(state, taskId, '2026-11-20', '2026-11-26'));
  const latest = state.audit.find(entry => entry.action === 'run.schedule' && entry.targetId === runOf(state, taskId).id)!;
  assert.match(latest.detail, /업무 마감일 초과.*2026-11-25.*2026-11-26/);
  assert.equal(taskOf(state, taskId).dueDate, '2026-11-25');
  assert.equal(runOf(state, taskId).dueDate, '2026-11-26');
});

test('deadline integration: a retained procedure draft cannot overwrite subsequently saved step schedules', () => {
  for (const initiallyScheduled of [false, true]) {
    const state = createSeed(now);
    const taskId = createTask(state);
    if (initiallyScheduled) dispatch(state, 'run.schedule', scheduleInput(state, taskId, '2026-11-10', '2026-11-15'));
    // The procedure editor retains this local draft while its schedule tab saves.
    const draft = structuredClone(getWorkspace(state, owner, now).tasks.find(task => task.id === taskId)!.workflow);
    draft[0].description = '작성 중이던 절차 설명을 보충합니다.';
    const input = scheduleInput(state, taskId);
    input.steps = input.steps.map(step => ({ ...step, scheduleDetails: `${step.stepId}의 새로 저장한 일정 메모` }));
    dispatch(state, 'run.schedule', input);
    const savedRun = structuredClone(runOf(state, taskId));
    dispatch(state, 'task.configure', { taskId, workflow: draft });
    const updatedRun = runOf(state, taskId);
    assert.equal(updatedRun.startDate, savedRun.startDate);
    assert.equal(updatedRun.dueDate, savedRun.dueDate);
    for (const step of savedRun.workflowSnapshot!) {
      const updated = updatedRun.workflowSnapshot!.find(item => item.id === step.id)!;
      assert.equal(updated.startDate, step.startDate, `${step.id} must retain its latest start date`);
      assert.equal(updated.dueDate, step.dueDate, `${step.id} must retain its latest end date`);
      assert.equal(updated.scheduleDetails, step.scheduleDetails, `${step.id} must retain its latest schedule memo`);
    }
    assert.equal(updatedRun.workflowSnapshot![0].description, draft[0].description);
    assert.equal(taskOf(state, taskId).dueDate, '2025-01-01');
  }
});

test('deadline integration: schedule preservation still rejects edits to a completed procedure', () => {
  const state = createSeed(now);
  const taskId = createTask(state);
  dispatch(state, 'run.schedule', scheduleInput(state, taskId));
  dispatch(state, 'task.setProgress', { taskId, stepId: 'prepare', done: true });
  const completed = structuredClone(runOf(state, taskId).steps[0]);
  const draft = structuredClone(getWorkspace(state, owner, now).tasks.find(task => task.id === taskId)!.workflow);
  draft[1].description = '미완료 검토 절차만 보충합니다.';
  dispatch(state, 'task.configure', { taskId, workflow: draft });
  assert.deepEqual(runOf(state, taskId).steps[0], completed);
  const invalid = structuredClone(draft);
  invalid[0].description = '완료된 절차를 변경하려는 입력';
  const before = JSON.stringify(state);
  assert.throws(() => dispatch(state, 'task.configure', { taskId, workflow: invalid }), error => error instanceof DomainError && error.code === 'COMPLETED_STEP_LOCKED');
  assert.equal(JSON.stringify(state), before);
});

test('deadline integration: procedure display reordering preserves execution dates, dependencies and memos', () => {
  const state = createSeed(now);
  const taskId = createTask(state, '2026-12-31');
  const [prepare, review] = taskOf(state, taskId).workflow;
  dispatch(state, 'task.configure', { taskId, workflow: [
    prepare,
    { ...prepare, id: 'write', title: '내용 작성', dependsOn: ['prepare'] },
    { ...prepare, id: 'share', title: '내용 공유', dependsOn: ['write'] },
    { ...review, dependsOn: ['share'] },
  ] });
  const input = scheduleInput(state, taskId, '2026-11-10', '2026-11-17');
  input.steps = input.steps.map((step, index) => ({ ...step, startDate: `2026-11-${10 + index * 2}`, dueDate: `2026-11-${11 + index * 2}`, scheduleDetails: `${step.stepId} 최신 일정 메모` }));
  dispatch(state, 'run.schedule', input);
  const saved = structuredClone(runOf(state, taskId));
  const draft = getWorkspace(state, owner, now).tasks.find(task => task.id === taskId)!.workflow;
  const reordered = moveProcedureStep(draft, 'share', 'up');
  assert.deepEqual(reordered.clearedScheduleIds, []);
  dispatch(state, 'task.configure', { taskId, workflow: reordered.workflow });
  const run = runOf(state, taskId);
  assert.equal(run.startDate, saved.startDate);
  assert.equal(run.dueDate, saved.dueDate);
  assert.deepEqual(run.steps.map(step => step.stepId), ['prepare', 'share', 'write', 'review']);
  for (const step of saved.workflowSnapshot!) {
    const updated = run.workflowSnapshot!.find(item => item.id === step.id)!;
    assert.equal(updated.startDate, step.startDate);
    assert.equal(updated.dueDate, step.dueDate);
    assert.deepEqual(updated.dependsOn, step.dependsOn);
    assert.equal(updated.scheduleDetails, step.scheduleDetails);
  }
});
