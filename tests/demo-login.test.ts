import test from 'node:test';
import assert from 'node:assert/strict';
import { demoCandidates, demoDefaultDepartment, selectDemoUser, type DemoRole } from '../src/lib/demo-login';
import { createSeed } from '../src/lib/seed';
import type { User } from '../src/lib/types';

const user = (id: string, role: User['role'], departmentId: string, commonTaskPermission = false): User => ({ id, role, departmentId, commonTaskPermission, name: id, initials: '', team: '시연팀', title: '시연 직원', color: 'stone', active: true });
const users = [
  user('u-admin', 'admin', 'dept-plan', true),
  user('u-minseo', 'manager', 'dept-plan', true),
  user('u-plan-other', 'member', 'dept-plan'),
  user('u-jiho', 'member', 'dept-plan', true),
  user('u-extra-member', 'member', 'dept-support'),
  user('u-support-member', 'member', 'dept-support'),
  user('u-support-lead', 'lead', 'dept-support'),
  user('u-doyun', 'manager', 'dept-support', true),
  user('u-support-head', 'head', 'dept-support'),
  user('u-support-admin', 'admin', 'dept-support', true),
  user('u-innovation-member', 'member', 'dept-innovation', true),
];

test('ordinary role defaults select data department accounts including its administrator', () => {
  const expected: [DemoRole, string][] = [['member', 'u-support-member'], ['lead', 'u-support-lead'], ['manager', 'u-doyun'], ['head', 'u-support-head'], ['admin', 'u-support-admin']];
  for (const [role, id] of expected) {
    const department = demoDefaultDepartment(role);
    const selected = selectDemoUser(demoCandidates(users, role, department), role, '');
    assert.equal(department, 'dept-support');
    assert.equal(selected?.id, id);
    assert.equal(selected?.departmentId, department);
  }
});

test('work officers use their organization role regardless of retired common permission', () => {
  const candidates = demoCandidates(users, 'member', 'dept-plan');
  assert.deepEqual(candidates.map(item => item.id), ['u-plan-other', 'u-jiho']);
  assert.deepEqual(demoCandidates(users.map(item => ({ ...item, commonTaskPermission: false })), 'member', 'dept-plan').map(item => item.id), ['u-plan-other', 'u-jiho']);
  assert.deepEqual(demoCandidates(users, 'common' as DemoRole, 'dept-plan'), []);
});

test('manual department selection stays scoped and stale account choices cannot cross departments', () => {
  const candidates = demoCandidates(users, 'member', 'dept-innovation');
  assert.equal(selectDemoUser(candidates, 'member', 'u-support-member')?.id, 'u-innovation-member');
  const admins = demoCandidates(users, 'admin', 'dept-plan');
  assert.equal(selectDemoUser(admins, 'admin', 'u-support-admin')?.id, 'u-admin');
  assert.equal(selectDemoUser(demoCandidates(users, 'member', 'dept-support'), 'member', 'u-extra-member')?.id, 'u-extra-member');
  assert.equal(demoDefaultDepartment('member'), 'dept-support');
});

test('presentation officers 1 and 2 select Song and Jo in the same department for handover', () => {
  const users = createSeed(new Date('2026-11-10T03:00:00Z')).users;
  const senderDepartment = demoDefaultDepartment('member1');
  const recipientDepartment = demoDefaultDepartment('member2');
  const sender = selectDemoUser(demoCandidates(users, 'member1', senderDepartment), 'member1', '');
  const recipient = selectDemoUser(demoCandidates(users, 'member2', recipientDepartment), 'member2', '');
  assert.equal(sender?.id, 'u-support-member'); assert.equal(sender?.departmentId, 'dept-support');
  assert.equal(sender?.name, '송주무관');
  assert.equal(recipient?.id, 'u-it-planning-member-1'); assert.equal(recipient?.departmentId, 'dept-support');
  assert.equal(recipient?.name, '조주무관');
  assert.equal(sender?.role, 'member'); assert.equal(recipient?.role, 'member');
  assert.deepEqual(demoCandidates(users, 'member1', 'dept-plan'), demoCandidates(users, 'member', 'dept-plan'));
});
