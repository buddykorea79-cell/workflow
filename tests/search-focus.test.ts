import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import { canSelectPersonalUnit } from '../src/lib/search';

const componentRequire = createRequire(path.resolve('tests/search-focus.test.ts'));
const previousCssLoader = componentRequire.extensions['.css'];
componentRequire.extensions['.css'] = () => undefined;
const focus = componentRequire('../src/components/notification-focus');
const focusModule = componentRequire.cache[componentRequire.resolve('../src/components/notification-focus')]!;
const ui = componentRequire('../src/components/ui');
const uiModule = componentRequire.cache[componentRequire.resolve('../src/components/ui')]!;
let prepared = false;
let target: string | undefined;
let personal: typeof import('../src/components/personal-work');
let management: typeof import('../src/components/management');
let division: typeof import('../src/components/organization-division');
try {
  focusModule.exports = { ...focus, useNotificationFocus: (id: string | undefined, _token: number | undefined, prepare: (id: string) => string | undefined) => {
    // Apply the real screen's preparation once; React then renders its changed filters.
    if (id && !prepared) { prepared = true; target = prepare(id); }
    return (key: string) => ({ 'data-focus-key': key });
  } };
  uiModule.exports = { ...ui, Modal: ({ title, children }: { title: string; children: ReactNode }) => createElement('section', { role: 'dialog', 'aria-label': title }, children) };
  personal = componentRequire('../src/components/personal-work');
  management = componentRequire('../src/components/management');
  division = componentRequire('../src/components/organization-division');
} finally {
  focusModule.exports = focus;
  uiModule.exports = ui;
  if (previousCssLoader) componentRequire.extensions['.css'] = previousCssLoader;
  else delete componentRequire.extensions['.css'];
}

function fixture(actor = 'u-jiho') {
  const now = new Date('2026-11-08T03:00:00Z');
  return getWorkspace(createSeed(now), actor, now);
}
const command = async () => true;

function renderWithPreviousState(element: ReactNode, previousState: unknown[] = []) {
  prepared = false; target = undefined;
  const react = componentRequire('react') as typeof import('react');
  const original = react.useState;
  let index = 0;
  // Seed only the screen's initial local state, preserving React's actual setters/rerender.
  react.useState = ((initial: unknown) => {
    const position = index++;
    return original(position < previousState.length ? previousState[position] : initial);
  }) as typeof react.useState;
  try { return renderToStaticMarkup(element); }
  finally { react.useState = original; }
}

test('personal search focus exits trash and filters, selects the unit and closes approved-away forms', () => {
  const workspace = fixture();
  const unit = workspace.units.find(item => canSelectPersonalUnit(workspace, item))!;
  const task = workspace.tasks.find(item => item.unitId === unit.id && item.primaryId === workspace.currentUser.id)!;
  const html = renderWithPreviousState(createElement(personal.PersonalWork, { workspace, command, focusId: unit.id }), [
    'trash', 'common', 'no matching task', [unit.id], 'unit', unit.id, unit.id, 'unfinished unit',
    { id: task.id, mode: 'edit' }, { kind: 'unit', id: unit.id, title: unit.title },
    { commonId: 'common-budget', distributionId: 'missing', title: 'pending registration' }, unit.id, true,
  ]);
  assert.equal(target, `unit:${unit.id}`);
  assert.match(html, /pw-task-groups pw-selected-unit/);
  assert.ok(html.includes(`data-focus-key="unit:${unit.id}"`));
  assert.ok(html.includes(task.title));
  assert.doesNotMatch(html, /no matching task|role="dialog"/);
  assert.doesNotMatch(html, /pw-tree-children" hidden/);
});

test('a foreign or deleted unit focus does not reset personal filters or invent a personal group', () => {
  const workspace = fixture();
  const unit = workspace.units.find(item => !item.deletedAt && !canSelectPersonalUnit(workspace, item))!;
  const state = ['all', 'common', 'preserve this search'];
  const baseline = renderWithPreviousState(createElement(personal.PersonalWork, { workspace, command }), state);
  const foreign = renderWithPreviousState(createElement(personal.PersonalWork, { workspace, command, focusId: unit.id }), state);
  assert.equal(target, undefined); assert.equal(foreign, baseline);
  const own = workspace.units.find(item => canSelectPersonalUnit(workspace, item))!;
  own.deletedAt = workspace.serverTime;
  const deletedBaseline = renderWithPreviousState(createElement(personal.PersonalWork, { workspace, command }), state);
  const deleted = renderWithPreviousState(createElement(personal.PersonalWork, { workspace, command, focusId: own.id }), state);
  assert.equal(target, undefined); assert.equal(deleted, deletedBaseline);
});

test('people focus resets admin filters and closes profile/editor while retaining inactive people', () => {
  const workspace = fixture('u-admin');
  const person = workspace.users.find(item => item.departmentId !== workspace.currentUser.departmentId && item.role === 'member')!;
  person.active = false;
  const html = renderWithPreviousState(createElement(management.OrganizationView, { workspace, command, focusId: person.id }), [
    workspace.currentUser.departmentId, 'head', 'no matching person', workspace.currentUser, 'user',
  ]);
  assert.equal(target, `person:${person.id}`);
  assert.ok(html.includes(`value="${person.departmentId}" selected=""`));
  assert.ok(html.includes(`data-focus-key="person:${person.id}"`));
  assert.match(html, />비활성</);
  assert.doesNotMatch(html, /no matching person|role="dialog"/);
});

test('people focus never exposes a foreign-department person to a department member', () => {
  const workspace = fixture();
  const adminWorkspace = fixture('u-admin');
  const foreign = adminWorkspace.users.find(item => item.departmentId !== workspace.currentUser.departmentId)!;
  workspace.users.push(foreign);
  const state = [workspace.currentUser.departmentId, 'head', 'preserved organization search'];
  const baseline = renderWithPreviousState(createElement(management.OrganizationView, { workspace, command }), state);
  const html = renderWithPreviousState(createElement(management.OrganizationView, { workspace, command, focusId: foreign.id }), state);
  assert.equal(target, undefined); assert.equal(html, baseline);
  assert.doesNotMatch(html, new RegExp(`data-focus-key="person:${foreign.id}"`));
});

test('division focus clears filters and chooses the owner occurrence without duplicate anchors', () => {
  const workspace = fixture('u-admin');
  const unit = workspace.units.find(item => !item.deletedAt)!;
  const department = workspace.organizationDivision!.departments.find(item => item.id === unit.departmentId)!;
  const owner = department.people.find(item => item.id === unit.ownerId)!;
  const modelUnit = owner.units.find(item => item.id === unit.id)!;
  const repeated = { ...modelUnit, tasks: [{ id: 'first-task', title: 'first task', delegates: [] }, { id: 'second-task', title: 'second task', delegates: [] }] };
  department.people = [{ ...owner, id: 'other-owner', name: 'Other person', units: [repeated] }, { ...owner, units: [repeated] }];
  const html = renderWithPreviousState(createElement(division.OrganizationDivision, { workspace, focusId: unit.id }), ['not-this-department', 'not-this-team', 'no matching person']);
  assert.equal(target, `unit:${department.id}:${owner.id}:${unit.id}`);
  assert.ok(html.includes(`value="${department.id}" selected=""`));
  assert.doesNotMatch(html, /no matching person|not-this-team/);
  const anchors = [...html.matchAll(/data-focus-key="([^"]+)"/g)].map(match => match[1]);
  assert.equal(anchors.filter(value => value === target).length, 1);
  assert.equal(anchors.filter(value => value.endsWith(`:${unit.id}`)).length, 2);
  assert.equal(anchors.length, new Set(anchors).size);
});

test('missing division focus keeps filters and an unavailable model remains a loading state', () => {
  const workspace = fixture('u-admin');
  const state = ['all', 'all', 'preserved division search'];
  const baseline = renderWithPreviousState(createElement(division.OrganizationDivision, { workspace }), state);
  const missing = renderWithPreviousState(createElement(division.OrganizationDivision, { workspace, focusId: 'not-readable-unit' }), state);
  assert.equal(target, undefined); assert.equal(missing, baseline);
  workspace.organizationDivision = undefined;
  const loading = renderWithPreviousState(createElement(division.OrganizationDivision, { workspace, focusId: 'not-readable-unit' }));
  assert.equal(target, undefined); assert.match(loading, /전체 업무분장표를 불러오고 있습니다/);
});
