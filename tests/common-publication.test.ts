import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-05T03:00:00Z');
const payload = { title: '여러 부서 자료 제출', description: '부서별 증빙을 모아 검토하고 제출합니다.', dueDate: '2026-12-31', frequency: 'once', requiredSteps: ['자료 준비', '부서장 검토'], departmentIds: ['dept-support'] };
function dispatch(state: WorkspaceData, actor: string, type: string, input: Record<string, unknown>) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload: input, expectedRevision: state.revision, requestId: randomUUID() }, now);
  Object.assign(state, candidate);
}
const current = (state: WorkspaceData, id = state.commonTasks[0].id) => state.commonTasks.find(item => item.id === id)!;
const pending = (state: WorkspaceData, id = state.commonTasks[0].id) => current(state, id).approvalRequests!.find(item => item.status === 'pending')!;
function create(state: WorkspaceData, extra: Record<string, unknown> = {}, actor = 'u-seoyeon') { dispatch(state, actor, 'common.create', { ...payload, ...extra }); return state.commonTasks[0].id; }
function approve(state: WorkspaceData, id = state.commonTasks[0].id) { const request = pending(state, id); const head = state.users.find(user => user.role === 'head' && user.departmentId === request.departmentId)!; dispatch(state, head.id, 'common.approve', { commonId: id, requestId: request.id }); }
function denied(state: WorkspaceData, actor: string, type: string, input: Record<string, unknown>, status?: number) {
  const before = JSON.stringify(state);
  assert.throws(() => dispatch(state, actor, type, input), error => error instanceof DomainError && (status === undefined || error.status === status));
  assert.equal(JSON.stringify(state), before);
}

test('publication: every work officer can request without the retired common permission and targets see nothing before approval', () => {
  for (const flag of [undefined, false, true]) {
    const state = createSeed(now), actor = state.users.find(user => user.id === 'u-seoyeon')!;
    actor.commonTaskPermission = flag;
    const tasksBefore = JSON.stringify(state.tasks), unitsBefore = JSON.stringify(state.units);
    const id = create(state), common = current(state, id), request = pending(state, id);
    assert.equal(common.originDepartmentId, 'dept-plan'); assert.equal(common.publicationStatus, 'pending');
    assert.deepEqual(common.departmentIds, []); assert.deepEqual(common.distributions, []);
    assert.equal(request.requestedBy, actor.id); assert.deepEqual(request.targetDepartmentIds, ['dept-support']);
    assert.equal(request.snapshot.title, payload.title); assert.equal(request.kind, 'initial');
    assert.equal(JSON.stringify(state.tasks), tasksBefore); assert.equal(JSON.stringify(state.units), unitsBefore);
    for (const user of ['u-support-head', 'u-doyun', 'u-support-member', 'u-jiho']) assert.equal(getWorkspace(state, user, now).commonTasks.some(item => item.id === id), false, user);
    for (const user of [actor.id, 'u-head', 'u-minseo', 'u-admin']) assert.equal(getWorkspace(state, user, now).commonTasks.some(item => item.id === id), true, user);
    assert.equal(state.notifications.some(item => item.targetId === id && item.userId === 'u-doyun'), false);
    assert.ok(state.notifications.some(item => item.targetId === id && item.userId === 'u-head'));
  }
});

test('publication: only source department head approves; administrative role and old flags do not bypass approval', () => {
  const state = createSeed(now), id = create(state), requestId = pending(state, id).id;
  for (const actor of ['u-seoyeon', 'u-minseo', 'u-admin', 'u-support-head']) denied(state, actor, 'common.approve', { commonId: id, requestId }, 403);
  denied(state, 'u-admin', 'common.assign', { commonId: id, departmentId: 'dept-support', unitId: 'unit-data', primaryId: 'u-support-member', reviewerId: 'u-support-head' });
  denied(state, 'u-doyun', 'common.assignTeam', { commonId: id, distributionId: 'invented', team: '데이터팀', leadId: 'u-support-lead' });
  approve(state, id);
  assert.equal(current(state, id).publicationStatus, 'approved'); assert.equal(current(state, id).distributions.length, 1);
  const resolved = current(state, id).approvalRequests![0]; assert.equal(resolved.status, 'approved'); assert.equal(resolved.resolvedBy, 'u-head'); assert.ok(resolved.resolvedAt);
  denied(state, 'u-head', 'common.approve', { commonId: id, requestId });
  assert.ok(state.audit.some(event => event.action === 'common.approve' && event.targetId === id));
});

test('publication: approved detail flows through receiving manager, team lead and work officer registration', () => {
  const state = createSeed(now), id = create(state); approve(state, id);
  assert.ok(getWorkspace(state, 'u-doyun', now).commonTasks.some(item => item.id === id));
  const distributionId = current(state, id).distributions[0].id, ref = { commonId: id, distributionId };
  denied(state, 'u-seoyeon', 'common.assignTeam', { ...ref, team: '데이터팀', leadId: 'u-support-lead' });
  denied(state, 'u-support-member', 'common.register', { ...ref, unitId: 'unit-data' });
  dispatch(state, 'u-doyun', 'common.assignTeam', { ...ref, team: '데이터팀', leadId: 'u-support-lead' });
  dispatch(state, 'u-support-lead', 'common.assignPerson', { ...ref, assigneeId: 'u-support-member' });
  dispatch(state, 'u-support-member', 'common.register', { ...ref, unitId: 'unit-data' });
  const task = state.tasks.find(item => item.commonId === id)!;
  assert.equal(task.title, payload.title); assert.equal(task.primaryId, 'u-support-member'); assert.equal(task.workflow.length, 2);
  assert.equal(getWorkspace(state, 'u-seoyeon', now).tasks.some(item => item.id === task.id), false);
  assert.equal(getWorkspace(state, 'u-seoyeon', now).commonTasks.find(item => item.id === id)!.distributions[0].assigneeId, 'u-support-member');
});

test('publication: rejected initial work is editable and resubmitted with its previous review preserved', () => {
  const state = createSeed(now), id = create(state), original = structuredClone(pending(state, id));
  denied(state, 'u-head', 'common.reject', { commonId: id, requestId: original.id, reason: '' });
  dispatch(state, 'u-head', 'common.reject', { commonId: id, requestId: original.id, reason: '대상 부서와 제출 내용을 보완해 주세요.' });
  assert.equal(current(state, id).publicationStatus, 'rejected'); assert.equal(current(state, id).distributions.length, 0);
  denied(state, 'u-jiho', 'common.resubmit', { commonId: id, ...payload, title: '다른 사람의 요청 변경' });
  dispatch(state, 'u-seoyeon', 'common.resubmit', { commonId: id, ...payload, title: '보완한 세부업무', departmentIds: ['dept-innovation'] });
  const requests = current(state, id).approvalRequests!;
  assert.equal(requests.length, 2); assert.equal(requests.find(item => item.id === original.id)!.snapshot.title, original.snapshot.title); assert.ok(requests.some(item => item.reason?.includes('보완')));
  assert.deepEqual(pending(state, id).targetDepartmentIds, ['dept-innovation']);
  assert.equal(getWorkspace(state, 'u-innovation-manager', now).commonTasks.some(item => item.id === id), false);
  approve(state, id);
  assert.deepEqual(current(state, id).departmentIds, ['dept-innovation']);
  denied(state, 'u-head', 'common.approve', { commonId: id, requestId: original.id });
});

test('publication: additional targets need separate approval and leave existing execution intact', () => {
  const state = createSeed(now), id = create(state); approve(state, id);
  const existing = structuredClone(current(state, id).distributions);
  dispatch(state, 'u-seoyeon', 'common.distribute', { commonId: id, departmentIds: ['dept-support', 'dept-innovation'] });
  const request = pending(state, id); assert.equal(request.kind, 'additional'); assert.deepEqual(request.targetDepartmentIds, ['dept-innovation']);
  assert.deepEqual(current(state, id).distributions, existing);
  assert.equal(getWorkspace(state, 'u-innovation-head', now).commonTasks.some(item => item.id === id), false);
  assert.equal(getWorkspace(state, 'u-doyun', now).commonTasks.find(item => item.id === id)?.approvalRequests?.some(item => item.id === request.id), false);
  denied(state, 'u-seoyeon', 'common.distribute', { commonId: id, departmentIds: ['dept-plan'] });
  dispatch(state, 'u-head', 'common.reject', { commonId: id, requestId: request.id, reason: '추가 배포 범위 검토 필요' });
  assert.equal(current(state, id).publicationStatus, 'approved'); assert.deepEqual(current(state, id).distributions, existing);
  dispatch(state, 'u-seoyeon', 'common.distribute', { commonId: id, departmentIds: ['dept-innovation'] }); approve(state, id);
  assert.equal(current(state, id).distributions.length, 2); assert.deepEqual(current(state, id).distributions.find(item => item.departmentId === 'dept-support'), existing[0]);
});

test('publication: all-department scope is fixed at request time and confirmed divisions can receive approved inbox work', () => {
  const state = createSeed(now); dispatch(state, 'u-head', 'department.confirm', {}); dispatch(state, 'u-support-head', 'department.confirm', {});
  const originalTasks = structuredClone(state.tasks), plans = structuredClone(state.departmentWorkPlans);
  const id = create(state, { distributionMode: 'all' });
  dispatch(state, 'u-admin', 'organization.departmentCreate', { name: '요청 후 신설부서', shortName: '신설' });
  approve(state, id);
  assert.equal(current(state, id).distributions.length, 3); assert.equal(current(state, id).departmentIds.includes(state.departments.at(-1)!.id), false);
  assert.deepEqual(state.tasks, originalTasks); assert.deepEqual(state.departmentWorkPlans, plans);
  denied(state, 'u-doyun', 'common.assignTeam', { commonId: id, distributionId: current(state, id).distributions.find(item => item.departmentId === 'dept-support')!.id, team: '데이터팀', leadId: 'u-support-lead' });
});

test('publication: directives are private before approval and cannot change the pending approval definition', () => {
  const state = createSeed(now), tasks = structuredClone(state.tasks);
  const id = create(state, { kind: 'directive', directiveIssuer: 'minister', instructedOn: '2026-11-01' }, 'u-support-member');
  assert.deepEqual(state.tasks, tasks); assert.equal(getWorkspace(state, 'u-seoyeon', now).commonTasks.some(item => item.id === id), false);
  denied(state, 'u-support-member', 'directive.updateMetadata', { commonId: id, directiveIssuer: 'vice_minister', instructedOn: '2026-11-02' });
  approve(state, id); assert.ok(state.tasks.some(item => item.commonId === id));
});

test('publication: legacy delivered work stays available but false/true retired flags do not grant ownership', () => {
  const state = createSeed(now), id = 'common-budget', before = structuredClone(current(state, id));
  state.departments.push({ id: 'dept-new', name: '추가 부서', shortName: '추가' });
  for (const role of ['manager', 'head'] as const) state.users.push({ ...state.users.find(user => user.departmentId === 'dept-support' && user.role === role)!, id: `u-new-${role}`, departmentId: 'dept-new' });
  assert.equal(before.publicationStatus, undefined); assert.ok(getWorkspace(state, 'u-support-head', now).commonTasks.some(item => item.id === id));
  state.users.find(user => user.id === 'u-seoyeon')!.commonTaskPermission = true;
  denied(state, 'u-seoyeon', 'common.distribute', { commonId: id, departmentIds: ['dept-new'] });
  state.users.find(user => user.id === before.managerId)!.commonTaskPermission = false;
  dispatch(state, before.managerId, 'common.distribute', { commonId: id, departmentIds: ['dept-new'] });
  assert.deepEqual(current(state, id).distributions, before.distributions);
  approve(state, id); assert.equal(current(state, id).distributions.length, before.distributions.length + 1);
});
