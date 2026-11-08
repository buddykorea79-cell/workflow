import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DomainError, executeCommand, getWorkspace, reconcileDueHandovers } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import { getBudgetCatalog, searchBudgets } from '../src/lib/budget-catalog';
import { COMMAND_TARGET_RULES, commandExpectation, commandTarget, halfPerformanceTargetId, planTargetId, targetEntity, targetRevision } from '../src/lib/command-targets';
import type { CommandExpectation, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-07T03:00:00Z');
function send(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, expected = commandExpectation(state, type, payload, actor), requestId = randomUUID(), expectedRevision = state.revision) {
  const next = structuredClone(state);
  const changes = executeCommand(next, actor, { type, payload, expectedRevision, requestId, ...(expected ? { expected } : {}) }, now);
  Object.assign(state, next);
  return changes;
}
const rejects = (code: string, fn: () => unknown) => assert.throws(fn, error => error instanceof DomainError && error.code === code);

test('concurrency: all 82 server commands are explicitly classified, including logical and no-target commands', () => {
  const cases = [...readFileSync('src/lib/domain.ts', 'utf8').matchAll(/case '([^']+)':/g)].map(match => match[1]);
  assert.equal(cases.length, 82); assert.deepEqual(Object.keys(COMMAND_TARGET_RULES).sort(), cases.sort());
  assert.equal(COMMAND_TARGET_RULES['work.import'], null);
  const context = { actorId: 'person', departmentId: 'department', delegations: [{ id: 'delegate', batchId: 'batch' }] };
  assert.deepEqual(commandTarget('department.confirm', {}, context), { kind: 'departmentPlan', id: 'department' });
  assert.deepEqual(commandTarget('performance.setWeights', { period: '2026-H2', personId: 'forged' }, context), { kind: 'plan', id: planTargetId('person', '2026-H2') });
  assert.deepEqual(commandTarget('performance.evaluatePerson', { period: '2026-H2', personId: 'reviewed' }, context), { kind: 'plan', id: planTargetId('reviewed', '2026-H2') });
  assert.deepEqual(commandTarget('performance.saveHalf', { period: '2026-H2', taskId: 'task' }, context), { kind: 'halfPerformance', id: halfPerformanceTargetId('person', 'task', '2026-H2') });
  assert.deepEqual(commandTarget('delegation.approve', { delegationId: 'delegate' }, context), { kind: 'delegationBatch', id: 'batch' });
  assert.deepEqual(commandTarget('run.schedule', { taskId: 'task', runId: 'run' }), { kind: 'run', id: 'run' });
  assert.deepEqual(commandTarget('run.schedule', { taskId: 'task' }), { kind: 'task', id: 'task' });
  assert.deepEqual(commandTarget('run.nextCycle', { taskId: 'task', previousRunId: 'run' }), { kind: 'task', id: 'task' });
  assert.deepEqual(commandTarget('common.assignPerson', { commonId: 'common', distributionId: 'distribution' }), { kind: 'common', id: 'common' });
  for (const type of ['run.check', 'run.note', 'task.setProgress', 'handover.check', 'notification.read', 'reconcile', 'task.create', 'delegation.requestBatch']) assert.equal(commandTarget(type, {}, context), null);
});

test('concurrency: unrelated departments can save with old global revisions and unchanged target snapshots', () => {
  const state = createSeed(now), revision = state.revision;
  const a = commandExpectation(state, 'task.configure', { taskId: 'task-plan' }, 'u-minseo')!;
  const b = commandExpectation(state, 'task.configure', { taskId: 'task-data' }, 'u-support-member')!;
  send(state, 'u-support-member', 'task.configure', { taskId: 'task-data', description: '다른 부서에서 변경한 설명' }, b);
  send(state, 'u-minseo', 'task.configure', { taskId: 'task-plan', description: '내 업무의 설명 변경' }, a, randomUUID(), revision);
  assert.equal(state.tasks.find(task => task.id === 'task-plan')!.description, '내 업무의 설명 변경');
  assert.equal(state.tasks.find(task => task.id === 'task-data')!.description, '다른 부서에서 변경한 설명');
});

test('concurrency: the same target conflicts, numeric rev advances even within one timestamp, and receipts include side effects', () => {
  const state = createSeed(now); const payload = { taskId: 'task-plan', description: '첫 번째 변경' };
  const expected = commandExpectation(state, 'task.configure', payload, 'u-minseo')!;
  const changes = send(state, 'u-minseo', 'task.configure', payload, expected);
  assert.ok(changes.some(item => item.kind === 'task' && item.id === 'task-plan' && item.fromRev === 0 && item.toRev === 1));
  assert.ok(changes.some(item => item.kind === 'run'));
  assert.ok(changes.some(item => item.kind === 'handover' && item.id === 'handover-plan'));
  assert.equal(state.tasks.find(task => task.id === 'task-data')!.rev, undefined);
  const before = structuredClone(state);
  rejects('TARGET_CONFLICT', () => send(state, 'u-minseo', 'task.configure', { ...payload, description: '늦게 도착한 변경' }, expected));
  assert.deepEqual(state, before);
  send(state, 'u-minseo', 'task.configure', { ...payload, description: '현재 기준의 두 번째 변경' });
  assert.equal(state.tasks.find(task => task.id === 'task-plan')!.rev, 2);
  assert.equal(state.tasks.find(task => task.id === 'task-plan')!.updatedAt, now.toISOString());
});

test('concurrency: absent expectations are backward compatible and append-only requests keep both records', t => {
  t.mock.method(console, 'warn', () => {});
  const state = createSeed(now), revision = state.revision;
  const runId = state.runs.find(run => run.taskId === 'task-plan')!.id;
  send(state, 'u-minseo', 'run.note', { runId, body: '첫 메모' });
  send(state, 'u-minseo', 'run.note', { runId, body: '둘째 메모' }, null, randomUUID(), revision);
  send(state, 'u-minseo', 'task.configure', { taskId: 'task-plan', description: '이전 클라이언트 저장' }, null, randomUUID(), revision);
  assert.deepEqual(state.runs.find(run => run.id === runId)!.notes.slice(-2).map(note => note.body), ['첫 메모', '둘째 메모']);
});

test('concurrency: expected targets cannot bypass mapping or existing access checks', () => {
  const state = createSeed(now), before = structuredClone(state);
  rejects('COMMAND_TARGET_MISMATCH', () => send(state, 'u-minseo', 'task.configure', { taskId: 'task-plan', description: '우회 시도' }, { kind: 'task', id: 'task-data', rev: 0 }));
  rejects('TASK_ACCESS_DENIED', () => send(state, 'u-jiho', 'task.configure', { taskId: 'task-data', description: '다른 부서 수정 시도' }, { kind: 'task', id: 'task-data', rev: 0 }));
  assert.deepEqual(state, before);
});

test('concurrency: idempotency wins over stale expected values and unchanged configurations return no receipt', () => {
  const state = createSeed(now), requestId = randomUUID();
  const payload = { taskId: 'task-plan', description: '한 번만 저장' };
  const expected = commandExpectation(state, 'task.configure', payload, 'u-minseo')!;
  send(state, 'u-minseo', 'task.configure', payload, expected, requestId);
  const saved = structuredClone(state);
  assert.deepEqual(send(state, 'u-minseo', 'task.configure', payload, expected, requestId, 0), []);
  assert.deepEqual(state, saved);
  rejects('IDEMPOTENCY_CONFLICT', () => send(state, 'u-minseo', 'task.configure', { ...payload, description: '다른 내용' }, expected, requestId));
  const revision = state.revision, targetRev = state.tasks.find(task => task.id === 'task-plan')!.rev;
  assert.deepEqual(send(state, 'u-minseo', 'task.configure', payload), []);
  assert.equal(state.revision, revision); assert.equal(state.tasks.find(task => task.id === 'task-plan')!.rev, targetRev);
});

test('concurrency: half-year logical targets protect a previously absent performance and return its alias receipt', () => {
  const state = createSeed(now), actor = 'u-support-member';
  const payload = { taskId: 'task-data', period: '2026-H2', description: '새 반기 성과' };
  state.performances = state.performances.filter(item => !(item.authorId === actor && item.taskId === payload.taskId && item.period === payload.period));
  const expected = commandExpectation(state, 'performance.saveHalf', payload, actor)!;
  assert.equal(expected.rev, 0);
  const changes = send(state, actor, 'performance.saveHalf', payload, expected);
  assert.ok(changes.some(item => item.kind === 'halfPerformance' && item.id === expected.id && item.fromRev === 0 && item.toRev === 1));
  assert.equal(targetRevision(state, expected), 1);
  assert.equal((targetEntity(state, expected) as { description: string }).description, payload.description);
  rejects('TARGET_CONFLICT', () => send(state, actor, 'performance.saveHalf', { ...payload, description: '동시에 작성한 초안' }, expected));
  const view = getWorkspace(state, actor, now);
  assert.equal(commandExpectation(view, 'performance.saveHalf', payload)!.rev, 1);
});

test('concurrency: logical batch revisions account for every member and missing targets start at zero', () => {
  const state = createSeed(now);
  const template = state.delegations[0] ?? { id: 'delegation', taskId: 'task-plan', fromId: 'u-minseo', toId: 'u-jiho', startsAt: now.toISOString(), endsAt: '2026-12-31T00:00:00Z', actions: [] };
  state.delegations = [{ ...template, id: 'one', batchId: 'batch', rev: 1 }, { ...template, id: 'two', batchId: 'batch', rev: 3 }];
  assert.equal(commandExpectation(state, 'delegation.approve', { delegationId: 'one' }, 'u-head')!.rev, 4);
  state.delegations[1].rev = 4;
  assert.equal(targetRevision(state, { kind: 'delegationBatch', id: 'batch' }), 5);
  assert.equal(targetRevision(state, { kind: 'task', id: 'missing' }), 0);
});

test('concurrency: scheduled reconciliation increments changed entities without attributing them to a later command', () => {
  const state = createSeed(now), later = new Date('2026-11-22T00:00:00Z');
  const expected = commandExpectation(state, 'task.configure', { taskId: 'task-plan' }, 'u-minseo')!;
  assert.equal(reconcileDueHandovers(state, later), true);
  assert.equal(state.tasks.find(task => task.id === 'task-plan')!.rev, 1);
  assert.equal(state.handovers.find(handover => handover.id === 'handover-plan')!.rev, 1);
  rejects('TARGET_CONFLICT', () => send(state, 'u-admin', 'task.configure', { taskId: 'task-plan', description: '이전 담당 기준' }, expected));
  const revision = state.revision; assert.equal(reconcileDueHandovers(state, later), false); assert.equal(state.revision, revision);
  const changes = send(state, 'u-support-member', 'task.configure', { taskId: 'task-data', description: '인계와 무관한 수정' });
  assert.ok(!changes.some(item => item.id === 'task-plan' || item.id === 'handover-plan'));
});

test('concurrency: reconciliation failure feedback increments only once while preserving its applied-result contract', () => {
  const state = createSeed(now); send(state, 'u-head', 'department.confirm', {});
  const later = new Date('2026-11-22T00:00:00Z'), before = state.handovers.find(item => item.id === 'handover-plan')!.rev ?? 0;
  assert.equal(reconcileDueHandovers(state, later), false);
  assert.equal(state.handovers.find(item => item.id === 'handover-plan')!.rev, before + 1);
  const revision = state.revision; assert.equal(reconcileDueHandovers(state, later), false); assert.equal(state.revision, revision);
});

test('concurrency: the first budget edit preserves untouched bundled-item revisions and exposes catalog revision', () => {
  const state = createSeed(now), items = getBudgetCatalog(state).items;
  const [a, b] = items.filter(item => item.active !== false).slice(0, 2);
  const first: CommandExpectation = { kind: 'budgetItem', id: a.id, rev: 0 };
  const second: CommandExpectation = { kind: 'budgetItem', id: b.id, rev: 0 };
  const changes = send(state, 'u-admin', 'budget.setActive', { id: a.id, active: false }, first);
  assert.equal(targetRevision(state, first), 1); assert.equal(targetRevision(state, second), 0);
  assert.ok(changes.some(item => item.kind === 'budgetCatalog' && item.id === 'catalog' && item.toRev === 1));
  assert.ok(!changes.some(item => item.kind === 'budgetItem' && item.id === b.id));
  send(state, 'u-admin', 'budget.setActive', { id: b.id, active: false }, second);
  assert.equal(searchBudgets(state, {}).catalogRev, 2);
});
