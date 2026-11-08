import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { replaceProcedureDraft } from '../src/lib/procedure-draft';
import { taskExecution } from '../src/lib/common-status';
import { nextCycleWorkflow, runWorkflow } from '../src/lib/work-cycles';
import type { WorkflowStep, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-06T03:00:00Z');
const owner = 'u-seoyeon', manager = 'u-minseo', head = 'u-head', deputy = 'u-jiho';
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown> = {}, requestId = randomUUID(), expectedRevision = state.revision) {
  executeCommand(state, actor, { type, payload, requestId, expectedRevision }, now);
}
function fixture(schedule = false) {
  const state = createSeed(now);
  dispatch(state, owner, 'task.create', { title: '최종 절차 교체', description: '한 개의 최종 절차로 적용하고 수행 이력을 보존합니다.', unitId: 'unit-record', primaryId: owner, supportIds: [], frequency: 'monthly', dueDate: '2026-11-30' });
  const task = state.tasks[0];
  if (schedule) dispatch(state, owner, 'run.schedule', { taskId: task.id, title: '11월 실제 수행', startDate: '2026-11-06', dueDate: '2026-11-30', scheduleDetails: '기존 회차의 상세 일정', steps: task.workflow.map(step => ({ stepId: step.id })) });
  return { state, task };
}
function workflow(prefix = 'final'): WorkflowStep[] {
  return [{ id: `${prefix}-prepare`, title: '최종 자료 작성', role: 'primary', description: '선택한 근거에 따라 자료를 작성한다.', output: '자료', required: true, dependsOn: [], checklist: ['자료 확인'], done: true }, { id: `${prefix}-review`, title: '최종 자료 검토', role: 'reviewer', description: '결과를 검토한다.', output: '검토 의견', required: true, dependsOn: [`${prefix}-prepare`], checklist: ['결과 확인'], done: true }];
}
function denied(state: WorkspaceData, actor: string, payload: Record<string, unknown>, code: string) {
  const before = structuredClone(state);
  assert.throws(() => dispatch(state, actor, 'task.procedure.replace', payload), error => error instanceof DomainError && error.code === code);
  assert.deepEqual(state, before);
}

test('final procedure replaces the old list instead of appending and persists exactly one editable procedure', () => {
  const { state, task } = fixture(); const old = structuredClone(task.workflow), draft = workflow();
  const final = replaceProcedureDraft(draft); assert.ok(final.every(step => !step.done)); assert.ok(draft.every(step => step.done));
  final[0].title = '복사된 최종 자료 작성'; assert.notEqual(draft[0].title, final[0].title);
  const references = [{ id: 'source-final', type: 'guideline', title: '최종 지침', content: '자료를 작성하고 검토한다.' }];
  dispatch(state, owner, 'task.procedure.replace', { taskId: task.id, workflow: final, references });
  assert.deepEqual(task.workflow, final); assert.deepEqual(task.references, references);
  assert.deepEqual(task.versions[0].workflow, old); assert.deepEqual(task.versions.at(-1)!.workflow, final);
  const second = workflow('second'); dispatch(state, owner, 'task.procedure.replace', { taskId: task.id, workflow: second });
  assert.equal(task.workflow.length, 2); assert.deepEqual(task.workflow.map(step => step.id), second.map(step => step.id)); assert.deepEqual(task.references, references);
  const edited = structuredClone(task.workflow); edited[0].title = '저장되는 사용자 수정 절차';
  dispatch(state, owner, 'task.configure', { taskId: task.id, workflow: edited });
  assert.equal(getWorkspace(state, owner, now).tasks.find(item => item.id === task.id)!.workflow[0].title, edited[0].title);
  assert.ok(state.audit.some(event => event.action === 'task.procedure.replace' && event.targetId === task.id));
  assert.throws(() => replaceProcedureDraft([draft[0]]), /필수 검토/);
});

test('in-progress replacement retains the same cycle and archives all execution, notes and prior assignments', () => {
  const { state, task } = fixture(true); const run = state.runs.find(item => item.taskId === task.id)!;
  dispatch(state, owner, 'run.note', { runId: run.id, body: '이전 절차에서 확인한 사항' });
  dispatch(state, owner, 'task.setProgress', { taskId: task.id, stepId: task.workflow[0].id, done: true });
  const original = structuredClone(run), originalWorkflow = runWorkflow(task, run);
  const historical = structuredClone(run); historical.id = 'completed-history'; historical.startedAt = '2026-10-01T00:00:00Z'; historical.status = 'completed'; state.runs.push(historical);
  dispatch(state, owner, 'task.procedure.replace', { taskId: task.id, workflow: workflow(), reason: '근거를 재분석하여 최종 절차 확정' });
  assert.equal(run.id, original.id); assert.equal(run.title, original.title); assert.equal(run.period, original.period); assert.equal(run.startDate, original.startDate); assert.equal(run.dueDate, original.dueDate); assert.equal(run.scheduleDetails, original.scheduleDetails); assert.deepEqual(run.notes, original.notes);
  assert.equal(run.status, 'scheduled'); assert.equal(run.definitionVersion, task.version); assert.ok(run.steps.every(step => step.status === 'pending' && !step.output && !step.completedBy && step.checklist.every(check => !check.done)));
  const history = run.procedureHistory![0]; assert.equal(history.replacedBy, owner); assert.equal(history.reason, '근거를 재분석하여 최종 절차 확정'); assert.equal(history.primaryId, original.primaryId); assert.deepEqual(history.supportIds, original.supportIds); assert.equal(history.reviewerId, original.reviewerId);
  assert.deepEqual(history.steps, original.steps); assert.deepEqual(history.workflowSnapshot, originalWorkflow); assert.deepEqual(history.notes, original.notes);
  assert.deepEqual(state.runs.find(item => item.id === historical.id), historical);
  assert.equal(taskExecution(state, task).progress, 0); assert.equal(getWorkspace(state, owner, now).tasks.find(item => item.id === task.id)!.workflow.length, 2);
  dispatch(state, owner, 'task.setProgress', { taskId: task.id, stepId: task.workflow[0].id, done: true });
  assert.equal(run.steps[0].completedBy, owner); assert.deepEqual(history.steps, original.steps);
});

test('paused cycles stay paused and prior people remain identifiable after personnel movement', () => {
  const { state, task } = fixture(true); const run = state.runs.find(item => item.taskId === task.id)!;
  run.status = 'paused'; run.notes.push({ id: 'note-before', authorId: deputy, body: '이전 지원자의 기록', createdAt: now.toISOString() }); run.supportIds = [deputy];
  dispatch(state, owner, 'task.procedure.replace', { taskId: task.id, workflow: workflow() });
  assert.equal(run.status, 'paused'); assert.equal(run.procedureHistory![0].status, 'paused');
  state.users.find(user => user.id === deputy)!.departmentId = 'dept-support'; run.supportIds = []; run.notes = [];
  const workspace = getWorkspace(state, owner, now); assert.ok(!workspace.users.some(user => user.id === deputy)); assert.ok(workspace.identities!.some(user => user.id === deputy));
});

test('completed cycles are immutable and the next cycle uses the newly applied procedure', () => {
  const { state, task } = fixture(true);
  for (const step of task.workflow) dispatch(state, step.role === 'reviewer' ? head : owner, 'task.setProgress', { taskId: task.id, stepId: step.id, done: true });
  const previous = structuredClone(state.runs.find(item => item.taskId === task.id)!);
  assert.equal(previous.status, 'completed');
  dispatch(state, owner, 'task.procedure.replace', { taskId: task.id, workflow: workflow() });
  assert.deepEqual(state.runs.find(run => run.id === previous.id), previous); assert.equal(taskExecution(state, task).progress, 0);
  dispatch(state, owner, 'run.nextCycle', { taskId: task.id, previousRunId: previous.id, startDate: '2026-12-01', dueDate: '2026-12-20', steps: nextCycleWorkflow(task).map(step => ({ stepId: step.id })) });
  assert.deepEqual(state.runs[0].steps.map(step => step.stepId), workflow().map(step => step.id)); assert.deepEqual(state.runs.find(run => run.id === previous.id), previous);
});

test('legacy task-only completion is preserved without inventing a historical completion actor', () => {
  for (const complete of [false, true]) {
    const { state, task } = fixture(); task.workflow.forEach((step, index) => { step.done = complete || index === 0; }); const old = structuredClone(task.workflow);
    dispatch(state, owner, 'task.procedure.replace', { taskId: task.id, workflow: workflow() });
    const run = state.runs.find(item => item.taskId === task.id)!;
    const steps = complete ? run.steps : run.procedureHistory![0].steps;
    assert.deepEqual(steps.map(step => step.status === 'completed'), old.map(step => !!step.done));
    assert.ok(steps.every(step => !step.completedBy && !step.completedAt)); assert.ok(task.workflow.every(step => !step.done));
  }
});

test('undated final procedures can replace overdue legacy and active execution without rewriting past schedules', () => {
  for (const scheduled of [false, true]) {
    const { state, task } = fixture(scheduled); task.dueDate = '2026-10-01';
    const existing = state.runs.find(run => run.taskId === task.id);
    if (existing) { existing.dueDate = task.dueDate; existing.startDate = '2026-11-06'; }
    dispatch(state, owner, 'task.setProgress', { taskId: task.id, stepId: task.workflow[0].id, done: true });
    dispatch(state, owner, 'task.procedure.replace', { taskId: task.id, workflow: workflow() });
    const run = state.runs.find(item => item.taskId === task.id)!;
    assert.equal(task.dueDate, '2026-10-01'); assert.equal(run.dueDate, '2026-10-01');
    if (scheduled) assert.equal(run.startDate, '2026-11-06');
    assert.equal(run.procedureHistory![0].dueDate, '2026-10-01'); assert.equal(run.procedureHistory![0].steps[0].status, 'completed');
    assert.deepEqual(task.workflow.map(step => step.id), workflow().map(step => step.id)); assert.ok(run.steps.every(step => step.status === 'pending'));
  }
});

test('procedure replacement keeps source ownership, readonly roles and confirmed department locks enforced atomically', () => {
  const { state, task } = fixture(); const payload = { taskId: task.id, workflow: workflow() };
  denied(state, 'u-support-member', payload, 'TASK_ACCESS_DENIED'); denied(state, head, payload, 'HEAD_DEFINITION_DENIED');
  dispatch(state, owner, 'delegation.request', { taskId: task.id, toId: deputy, startsAt: '2026-11-06T00:00:00Z', endsAt: '2026-11-20T00:00:00Z', reason: '수행 권한만 위임' });
  dispatch(state, head, 'delegation.approve', { delegationId: state.delegations[0].id });
  denied(state, deputy, payload, 'EDIT_DENIED');
  dispatch(state, head, 'department.confirm');
  for (const actor of [owner, manager, 'u-admin']) denied(state, actor, payload, 'DEPARTMENT_CONFIRMED');
});

test('common required stages remain mandatory and rejected replacements never alter any previous execution', () => {
  const state = createSeed(now), task = state.tasks.find(item => item.commonId === 'common-budget')!;
  denied(state, task.primaryId, { taskId: task.id, workflow: workflow() }, 'COMMON_REQUIRED_STEP');
  const preserved = task.workflow.map((step, index) => ({ ...step, id: `common-final-${index}`, dependsOn: index ? [`common-final-${index - 1}`] : [], startDate: undefined, dueDate: undefined, scheduleDetails: undefined }));
  dispatch(state, task.primaryId, 'task.procedure.replace', { taskId: task.id, workflow: preserved });
  assert.deepEqual(task.workflow.map(step => step.title), preserved.map(step => step.title)); assert.equal(task.workflow.length, preserved.length);
});

test('invalid references, cycles, missing review and out-of-cycle schedules cannot partially replace a procedure', () => {
  const { state, task } = fixture(true); const payload = { taskId: task.id, workflow: workflow() };
  denied(state, owner, { ...payload, references: [{ id: 'wrong-file', type: 'law', title: '다른 업무 파일', content: '', attachmentId: 'missing' }] }, 'REFERENCE_ATTACHMENT_INVALID');
  denied(state, owner, { ...payload, workflow: [workflow()[0]] }, 'REVIEW_REQUIRED');
  denied(state, owner, { ...payload, workflow: workflow().map(step => ({ ...step, dependsOn: [step.id] })) }, 'WORKFLOW_REFERENCE');
  denied(state, owner, { ...payload, workflow: workflow().map((step, index) => ({ ...step, dependsOn: [workflow()[1 - index].id] })) }, 'WORKFLOW_CYCLE');
  denied(state, owner, { ...payload, workflow: workflow().map(step => ({ ...step, dueDate: '2026-12-01' })) }, 'CYCLE_STEP_DATE_RANGE');
});

test('idempotent apply cannot duplicate histories and concurrent stale applies cannot overwrite newer edits', () => {
  const { state, task } = fixture(true), requestId = randomUUID(), revision = state.revision, expected = { kind: 'task' as const, id: task.id, rev: task.rev ?? 0 };
  const payload = { taskId: task.id, workflow: workflow() };
  dispatch(state, owner, 'task.procedure.replace', payload, requestId, revision); const applied = structuredClone(state);
  dispatch(state, owner, 'task.procedure.replace', payload, requestId, revision); assert.deepEqual(state, applied);
  assert.throws(() => dispatch(state, owner, 'task.procedure.replace', { ...payload, reason: '다른 요청' }, requestId, revision), error => error instanceof DomainError && error.code === 'IDEMPOTENCY_CONFLICT');
  assert.throws(() => executeCommand(state, owner, { type: 'task.procedure.replace', payload: { ...payload, workflow: workflow('stale') }, requestId: randomUUID(), expectedRevision: revision, expected }, now), error => error instanceof DomainError && error.code === 'TARGET_CONFLICT');
  assert.deepEqual(state, applied); assert.equal(state.runs.find(run => run.taskId === task.id)!.procedureHistory!.length, 1);
});
