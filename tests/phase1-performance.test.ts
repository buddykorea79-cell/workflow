import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { getUnitEvaluation, getUnitScorePlan, scoreUnitsForPeriod } from '../src/lib/unit-evaluation';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-05T03:00:00Z');
const author = 'u-support-member', head = 'u-support-head', manager = 'u-doyun', period = '2026-H2';
const input = { taskId: 'task-data', period, title: '전보 전 데이터 정비', description: '인계일까지 완료한 오류 정비', evidence: '인계 전 결과보고서' };
function fixture() { const state = createSeed(now); state.performances = []; state.handovers = []; return state; }
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now);
  Object.assign(state, candidate);
}
function reject(code: string, action: () => void) { assert.throws(action, cause => cause instanceof DomainError && cause.code === code); }
function transfer(state: WorkspaceData) { dispatch(state, manager, 'transfer.emergency', { departmentId: 'dept-support', fromId: author, toId: manager, reason: '인사발령으로 잔여 업무 보관' }); }
function weights(state: WorkspaceData) {
  const recordUnit = state.performances.find(record => record.authorId === author)!.unitId;
  dispatch(state, author, 'performance.setWeights', { period, allocations: scoreUnitsForPeriod(state, author, period).map(unit => ({ unitId: unit.id, maxScore: unit.id === recordUnit ? 50 : 0 })) });
}
function submit(state: WorkspaceData) { dispatch(state, author, 'performance.submitPerson', { period, planVersion: getUnitScorePlan(state, author, period)!.version }); }
function evaluation(state: WorkspaceData) {
  const plan = getUnitScorePlan(state, author, period)!;
  return { personId: author, period, planVersion: plan.version, scores: plan.allocations.map(unit => ({ unitId: unit.unitId, score: unit.maxScore ? 43 : 0 })), comment: '인계 전 성과를 확인함' };
}

test('phase1 performance: former author corrects only their existing record without regaining task access', () => {
  const state = fixture(); dispatch(state, author, 'performance.saveHalf', input);
  const original = structuredClone(state.performances[0]);
  transfer(state);
  assert.ok(!getWorkspace(state, author, now).tasks.some(task => task.id === input.taskId));
  const taskAfterTransfer = structuredClone(state.tasks.find(task => task.id === input.taskId));
  dispatch(state, author, 'performance.saveHalf', { ...input, description: '인계 전 성과를 보완했습니다.' });
  assert.equal(state.performances[0].id, original.id);
  assert.equal(state.performances[0].authorId, original.authorId);
  assert.equal(state.performances[0].departmentId, original.departmentId);
  assert.equal(state.performances[0].unitId, original.unitId);
  assert.equal(state.performances[0].description, '인계 전 성과를 보완했습니다.');
  assert.deepEqual(state.tasks.find(task => task.id === input.taskId), taskAfterTransfer);
  assert.ok(!getWorkspace(state, author, now).tasks.some(task => task.id === input.taskId));
  reject('TASK_ACCESS_DENIED', () => dispatch(state, author, 'performance.saveHalf', { ...input, period: '2027-H1' }));
  reject('TASK_ACCESS_DENIED', () => dispatch(state, 'u-seoyeon', 'performance.saveHalf', input));
});

test('phase1 performance: submitted allocation remains evaluable after all work and the person move', () => {
  const state = fixture(); dispatch(state, author, 'performance.saveHalf', input); weights(state); submit(state);
  const frozen = structuredClone(getUnitScorePlan(state, author, period));
  transfer(state); state.users.find(user => user.id === author)!.departmentId = 'dept-plan';
  reject('HEAD_EVALUATION_REQUIRED', () => dispatch(state, 'u-head', 'performance.evaluatePerson', evaluation(state)));
  dispatch(state, head, 'performance.evaluatePerson', evaluation(state));
  const result = getUnitEvaluation(state, author, period)!;
  assert.equal(result.departmentId, 'dept-support'); assert.equal(result.totalScore, 43);
  assert.deepEqual(result.scores.map(({ score: _score, comment: _comment, ...allocation }) => allocation), frozen!.allocations);
  assert.equal(result.performanceSnapshot[0].authorId, author);
  assert.equal(result.performanceSnapshot[0].description, input.description);
});

test('phase1 performance: old draft can be weighted and submitted after transfer without a previous plan', () => {
  const state = fixture(); dispatch(state, author, 'performance.saveHalf', input); transfer(state);
  state.users.find(user => user.id === author)!.departmentId = 'dept-plan';
  const projected = getWorkspace(state, author, now);
  assert.ok(!projected.tasks.some(task => task.id === input.taskId));
  assert.deepEqual(scoreUnitsForPeriod(projected, author, period).map(unit => unit.id), scoreUnitsForPeriod(state, author, period).map(unit => unit.id));
  weights(state); submit(state);
  assert.equal(getUnitScorePlan(state, author, period)?.departmentId, 'dept-support');
  assert.ok(state.notifications.some(notification => notification.userId === head && notification.title === '개인별 반기 성과 평가 요청'));
  dispatch(state, head, 'performance.evaluatePerson', evaluation(state));
  assert.equal(getUnitEvaluation(state, author, period)?.totalScore, 43);
});

test('phase1 performance: previous department sees the author identity and old evidence, not new department private data', () => {
  const state = fixture(); dispatch(state, author, 'performance.saveHalf', input); weights(state); transfer(state);
  state.users.find(user => user.id === author)!.departmentId = 'dept-plan';
  const oldHead = getWorkspace(state, head, now);
  assert.ok(oldHead.identities?.some(person => person.id === author));
  assert.ok(!oldHead.users.some(person => person.id === author));
  assert.ok(oldHead.performances.some(record => record.authorId === author));
  const newHead = getWorkspace(state, 'u-head', now);
  assert.ok(!newHead.performances.some(record => record.authorId === author));
  assert.ok(!newHead.unitScorePlans?.some(plan => plan.personId === author));
  assert.ok(!getWorkspace(state, manager, now).performances.some(record => record.authorId === author));
});

test('phase1 performance: withdrawal after transfer reopens own evidence and retains the evaluation department', () => {
  const state = fixture(); dispatch(state, author, 'performance.saveHalf', input); weights(state); submit(state); transfer(state);
  state.users.find(user => user.id === author)!.departmentId = 'dept-plan';
  reject('PERFORMANCE_SUBMITTED', () => dispatch(state, author, 'performance.saveHalf', input));
  dispatch(state, author, 'performance.withdrawSubmission', { period });
  dispatch(state, author, 'performance.saveHalf', { ...input, evidence: '보완한 인계 전 보고서' });
  submit(state); dispatch(state, head, 'performance.evaluatePerson', evaluation(state));
  assert.equal(getUnitEvaluation(state, author, period)?.performanceSnapshot[0].evidence, '보완한 인계 전 보고서');
  reject('EVALUATION_CONFIRMED', () => dispatch(state, author, 'performance.saveHalf', input));
});

test('phase1 performance: historical entitlement cannot be used to assign scores to unrelated units', () => {
  const state = fixture(); dispatch(state, author, 'performance.saveHalf', input); transfer(state);
  const unrelated = state.units.find(unit => unit.departmentId === 'dept-plan')!;
  reject('SCORE_OWNER_REQUIRED', () => dispatch(state, author, 'performance.setWeights', { period, allocations: [{ unitId: unrelated.id, maxScore: 50 }] }));
});

test('phase1 performance: a new owner records their own contribution separately from the former author', () => {
  const state = fixture(); dispatch(state, author, 'performance.saveHalf', input); transfer(state);
  dispatch(state, manager, 'performance.saveHalf', { ...input, title: '인수 후 성과', description: '후임자가 수행한 결과' });
  assert.equal(state.performances.filter(record => record.taskId === input.taskId && record.period === period).length, 2);
  dispatch(state, author, 'performance.saveHalf', { ...input, description: '전임자 성과 보완' });
  assert.equal(state.performances.find(record => record.authorId === manager)?.description, '후임자가 수행한 결과');
});
