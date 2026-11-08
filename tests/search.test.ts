import assert from 'node:assert/strict';
import test from 'node:test';
import { getWorkspace } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import { canSelectPersonalUnit, flattenSearchResults, searchResultRoute, searchWorkspace, type SearchResult } from '../src/lib/search';
import type { CommonTask, OrgRole, Unit, User, WorkspaceTask } from '../src/lib/types';

const now = new Date('2026-11-08T03:00:00Z');
type SearchWorkspace = Parameters<typeof searchWorkspace>[0];
const ids = (items: { id: string }[]) => items.map(item => item.id);
const result = (kind: SearchResult['kind'], id: string): SearchResult => ({ kind, id, title: '검색 당시 제목', description: '' });

function fixture() {
  const seed = createSeed(now), currentUser = { ...seed.users.find(user => user.id === 'u-jiho')! };
  const workspace: SearchWorkspace = { currentUser, tasks: [], units: [], commonTasks: [], users: [], departments: seed.departments };
  const unit = (id: string, changes: Partial<Unit> = {}) => {
    const item = { ...seed.units[0], id, title: id, ownerId: currentUser.id, ...changes };
    workspace.units.push(item); return item;
  };
  const task = (id: string, changes: Partial<WorkspaceTask> = {}) => {
    const item = { ...structuredClone(seed.tasks[0]), id, title: id, description: '', code: `CODE-${id}`, primaryId: currentUser.id, unitId: 'unit-main', commonId: undefined, ...changes };
    workspace.tasks.push(item); return item;
  };
  const common = (id: string, changes: Partial<CommonTask> = {}) => {
    const item = { ...structuredClone(seed.commonTasks[0]), id, title: id, description: '', distributions: [], ...changes };
    workspace.commonTasks.push(item); return item;
  };
  const person = (id: string, changes: Partial<User> = {}) => {
    const item = { ...currentUser, id, name: id, ...changes };
    workspace.users.push(item); return item;
  };
  unit('unit-main');
  return { workspace, seed, unit, task, common, person };
}

test('search normalizes whitespace and case, ranking title prefixes before title matches, codes, and descriptions', () => {
  const { workspace, task, unit, common, person } = fixture();
  task('description', { title: '안내', description: '계획 Budget\t review 자료' });
  task('contains', { title: '월별 BUDGET   REVIEW' });
  task('code', { title: '실적', code: 'BUDGET REVIEW-2026' });
  task('prefix', { title: 'Budget\nreview 계획' });
  task('second-prefix', { title: 'budget review 결과' });
  task('not-matching', { title: 'Budget report' });
  unit('unit-result', { title: 'BUDGET   REVIEW 편성' });
  common('common-result', { description: 'budget\nreview 담당' });
  person('person-result', { name: 'Budget  Review' });
  const groups = searchWorkspace(workspace, '  bUdGeT \t review\n');
  assert.deepEqual(ids(groups.tasks), ['prefix', 'second-prefix', 'contains', 'code', 'description']);
  assert.deepEqual(ids(groups.units), ['unit-result']);
  assert.deepEqual(ids(groups.commons), ['common-result']);
  assert.deepEqual(ids(groups.people), ['person-result']);
  assert.deepEqual(searchWorkspace(workspace, '초성없는검색'), { tasks: [], units: [], commons: [], people: [] });
});

test('each group is capped separately and keyboard results keep the visible group order', () => {
  const { workspace, task, unit, common, person } = fixture();
  for (let index = 0; index < 7; index++) {
    task(`task-${index}`, { title: `검색 ${index}` });
    unit(`unit-${index}`, { title: `검색 ${index}` });
    common(`common-${index}`, { title: `검색 ${index}` });
    person(`person-${index}`, { name: `검색 ${index}` });
  }
  const before = structuredClone(workspace), groups = searchWorkspace(workspace, '검색');
  assert.deepEqual(Object.values(groups).map(group => group.length), [5, 5, 5, 5]);
  const flat = flattenSearchResults(workspace, groups);
  assert.deepEqual(flat.map(item => item.kind), ['task', 'unit', 'common', 'person'].flatMap(kind => Array(5).fill(kind)));
  assert.equal(flat[0].description, 'CODE-task-0');
  assert.match(flat.at(-1)!.description, new RegExp(workspace.currentUser.team));
  assert.deepEqual(workspace, before);
});

test('trash and tasks under deleted units are excluded while readable archived and missing-unit tasks remain searchable', () => {
  const { workspace, task, unit, person } = fixture();
  unit('deleted-unit', { deletedAt: now.toISOString(), title: '검색 휴지통' });
  task('active', { title: '검색 현재' });
  task('deleted', { title: '검색 삭제', deletedAt: now.toISOString() });
  task('parent-deleted', { title: '검색 상위 삭제', unitId: 'deleted-unit' });
  task('archived', { title: '검색 보관', status: 'archived' });
  task('missing-unit', { title: '검색 기존 기록', unitId: 'unavailable-unit' });
  person('inactive', { name: '검색 퇴직자', active: false });
  const groups = searchWorkspace(workspace, '검색');
  assert.deepEqual(ids(groups.tasks), ['active', 'archived', 'missing-unit']);
  assert.deepEqual(groups.units, []);
  assert.deepEqual(ids(groups.people), ['inactive'], 'the organization screen still exposes readable inactive members');
});

test('empty queries return only five recent readable tasks, using creation dates when update dates are missing or invalid', () => {
  const { workspace, task } = fixture();
  for (let index = 0; index < 6; index++) task(`task-${index}`, { updatedAt: `2026-11-0${index + 1}T00:00:00Z` });
  task('fallback', { updatedAt: '', createdAt: '2026-11-07T00:00:00Z' });
  task('invalid-fallback', { updatedAt: 'invalid', createdAt: '2026-11-08T00:00:00Z' });
  task('all-invalid', { updatedAt: 'invalid', createdAt: 'invalid' });
  task('deleted-recent', { updatedAt: '2026-12-01T00:00:00Z', deletedAt: now.toISOString() });
  const groups = searchWorkspace(workspace, ' \n\t ');
  assert.deepEqual(ids(groups.tasks), ['invalid-fallback', 'fallback', 'task-5', 'task-4', 'task-3']);
  assert.deepEqual([groups.units, groups.commons, groups.people], [[], [], []]);
});

test('search uses only the supplied authorized entities and never promotes identities into person results', () => {
  const state = createSeed(now), workspace = getWorkspace(state, 'u-jiho', now);
  const hidden = state.users.find(user => !workspace.users.some(item => item.id === user.id))!;
  assert.ok(hidden, 'fixture has an out-of-scope colleague');
  workspace.identities = [...(workspace.identities ?? []), { id: hidden.id, name: '참조전용 인물', departmentId: hidden.departmentId, team: hidden.team }];
  assert.deepEqual(searchWorkspace(workspace, '참조전용').people, []);
  assert.deepEqual(searchResultRoute(workspace, result('person', hidden.id)), { view: 'organization' });
  for (const groups of [searchWorkspace(workspace, ''), searchWorkspace(workspace, '업무')]) {
    assert.ok(groups.tasks.every(task => workspace.tasks.includes(task)));
    assert.ok(groups.units.every(unit => workspace.units.includes(unit)));
    assert.ok(groups.commons.every(common => workspace.commonTasks.includes(common)));
    assert.ok(groups.people.every(person => workspace.users.includes(person)));
  }
});

test('personal unit eligibility matches ownership and active primary work for all five roles without an admin shortcut', () => {
  const { workspace, unit, task } = fixture();
  const owned = workspace.units[0], shared = unit('shared', { ownerId: 'another-owner' }), other = unit('other', { ownerId: 'another-owner' });
  task('mine', { unitId: shared.id });
  task('support-only', { unitId: other.id, primaryId: 'another-person', supportIds: [workspace.currentUser.id] });
  const synthetic = unit('__personal_delegated_work__');
  for (const role of ['member', 'lead', 'manager', 'head', 'admin'] as OrgRole[]) {
    workspace.currentUser.role = role;
    assert.equal(canSelectPersonalUnit(workspace, owned), true, role);
    assert.equal(canSelectPersonalUnit(workspace, shared), true, role);
    assert.equal(canSelectPersonalUnit(workspace, other), false, role);
    assert.equal(canSelectPersonalUnit(workspace, synthetic), false, role);
    assert.equal(canSelectPersonalUnit(workspace, { id: 'forged-unit' }), false, role);
  }
  owned.deletedAt = now.toISOString();
  assert.equal(canSelectPersonalUnit(workspace, owned), false);
  workspace.tasks[0].status = 'archived';
  assert.equal(canSelectPersonalUnit(workspace, shared), false);
  workspace.tasks[0].status = 'draft'; workspace.tasks[0].deletedAt = now.toISOString();
  assert.equal(canSelectPersonalUnit(workspace, shared), false);
});

test('personal unit eligibility preserves registered common and legacy missing-distribution behavior exactly', () => {
  const { workspace, unit, task, common, seed } = fixture();
  const shared = unit('common-unit', { ownerId: 'another-owner' });
  const source = common('source');
  const assigned = task('assigned', { unitId: shared.id, commonId: source.id });
  const distribution = { ...seed.commonTasks[0].distributions[0], taskId: assigned.id };
  source.distributions.push(distribution);
  for (const status of ['pending', 'team_assigned', 'person_assigned', 'assigned', 'registered', 'submitted'] as const) {
    distribution.status = status;
    assert.equal(canSelectPersonalUnit(workspace, shared), ['assigned', 'registered', 'submitted'].includes(status), status);
  }
  source.distributions = [];
  assert.equal(canSelectPersonalUnit(workspace, shared), true);
  workspace.commonTasks = [];
  assert.equal(canSelectPersonalUnit(workspace, shared), true);
});

test('result routes select personal units only when available and use division focus otherwise for every role', () => {
  const { workspace, task, unit, common, person } = fixture();
  const owned = workspace.units[0], other = unit('other', { ownerId: 'another-owner' });
  task('task-result'); common('common-result'); person('person-result', { active: false });
  for (const role of ['member', 'lead', 'manager', 'head', 'admin'] as OrgRole[]) {
    workspace.currentUser.role = role;
    assert.deepEqual(searchResultRoute(workspace, result('task', 'task-result')), { view: role === 'head' ? 'department' : 'personal', taskId: 'task-result', tab: 'overview' });
    assert.deepEqual(searchResultRoute(workspace, result('unit', owned.id)), { view: role === 'head' ? 'division' : 'personal', focus: owned.id });
    assert.deepEqual(searchResultRoute(workspace, result('unit', other.id)), { view: 'division', focus: other.id });
  }
  assert.deepEqual(searchResultRoute(workspace, result('common', 'common-result')), { view: 'common', focus: 'common-result' });
  assert.deepEqual(searchResultRoute(workspace, result('person', 'person-result')), { view: 'organization', focus: 'person-result' });
});

test('result selection rechecks stale, deleted, absent, and unsafe IDs before producing a hash target', () => {
  const { workspace, task, unit, common, person } = fixture();
  task('deleted', { deletedAt: now.toISOString() });
  unit('deleted-unit', { deletedAt: now.toISOString() }); task('child', { unitId: 'deleted-unit' });
  for (const id of ['missing', 'deleted', 'child']) assert.deepEqual(searchResultRoute(workspace, result('task', id)), { view: 'personal' });
  for (const id of ['missing', 'deleted-unit', '__personal_delegated_work__']) assert.deepEqual(searchResultRoute(workspace, result('unit', id)), { view: 'division' });
  assert.deepEqual(searchResultRoute(workspace, result('common', 'missing')), { view: 'common' });
  assert.deepEqual(searchResultRoute(workspace, result('person', 'missing')), { view: 'organization' });
  task('../unsafe'); unit('../unsafe'); common('../unsafe'); person('../unsafe');
  assert.deepEqual(searchResultRoute(workspace, result('task', '../unsafe')), { view: 'personal' });
  assert.deepEqual(searchResultRoute(workspace, result('unit', '../unsafe')), { view: 'personal' });
  assert.deepEqual(searchResultRoute(workspace, result('common', '../unsafe')), { view: 'common' });
  assert.deepEqual(searchResultRoute(workspace, result('person', '../unsafe')), { view: 'organization' });
});

test('flattening refreshes readable labels and drops removed results instead of using stale caller data', () => {
  const { workspace, task, person } = fixture();
  const current = task('current', { title: '검색 전 제목' });
  person('person', { name: '검색 전 인물' });
  const groups = structuredClone(searchWorkspace(workspace, '검색'));
  current.title = '최신 제목'; workspace.users = [];
  groups.tasks.push({ ...current, id: 'not-readable', title: '노출 금지' });
  const flat = flattenSearchResults(workspace, groups);
  assert.deepEqual(flat.map(item => ({ kind: item.kind, id: item.id, title: item.title })), [{ kind: 'task', id: 'current', title: '최신 제목' }]);
});
