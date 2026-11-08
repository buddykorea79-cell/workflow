import assert from 'node:assert/strict';
import test from 'node:test';
import { commonRegistrationState, registrationUnitTitle, savedRegistrationUnit } from '../src/lib/common-registration';
import { createSeed } from '../src/lib/seed';
import type { CommonTask, Unit, Workspace } from '../src/lib/types';

function fixture() {
  const seed = createSeed(new Date('2026-11-08T03:00:00Z'));
  const currentUser = seed.users.find(user => user.id === 'u-jiho')!;
  const common: CommonTask = { ...seed.commonTasks[0], id: 'common-registration', publicationStatus: 'approved', distributions: [{
    ...seed.commonTasks[0].distributions[0], id: 'distribution-registration', departmentId: currentUser.departmentId, assigneeId: currentUser.id, status: 'person_assigned',
  }] };
  const own: Unit = { ...seed.units[0], id: 'own', departmentId: currentUser.departmentId, ownerId: currentUser.id, title: '내 업무' };
  const workspace: Parameters<typeof commonRegistrationState>[0] = { currentUser, commonTasks: [common], units: [], departmentWorkPlans: [], serverTime: '2026-11-08T03:00:00Z' };
  return { workspace, common, own };
}

test('zero-unit assignees can register after creating an active own-department unit', () => {
  const { workspace, common, own } = fixture();
  const state = () => commonRegistrationState(workspace, common.id, common.distributions[0].id);
  assert.equal(state().blocked, '');
  assert.deepEqual(state().units, []);
  workspace.units.push(own, { ...own, id: 'deleted', deletedAt: workspace.serverTime }, { ...own, id: 'other-owner', ownerId: 'other' }, { ...own, id: 'other-department', departmentId: 'another-department' });
  assert.deepEqual(state().units.map(unit => unit.id), ['own']);
  assert.equal(state().blocked, '');
});

test('a stale open modal must recheck assignment, approval, active user and department definition permissions', () => {
  type Fixture = ReturnType<typeof fixture>;
  const cases = [
    (data: Fixture) => { data.common.distributions[0].assigneeId = 'another-person'; },
    (data: Fixture) => { data.common.distributions[0].status = 'registered'; },
    (data: Fixture) => { data.common.distributions[0].departmentId = 'another-department'; },
    (data: Fixture) => { data.common.publicationStatus = 'pending'; },
    (data: Fixture) => { data.workspace.currentUser.active = false; },
    (data: Fixture) => { data.workspace.currentUser.endsAt = data.workspace.serverTime; },
    (data: Fixture) => { data.workspace.currentUser.role = 'head'; },
    (data: Fixture) => { data.workspace.departmentWorkPlans = [{ departmentId: data.workspace.currentUser.departmentId, status: 'confirmed', version: 1 }]; },
    (data: Fixture) => { data.workspace.commonTasks = []; },
  ];
  for (const change of cases) {
    const data = fixture(); change(data);
    assert.ok(commonRegistrationState(data.workspace, data.common.id, data.common.distributions[0].id).blocked);
  }
});

test('saved unit lookup uses actual receipts or the command audit and cannot select a pre-existing duplicate', () => {
  const { workspace, own } = fixture();
  const created = { ...own, id: 'created', title: '사업 이름', rev: 1 };
  const context = { ownerId: own.ownerId, departmentId: own.departmentId, previousUnitIds: [own.id], title: created.title };
  const result: Pick<Workspace, 'units' | 'audit' | 'commandChanges'> = { units: [own, created], audit: [], commandChanges: [{ kind: 'unit', id: created.id, fromRev: 0, toRev: 1 }] };
  assert.equal(savedRegistrationUnit(result, context)?.id, created.id);
  result.commandChanges = [];
  result.audit = [{ id: 'audit', actorId: own.ownerId, action: 'unit.create', targetType: 'unit', targetId: created.id, title: '단위업무 등록', detail: created.title, departmentId: own.departmentId, createdAt: workspace.serverTime }];
  assert.equal(savedRegistrationUnit(result, context)?.id, created.id);
  result.units = [{ ...own, title: created.title }];
  result.audit[0].targetId = own.id;
  assert.equal(savedRegistrationUnit(result, context), undefined);
});

test('saved unit fallback accepts one newly returned own unit but rejects ambiguous, deleted or foreign candidates', () => {
  const { own } = fixture();
  const context = { ownerId: own.ownerId, departmentId: own.departmentId, previousUnitIds: [own.id], title: ' 새 사업 ' };
  const created = { ...own, id: 'created', title: '새 사업' };
  const result: Pick<Workspace, 'units' | 'audit' | 'commandChanges'> = { units: [own, created], audit: [] };
  assert.equal(savedRegistrationUnit(result, context)?.id, 'created');
  result.units.push({ ...created, id: 'another-created' });
  assert.equal(savedRegistrationUnit(result, context), undefined);
  for (const changes of [{ deletedAt: '2026-11-08' }, { ownerId: 'other' }, { departmentId: 'another-department' }]) {
    result.units = [own, { ...created, ...changes }];
    assert.equal(savedRegistrationUnit(result, context), undefined);
  }
  result.units = [own, created];
  assert.equal(savedRegistrationUnit(result, { ...context, previousUnitIds: [own.id, created.id], unitId: created.id })?.id, created.id, 'further saves update the resolved unit, without creating another');
});

test('project title suggestions respect the 100-character input limit without splitting a Unicode character', () => {
  assert.equal(registrationUnitTitle(), '');
  assert.equal(registrationUnitTitle('공통 사업'), '공통 사업');
  assert.equal(registrationUnitTitle('가'.repeat(150)), '가'.repeat(100));
  assert.equal(registrationUnitTitle('가'.repeat(99) + '📁추가'), '가'.repeat(99));
  assert.equal(registrationUnitTitle('📁'.repeat(60)), '📁'.repeat(50));
});
