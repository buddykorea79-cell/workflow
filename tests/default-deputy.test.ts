import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { canReadTask, DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { commandExpectation } from '../src/lib/command-targets';
import { defaultDeputyCandidates, getDefaultDeputy } from '../src/lib/default-deputy';
import { canActAsDeputy, canReviewTaskDelegation } from '../src/lib/delegations';
import { canReviewTransfer } from '../src/lib/transfer-permissions';
import type { Command, User, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-10T03:00:00Z');
const type = 'organization.setDefaultDeputy';
const admin = 'u-admin';
const jo = 'u-it-planning-member-1';
const shin = 'u-it-planning-member-2';
const member = (state: Pick<WorkspaceData, 'users'>, userId: string) => state.users.find(person => person.id === userId)!;
const payload = (userId = jo, deputyId: string | null = shin) => ({ userId, deputyId, reason: '같은 팀 우선 기본 대행자 지정' });

function dispatch(state: WorkspaceData, actor: string, commandType: string, input: Record<string, unknown>, options: Partial<Pick<Command, 'expected' | 'requestId'>> = {}) {
  const candidate = structuredClone(state);
  const changes = executeCommand(candidate, actor, {
    type: commandType, payload: input, expectedRevision: state.revision,
    expected: commandExpectation(state, commandType, input, actor) ?? undefined, requestId: randomUUID(), ...options,
  }, now);
  Object.assign(state, candidate);
  return changes;
}

function denied(state: WorkspaceData, code: string, actor: string, input: Record<string, unknown>, options: Partial<Pick<Command, 'expected' | 'requestId'>> = {}) {
  const before = structuredClone(state);
  assert.throws(() => dispatch(state, actor, type, input, options), error => error instanceof DomainError && error.code === code);
  assert.deepEqual(state, before);
}

function updateInput(person: User, changes: Record<string, unknown> = {}) {
  return { userId: person.id, name: person.name, departmentId: person.departmentId, team: person.team, role: person.role,
    title: person.title, email: person.email || '', phone: person.phone || '', active: person.active, reason: '인사정보 정비', ...changes };
}

test('default deputy: same-team active candidates come first without changing the roster', () => {
  const base = member(createSeed(now), jo);
  const owner = { ...base, id: 'owner' };
  const people: User[] = [owner,
    { ...base, id: 'adjacent-team', team: '데이터팀' },
    { ...base, id: 'same-team' },
    { ...base, id: 'other-department', departmentId: 'dept-plan' },
    { ...base, id: 'head', role: 'head' },
    { ...base, id: 'inactive', active: false },
    { ...base, id: 'expired', endsAt: now.toISOString() },
    { ...base, id: 'invalid-expiry', endsAt: 'invalid' },
    { ...base, id: 'same-team-lead', role: 'lead' },
    { ...base, id: 'active-admin', role: 'admin', team: '시스템운영팀' },
  ];
  const state = { users: people }; const before = structuredClone(state);
  assert.deepEqual(defaultDeputyCandidates(state, owner, now).map(person => person.id), ['same-team', 'same-team-lead', 'adjacent-team', 'active-admin']);
  assert.equal(getDefaultDeputy(state, owner, now), undefined);
  assert.deepEqual(defaultDeputyCandidates(state, { ...owner, active: false }, now), []);
  assert.deepEqual(state, before);
});

test('default deputy: saved references are hidden after removal, personnel changes or expiry', () => {
  for (const change of ['removed', 'department', 'inactive', 'expired', 'head', 'self', 'owner-inactive'] as const) {
    const state = createSeed(now); const owner = member(state, jo); const deputy = member(state, shin);
    owner.defaultDeputyId = deputy.id;
    assert.equal(getDefaultDeputy(state, owner, now)?.id, deputy.id);
    if (change === 'removed') state.users = state.users.filter(person => person.id !== deputy.id);
    if (change === 'department') deputy.departmentId = 'dept-plan';
    if (change === 'inactive') deputy.active = false;
    if (change === 'expired') deputy.endsAt = now.toISOString();
    if (change === 'head') deputy.role = 'head';
    if (change === 'self') owner.defaultDeputyId = owner.id;
    if (change === 'owner-inactive') owner.active = false;
    const saved = structuredClone(state);
    assert.equal(getDefaultDeputy(state, owner, now), undefined, change);
    assert.deepEqual(state, saved, 'read-time filtering preserves the saved record');
  }
  const state = createSeed(now); const head = member(state, 'u-support-head');
  head.defaultDeputyId = 'u-it-planning-lead';
  assert.ok(defaultDeputyCandidates(state, head, now).every(person => person.role === 'lead'));
  assert.equal(getDefaultDeputy(state, head, now)?.id, 'u-it-planning-lead');
  member(state, 'u-it-planning-lead').role = 'member';
  assert.equal(getDefaultDeputy(state, head, now), undefined);
});

test('default deputy: administrator sets and clears only the target metadata with audit and user revisions', () => {
  const state = createSeed(now); const previous = structuredClone(member(state, jo));
  const otherUsers = structuredClone(state.users.filter(person => person.id !== jo));
  const expected = commandExpectation(state, type, payload(), admin)!;
  assert.deepEqual(expected, { kind: 'user', id: jo, rev: previous.rev ?? 0 });
  const changes = dispatch(state, admin, type, payload());
  assert.equal(member(state, jo).defaultDeputyId, shin);
  assert.equal(member(state, jo).rev, expected.rev + 1);
  assert.deepEqual(changes.filter(change => change.kind === 'user'), [{ kind: 'user', id: jo, fromRev: expected.rev, toRev: expected.rev + 1 }]);
  assert.deepEqual(state.users.filter(person => person.id !== jo), otherUsers);
  const event = state.audit.find(item => item.action === type)!;
  assert.equal(event.actorId, admin); assert.equal(event.targetId, jo); assert.equal(event.departmentId, previous.departmentId);
  assert.deepEqual(JSON.parse(event.detail), { reason: payload().reason, before: { defaultDeputyId: null }, after: { defaultDeputyId: shin } });
  assert.equal(getWorkspace(state, jo, now).currentUser.defaultDeputyId, shin);
  dispatch(state, admin, type, payload(jo, null));
  assert.equal(Object.hasOwn(member(state, jo), 'defaultDeputyId'), false);
  assert.deepEqual(JSON.parse(state.audit.find(item => item.action === type)!.detail).after, { defaultDeputyId: null });
});

test('default deputy: non-admins and ineligible people cannot change the assignment', () => {
  const state = createSeed(now);
  for (const actor of [jo, 'u-it-planning-lead', 'u-doyun', 'u-support-head']) denied(state, 'ADMIN_REQUIRED', actor, payload());
  for (const deputyId of [jo, 'u-jiho', 'u-support-head', 'missing-person']) denied(state, 'DEFAULT_DEPUTY_INVALID', admin, payload(jo, deputyId));
  member(state, shin).active = false;
  denied(state, 'DEFAULT_DEPUTY_INVALID', admin, payload());
  member(state, shin).active = true; member(state, shin).endsAt = now.toISOString();
  denied(state, 'DEFAULT_DEPUTY_INVALID', admin, payload());
  delete member(state, shin).endsAt;
  denied(state, 'DEFAULT_DEPUTY_INVALID', admin, payload('u-support-head', shin));
  dispatch(state, admin, type, payload('u-support-head', 'u-it-planning-lead'));
  assert.equal(member(state, 'u-support-head').defaultDeputyId, 'u-it-planning-lead');
  dispatch(state, admin, type, payload(jo, 'u-support-admin'));
  assert.equal(member(state, jo).defaultDeputyId, 'u-support-admin');
  denied(state, 'USER_NOT_FOUND', admin, payload('missing-person', shin));
  member(state, jo).active = false;
  denied(state, 'DEFAULT_DEPUTY_PERSON_INACTIVE', admin, payload());
  denied(state, 'DEFAULT_DEPUTY_PERSON_INACTIVE', admin, payload(jo, null));
  member(state, jo).active = true; member(state, jo).endsAt = now.toISOString();
  denied(state, 'DEFAULT_DEPUTY_PERSON_INACTIVE', admin, payload());
});

test('default deputy: explicit clearing, change reasons, idempotency and conflict checks are enforced', () => {
  const state = createSeed(now);
  for (const input of [{ ...payload(), deputyId: '' }, { ...payload(), deputyId: undefined }, { ...payload(), reason: '' }, { ...payload(), reason: ' ' }, { ...payload(), actions: ['run.completeStep'] }]) {
    denied(state, 'VALIDATION_ERROR', admin, input);
  }
  const expected = commandExpectation(state, type, payload(), admin)!;
  const requestId = randomUUID();
  dispatch(state, admin, type, payload(), { expected, requestId });
  const after = structuredClone(state);
  assert.deepEqual(dispatch(state, admin, type, payload(), { expected, requestId }), []);
  assert.deepEqual(state, after);
  denied(state, 'IDEMPOTENCY_CONFLICT', admin, payload(jo, null), { requestId });
  denied(state, 'TARGET_CONFLICT', admin, payload(jo, null), { expected });
  denied(state, 'COMMAND_TARGET_MISMATCH', admin, payload(jo, null), { expected: { kind: 'user', id: shin, rev: 0 } });
});

test('default deputy: metadata does not approve pending delegations or grant task and head authority', () => {
  const state = createSeed(now); const deputy = member(state, jo);
  const task = state.tasks.find(item => item.primaryId === 'u-support-member' && !item.commonId && !canReadTask(state, deputy, item, now))!;
  assert.ok(task);
  dispatch(state, admin, 'delegation.request', { taskId: task.id, toId: jo, startsAt: '2026-11-10T00:00:00Z', endsAt: '2026-11-20T00:00:00Z', reason: '기간제 대행은 별도 승인 대기' });
  const records = () => ({ tasks: state.tasks, units: state.units, runs: state.runs, delegations: state.delegations, handovers: state.handovers, workTransfers: state.workTransfers, commonTasks: state.commonTasks, notifications: state.notifications, performances: state.performances, departmentWorkPlans: state.departmentWorkPlans });
  const before = structuredClone(records());
  dispatch(state, admin, type, payload(task.primaryId, jo));
  dispatch(state, admin, type, payload('u-support-head', 'u-it-planning-lead'));
  assert.deepEqual(records(), before);
  assert.equal(canActAsDeputy(state, member(state, jo), task, 'run.completeStep', now), false);
  assert.equal(canReadTask(state, member(state, jo), task, now), false);
  const lead = member(state, 'u-it-planning-lead');
  assert.equal(canReviewTaskDelegation(state, lead, state.delegations[0], now), false);
  assert.equal(canReviewTransfer(lead, { departmentId: lead.departmentId, status: 'pending' }, now), false);
  assert.equal(state.delegations[0].status, 'pending');
});

test('default deputy: normal personnel updates preserve the field and do not block a deputy transfer or departure', () => {
  const state = createSeed(now);
  state.users.push({ ...member(state, shin), id: 'default-deputy-free-member', name: '기본대행담당', email: 'free-deputy@example.test' });
  const deputyId = state.users.at(-1)!.id;
  dispatch(state, admin, type, payload(jo, deputyId));
  dispatch(state, admin, 'organization.userUpdate', updateInput(member(state, jo), { title: '정보화 기획 담당 주무관', defaultDeputyId: 'u-support-head' }));
  assert.equal(member(state, jo).defaultDeputyId, deputyId, 'the general edit preserves the dedicated field and ignores an injected replacement');
  dispatch(state, admin, 'organization.userUpdate', updateInput(member(state, deputyId), { departmentId: 'dept-plan', team: '기획팀' }));
  assert.equal(member(state, jo).defaultDeputyId, deputyId);
  assert.equal(getDefaultDeputy(state, member(state, jo), now), undefined);
  dispatch(state, admin, 'organization.userUpdate', updateInput(member(state, deputyId), { departmentId: 'dept-support', team: '정보기획팀' }));
  assert.equal(getDefaultDeputy(state, member(state, jo), now)?.id, deputyId);
  dispatch(state, admin, 'organization.userUpdate', updateInput(member(state, deputyId), { active: false }));
  assert.equal(member(state, jo).defaultDeputyId, deputyId);
  assert.equal(getDefaultDeputy(state, member(state, jo), now), undefined);
});
