import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { canReadAttachment, DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import { getUnitEvaluation, getUnitScorePlan, scoreUnitsForPeriod } from '../src/lib/unit-evaluation';
import type { Attachment, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-07T03:00:00Z');
const owner = 'u-support-member', head = 'u-support-head', taskId = 'task-data', period = '2026-H2';
function fixture() {
  const state = createSeed(now); state.performances = []; state.handovers = [];
  for (const step of state.tasks.find(task => task.id === taskId)!.workflow) step.done = false;
  for (const run of state.runs.filter(run => run.taskId === taskId)) {
    run.status = 'scheduled';
    for (const step of run.steps) { step.status = 'pending'; for (const item of step.checklist) item.done = false; }
  }
  return state;
}
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) {
  executeCommand(state, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now);
}
function file(state: WorkspaceData, linkedTaskId = taskId): Attachment {
  const attachment: Attachment = { id: randomUUID(), taskId: linkedTaskId, name: '참고 자료.pdf', size: 12, mime: 'application/pdf', sha256: 'a'.repeat(64), storageKey: 'test.bin', status: 'quarantined', uploadedBy: owner, createdAt: now.toISOString() };
  state.attachments.push(attachment); return attachment;
}
function rejectsUnchanged(state: WorkspaceData, code: string, action: () => void) {
  const before = structuredClone(state);
  assert.throws(action, cause => cause instanceof DomainError && cause.code === code);
  assert.deepEqual(state, before);
}
function submit(state: WorkspaceData) {
  const task = state.tasks.find(task => task.id === taskId)!;
  dispatch(state, owner, 'performance.setWeights', { period, allocations: scoreUnitsForPeriod(state, owner, period).map(unit => ({ unitId: unit.id, maxScore: unit.id === task.unitId ? 50 : 0 })) });
  dispatch(state, owner, 'performance.submitPerson', { period, planVersion: getUnitScorePlan(state, owner, period)!.version });
}

test('procedure files: links survive task versions, active schedules and procedure replacement history', () => {
  const state = fixture(), attachment = file(state), task = state.tasks.find(task => task.id === taskId)!;
  const workflow = task.workflow.map((step, index) => ({ ...step, attachmentIds: index ? [] : [attachment.id] }));
  dispatch(state, owner, 'task.configure', { taskId, workflow });
  assert.deepEqual(task.workflow[0].attachmentIds, [attachment.id]);
  assert.deepEqual(task.versions.at(-1)!.workflow[0].attachmentIds, [attachment.id]);
  const run = state.runs.find(run => run.taskId === taskId && run.status !== 'completed')!;
  assert.deepEqual(run.workflowSnapshot![0].attachmentIds, [attachment.id]);
  dispatch(state, owner, 'task.procedure.replace', { taskId, workflow: workflow.map(step => ({ ...step, attachmentIds: [] })), reason: '다음 절차로 자료 정리' });
  assert.deepEqual(run.procedureHistory!.at(-1)!.workflowSnapshot[0].attachmentIds, [attachment.id]);
  assert.deepEqual(run.workflowSnapshot![0].attachmentIds, []);
  assert.ok(state.attachments.some(item => item.id === attachment.id));
});

test('procedure files: missing, foreign and duplicate links fail before modifying the procedure', () => {
  const state = fixture(), own = file(state), foreign = file(state, 'task-budget'), task = state.tasks.find(task => task.id === taskId)!;
  for (const type of ['task.configure', 'task.procedure.replace']) {
    for (const attachmentId of ['missing', foreign.id]) rejectsUnchanged(state, 'PROCEDURE_ATTACHMENT_INVALID', () => dispatch(state, owner, type, { taskId, workflow: task.workflow.map(step => ({ ...step, attachmentIds: [own.id, attachmentId] })) }));
    rejectsUnchanged(state, 'PROCEDURE_ATTACHMENT_DUPLICATE', () => dispatch(state, owner, type, { taskId, workflow: task.workflow.map(step => ({ ...step, attachmentIds: [own.id, own.id] })) }));
  }
});

test('procedure files: completed-step evidence stays frozen while omitted links survive legacy saves', () => {
  const state = fixture(), attachment = file(state), task = state.tasks.find(task => task.id === taskId)!;
  dispatch(state, owner, 'task.configure', { taskId, workflow: task.workflow.map((step, index) => ({ ...step, attachmentIds: index ? [] : [attachment.id] })) });
  task.workflow[0].done = true;
  rejectsUnchanged(state, 'COMPLETED_STEP_LOCKED', () => dispatch(state, owner, 'task.configure', { taskId, workflow: task.workflow.map(step => ({ ...step, attachmentIds: [] })) }));
  dispatch(state, owner, 'task.configure', { taskId, workflow: task.workflow.map(({ attachmentIds: _files, ...step }) => step) });
  assert.deepEqual(task.workflow[0].attachmentIds, [attachment.id]);
});

test('performance files: 500 characters save without title or evidence, and content alone can be submitted', () => {
  const state = fixture(), attachment = file(state), task = state.tasks.find(task => task.id === taskId)!;
  dispatch(state, owner, 'performance.saveHalf', { taskId, period, description: '성'.repeat(500), attachmentIds: [attachment.id] });
  const record = state.performances[0];
  assert.equal(record.title, task.title); assert.equal(record.evidence, ''); assert.deepEqual(record.attachmentIds, [attachment.id]);
  rejectsUnchanged(state, 'VALIDATION_ERROR', () => dispatch(state, owner, 'performance.saveHalf', { taskId, period, description: '성'.repeat(501) }));
  rejectsUnchanged(state, 'VALIDATION_ERROR', () => dispatch(state, owner, 'performance.saveHalf', { taskId, period, description: '  ' }));
  dispatch(state, owner, 'performance.saveHalf', { taskId, period, description: '파일 없이 성과 내용만 작성', attachmentIds: [] });
  assert.deepEqual(record.attachmentIds, []);
  submit(state); assert.equal(record.status, 'review');
});

test('performance files: linking enforces task scope and preserves omitted legacy evidence', () => {
  const state = fixture(), own = file(state), foreign = file(state, 'task-budget');
  const input = { taskId, period, description: '성과 내용' };
  dispatch(state, owner, 'performance.saveHalf', { ...input, evidence: '기존에 작성한 근거', attachmentIds: [own.id] });
  for (const attachmentId of ['missing', foreign.id]) rejectsUnchanged(state, 'PERFORMANCE_ATTACHMENT_INVALID', () => dispatch(state, owner, 'performance.saveHalf', { ...input, attachmentIds: [attachmentId] }));
  rejectsUnchanged(state, 'PERFORMANCE_ATTACHMENT_DUPLICATE', () => dispatch(state, owner, 'performance.saveHalf', { ...input, attachmentIds: [own.id, own.id] }));
  dispatch(state, owner, 'performance.saveHalf', { ...input, description: '내용만 수정' });
  assert.equal(state.performances[0].evidence, '기존에 작성한 근거'); assert.deepEqual(state.performances[0].attachmentIds, [own.id]);
});

test('performance files: legacy run create and resubmit accept files and enforce the same content limit', () => {
  const state = fixture(), attachment = file(state), run = state.runs.find(run => run.taskId === taskId)!;
  const input = { taskId, runId: run.id, description: '완료한 성과', attachmentIds: [attachment.id] };
  dispatch(state, owner, 'performance.create', input);
  const record = state.performances[0]; assert.deepEqual(record.attachmentIds, [attachment.id]);
  dispatch(state, head, 'performance.requestChanges', { performanceId: record.id });
  rejectsUnchanged(state, 'VALIDATION_ERROR', () => dispatch(state, owner, 'performance.resubmit', { performanceId: record.id, description: '성'.repeat(501) }));
  dispatch(state, owner, 'performance.resubmit', { performanceId: record.id, description: '보완한 성과' });
  assert.deepEqual(record.attachmentIds, [attachment.id]); assert.equal(record.status, 'review');
  dispatch(state, owner, 'performance.create', { ...input, description: '별도로 수행한 성과', attachmentIds: [] });
  assert.equal(state.performances.length, 2);
});

test('performance files: evaluated snapshots retain evidence access after transfer without granting task access', () => {
  const state = fixture(), evidence = file(state), unrelated = file(state);
  dispatch(state, owner, 'performance.saveHalf', { taskId, period, description: '인계 전에 완료한 성과', attachmentIds: [evidence.id] });
  submit(state);
  const plan = getUnitScorePlan(state, owner, period)!;
  dispatch(state, head, 'performance.evaluatePerson', { personId: owner, period, planVersion: plan.version, scores: plan.allocations.map(unit => ({ unitId: unit.unitId, score: unit.maxScore })), comment: '성과 확인' });
  const evaluation = getUnitEvaluation(state, owner, period)!;
  assert.deepEqual(evaluation.performanceSnapshot[0].attachmentIds, [evidence.id]);
  const task = state.tasks.find(task => task.id === taskId)!;
  Object.assign(task, { primaryId: 'u-seoyeon', supportIds: [], reviewerId: 'u-head', departmentId: 'dept-plan' });
  for (const run of state.runs.filter(run => run.taskId === taskId)) Object.assign(run, { primaryId: 'u-seoyeon', supportIds: [], reviewerId: 'u-head', departmentId: 'dept-plan' });
  state.performances[0].attachmentIds = [];
  for (const actor of [owner, head]) {
    const workspace = getWorkspace(state, actor, now);
    assert.ok(!workspace.tasks.some(task => task.id === taskId));
    assert.ok(workspace.attachments.some(file => file.id === evidence.id));
    assert.ok(!workspace.attachments.some(file => file.id === unrelated.id));
    assert.equal(canReadAttachment(state, state.users.find(user => user.id === actor)!, evidence, now), true);
  }
  assert.equal(canReadAttachment(state, state.users.find(user => user.id === 'u-doyun')!, evidence, now), false);
});
