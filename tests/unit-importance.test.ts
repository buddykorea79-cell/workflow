import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { commandExpectation } from '../src/lib/command-targets';
import { normalizeUnitImportance, sortUnitsByImportance, unitImportance } from '../src/lib/unit-importance';
import { getUnitEvaluation, getUnitScorePlan, scoreUnitsForPeriod } from '../src/lib/unit-evaluation';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-08T03:00:00Z');
function send(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) {
  const candidate = structuredClone(state); const expected = commandExpectation(state, type, payload, actor);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID(), ...(expected ? { expected } : {}) }, now);
  Object.assign(state, candidate);
}
const code = (expected: string) => (error: unknown) => error instanceof DomainError && error.code === expected;

test('importance uses the legacy default and a stable descending sort without changing input or tied order', () => {
  for (const importance of [undefined, 0, 11, 1.5, NaN, Infinity]) assert.equal(unitImportance({ importance }), 5);
  for (let importance = 1; importance <= 10; importance++) assert.equal(unitImportance({ importance }), importance);
  const units = [{ id: 'first-default', importance: undefined }, { id: 'high', importance: 10 }, { id: 'second-five', importance: 5 }, { id: 'low', importance: 1 }, { id: 'third-default', importance: 0 }];
  const before = structuredClone(units); const sorted = sortUnitsByImportance(units);
  assert.deepEqual(sorted.map(unit => unit.id), ['high', 'first-default', 'second-five', 'third-default', 'low']);
  assert.deepEqual(units, before); assert.notEqual(sorted, units); assert.equal(sorted[0], units[1]);
});

test('seed and fresh manual/AI units default to five; explicit integers and omitted updates preserve importance', () => {
  const state = createSeed(now); assert.ok(state.units.every(unit => unit.importance === 5));
  send(state, 'u-jiho', 'unit.create', { title: '중요도 기본 업무', description: '새 업무 범위' });
  const created = state.units.at(-1)!; assert.equal(created.importance, 5);
  send(state, 'u-jiho', 'unit.update', { unitId: created.id, title: created.title, description: '변경한 범위', importance: 9 });
  assert.equal(state.units.find(unit => unit.id === created.id)!.importance, 9);
  send(state, 'u-jiho', 'unit.update', { unitId: created.id, title: created.title, description: '중요도 없는 이전 클라이언트 요청' });
  assert.equal(state.units.find(unit => unit.id === created.id)!.importance, 9);
  send(state, 'u-jiho', 'unit.create', { title: '낮은 중요도 업무', description: '명시한 중요도', importance: 1 });
  assert.equal(state.units.at(-1)!.importance, 1);
  send(state, 'u-jiho', 'work.import', { importId: randomUUID(), units: [{ title: 'AI 검토 단위', description: '사용자가 검토한 범위', tasks: [{ title: '검토한 업무', description: '실제 업무 설명', dueDate: '2026-12-31', frequency: 'once', priority: 'medium' }] }] });
  assert.equal(state.units.at(-1)!.importance, 5);
});

test('unit importance is validated on both creation and update without widening definition permissions', () => {
  const state = createSeed(now); const unit = state.units.find(item => item.ownerId === 'u-jiho')!;
  for (const importance of [0, 11, 1.5, NaN, Infinity, '5', null]) {
    const before = structuredClone(state);
    for (const type of ['unit.create', 'unit.update']) assert.throws(() => send(state, 'u-jiho', type, { unitId: unit.id, title: '중요도 검증', description: '업무 범위', importance }), (error: unknown) => error instanceof DomainError && error.code === 'VALIDATION_ERROR' && !!error.fieldErrors?.some(field => field.path === 'importance'));
    assert.deepEqual(state, before);
  }
  assert.throws(() => send(state, 'u-head', 'unit.update', { unitId: unit.id, title: unit.title, description: unit.description, importance: 10 }), code('HEAD_DEFINITION_DENIED'));
  state.departmentWorkPlans = [{ departmentId: unit.departmentId, status: 'confirmed', version: 1 }];
  assert.throws(() => send(state, 'u-jiho', 'unit.update', { unitId: unit.id, title: unit.title, description: unit.description, importance: 10 }), code('DEPARTMENT_CONFIRMED'));
});

test('legacy units are exposed as five without mutating read input or historical unit snapshots', () => {
  const state = createSeed(now); state.units.forEach(unit => { delete unit.importance; });
  const historicalUnit = structuredClone(state.units[0]);
  state.departmentWorkPlans = [{ departmentId: historicalUnit.departmentId, status: 'draft', version: 1, snapshot: { units: [historicalUnit], tasks: [], members: [] } }];
  const before = structuredClone(state);
  assert.ok(getWorkspace(state, 'u-admin', now).units.every(unit => unit.importance === 5));
  assert.deepEqual(state, before);
  normalizeUnitImportance(state);
  assert.ok(state.units.every(unit => unit.importance === 5));
  assert.deepEqual(state.departmentWorkPlans, before.departmentWorkPlans);
});

test('handover unit copies preserve current importance and default missing legacy values without changing the original', () => {
  for (const importance of [undefined, 8]) {
    const state = createSeed(now); state.handovers = [];
    const original = state.units.find(unit => unit.id === 'unit-data')!; original.importance = importance;
    const recipient = 'u-importance-successor'; state.users.push({ ...state.users.find(user => user.id === 'u-support-member')!, id: recipient, name: '중요도 인수자' });
    send(state, 'u-support-member', 'transfer.request', { departmentId: 'dept-support', fromId: 'u-support-member', toId: recipient, unitIds: [], taskIds: ['task-data'], reason: '후임에게 업무 이관' });
    send(state, 'u-support-head', 'transfer.approve', { transferId: state.workTransfers![0].id });
    const copy = state.units.find(unit => unit.ownerId === recipient && unit.transferOriginUnitId === original.id)!;
    assert.equal(copy.importance, importance ?? 5);
    assert.equal(state.units.find(unit => unit.id === original.id)!.importance, importance);
  }
});

test('new weight saves require positive whole points while legacy zero/fractional plans still submit/evaluate and remain unchanged by importance edits', () => {
  const state = createSeed(now); const actor = 'u-jiho'; const period = '2026-H2'; const unitIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    send(state, actor, 'unit.create', { title: `소수 호환 단위 ${index}`, description: '기존 평가 보존 확인', importance: 5 });
    const unitId = state.units.at(-1)!.id; unitIds.push(unitId);
    send(state, actor, 'task.create', { unitId, primaryId: actor, title: `성과 업무 ${index}`, description: '기존 성과를 평가합니다.', dueDate: '2026-12-31', frequency: 'once' });
    send(state, actor, 'performance.saveHalf', { taskId: state.tasks[0].id, period, description: '반기에 완료한 업무 결과' });
  }
  const units = scoreUnitsForPeriod(state, actor, period);
  const allocations = units.map((unit, index) => ({ unitId: unit.id, maxScore: index === 0 ? 51 - units.length : 1 }));
  const fractional = allocations.map(item => ({ ...item, maxScore: item.unitId === unitIds[0] ? 25.5 : item.unitId === unitIds[1] ? 24.5 : 0 }));
  assert.throws(() => send(state, actor, 'performance.setWeights', { period, allocations: fractional }), code('VALIDATION_ERROR'));
  const zero = allocations.map(item => ({ ...item, maxScore: unitIds.includes(item.unitId) ? 25 : 0 }));
  assert.ok(zero.some(item => item.maxScore === 0));
  assert.throws(() => send(state, actor, 'performance.setWeights', { period, allocations: zero }), code('VALIDATION_ERROR'));
  send(state, actor, 'performance.setWeights', { period, allocations });
  const plan = getUnitScorePlan(state, actor, period)!;
  // Model a stored plan from before integer/minimum-one validation; no new save bypass is provided.
  for (const allocation of plan.allocations) allocation.maxScore = fractional.find(item => item.unitId === allocation.unitId)!.maxScore;
  const oldAllocations = structuredClone(plan.allocations);
  send(state, actor, 'performance.submitPerson', { period, planVersion: plan.version });
  send(state, 'u-head', 'performance.evaluatePerson', { personId: actor, period, planVersion: plan.version, scores: oldAllocations.map(item => ({ unitId: item.unitId, score: item.maxScore ? item.maxScore - 0.25 : 0, comment: '기존 소수 비중 기준 평가' })), comment: '기록 보존' });
  const evaluation = structuredClone(getUnitEvaluation(state, actor, period));
  assert.equal(evaluation?.totalScore, 49.5);
  const unit = state.units.find(item => item.id === unitIds[0])!;
  send(state, actor, 'unit.update', { unitId: unit.id, title: unit.title, description: unit.description, importance: 10 });
  assert.deepEqual(getUnitScorePlan(state, actor, period)!.allocations, oldAllocations);
  assert.deepEqual(getUnitEvaluation(state, actor, period), evaluation);
});

test('new weights allow exactly fifty one-point units and reject larger compositions atomically', () => {
  const state = createSeed(now), actor = 'u-jiho', period = '2026-H2';
  const template = state.units.find(unit => unit.ownerId === actor)!;
  while (scoreUnitsForPeriod(state, actor, period).length < 50) state.units.push({ ...structuredClone(template), id: randomUUID(), title: `단위업무 ${state.units.length}` });
  const allocations = scoreUnitsForPeriod(state, actor, period).map(unit => ({ unitId: unit.id, maxScore: 1 }));
  send(state, actor, 'performance.setWeights', { period, allocations });
  assert.equal(getUnitScorePlan(state, actor, period)!.allocations.length, 50);
  state.units.push({ ...structuredClone(template), id: randomUUID(), title: '51번째 단위업무' });
  const before = structuredClone(state);
  assert.throws(() => send(state, actor, 'performance.setWeights', { period, allocations: scoreUnitsForPeriod(state, actor, period).map(unit => ({ unitId: unit.id, maxScore: 1 })) }), code('VALIDATION_ERROR'));
  assert.throws(() => send(state, actor, 'performance.setWeights', { period, allocations }), code('SCORE_UNIT_LIMIT'));
  assert.deepEqual(state, before);
});
