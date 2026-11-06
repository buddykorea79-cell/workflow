import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import { buildOrganizationDivision, filterOrganizationDivision, organizationDivisionRows } from '../src/lib/organization-division';
import type { Delegation } from '../src/lib/types';

const now = new Date('2026-11-06T03:00:00Z');

test('every organizational role receives the same cross-department titles without task contents or codes', () => {
  const state = createSeed(now);
  const privateTask = state.tasks.find(task => task.id === 'task-data')!;
  privateTask.description = 'PRIVATE-BODY-ORGANIZATION'; privateTask.code = 'PRIVATE-CODE-ORGANIZATION'; privateTask.references = [{ id: 'private-file', type: 'document', title: 'PRIVATE-DOCUMENT-NAME', content: 'PRIVATE-DOCUMENT-CONTENT', attachmentId: 'PRIVATE-FILE-ID' }];
  const expected = buildOrganizationDivision(state, now);
  for (const role of ['member', 'lead', 'manager', 'head', 'admin']) {
    const user = state.users.find(item => item.departmentId === 'dept-plan' && item.role === role)!;
    const workspace = getWorkspace(state, user.id, now);
    assert.deepEqual(workspace.organizationDivision, expected);
    if (role !== 'admin') assert.equal(workspace.tasks.some(task => task.id === privateTask.id), false);
  }
  assert.equal(expected.departments.length, state.departments.length);
  const serialized = JSON.stringify(expected);
  for (const value of ['PRIVATE-BODY', 'PRIVATE-CODE', 'PRIVATE-DOCUMENT', 'PRIVATE-FILE', '@ieum.example']) assert.equal(serialized.includes(value), false);
  for (const row of expected.departments.flatMap(department => department.people.flatMap(person => person.units.flatMap(unit => unit.tasks)))) assert.deepEqual(Object.keys(row).sort(), ['delegates', 'id', 'title']);
});

test('only currently approved original-task deputies are shown, without duplicating assignments', () => {
  const state = createSeed(now), task = state.tasks.find(item => item.id === 'task-data')!;
  const original = { ...structuredClone(state) };
  const valid: Delegation = { id: 'valid', taskId: task.id, fromId: task.primaryId, toId: 'u-doyun', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', actions: ['task.setProgress'], approvedBy: 'u-support-head', status: 'approved' };
  state.delegations = [valid,
    { ...valid, id: 'duplicate' }, { ...valid, id: 'pending', status: 'pending', toId: 'u-support-lead' },
    { ...valid, id: 'future', startsAt: '2026-11-07T00:00:00Z', toId: 'u-support-lead' }, { ...valid, id: 'expired', endsAt: now.toISOString(), toId: 'u-support-lead' },
    { ...valid, id: 'revoked', revokedAt: now.toISOString(), toId: 'u-support-lead' }, { ...valid, id: 'rejected', status: 'rejected', toId: 'u-support-lead' },
    { ...valid, id: 'old-owner', fromId: 'u-support-lead', toId: 'u-support-lead' }, { ...valid, id: 'wrong-department', toId: 'u-jiho' },
  ];
  const before = structuredClone(state);
  const model = buildOrganizationDivision(state, now);
  const tasks = model.departments.flatMap(department => department.people.flatMap(person => person.units.flatMap(unit => unit.tasks))).filter(item => item.id === task.id);
  assert.equal(tasks.length, 1); assert.deepEqual(tasks[0].delegates.map(item => item.id), ['u-doyun']);
  assert.equal(organizationDivisionRows(model).find(row => row.taskId === task.id)?.personId, task.primaryId);
  assert.deepEqual(state, before); assert.equal(state.tasks.length, original.tasks.length); assert.equal(state.units.length, original.units.length);
});

test('organization filters preserve the same department, team and original-owner hierarchy for exports', () => {
  const state = createSeed(now), model = buildOrganizationDivision(state, now);
  const owner = state.users.find(item => item.id === 'u-support-member')!;
  const filtered = filterOrganizationDivision(model, { departmentId: owner.departmentId, team: owner.team, name: ` ${owner.name} ` });
  assert.equal(filtered.departments.length, 1); assert.equal(filtered.departments[0].people.length, 1);
  const rows = organizationDivisionRows(filtered);
  assert.ok(rows.length); assert.ok(rows.every(row => row.departmentId === owner.departmentId && row.personId === owner.id && row.team === owner.team));
  assert.equal(filterOrganizationDivision(model, { name: '없는이름' }).departments.length, 0);
});

test('deleted, archived and unregistered common tasks are absent from the shared division', () => {
  const state = createSeed(now);
  state.tasks.find(item => item.id === 'task-data')!.deletedAt = now.toISOString();
  state.tasks.find(item => item.id === 'task-assets')!.status = 'archived';
  const unregistered = state.tasks.find(task => task.commonId && state.commonTasks.some(common => common.id === task.commonId && common.distributions.some(item => item.taskId === task.id && item.status === 'pending')));
  const rows = organizationDivisionRows(buildOrganizationDivision(state, now));
  assert.equal(rows.some(row => ['task-data', 'task-assets'].includes(row.taskId)), false);
  if (unregistered) assert.equal(rows.some(row => row.taskId === unregistered.id), false);
});
