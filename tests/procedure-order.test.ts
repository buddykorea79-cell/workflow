import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { executeCommand, getWorkspace } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import { appendProcedureStep, canMoveProcedureStep, canRemoveProcedureStep, moveProcedureStep, procedureOrderStart, removeProcedureStep } from '../src/lib/procedure-order';
import { runWorkflow } from '../src/lib/work-cycles';
import type { WorkflowStep, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-07T03:00:00Z');
const owner = 'u-seoyeon';
function dispatch(state: WorkspaceData, type: string, payload: Record<string, unknown>) {
  executeCommand(state, owner, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now);
}
function workflow(): WorkflowStep[] {
  return ['prepare', 'write', 'share', 'review'].map((id, index) => ({ id, title: `${id} 절차`, role: id === 'review' ? 'reviewer' : 'primary', description: `${id} 수행 방법`, output: `${id} 결과물`, required: true, dependsOn: index ? [['prepare', 'write', 'share'][index - 1]] : [], checklist: [`${id} 확인`], done: false }));
}
function fixture(scheduled = false) {
  const state = createSeed(now);
  dispatch(state, 'task.create', { title: '절차 순서 조정 검증', description: '수정한 순서로 절차도와 수행 흐름을 함께 저장합니다.', unitId: 'unit-record', primaryId: owner, supportIds: [], dueDate: '2026-11-30', frequency: 'monthly', workflow: workflow() });
  const task = state.tasks[0];
  if (scheduled) dispatch(state, 'run.schedule', { taskId: task.id, title: '11월 수행', startDate: '2026-11-01', dueDate: '2026-11-30', steps: task.workflow.map((step, index) => ({ stepId: step.id, startDate: `2026-11-0${index * 2 + 1}`, dueDate: `2026-11-0${index * 2 + 2}`, scheduleDetails: `${step.id} 일정 메모` })) });
  return { state, task };
}

test('manual order persists as the procedure graph and execution order, without mutating the source draft', () => {
  const { state, task } = fixture(true);
  const draft = getWorkspace(state, owner, now).tasks.find(item => item.id === task.id)!.workflow;
  const before = structuredClone(draft);
  const result = moveProcedureStep(draft, 'share', 'up');
  assert.equal(result.changed, true);
  assert.deepEqual(draft, before);
  assert.deepEqual(result.workflow.map(step => step.id), ['prepare', 'share', 'write', 'review']);
  assert.deepEqual(result.workflow.map(step => step.dependsOn), [[], ['prepare'], ['share'], ['write']]);
  dispatch(state, 'task.configure', { taskId: task.id, workflow: result.workflow });
  const run = state.runs.find(run => run.taskId === task.id)!;
  assert.deepEqual(run.steps.map(step => step.stepId), result.workflow.map(step => step.id));
  assert.deepEqual(runWorkflow(task, run), task.workflow);
  assert.deepEqual(getWorkspace(state, owner, now).tasks.find(item => item.id === task.id)!.workflow, task.workflow);
  assert.deepEqual(task.versions.at(-2)!.workflow.map(step => step.id), before.map(step => step.id));
});

test('reordering preserves completed execution, notes, attachment links and historical runs', () => {
  const { state, task } = fixture(true);
  state.attachments.push({ id: 'order-reference', taskId: task.id, name: '참고.txt', size: 12, mime: 'text/plain', sha256: 'a'.repeat(64), storageKey: 'order-reference', status: 'quarantined', uploadedBy: owner, createdAt: now.toISOString() });
  dispatch(state, 'task.configure', { taskId: task.id, workflow: getWorkspace(state, owner, now).tasks.find(item => item.id === task.id)!.workflow.map(step => ({ ...step, attachmentIds: ['order-reference'] })) });
  const run = state.runs.find(run => run.taskId === task.id)!;
  dispatch(state, 'task.setProgress', { taskId: task.id, stepId: 'prepare', done: true });
  dispatch(state, 'run.note', { runId: run.id, body: '완료한 자료 준비 기록' });
  const completed = structuredClone(run.steps[0]);
  const completedDefinition = structuredClone(task.workflow[0]);
  const notes = structuredClone(run.notes);
  const oldRun = { ...structuredClone(run), id: 'older-order-run', startedAt: '2026-10-01T00:00:00Z', status: 'completed' as const };
  state.runs.push(structuredClone(oldRun));
  const result = moveProcedureStep(task.workflow, 'share', 'up');
  dispatch(state, 'task.configure', { taskId: task.id, workflow: result.workflow });
  assert.deepEqual(task.workflow[0], completedDefinition);
  assert.deepEqual(run.steps[0], completed);
  assert.deepEqual(run.notes, notes);
  assert.deepEqual(state.runs.find(item => item.id === oldRun.id), oldRun);
  for (const step of task.workflow) {
    assert.deepEqual(step.attachmentIds, ['order-reference']);
    assert.equal(step.output, `${step.id} 결과물`);
    assert.deepEqual(step.checklist, [`${step.id} 확인`]);
  }
});

test('completed prefix remains fixed even when a legacy parallel step in the prefix is unfinished', () => {
  const draft = workflow(); draft[1].done = true; draft[1].dependsOn = [];
  assert.equal(procedureOrderStart(draft), 2);
  assert.equal(canMoveProcedureStep(draft, 'prepare', 'down'), false);
  assert.equal(canMoveProcedureStep(draft, 'share', 'up'), false);
  assert.equal(canRemoveProcedureStep(draft, 'prepare'), false);
  assert.equal(canRemoveProcedureStep(draft, 'write'), false);
  assert.equal(moveProcedureStep(draft, 'write', 'down').changed, false);
  assert.equal(removeProcedureStep(draft, 'prepare').changed, false);
  const result = moveProcedureStep(draft, 'review', 'up');
  assert.deepEqual(result.workflow.slice(0, 2), draft.slice(0, 2));
  assert.deepEqual(result.workflow.slice(2).map(step => step.dependsOn), [['write'], ['review']]);
});

test('only schedules conflicting with the new order are cleared and reported; other dates and memos stay attached to their steps', () => {
  const { state, task } = fixture(true);
  const draft = getWorkspace(state, owner, now).tasks.find(item => item.id === task.id)!.workflow;
  const before = structuredClone(draft);
  const result = moveProcedureStep(draft, 'share', 'up');
  assert.deepEqual(result.clearedScheduleIds, ['write']);
  for (const step of result.workflow) {
    const previous = before.find(item => item.id === step.id)!;
    assert.equal(step.scheduleDetails, previous.scheduleDetails);
    assert.equal(step.startDate, step.id === 'write' ? undefined : previous.startDate);
    assert.equal(step.dueDate, step.id === 'write' ? undefined : previous.dueDate);
  }
  dispatch(state, 'task.configure', { taskId: task.id, workflow: result.workflow });
  const run = state.runs.find(item => item.taskId === task.id)!;
  assert.equal(run.startDate, '2026-11-01'); assert.equal(run.dueDate, '2026-11-30');
  assert.equal(run.workflowSnapshot!.find(step => step.id === 'write')!.startDate, undefined);
  dispatch(state, 'run.schedule', { taskId: task.id, runId: run.id, startDate: run.startDate, dueDate: run.dueDate, steps: result.workflow.map(step => ({ stepId: step.id, startDate: step.startDate, dueDate: step.dueDate, scheduleDetails: step.scheduleDetails })) });
});

test('manual additions and removals reconnect the saved sequence without removing unrelated metadata', () => {
  const { state, task } = fixture();
  const added = appendProcedureStep(task.workflow, { id: 'followup', title: '후속 안내', role: 'primary', description: '결과를 안내합니다.', output: '', required: true, checklist: [], dependsOn: [], attachmentIds: [] });
  assert.equal(added.changed, true); assert.deepEqual(added.workflow.at(-1)!.dependsOn, ['review']);
  const removed = removeProcedureStep(added.workflow, 'write');
  assert.deepEqual(removed.workflow.map(step => step.id), ['prepare', 'share', 'review', 'followup']);
  assert.deepEqual(removed.workflow.map(step => step.dependsOn), [[], ['prepare'], ['share'], ['review']]);
  dispatch(state, 'task.configure', { taskId: task.id, workflow: removed.workflow });
  assert.deepEqual(task.workflow.map(step => step.dependsOn), removed.workflow.map(step => step.dependsOn));
  assert.equal(appendProcedureStep(task.workflow, task.workflow[0]).changed, false);
  assert.equal(removeProcedureStep(task.workflow, 'missing').changed, false);
  assert.equal(moveProcedureStep(task.workflow, 'prepare', 'up').changed, false);
  assert.equal(moveProcedureStep(task.workflow, 'followup', 'down').changed, false);
});

test('manual ordering handles one-sided dates and enforces the procedure count limit', () => {
  const draft = workflow();
  draft[1].startDate = '2026-11-02'; draft[2].dueDate = '2026-11-05';
  const result = moveProcedureStep(draft, 'share', 'up');
  assert.deepEqual(result.clearedScheduleIds, ['write']);
  assert.equal(result.workflow.find(step => step.id === 'share')!.dueDate, '2026-11-05');
  const full = Array.from({ length: 50 }, (_, index) => ({ ...draft[0], id: `full-${index}` }));
  assert.equal(appendProcedureStep(full, { ...draft[0], id: 'overflow' }).changed, false);
  assert.equal(canRemoveProcedureStep([draft[0]], draft[0].id), false);
});
