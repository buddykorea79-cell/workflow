import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { commandExpectation } from '../src/lib/command-targets';
import { createSeed } from '../src/lib/seed';
import { eligibleScoreUnits, getUnitScorePlan } from '../src/lib/unit-evaluation';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-07T03:00:00Z'), actor = 'u-support-member', head = 'u-support-head', taskId = 'task-data';
function send(state: WorkspaceData, type: string, payload: Record<string, unknown>, when = now, userId = actor) {
  const candidate = structuredClone(state), expected = commandExpectation(state, type, payload, userId);
  executeCommand(candidate, userId, { type, payload, requestId: randomUUID(), expectedRevision: state.revision, ...(expected ? { expected } : {}) }, when);
  Object.assign(state, candidate);
}
const allocations = (state: WorkspaceData) => {
  const units = eligibleScoreUnits(state, actor);
  return units.map((unit, index) => ({ unitId: unit.id, maxScore: index === 0 ? 51 - units.length : 1 }));
};
function ready(state: WorkspaceData, period: string, when = now) {
  send(state, 'performance.setWeights', { period, allocations: allocations(state) }, when);
  send(state, 'performance.saveHalf', { taskId, period, description: '반기에 수행한 업무 성과' }, when);
  for (const allocation of allocations(state)) {
    if (allocation.unitId === state.tasks.find(task => task.id === taskId)!.unitId) continue;
    send(state, 'task.create', { unitId: allocation.unitId, primaryId: actor, title: '반기 검증 업무', description: '단위업무별 성과', dueDate: '2027-12-31', frequency: 'once' }, when);
    send(state, 'performance.saveHalf', { taskId: state.tasks[0].id, period, description: '반기에 수행한 단위업무 성과' }, when);
  }
  return getUnitScorePlan(state, actor, period)!;
}
function rejects(code: string, action: () => unknown, message?: string) {
  assert.throws(action, error => error instanceof DomainError && error.code === code && (!message || error.message === message));
}

test('all four performance commands accept current and past halves', () => {
  for (const period of ['2026-H2', '2026-H1', '2025-H2']) {
    const state = createSeed(now); const plan = ready(state, period);
    send(state, 'performance.submitHalf', { taskId, period, description: '제출 전에 보완한 성과' });
    send(state, 'performance.submitPerson', { period, planVersion: plan.version });
    assert.ok(getUnitScorePlan(state, actor, period)?.submittedAt);
    assert.equal(state.performances.find(item => item.taskId === taskId && item.authorId === actor && item.period === period)!.status, 'review');
  }
});

test('future saves, weight changes and person submissions reject atomically with the requested messages', () => {
  const future = '2027-H2';
  const cases: [string, (state: WorkspaceData) => Record<string, unknown>, string][] = [
    ['performance.setWeights', state => ({ period: future, allocations: allocations(state) }), '아직 시작하지 않은 반기의 업무 비중은 입력할 수 없습니다.'],
    ['performance.saveHalf', () => ({ taskId, period: future, description: '미래 성과' }), '아직 시작하지 않은 반기의 성과는 입력할 수 없습니다.'],
    ['performance.submitHalf', () => ({ taskId, period: future, description: '미래 성과' }), '아직 시작하지 않은 반기의 성과는 입력할 수 없습니다.'],
    ['performance.submitPerson', () => ({ period: future, planVersion: 1 }), '아직 시작하지 않은 반기의 성과는 입력할 수 없습니다.'],
  ];
  for (const [type, payload, message] of cases) {
    const state = createSeed(now), before = structuredClone(state);
    rejects('PERIOD_NOT_STARTED', () => send(state, type, payload(state)), message);
    assert.deepEqual(state, before, type);
  }
});

test('the Korean half-year boundary opens all four commands at midnight', () => {
  const before = new Date('2026-06-30T14:59:59.999Z'), after = new Date('2026-06-30T15:00:00Z'), period = '2026-H2';
  const state = createSeed(before);
  for (const type of ['performance.saveHalf', 'performance.submitHalf']) rejects('PERIOD_NOT_STARTED', () => send(state, type, { taskId, period, description: '하반기 성과' }, before));
  rejects('PERIOD_NOT_STARTED', () => send(state, 'performance.setWeights', { period, allocations: allocations(state) }, before));
  rejects('PERIOD_NOT_STARTED', () => send(state, 'performance.submitPerson', { period, planVersion: 1 }, before));
  const plan = ready(state, period, after);
  send(state, 'performance.submitHalf', { taskId, period, description: '하반기 성과 보완' }, after);
  send(state, 'performance.submitPerson', { period, planVersion: plan.version }, after);
  assert.ok(getUnitScorePlan(state, actor, period)?.submittedAt);
});

test('existing future records remain readable while edits and resubmission are blocked', () => {
  const future = '2027-H2', state = createSeed(now), later = new Date('2027-07-01T00:00:00Z');
  ready(state, future, later);
  const before = structuredClone(state), view = getWorkspace(state, actor, now);
  assert.ok(view.performances.some(item => item.period === future && item.taskId === taskId));
  assert.ok(view.unitScorePlans?.some(item => item.personId === actor && item.period === future));
  assert.deepEqual(state, before, 'reading future records must not migrate or remove them');
  for (const type of ['performance.saveHalf', 'performance.submitHalf']) rejects('PERIOD_NOT_STARTED', () => send(state, type, { taskId, period: future, description: '미래 기록 수정' }));
  rejects('PERIOD_NOT_STARTED', () => send(state, 'performance.setWeights', { period: future, allocations: allocations(state) }));
  rejects('PERIOD_NOT_STARTED', () => send(state, 'performance.submitPerson', { period: future, planVersion: getUnitScorePlan(state, actor, future)!.version }));
  assert.deepEqual(state, before);
});

test('future restrictions preserve authorization precedence and do not restrict existing submission withdrawal or head evaluation', () => {
  const state = createSeed(now), period = '2027-H2', later = new Date('2027-07-01T00:00:00Z');
  rejects('SCORE_OWNER_REQUIRED', () => send(state, 'performance.setWeights', { period, allocations: allocations(state) }, now, head));
  rejects('SCORE_OWNER_REQUIRED', () => send(state, 'performance.setWeights', { personId: 'u-seoyeon', period, allocations: allocations(state) }));
  const foreign = state.units.find(unit => unit.departmentId !== 'dept-support')!;
  rejects('SCORE_OWNER_REQUIRED', () => send(state, 'performance.setWeights', { period, allocations: [{ unitId: foreign.id, maxScore: 50 }] }));
  rejects('PERFORMANCE_DENIED', () => send(state, 'performance.submitPerson', { personId: 'u-seoyeon', period, planVersion: 1 }));
  rejects('TASK_ACCESS_DENIED', () => send(state, 'performance.saveHalf', { taskId: 'task-plan', period, description: '다른 부서 성과' }));
  const plan = ready(state, period, later);
  send(state, 'performance.submitPerson', { period, planVersion: plan.version }, later);
  const submitted = structuredClone(state);
  send(state, 'performance.withdrawSubmission', { period });
  assert.equal(getUnitScorePlan(state, actor, period)!.submittedAt, undefined);
  send(submitted, 'performance.evaluatePerson', { personId: actor, period, planVersion: plan.version, scores: plan.allocations.map(allocation => ({ unitId: allocation.unitId, score: allocation.maxScore, comment: '기존 제출 자료 확인' })), comment: '이전 제출 기록 평가' }, now, head);
  assert.ok(submitted.unitEvaluations?.some(item => item.personId === actor && item.period === period));
});
