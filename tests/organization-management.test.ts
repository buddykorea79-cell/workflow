import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { isOrganizationUserActive, organizationResponsibilities } from '../src/lib/organization-management';
import type { User, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-05T03:00:00Z');
const admin = 'u-admin';
function fixture() { return createSeed(now); }
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now);
  Object.assign(state, candidate);
}
function denied(state: WorkspaceData, code: string, actor: string, type: string, payload: Record<string, unknown>) {
  const before = structuredClone(state);
  assert.throws(() => dispatch(state, actor, type, payload), error => error instanceof DomainError && error.code === code);
  assert.deepEqual(state, before);
}
function staffInput(overrides: Record<string, unknown> = {}) { return { name: '신규직원', departmentId: 'dept-plan', team: '기획팀', role: 'member', title: '주무관', email: 'new-member@example.test', phone: '02-0000-9999', commonTaskPermission: false, ...overrides }; }
function addStaff(state: WorkspaceData, overrides: Record<string, unknown> = {}) { dispatch(state, admin, 'organization.userCreate', staffInput(overrides)); return state.users.at(-1)!; }
function updateInput(user: User, patch: Record<string, unknown> = {}) { return { userId: user.id, name: user.name, departmentId: user.departmentId, team: user.team, role: user.role, title: user.title, email: user.email || '', phone: user.phone || '', commonTaskPermission: !!user.commonTaskPermission, active: user.active, reason: '인사정보 정비', ...patch }; }
function emptyWork(state: WorkspaceData) { state.units = []; state.tasks = []; state.runs = []; state.commonTasks = []; state.handovers = []; state.workTransfers = []; state.delegations = []; }

test('organization management: admin registers a department and complete prototype staff roster', () => {
  const state = fixture(); dispatch(state, admin, 'organization.departmentCreate', { name: '신규정책실', shortName: '신규정책' });
  const department = state.departments.at(-1)!;
  const member = addStaff(state, { departmentId: department.id, email: ' New-Member@Example.Test ' });
  addStaff(state, { departmentId: department.id, name: '후임부서장', role: 'head', email: 'head-new@example.test' });
  addStaff(state, { departmentId: department.id, name: '후임담당', role: 'manager', email: 'manager-new@example.test' });
  assert.equal(member.email, 'new-member@example.test'); assert.equal(member.active, true);
  assert.equal(state.users.filter(user => user.departmentId === department.id).length, 3);
  assert.ok(getWorkspace(state, admin, now).users.some(user => user.id === member.id));
  assert.ok(state.audit.some(event => event.action === 'organization.userCreate' && event.targetId === member.id));
});

test('organization management: creation and changes remain admin-only', () => {
  const state = fixture(); const member = addStaff(state);
  for (const actor of ['u-head', 'u-minseo', 'u-plan-lead', 'u-seoyeon']) {
    denied(state, 'ADMIN_REQUIRED', actor, 'organization.departmentCreate', { name: '불가부서', shortName: '불가' });
    denied(state, 'ADMIN_REQUIRED', actor, 'organization.userCreate', staffInput({ email: 'other@example.test' }));
    denied(state, 'ADMIN_REQUIRED', actor, 'organization.userUpdate', updateInput(member, { name: '권한없는 변경' }));
  }
});

test('organization management: email uniqueness includes inactive accounts and field formats are validated', () => {
  const state = fixture(); const member = addStaff(state); member.active = false;
  denied(state, 'DUPLICATE_USER_EMAIL', admin, 'organization.userCreate', staffInput({ email: 'NEW-MEMBER@EXAMPLE.TEST' }));
  denied(state, 'VALIDATION_ERROR', admin, 'organization.userCreate', staffInput({ email: 'not-an-email' }));
  denied(state, 'VALIDATION_ERROR', admin, 'organization.userCreate', staffInput({ email: '', phone: '전화번호 아님' }));
  denied(state, 'DEPARTMENT_MISSING', admin, 'organization.userCreate', staffInput({ departmentId: 'missing', email: '' }));
  denied(state, 'DUPLICATE_DEPARTMENT', admin, 'organization.departmentCreate', { name: state.departments[0].name, shortName: '다른약칭' });
  denied(state, 'DUPLICATE_DEPARTMENT', admin, 'organization.departmentCreate', { name: '다른부서', shortName: state.departments[0].shortName });
  const other = addStaff(state, { email: 'other@example.test' });
  denied(state, 'DUPLICATE_USER_EMAIL', admin, 'organization.userUpdate', updateInput(other, { email: member.email }));
  denied(state, 'VALIDATION_ERROR', admin, 'organization.userUpdate', updateInput(other, { reason: ' ' }));
});

test('organization management: unassigned staff can transfer, deactivate and reactivate without rewriting history', () => {
  const state = fixture(); const member = addStaff(state);
  const records = structuredClone({ tasks: state.tasks, runs: state.runs, performances: state.performances, handovers: state.handovers, departmentWorkPlans: state.departmentWorkPlans });
  dispatch(state, admin, 'organization.userUpdate', updateInput(member, { departmentId: 'dept-support', team: '데이터팀', reason: '신규 부서 발령' }));
  let current = state.users.find(user => user.id === member.id)!;
  assert.equal(current.departmentId, 'dept-support'); assert.equal(current.id, member.id);
  dispatch(state, admin, 'organization.userUpdate', updateInput(current, { active: false, reason: '퇴직 처리' }));
  assert.equal(state.users.find(user => user.id === member.id)?.active, false);
  assert.throws(() => getWorkspace(state, member.id, now), error => error instanceof DomainError && error.code === 'ACCOUNT_INACTIVE');
  current = state.users.find(user => user.id === member.id)!; current.endsAt = '2026-10-01T00:00:00Z';
  dispatch(state, admin, 'organization.userUpdate', updateInput(current, { active: true, reason: '재직 확인 후 사용 재개' }));
  assert.equal(isOrganizationUserActive(state.users.find(user => user.id === member.id)!, now), true);
  assert.equal(state.users.find(user => user.id === member.id)?.endsAt, undefined);
  assert.deepEqual({ tasks: state.tasks, runs: state.runs, performances: state.performances, handovers: state.handovers, departmentWorkPlans: state.departmentWorkPlans }, records);
  const events = state.audit.filter(event => event.action === 'organization.userUpdate' && event.targetId === member.id);
  assert.equal(events.length, 3); assert.equal(JSON.parse(events[2].detail).before.departmentId, 'dept-plan'); assert.equal(JSON.parse(events[2].detail).after.departmentId, 'dept-support');
});

test('organization management: department transfer and deactivation fail while any work responsibility remains', () => {
  const state = fixture(); const member = state.users.find(user => user.id === 'u-support-member')!;
  const responsibilities = organizationResponsibilities(state, member.id, now);
  assert.ok(responsibilities.some(item => item.kind === 'unit'));
  assert.ok(responsibilities.some(item => item.kind === 'primary'));
  assert.ok(responsibilities.some(item => item.kind === 'run_primary'));
  denied(state, 'PERSONNEL_RESPONSIBILITIES_REMAIN', admin, 'organization.userUpdate', updateInput(member, { departmentId: 'dept-plan' }));
  denied(state, 'PERSONNEL_RESPONSIBILITIES_REMAIN', admin, 'organization.userUpdate', updateInput(member, { active: false }));
  dispatch(state, admin, 'organization.userUpdate', updateInput(member, { title: '연락처 정비 대상', phone: '02-0000-1234' }));
  assert.equal(state.users.find(user => user.id === member.id)?.phone, '02-0000-1234');
});

test('organization management: remaining support, reviewer, central coordinator, delegation and pending assignments are visible', () => {
  const state = fixture(); const member = addStaff(state, { role: 'lead' });
  const task = state.tasks.find(task => task.departmentId === member.departmentId && task.status !== 'archived')!;
  task.supportIds.push(member.id);
  const run = state.runs.find(run => run.taskId === task.id)!; run.supportIds.push(member.id);
  const other = state.tasks.find(item => item.departmentId === member.departmentId && item.id !== task.id && item.status !== 'archived')!; other.reviewerId = member.id;
  state.commonTasks[0].managerId = member.id;
  const distribution = state.commonTasks[0].distributions.find(item => item.departmentId === member.departmentId)!;
  distribution.status = 'person_assigned'; distribution.team = member.team; distribution.leadId = member.id; distribution.assigneeId = member.id;
  state.delegations.push({ id: 'future-delegation', taskId: task.id, fromId: task.primaryId, toId: member.id, startsAt: '2026-11-06T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', actions: ['run.note'], approvedBy: admin });
  const kinds = new Set(organizationResponsibilities(state, member.id, now).map(item => item.kind));
  for (const kind of ['task_support', 'run_support', 'task_reviewer', 'common_manager', 'distribution_lead', 'distribution_assignee', 'delegation_revoke']) assert.ok(kinds.has(kind), kind);
  denied(state, 'PERSONNEL_RESPONSIBILITIES_REMAIN', admin, 'organization.userUpdate', updateInput(member, { departmentId: 'dept-support' }));
});

test('organization management: role changes keep department officers and prevent self admin lockout', () => {
  const state = fixture(); emptyWork(state);
  const head = state.users.find(user => user.id === 'u-head')!;
  const manager = state.users.find(user => user.id === 'u-minseo')!;
  denied(state, 'DEPARTMENT_OFFICER_REQUIRED', admin, 'organization.userUpdate', updateInput(head, { active: false }));
  denied(state, 'DEPARTMENT_OFFICER_REQUIRED', admin, 'organization.userUpdate', updateInput(manager, { role: 'member' }));
  const self = state.users.find(user => user.id === admin)!;
  denied(state, 'SELF_ADMIN_LOCKOUT', admin, 'organization.userUpdate', updateInput(self, { active: false }));
  denied(state, 'SELF_ADMIN_LOCKOUT', admin, 'organization.userUpdate', updateInput(self, { role: 'member' }));
  addStaff(state, { name: '후임과장', role: 'head', email: 'replacement-head@example.test' });
  dispatch(state, admin, 'organization.userUpdate', updateInput(head, { active: false }));
  assert.equal(state.users.find(user => user.id === head.id)?.active, false);
});

test('organization management: promotion preserving execution eligibility is allowed; incompatible roles and team assignments are blocked', () => {
  const state = fixture(); const member = addStaff(state);
  dispatch(state, member.id, 'unit.create', { title: '신규 담당 업무', description: '역할 변경 검증' });
  dispatch(state, admin, 'organization.userUpdate', updateInput(member, { role: 'lead' }));
  const lead = state.users.find(user => user.id === member.id)!;
  denied(state, 'PERSONNEL_ROLE_CONFLICT', admin, 'organization.userUpdate', updateInput(lead, { role: 'head' }));
  const distribution = state.commonTasks[0].distributions.find(item => item.departmentId === lead.departmentId)!;
  distribution.status = 'team_assigned'; distribution.leadId = lead.id; distribution.team = lead.team;
  denied(state, 'PERSONNEL_ROLE_CONFLICT', admin, 'organization.userUpdate', updateInput(lead, { team: '다른팀' }));
  denied(state, 'PERSONNEL_ROLE_CONFLICT', admin, 'organization.userUpdate', updateInput(lead, { role: 'member' }));
});

test('organization management: finished runs and immutable historical authors do not block a transfer', () => {
  const state = fixture(); const member = addStaff(state);
  const completed = structuredClone(state.runs[0]); completed.id = 'historical-only'; completed.primaryId = member.id; completed.supportIds = [member.id]; completed.reviewerId = member.id; completed.status = 'completed'; state.runs.push(completed);
  assert.equal(organizationResponsibilities(state, member.id, now).length, 0);
  dispatch(state, admin, 'organization.userUpdate', updateInput(member, { departmentId: 'dept-support' }));
  assert.deepEqual(state.runs.find(run => run.id === completed.id), completed);
});
