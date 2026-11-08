import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { commandExpectation } from '../src/lib/command-targets';
import { executeCommand, getWorkspace } from '../src/lib/domain';
import { notificationDestination } from '../src/lib/notification-navigation';
import { notificationRoute } from '../src/lib/notification-route';
import { createSeed } from '../src/lib/seed';
import { STATISTICS_DEMO_IDS } from '../src/lib/statistics-demo';
import { eligibleScoreUnits } from '../src/lib/unit-evaluation';
import type { Notification, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-08T03:00:00Z');
function assertMetadata(state: WorkspaceData, notices: Notification[]) {
  for (const notice of notices) {
    assert.equal(notice.createdAt, now.toISOString(), notice.title);
    const visibleTarget = notice.targetType === 'task' ? state.tasks.some(item => item.id === notice.targetId)
      : notice.targetType === 'common' ? state.commonTasks.some(item => item.id === notice.targetId)
      : notice.targetType === 'distribution' ? state.commonTasks.some(item => item.distributions.some(distribution => distribution.id === notice.targetId))
      : notice.targetType === 'handover' ? state.handovers.some(item => item.id === notice.targetId)
      : notice.targetType === 'transfer' ? (state.workTransfers ?? []).some(item => item.id === notice.targetId)
      : notice.targetType === 'performance' ? state.performances.some(item => item.id === notice.targetId)
      : notice.targetType === 'delegation' ? state.delegations.some(item => item.id === notice.targetId) : false;
    assert.ok(visibleTarget, `알림 대상 불일치: ${notice.title} (${notice.targetType}/${notice.targetId})`);
  }
}
function send(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, kinds: Notification['targetType'][] = []) {
  const prior = new Set(state.notifications.map(item => item.id)), candidate = structuredClone(state), expected = commandExpectation(state, type, payload, actor);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID(), ...(expected ? { expected } : {}) }, now);
  Object.assign(state, candidate);
  const created = state.notifications.filter(item => !prior.has(item.id));
  assertMetadata(state, created);
  for (const kind of kinds) assert.ok(created.some(item => item.targetType === kind), `${type} must notify ${kind}`);
  return created;
}

test('both original seed notifications and the statistics demo supply real targets and times without migrating old records on read', () => {
  const state = createSeed(now);
  assertMetadata(state, state.notifications);
  assert.equal(state.notifications.find(item => item.id === 'notification-1')!.targetType, 'handover');
  assert.equal(state.notifications.find(item => item.id === 'notification-2')!.targetType, 'distribution');
  assert.equal(state.notifications.find(item => item.id === STATISTICS_DEMO_IDS.notification)!.targetType, 'common');
  const legacy = state.notifications.find(item => item.id === 'notification-1')!;
  delete legacy.createdAt; delete legacy.targetType;
  const before = structuredClone(state);
  const visible = getWorkspace(state, legacy.userId, now).notifications.find(item => item.id === legacy.id)!;
  assert.equal(visible.targetType, undefined); assert.equal(visible.createdAt, undefined);
  assert.deepEqual(state, before);
});

test('publication, approval result, department receipt, team assignment, personal assignment and registration use their precise targets', () => {
  const state = createSeed(now);
  const requested = send(state, 'u-seoyeon', 'common.create', { title: '알림 생성 전체 배정', description: '각 배정 단계의 대상을 확인합니다.', dueDate: '2026-11-30', frequency: 'once', requiredSteps: ['준비', '검토'], departmentIds: ['dept-support'] }, ['common']);
  const commonId = state.commonTasks[0].id;
  assert.ok(requested.every(item => item.targetId === commonId));
  const approved = send(state, 'u-head', 'common.approve', { commonId, requestId: state.commonTasks[0].approvalRequests![0].id }, ['common', 'distribution']);
  assert.ok(approved.every(item => !item.description.includes('배정를')));
  const distributionId = state.commonTasks[0].distributions[0].id, ref = { commonId, distributionId };
  const received = approved.find(item => item.userId === 'u-doyun')!;
  assert.equal(received.targetId, distributionId);
  assert.deepEqual(notificationRoute(received, getWorkspace(state, received.userId, now)), { view: 'allocation', focus: commonId });
  for (const [actor, type, extra] of [
    ['u-doyun', 'common.assignTeam', { team: '데이터팀', leadId: 'u-support-lead' }],
    ['u-support-lead', 'common.assignPerson', { assigneeId: 'u-support-member' }],
    ['u-support-member', 'common.register', { unitId: 'unit-data' }],
  ] as const) {
    const notices = send(state, actor, type, { ...ref, ...extra }, ['distribution']);
    assert.ok(notices.every(item => item.targetId === distributionId));
    for (const notice of notices) assert.deepEqual(notificationRoute(notice, getWorkspace(state, notice.userId, now)), { view: 'common', focus: commonId });
  }
  send(state, 'u-seoyeon', 'common.distribute', { commonId, departmentIds: ['dept-innovation'] }, ['common']);
  send(state, 'u-head', 'common.reject', { commonId, requestId: state.commonTasks[0].approvalRequests!.find(item => item.status === 'pending')!.id, reason: '대상 부서 보완' }, ['common']);
});

test('legacy handover acceptance and transfer request, completion, emergency and cancellation carry separate entity kinds', () => {
  const legacy = createSeed(now); legacy.handovers = [];
  send(legacy, 'u-seoyeon', 'task.create', { title: '인수 확인 알림 업무', description: '구형 인수 확인 흐름도 유지합니다.', unitId: 'unit-record', primaryId: 'u-seoyeon', dueDate: '2026-11-30', frequency: 'once' });
  send(legacy, 'u-seoyeon', 'handover.create', { taskIds: [legacy.tasks[0].id], runIds: [], toId: 'u-jiho', effectiveAt: '2026-11-20T03:00:00Z', summary: '인계 내용', pendingItems: '남은 일', nextAction: '다음 절차', notes: '' });
  const accepted = send(legacy, 'u-head', 'handover.approve', { handoverId: legacy.handovers[0].id }, ['handover']);
  assert.deepEqual(notificationRoute(accepted[0], getWorkspace(legacy, accepted[0].userId, now)), { view: 'handover', focus: legacy.handovers[0].id });
  for (const emergency of [false, true]) {
    const state = createSeed(now); state.handovers = [];
    const requested = send(state, 'u-support-member', 'transfer.request', { departmentId: 'dept-support', fromId: 'u-support-member', toId: 'u-doyun', taskIds: ['task-data'], unitIds: [], reason: '인사이동 알림' }, ['transfer']);
    const transferId = state.workTransfers![0].id;
    assert.ok(requested.every(item => item.targetId === transferId));
    assert.deepEqual(notificationRoute(requested[0], getWorkspace(state, requested[0].userId, now)), { view: 'handover', focus: transferId });
    if (emergency) {
      const notices = send(state, 'u-doyun', 'transfer.emergency', { departmentId: 'dept-support', fromId: 'u-support-member', toId: 'u-doyun', reason: '긴급 발령으로 부서 보관' }, ['transfer']);
      assert.ok(notices.some(item => item.targetId === transferId && item.title.includes('취소')));
      assert.ok(notices.some(item => item.targetId !== transferId && item.title.includes('긴급')));
    } else send(state, 'u-support-head', 'transfer.approve', { transferId }, ['transfer']);
  }
});

test('half-year submission and evaluation preserve person/period destinations while old per-run reviews target their performance record', () => {
  const state = createSeed(now), owner = 'u-support-member', period = '2026-H2';
  const units = eligibleScoreUnits(state, owner);
  send(state, owner, 'performance.setWeights', { period, allocations: units.map((unit, index) => ({ unitId: unit.id, maxScore: index === 0 ? 51 - units.length : 1 })) });
  send(state, owner, 'performance.saveHalf', { taskId: 'task-data', period, description: '성과 평가 알림 근거' });
  for (const unit of units) {
    if (unit.id === state.tasks.find(task => task.id === 'task-data')!.unitId) continue;
    send(state, owner, 'task.create', { unitId: unit.id, primaryId: owner, title: '알림 검증 업무', description: '단위업무별 성과', dueDate: '2026-12-31', frequency: 'once' });
    send(state, owner, 'performance.saveHalf', { taskId: state.tasks[0].id, period, description: '추가 단위업무 성과' });
  }
  const plan = state.unitScorePlans!.find(item => item.personId === owner && item.period === period)!;
  const submitted = send(state, owner, 'performance.submitPerson', { period, planVersion: plan.version }, ['performance']);
  for (const notice of submitted) assert.deepEqual(notice.destination, { view: 'performance', personId: owner, period });
  const evaluated = send(state, 'u-support-head', 'performance.evaluatePerson', { personId: owner, period, planVersion: plan.version, scores: plan.allocations.map(allocation => ({ unitId: allocation.unitId, score: 0, comment: '' })), comment: '평가 완료' }, ['performance']);
  assert.deepEqual(evaluated[0].destination, { view: 'performance', personId: owner, period });
  state.performances.unshift({ id: 'legacy-performance-notification', taskId: 'task-data', runId: '', title: '이전 회차 성과', description: '이전 기록', evidence: '이전 근거', authorId: owner, departmentId: 'dept-support', status: 'review', createdAt: now.toISOString() });
  const legacy = send(state, 'u-support-head', 'performance.evaluate', { performanceId: 'legacy-performance-notification', score: 85, comment: '확인했습니다.', decision: 'confirmed' }, ['performance']);
  assert.equal(legacy[0].targetId, 'legacy-performance-notification');
  assert.deepEqual(notificationDestination(legacy[0], state), { view: 'performance', personId: owner, period: undefined });
});

test('single, embedded and batch delegation notifications retain exact destinations on both request and resolution', () => {
  for (const mode of ['single', 'embedded', 'batch']) {
    const state = createSeed(now), owner = 'u-seoyeon'; state.handovers = [];
    const nomination = { toId: 'u-jiho', startsAt: now.toISOString(), endsAt: '2026-11-20T03:00:00Z', reason: '교육 기간 대행' };
    const taskInput = { title: `알림 대행 ${mode}`, description: '대행 요청의 정확한 이동을 확인합니다.', unitId: 'unit-record', primaryId: owner, dueDate: '2026-11-30', frequency: 'once' };
    const created = send(state, owner, 'task.create', { ...taskInput, ...(mode === 'embedded' ? { deputy: nomination } : {}) }, mode === 'embedded' ? ['delegation'] : []);
    let requested = created;
    if (mode === 'single') requested = send(state, owner, 'delegation.request', { taskId: state.tasks[0].id, ...nomination }, ['delegation']);
    if (mode === 'batch') {
      const first = state.tasks[0].id; send(state, owner, 'task.create', { ...taskInput, title: `${taskInput.title} 두 번째` });
      requested = send(state, owner, 'delegation.requestBatch', { fromId: owner, taskIds: [first, state.tasks[0].id], ...nomination }, ['delegation']);
    }
    for (const notice of requested) {
      assert.deepEqual(notice.destination, { view: 'delegation', delegationId: notice.targetId });
      const compatibility = { ...notice }; delete compatibility.destination;
      assert.deepEqual(notificationDestination(compatibility, state), notice.destination);
    }
    const delegation = state.delegations.find(item => item.taskId === state.tasks[0].id)!;
    const resolved = send(state, 'u-head', 'delegation.approve', delegation.batchId ? { batchId: delegation.batchId } : { delegationId: delegation.id }, ['delegation']);
    assert.ok(resolved.every(item => item.destination?.view === 'delegation' && item.destination.delegationId === item.targetId));
  }
});
