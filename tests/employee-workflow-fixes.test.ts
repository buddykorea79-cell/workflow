import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { executeCommand, DomainError, getWorkspace } from '../src/lib/domain';
import { commandExpectation } from '../src/lib/command-targets';
import { taskProcedureParticipants } from '../src/lib/procedure-participants';
import type { WorkspaceData, WorkflowStep } from '../src/lib/types';

const now = new Date('2026-11-08T03:00:00Z');
const owner = 'u-innovation-member';
const head = 'u-innovation-head';
const isCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;
function send(state: WorkspaceData, type: string, payload: Record<string, unknown>, actor = owner) {
  const copy = structuredClone(state);
  executeCommand(copy, actor, { type, payload, expectedRevision: copy.revision, expected: commandExpectation(copy, type, payload, actor) ?? undefined, requestId: randomUUID() }, now);
  Object.assign(state, copy);
}
function fixture() {
  const state = createSeed(now);
  const step = (id: string, role: WorkflowStep['role'], dependsOn: string[] = []): WorkflowStep => ({ id, title: id, role, dependsOn, description: '수행 내용', required: true, checklist: [], output: '' });
  const workflow = [step('collect', 'primary'), step('evidence', 'primary'), step('review', 'reviewer', ['collect', 'evidence']), step('submit', 'primary', ['review'])];
  send(state, 'task.create', { title: '데이터 실적 관리', description: '실적과 증빙을 취합하고 검토한다.', primaryId: owner, unitId: 'unit-service', supportIds: [], frequency: 'once', dueDate: '2026-12-31', workflow });
  const taskId = state.tasks[0].id;
  return { state, taskId, workflow };
}
function schedule(f: ReturnType<typeof fixture>) {
  send(f.state, 'run.schedule', { taskId: f.taskId, startDate: '2026-11-08', dueDate: '2026-11-08', steps: f.workflow.map(step => ({ stepId: step.id, startDate: '2026-11-08', dueDate: '2026-11-08' })) });
  return f.state.runs.find(run => run.taskId === f.taskId)!.id;
}

test('employee fix: current configure saves supporters and cooperation departments into active runs without granting external access', () => {
  const f = fixture(); const runId = schedule(f);
  send(f.state, 'task.configure', { taskId: f.taskId, supportIds: ['u-innovation-manager'], cooperationDepartmentIds: ['dept-plan', 'dept-support'] });
  const task = f.state.tasks.find(task => task.id === f.taskId)!;
  const run = f.state.runs.find(run => run.id === runId)!;
  assert.deepEqual(task.supportIds, ['u-innovation-manager']); assert.deepEqual(run.supportIds, task.supportIds);
  assert.deepEqual(run.cooperationDepartmentIds, task.cooperationDepartmentIds);
  assert.deepEqual(task.versions.at(-1)!.cooperationDepartmentIds, task.cooperationDepartmentIds);
  const workspace = getWorkspace(f.state, owner, now);
  assert.equal(workspace.cooperationDepartments?.length, 3);
  assert.match(taskProcedureParticipants(workspace, task).support, /강담당.*기획재정담당관실.*데이터정보화담당관실/);
  assert.equal(getWorkspace(f.state, 'u-jiho', now).tasks.some(item => item.id === f.taskId), false);
});

test('employee fix: cooperation selections are validated and support assignment remains within the owning department', () => {
  const f = fixture();
  assert.throws(() => send(f.state, 'task.configure', { taskId: f.taskId, supportIds: ['u-jiho'] }), isCode('ASSIGNMENT_SCOPE'));
  for (const ids of [['absent'], ['dept-plan', 'dept-plan']]) assert.throws(() => send(f.state, 'task.configure', { taskId: f.taskId, cooperationDepartmentIds: ids }), isCode('COOPERATION_DEPARTMENT_INVALID'));
  assert.deepEqual(f.state.tasks.find(task => task.id === f.taskId)!.supportIds, []);
});

test('employee fix: a personal task can explicitly opt out of mandatory review and save a reviewer-free procedure', () => {
  const f = fixture();
  const workflow = f.workflow.filter(step => step.role !== 'reviewer').map(step => ({ ...step, dependsOn: step.id === 'submit' ? ['collect', 'evidence'] : step.dependsOn }));
  assert.throws(() => send(f.state, 'task.configure', { taskId: f.taskId, workflow }), isCode('REVIEW_REQUIRED'));
  send(f.state, 'task.configure', { taskId: f.taskId, reviewRequired: false, workflow });
  const task = f.state.tasks.find(task => task.id === f.taskId)!;
  assert.equal(task.reviewRequired, false); assert.equal(task.versions.at(-1)!.reviewRequired, false);
  assert.equal(task.workflow.some(step => step.role === 'reviewer'), false);
  assert.throws(() => send(f.state, 'task.configure', { taskId: f.taskId, reviewRequired: true }), isCode('REVIEW_REQUIRED'));
  assert.throws(() => send(f.state, 'task.update', { taskId: f.taskId, reviewRequired: true }), isCode('REVIEW_REQUIRED'));
});

test('employee fix: common work cannot opt out of the required review policy', () => {
  const state = createSeed(now);
  assert.throws(() => send(state, 'task.configure', { taskId: 'task-budget', reviewRequired: false }, 'u-minseo'), isCode('COMMON_REVIEW_REQUIRED'));
});

test('employee fix: completed output correction retains the old record, reopens dependent approval and can be reviewed again', () => {
  const f = fixture(); const runId = schedule(f);
  for (const step of f.workflow) send(f.state, 'run.completeStep', { runId, stepId: step.id, output: `${step.id} 원래 결과` }, step.role === 'reviewer' ? head : owner);
  assert.equal(f.state.runs.find(run => run.id === runId)!.status, 'completed');
  send(f.state, 'run.correctOutput', { runId, stepId: 'collect', previousOutput: 'collect 원래 결과', output: '교육 실적 13명으로 정정', reason: '집계 누락 1명 추가' });
  const run = f.state.runs.find(run => run.id === runId)!;
  assert.equal(run.status, 'review'); assert.equal(run.completedAt, undefined);
  assert.equal(run.steps.find(step => step.stepId === 'review')!.status, 'pending');
  assert.equal(run.steps.find(step => step.stepId === 'submit')!.status, 'completed');
  assert.equal(run.steps.find(step => step.stepId === 'collect')!.output, '교육 실적 13명으로 정정');
  assert.equal(run.outputCorrections![0].previousOutput, 'collect 원래 결과');
  assert.equal(run.outputCorrections![0].reopenedReviews[0].output, 'review 원래 결과');
  assert.equal(run.outputCorrections![0].correctedBy, owner);
  assert.equal(run.outputCorrections![0].previousRunStatus, 'completed');
  assert.equal(run.outputCorrections![0].previousRunCompletedAt, now.toISOString());
  assert.equal(f.state.audit[0].action, 'run.correctOutput');
  send(f.state, 'run.completeStep', { runId, stepId: 'review', output: '정정된 실적 재검토 완료' }, head);
  assert.equal(f.state.runs.find(run => run.id === runId)!.status, 'completed');
});

test('employee fix: correction rejects stale text, missing reasons, incomplete steps and unauthorized reviewers', () => {
  const f = fixture(); const runId = schedule(f);
  const payload = { runId, stepId: 'collect', previousOutput: '', output: '정정 결과', reason: '누락 수정' };
  assert.throws(() => send(f.state, 'run.correctOutput', payload), isCode('CORRECTION_NOT_COMPLETED'));
  send(f.state, 'run.completeStep', { runId, stepId: 'collect', output: '기존 결과' });
  assert.throws(() => send(f.state, 'run.correctOutput', payload), isCode('CORRECTION_CONFLICT'));
  assert.throws(() => send(f.state, 'run.correctOutput', { ...payload, previousOutput: '기존 결과' }, head), isCode('CORRECTION_DENIED'));
  assert.throws(() => send(f.state, 'run.correctOutput', { ...payload, previousOutput: '기존 결과', reason: '' }));
  assert.throws(() => send(f.state, 'run.correctOutput', { ...payload, previousOutput: '기존 결과', output: '기존 결과' }), isCode('CORRECTION_UNCHANGED'));
  assert.equal(f.state.runs.find(run => run.id === runId)!.outputCorrections, undefined);
});

test('employee fix: changing a result before review does not prematurely complete or reopen unrelated branches', () => {
  const f = fixture(); const runId = schedule(f);
  send(f.state, 'run.completeStep', { runId, stepId: 'collect', output: '기존 결과' });
  send(f.state, 'run.correctOutput', { runId, stepId: 'collect', previousOutput: '기존 결과', output: '새 결과', reason: '수치 보완' });
  send(f.state, 'task.configure', { taskId: f.taskId, supportIds: ['u-innovation-manager'] });
  const run = f.state.runs.find(run => run.id === runId)!;
  assert.equal(run.steps.find(step => step.stepId === 'evidence')!.status === 'completed', false);
  assert.equal(run.outputCorrections!.length, 1);
  assert.equal(run.outputCorrections![0].reopenedReviews.length, 0);
});

test('employee fix: a correction prepared before the next cycle cannot reopen an older completed run', () => {
  const f = fixture(); const runId = schedule(f);
  for (const step of f.workflow) send(f.state, 'run.completeStep', { runId, stepId: step.id, output: `${step.id} 원래 결과` }, step.role === 'reviewer' ? head : owner);
  send(f.state, 'run.nextCycle', { taskId: f.taskId, previousRunId: runId, startDate: '2026-11-09', dueDate: '2026-11-09', steps: f.workflow.map(step => ({ stepId: step.id, startDate: '2026-11-09', dueDate: '2026-11-09' })) });
  assert.throws(() => send(f.state, 'run.correctOutput', { runId, stepId: 'collect', previousOutput: 'collect 원래 결과', output: '뒤늦은 정정', reason: '새 회차 이후 정정' }), isCode('CYCLE_CHANGED'));
  assert.equal(f.state.runs.find(run => run.id === runId)!.status, 'completed');
  assert.equal(f.state.runs.find(run => run.id === runId)!.outputCorrections, undefined);
});
