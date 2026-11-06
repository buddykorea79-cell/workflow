import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-05T03:00:00Z');
const sourceId = 'u-support-member';
const headId = 'u-support-head';
const recipientId = 'u-transfer-new';
const taskId = 'task-data';

function fixture() {
  const state = createSeed(now);
  state.handovers = [];
  state.users.push({ ...state.users.find(user => user.id === sourceId)!, id: recipientId, name: '후임', initials: '후' });
  return state;
}
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, offsetMinutes = 0) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, new Date(now.getTime() + offsetMinutes * 60_000));
  Object.assign(state, candidate);
}
function request(state: WorkspaceData) {
  dispatch(state, sourceId, 'transfer.request', { departmentId: 'dept-support', fromId: sourceId, toId: recipientId, taskIds: [taskId], reason: '인사이동 후 업무 인계' });
  return state.workTransfers![0].id;
}
const task = (state: WorkspaceData) => state.tasks.find(item => item.id === taskId)!;
const run = (state: WorkspaceData) => state.runs.find(item => item.taskId === taskId)!;
function rejectApproval(state: WorkspaceData, transferId: string, code = 'TRANSFER_TASK_CHANGED') {
  const before = structuredClone(state);
  assert.throws(() => dispatch(state, headId, 'transfer.approve', { transferId }, 5), error => error instanceof DomainError && error.code === code);
  assert.deepEqual(state, before, 'failed approval must not partially assign work');
}

test('phase 1 transfer: progress after a request remains approvable with original execution authors', () => {
  const state = fixture();
  const transferId = request(state);
  const step = run(state).steps.find(item => item.stepId === 's2')!;
  dispatch(state, sourceId, 'run.check', { runId: run(state).id, stepId: step.stepId, checkId: step.checklist[0].id, done: true }, 1);
  const latestExecution = structuredClone(run(state));
  assert.notEqual(task(state).updatedAt, state.workTransfers![0].tasks[0].updatedAt);
  dispatch(state, headId, 'transfer.approve', { transferId }, 2);
  assert.equal(task(state).primaryId, recipientId);
  assert.equal(run(state).primaryId, recipientId);
  assert.deepEqual(run(state).steps, latestExecution.steps);
  assert.equal(run(state).steps[1].checklist[0].completedBy, sourceId);
});

test('phase 1 transfer: notes and current run schedule are carried forward at approval', () => {
  const state = fixture();
  const transferId = request(state);
  dispatch(state, sourceId, 'run.note', { runId: run(state).id, body: '승인 대기 중 확인한 미결 사항' }, 1);
  dispatch(state, sourceId, 'run.schedule', {
    taskId, runId: run(state).id, title: '인계 전 조정한 수행 일정',
    startDate: '2026-11-05', dueDate: '2026-11-20', scheduleDetails: '후임에게 최신 일정으로 전달',
    steps: task(state).workflow.map(step => ({ stepId: step.id, startDate: step.startDate, dueDate: step.id === 's4' ? '2026-11-20' : step.dueDate })),
  }, 2);
  const latestExecution = structuredClone(run(state));
  dispatch(state, headId, 'transfer.approve', { transferId }, 3);
  assert.equal(run(state).dueDate, '2026-11-20');
  assert.equal(run(state).title, latestExecution.title);
  assert.deepEqual(run(state).workflowSnapshot, latestExecution.workflowSnapshot);
  assert.deepEqual(run(state).notes, latestExecution.notes);
});

test('phase 1 transfer: a cycle finished while approval is pending remains with its actual performer', () => {
  const state = fixture();
  const transferId = request(state);
  for (const stepId of ['s2', 's3', 's4']) {
    const step = run(state).steps.find(item => item.stepId === stepId)!;
    const actor = step.role === 'reviewer' ? headId : sourceId;
    for (const check of step.checklist) dispatch(state, actor, 'run.check', { runId: run(state).id, stepId, checkId: check.id, done: true }, 1);
    dispatch(state, actor, 'run.completeStep', { runId: run(state).id, stepId, output: `${step.title} 결과 확인` }, 2);
  }
  const completed = structuredClone(run(state));
  assert.equal(completed.status, 'completed');
  dispatch(state, headId, 'transfer.approve', { transferId }, 3);
  assert.equal(task(state).primaryId, recipientId);
  assert.deepEqual(run(state), completed);
  assert.deepEqual(state.workTransfers![0].runIds, []);
});

test('phase 1 transfer: a new confirmed definition still invalidates the request', () => {
  const state = fixture();
  const transferId = request(state);
  dispatch(state, sourceId, 'task.configure', { taskId, description: '검토 범위가 변경된 업무 기준' }, 1);
  rejectApproval(state, transferId, 'TRANSFER_RUN_CHANGED');
});

test('phase 1 transfer: draft edits without a version increment still invalidate the request', () => {
  for (const changes of [{ title: '인수 범위가 달라진 세부업무' }, { dueDate: '2026-11-25' }, { description: '인수 범위가 달라진 업무 설명' }]) {
    const state = fixture();
    task(state).status = 'revision';
    const transferId = request(state);
    const version = task(state).version;
    dispatch(state, sourceId, 'task.update', { taskId, ...changes }, 1);
    assert.equal(task(state).version, version);
    rejectApproval(state, transferId);
  }
});

test('phase 1 transfer: produced documents and expenses do not alter the agreed definition', () => {
  const state = fixture();
  const transferId = request(state);
  // Execution records have their own command/history; they never publish a definition.
  task(state).expenses!.push({ id: 'expense-execution', date: '2026-11-05', description: '승인 대기 중 집행', amount: 1000 });
  task(state).references!.push({ id: 'document-execution', type: 'document', title: '최신 수행 보고서', content: '인계 시 함께 전달할 결과' });
  task(state).updatedAt = new Date(now.getTime() + 60_000).toISOString();
  dispatch(state, headId, 'transfer.approve', { transferId }, 2);
  assert.ok(task(state).expenses!.some(item => item.id === 'expense-execution'));
  assert.ok(task(state).references!.some(item => item.id === 'document-execution'));
});

test('phase 1 transfer: a changed legal basis still invalidates the request without a version bump', () => {
  const state = fixture();
  const transferId = request(state);
  task(state).references![0].content = '다른 법령 근거';
  rejectApproval(state, transferId);
});

test('phase 1 transfer: older pending requests remain conservative when no definition fingerprint exists', () => {
  const state = fixture();
  const transferId = request(state);
  delete state.workTransfers![0].tasks[0].definitionFingerprint;
  const unchanged = structuredClone(state);
  dispatch(unchanged, headId, 'transfer.approve', { transferId }, 1);
  assert.equal(task(unchanged).primaryId, recipientId);
  task(state).updatedAt = new Date(now.getTime() + 60_000).toISOString();
  rejectApproval(state, transferId);
});

test('phase 1 transfer: the moved participant retains past-department records without other colleagues records', () => {
  const state = fixture();
  const transferId = request(state);
  dispatch(state, headId, 'transfer.approve', { transferId }, 1);
  state.users.find(user => user.id === sourceId)!.departmentId = 'dept-plan';
  const ownHistory = getWorkspace(state, sourceId, now).workTransfers!;
  assert.ok(ownHistory.some(item => item.id === transferId));
  assert.ok(!getWorkspace(state, 'u-jiho', now).workTransfers!.some(item => item.id === transferId));
});
