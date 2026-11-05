import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import type { CommonTask, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-05T03:00:00Z');
const input = { title: '배포 승인 검증', description: '승인한 업무 기준을 각 부서에서 수행합니다.', dueDate: '2026-12-31', frequency: 'once', requiredSteps: ['자료 준비', '결과 검토'], departmentIds: ['dept-support'] };
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) {
  executeCommand(state, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now);
}
function create(state: WorkspaceData, extra: Record<string, unknown> = {}) {
  dispatch(state, 'u-seoyeon', 'common.create', { ...input, ...extra });
  return state.commonTasks[0];
}
const pending = (common: CommonTask) => common.approvalRequests!.find(request => request.status === 'pending')!;
function approve(state: WorkspaceData, common: CommonTask) {
  dispatch(state, 'u-head', 'common.approve', { commonId: common.id, requestId: pending(common).id });
}
// Exercise the domain directly: a failed preflight must not mutate even its input.
function denied(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>, code: string) {
  const before = structuredClone(state);
  assert.throws(() => dispatch(state, actor, type, payload), error => error instanceof DomainError && error.code === code);
  assert.deepEqual(state, before);
}

test('publication guards: JSONB object key order does not invalidate an unchanged approval snapshot', () => {
  const state = createSeed(now), common = create(state, { kind: 'directive', directiveIssuer: 'minister', instructedOn: '2026-11-01', projectName: '부서 협업' });
  const request = pending(common);
  // PostgreSQL JSONB may return object keys in a different order from insertion.
  request.snapshot = Object.fromEntries(Object.entries(request.snapshot).reverse()) as typeof request.snapshot;
  approve(state, common);
  assert.equal(common.publicationStatus, 'approved');
  assert.equal(common.distributions.length, 1);
});

test('publication guards: version, task content, required step order and owner changes invalidate approval', () => {
  const changes: Array<(common: CommonTask) => void> = [
    common => { common.version++; },
    common => { common.description = '요청 후 변경된 상세 내용'; },
    common => { common.requiredSteps.reverse(); },
    common => { common.managerId = 'u-jiho'; },
  ];
  for (const change of changes) {
    const state = createSeed(now), common = create(state);
    change(common);
    denied(state, 'u-head', 'common.approve', { commonId: common.id, requestId: pending(common).id }, 'COMMON_APPROVAL_STALE');
  }
});

test('publication guards: responsibility handover requires a fresh approval snapshot and preserves origin and history', () => {
  const state = createSeed(now), common = create(state), originalRequest = structuredClone(pending(common));
  dispatch(state, 'u-minseo', 'transfer.rolesRequest', { departmentId: 'dept-plan', fromId: 'u-seoyeon', toId: 'u-jiho', roleIds: [`common_manager:${common.id}`], reason: '공통업무 작성 책임 인계' });
  dispatch(state, 'u-head', 'transfer.approve', { transferId: state.workTransfers![0].id });
  const transferred = state.commonTasks.find(item => item.id === common.id)!;
  assert.equal(transferred.managerId, 'u-jiho');
  assert.equal(transferred.originDepartmentId, 'dept-plan');
  denied(state, 'u-head', 'common.approve', { commonId: transferred.id, requestId: originalRequest.id }, 'COMMON_APPROVAL_STALE');
  dispatch(state, 'u-head', 'common.reject', { commonId: transferred.id, requestId: originalRequest.id, reason: '새 작성자가 내용을 확인하고 다시 요청해 주세요.' });
  denied(state, 'u-seoyeon', 'common.resubmit', { commonId: transferred.id, ...input }, 'COMMON_AUTHOR_REQUIRED');
  dispatch(state, 'u-jiho', 'common.resubmit', { commonId: transferred.id, ...input, description: '인수 후 확인한 업무 기준' });
  const resubmitted = state.commonTasks.find(item => item.id === common.id)!;
  assert.equal(pending(resubmitted).snapshot.managerId, 'u-jiho');
  assert.equal(pending(resubmitted).requestedBy, 'u-jiho');
  assert.equal(resubmitted.approvalRequests!.find(request => request.id === originalRequest.id)!.snapshot.managerId, 'u-seoyeon');
  approve(state, resubmitted);
  assert.equal(resubmitted.publicationStatus, 'approved');
});

test('publication guards: every target active manager and head is checked before any common or directive publication side effect', () => {
  for (const kind of ['common', 'directive']) for (const role of ['manager', 'head']) for (const availability of ['inactive', 'expired']) {
    const state = createSeed(now), common = create(state, { kind, ...(kind === 'directive' ? { directiveIssuer: 'minister', instructedOn: '2026-11-01' } : {}), departmentIds: ['dept-support', 'dept-innovation'] });
    // A valid first target must not be published when the later target is invalid.
    const staff = state.users.filter(user => user.departmentId === 'dept-innovation' && user.role === role);
    assert.ok(staff.length);
    for (const user of staff) if (availability === 'inactive') user.active = false; else user.endsAt = now.toISOString();
    denied(state, 'u-head', 'common.approve', { commonId: common.id, requestId: pending(common).id }, 'DEPARTMENT_STAFF_REQUIRED');
    assert.deepEqual(common.departmentIds, []);
    assert.deepEqual(common.distributions, []);
  }
});

test('publication guards: approval rechecks author employment and immutable source department', () => {
  for (const change of ['inactive', 'expired', 'department']) {
    const state = createSeed(now), common = create(state), owner = state.users.find(user => user.id === common.managerId)!;
    if (change === 'inactive') owner.active = false;
    else if (change === 'expired') owner.endsAt = now.toISOString();
    else owner.departmentId = 'dept-support';
    denied(state, 'u-head', 'common.approve', { commonId: common.id, requestId: pending(common).id }, change === 'department' ? 'COMMON_AUTHOR_CHANGED' : 'ACCOUNT_INACTIVE');
    denied(state, 'u-support-head', 'common.approve', { commonId: common.id, requestId: pending(common).id }, 'COMMON_HEAD_APPROVAL_REQUIRED');
  }
});

test('publication guards: pending additional approval locks directive metadata for owner, coordinator and admin', () => {
  const state = createSeed(now), common = create(state, { kind: 'directive', directiveIssuer: 'minister', instructedOn: '2026-11-01' });
  approve(state, common);
  dispatch(state, 'u-seoyeon', 'common.distribute', { commonId: common.id, departmentIds: ['dept-innovation'] });
  const request = pending(common), metadata = { commonId: common.id, directiveIssuer: 'vice_minister', instructedOn: '2026-11-02' };
  for (const actor of ['u-seoyeon', 'u-plan-lead', 'u-admin']) denied(state, actor, 'directive.updateMetadata', metadata, 'COMMON_APPROVAL_PENDING');
  dispatch(state, 'u-head', 'common.reject', { commonId: common.id, requestId: request.id, reason: '추가 배포 범위 재검토' });
  dispatch(state, 'u-seoyeon', 'directive.updateMetadata', metadata);
  assert.equal(common.directiveIssuer, 'vice_minister');
  assert.equal(request.snapshot.directiveIssuer, 'minister');
  assert.equal(request.status, 'rejected');
});

test('publication guards: recipient departments see their own distributions and task bodies while source sees aggregate progress only', () => {
  const state = createSeed(now), common = create(state, { departmentIds: ['dept-support', 'dept-innovation'] });
  approve(state, common);
  const assignments = [
    { departmentId: 'dept-support', manager: 'u-doyun', lead: 'u-support-lead', member: 'u-support-member', team: '데이터팀', unit: 'unit-data' },
    { departmentId: 'dept-innovation', manager: 'u-innovation-manager', lead: 'u-innovation-lead', member: 'u-innovation-member', team: '혁신팀', unit: 'unit-service' },
  ];
  for (const assignment of assignments) {
    const ref = { commonId: common.id, distributionId: common.distributions.find(item => item.departmentId === assignment.departmentId)!.id };
    dispatch(state, assignment.manager, 'common.assignTeam', { ...ref, team: assignment.team, leadId: assignment.lead });
    dispatch(state, assignment.lead, 'common.assignPerson', { ...ref, assigneeId: assignment.member });
    dispatch(state, assignment.member, 'common.register', { ...ref, unitId: assignment.unit });
  }
  for (const assignment of assignments) {
    const workspace = getWorkspace(state, assignment.manager, now), visible = workspace.commonTasks.find(item => item.id === common.id)!;
    assert.deepEqual(visible.distributions.map(item => item.departmentId), [assignment.departmentId]);
    assert.deepEqual(workspace.tasks.filter(item => item.commonId === common.id).map(item => item.departmentId), [assignment.departmentId]);
  }
  for (const actor of ['u-seoyeon', 'u-minseo', 'u-head']) {
    const workspace = getWorkspace(state, actor, now), visible = workspace.commonTasks.find(item => item.id === common.id)!;
    assert.equal(visible.distributions.length, 2);
    assert.equal(visible.distributions.every(item => item.assigneeId && item.status === 'registered'), true);
    assert.equal(workspace.tasks.some(item => item.commonId === common.id), false);
  }
});
