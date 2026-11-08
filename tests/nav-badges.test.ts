import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { commandExpectation } from '../src/lib/command-targets';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { navBadges } from '../src/lib/nav-badges';
import { createSeed } from '../src/lib/seed';
import { canReviewTransfer } from '../src/lib/transfer-permissions';
import { canEvaluateUnitPerformance, eligibleScoreUnits } from '../src/lib/unit-evaluation';
import type { CommonDistribution, Performance, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-08T03:00:00Z'), period = '2026-H2';
function fixture() {
  const state = createSeed(now);
  state.commonTasks = []; state.workTransfers = []; state.handovers = []; state.delegations = [];
  state.unitScorePlans = []; state.unitEvaluations = []; state.performances = []; state.departmentWorkPlans = [];
  return state;
}
function send(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) {
  const candidate = structuredClone(state), expected = commandExpectation(state, type, payload, actor);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID(), ...(expected ? { expected } : {}) }, now);
  Object.assign(state, candidate);
}
const badges = (state: WorkspaceData, actor: string) => navBadges(getWorkspace(state, actor, now), now);

test('common approval badges use the same source-head and self-review permissions as the command', () => {
  const state = fixture();
  send(state, 'u-seoyeon', 'common.create', { title: '배포 승인 배지', description: '작성 부서장만 검토합니다.', dueDate: '2026-11-30', frequency: 'once', requiredSteps: ['준비', '검토'], departmentIds: ['dept-support'] });
  assert.equal(badges(state, 'u-head').common, 1);
  for (const actor of ['u-admin', 'u-seoyeon', 'u-minseo', 'u-support-head']) assert.equal(badges(state, actor).common, undefined, actor);
  const common = state.commonTasks[0], requestId = common.approvalRequests![0].id;
  const selfReview = structuredClone(state); selfReview.commonTasks[0].approvalRequests![0].requestedBy = 'u-head';
  assert.equal(badges(selfReview, 'u-head').common, undefined);
  send(state, 'u-head', 'common.approve', { commonId: common.id, requestId });
  assert.equal(badges(state, 'u-head').common, undefined);
  assert.equal(badges(state, 'u-doyun').allocation, 1);
});

test('assignment badges include a lead’s own registration, keep the admin allocation scope, and honor publication and definition locks', () => {
  const state = fixture(), sample = createSeed(now).commonTasks[0];
  const dist = (id: string, departmentId: string, status: CommonDistribution['status'], extra: Partial<CommonDistribution> = {}): CommonDistribution => ({ id, departmentId, status, distributedAt: now.toISOString(), ...extra });
  state.commonTasks.push({ ...sample, id: 'badge-assignments', publicationStatus: 'approved', departmentIds: ['dept-plan', 'dept-support'], approvalRequests: [], distributions: [
    dist('plan-team', 'dept-plan', 'pending'), dist('support-team', 'dept-support', 'pending'),
    dist('plan-person', 'dept-plan', 'team_assigned', { leadId: 'u-plan-lead' }), dist('support-person', 'dept-support', 'team_assigned', { leadId: 'u-support-lead' }),
    dist('lead-own', 'dept-plan', 'person_assigned', { assigneeId: 'u-plan-lead' }),
    dist('manager-own', 'dept-plan', 'person_assigned', { assigneeId: 'u-minseo' }),
    dist('member-own', 'dept-plan', 'person_assigned', { assigneeId: 'u-jiho' }),
    dist('admin-own', 'dept-plan', 'person_assigned', { assigneeId: 'u-admin' }),
  ] });
  assert.deepEqual(badges(state, 'u-plan-lead'), { common: 2 });
  assert.deepEqual(badges(state, 'u-minseo'), { allocation: 1, common: 1 });
  assert.deepEqual(badges(state, 'u-jiho'), { common: 1 });
  assert.deepEqual(badges(state, 'u-admin'), { allocation: 1, common: 3 });
  assert.deepEqual(badges(state, 'u-head'), {});
  state.departmentWorkPlans = [{ departmentId: 'dept-plan', status: 'confirmed', version: 1 }];
  assert.deepEqual(badges(state, 'u-plan-lead'), {});
  assert.deepEqual(badges(state, 'u-minseo'), {});
  assert.deepEqual(badges(state, 'u-admin'), { common: 1 });
  state.commonTasks[0].publicationStatus = 'pending';
  assert.deepEqual(badges(state, 'u-admin'), {});
});

test('one actual pending transfer is counted only for its approving department head and disappears after approval', () => {
  const state = fixture();
  state.users.push({ ...state.users.find(user => user.id === 'u-support-member')!, id: 'new-recipient', name: '새 담당자' });
  send(state, 'u-support-member', 'transfer.request', { departmentId: 'dept-support', fromId: 'u-support-member', toId: 'new-recipient', taskIds: ['task-data'], unitIds: [], reason: '배지 확인 인수인계' });
  const transfer = state.workTransfers![0];
  for (const [actor, expected] of [['u-support-head', true], ['u-head', false], ['u-admin', false], ['u-support-member', false], ['new-recipient', false]] as const) {
    const user = state.users.find(user => user.id === actor)!;
    assert.equal(canReviewTransfer(user, transfer, now), expected);
    assert.equal(badges(state, actor).handover ?? 0, expected ? 1 : 0);
    if (!expected) assert.throws(() => send(structuredClone(state), actor, 'transfer.approve', { transferId: transfer.id }), error => error instanceof DomainError && error.status === 403);
  }
  send(state, 'u-support-head', 'transfer.approve', { transferId: transfer.id });
  assert.equal(badges(state, 'u-support-head').handover, undefined);
  // Legacy requests are displayed for cleanup; this screen does not offer their approval flow.
  state.handovers = createSeed(now).handovers.map(item => ({ ...item, departmentId: 'dept-support', status: 'approval' }));
  assert.equal(badges(state, 'u-support-head').handover, undefined);
});

function submittedPerformance() {
  const state = fixture(), owner = 'u-support-member';
  const allocations = eligibleScoreUnits(state, owner).map((unit, index) => ({ unitId: unit.id, unitTitle: unit.title, maxScore: index === 0 ? 50 : 0 }));
  // Already-saved zero-weight plans retain the same review/readiness rules.
  state.unitScorePlans = [{ id: randomUUID(), personId: owner, departmentId: 'dept-support', period, version: 1, allocations, updatedAt: now.toISOString() }];
  send(state, owner, 'performance.saveHalf', { taskId: 'task-data', period, description: '반기 제출 근거' });
  send(state, owner, 'performance.submitPerson', { period, planVersion: state.unitScorePlans![0].version });
  return { state, owner, plan: state.unitScorePlans![0] };
}

test('evaluation badges match actual score submission permissions and clear after the review is committed', () => {
  const { state, owner, plan } = submittedPerformance();
  const input = { personId: owner, period, planVersion: plan.version, scores: plan.allocations.map(allocation => ({ unitId: allocation.unitId, score: 0, comment: '' })), comment: '' };
  for (const actor of ['u-support-head', 'u-admin', 'u-head', owner, 'u-doyun']) {
    const user = state.users.find(user => user.id === actor)!, expected = ['u-support-head', 'u-admin'].includes(actor);
    assert.equal(canEvaluateUnitPerformance(state, user, owner, period, now), expected);
    assert.equal(badges(state, actor).performance ?? 0, expected ? 1 : 0);
    if (expected) {
      const candidate = structuredClone(state); send(candidate, actor, 'performance.evaluatePerson', input);
      assert.equal(badges(candidate, actor).performance, undefined);
    } else assert.throws(() => send(structuredClone(state), actor, 'performance.evaluatePerson', input), error => error instanceof DomainError && error.status === 403);
  }
});

test('evaluation readiness uses the saved department, current correction chain, evidence, and all submitted periods', () => {
  const { state, owner, plan } = submittedPerformance();
  state.users.find(user => user.id === owner)!.departmentId = 'dept-innovation';
  assert.equal(badges(state, 'u-support-head').performance, 1, 'the prior department evaluates historical work');
  assert.equal(badges(state, 'u-innovation-head').performance, undefined);
  const workspace = getWorkspace(state, 'u-support-head', now);
  assert.ok(!workspace.users.some(user => user.id === owner) && workspace.identities?.some(user => user.id === owner));
  assert.equal(canEvaluateUnitPerformance(workspace, workspace.currentUser, owner, period, now), true);
  const record = state.performances.find(item => item.authorId === owner)!;
  const prior: Performance = { ...structuredClone(record), id: 'old-record', status: 'changes_requested', createdAt: '2026-11-01T03:00:00Z' };
  record.previousId = prior.id; state.performances.push(prior);
  assert.equal(badges(state, 'u-support-head').performance, 1, 'superseded corrections do not block current evidence');
  for (const mutation of [
    (candidate: WorkspaceData) => { candidate.performances.find(item => item.id === record.id)!.status = 'draft'; },
    (candidate: WorkspaceData) => { candidate.performances.find(item => item.id === record.id)!.status = 'changes_requested'; },
    (candidate: WorkspaceData) => { candidate.performances.find(item => item.id === record.id)!.departmentId = 'dept-innovation'; },
    (candidate: WorkspaceData) => { candidate.unitScorePlans![0].submittedAt = undefined; },
  ]) {
    const candidate = structuredClone(state); mutation(candidate);
    assert.equal(badges(candidate, 'u-support-head').performance, undefined);
  }
  state.unitScorePlans!.push({ ...structuredClone(plan), id: 'older-plan', period: '2025-H2' });
  state.performances.push({ ...structuredClone(record), id: 'older-performance', previousId: undefined, period: '2025-H2' });
  assert.equal(badges(state, 'u-support-head').performance, 2);
  state.unitScorePlans!.push({ ...structuredClone(plan), id: 'duplicate-plan' });
  assert.equal(badges(state, 'u-support-head').performance, 2, 'one person-period is one evaluation');
});

test('delegation badges count review cards once per batch, honor self-review restrictions, and retain rejectable expired requests', () => {
  const state = fixture(), owner = 'u-support-member';
  send(state, owner, 'task.create', { title: '두 번째 대행 업무', description: '일괄 대행 승인', unitId: 'unit-data', primaryId: owner, dueDate: '2026-11-30', frequency: 'once' });
  send(state, owner, 'delegation.requestBatch', { fromId: owner, toId: 'u-doyun', taskIds: ['task-data', state.tasks[0].id], startsAt: now.toISOString(), endsAt: '2026-11-20T03:00:00Z', reason: '출장 중 대행' });
  assert.equal(state.delegations.length, 2);
  assert.equal(badges(state, 'u-support-head').delegation, 1);
  for (const actor of ['u-admin', 'u-head', owner, 'u-doyun']) assert.equal(badges(state, actor).delegation, undefined, actor);
  state.delegations.forEach(record => { record.endsAt = '2026-11-07T03:00:00Z'; });
  assert.equal(badges(state, 'u-support-head').delegation, 1);
  const legacySingle = { ...structuredClone(state.delegations[0]), id: 'legacy-single', batchId: undefined, batchTaskIds: undefined, status: undefined };
  state.delegations.push(legacySingle);
  assert.equal(badges(state, 'u-support-head').delegation, 2);
  legacySingle.revokedAt = now.toISOString();
  assert.equal(badges(state, 'u-support-head').delegation, 1);
  state.delegations.forEach(record => { record.requestedBy = 'u-support-head'; });
  assert.equal(badges(state, 'u-support-head').delegation, undefined);
});

test('badge calculation is pure, omits zero keys, and exposes no actions for inactive or ended users', () => {
  const { state } = submittedPerformance();
  const workspace = getWorkspace(state, 'u-support-head', now), before = structuredClone(workspace);
  assert.deepEqual(navBadges(workspace), { performance: 1 });
  assert.deepEqual(workspace, before);
  assert.deepEqual(navBadges({ ...workspace, currentUser: { ...workspace.currentUser, active: false } }, now), {});
  assert.deepEqual(navBadges({ ...workspace, currentUser: { ...workspace.currentUser, endsAt: now.toISOString() } }, now), {});
});
