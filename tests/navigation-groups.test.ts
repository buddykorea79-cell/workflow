import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { executeCommand, getWorkspace } from '../src/lib/domain';
import { navBadges } from '../src/lib/nav-badges';
import { createSeed } from '../src/lib/seed';
import { navigationGroups, groupPendingCount, initialGroupExpansion, reconcileGroupExpansion } from '../src/lib/navigation-groups';
import type { OrgRole } from '../src/lib/types';
import type { View } from '../src/lib/hash-route';

const now = new Date('2026-11-08T03:00:00Z');
const people: Record<OrgRole, string> = { member: 'u-jiho', lead: 'u-plan-lead', manager: 'u-minseo', head: 'u-head', admin: 'u-admin' };
const universal: View[] = ['dashboard', 'schedule', 'common', 'delegation', 'handover', 'performance', 'division', 'organization'];

test('all five real workspace roles retain their approved destinations without duplicate or privileged menu entries', () => {
  const seed = createSeed(now);
  for (const role of ['member', 'lead', 'manager', 'head', 'admin'] as const) {
    const workspace = getWorkspace(seed, people[role], now);
    assert.equal(workspace.currentUser.role, role);
    const groups = navigationGroups(workspace.currentUser.role), views = groups.flatMap(group => group.views);
    // Independent access contract: the existing top-bar division view is available to every role.
    const allowed = new Set<View>(universal);
    if (role !== 'head') allowed.add('personal');
    if (role === 'head' || role === 'admin') allowed.add('department');
    if (role === 'manager' || role === 'head' || role === 'admin') allowed.add('budgets');
    if (role === 'manager' || role === 'admin') allowed.add('allocation');
    if (role === 'admin') allowed.add('admin');
    assert.deepEqual(new Set(views), allowed, role);
    assert.equal(views.length, allowed.size, `${role}: no duplicate destinations across groups`);
    assert.deepEqual(groups.map(group => group.label), ['내 업무', '협업', '부서 관리', '조직·시스템']);
    assert.deepEqual(groups.filter(group => group.alwaysOpen).map(group => group.id), ['my']);
    for (const view of ['department', 'budgets', 'performance', 'division'] as const) {
      if (allowed.has(view)) assert.ok(groups.find(group => group.id === 'department')!.views.includes(view));
    }
    assert.ok(groups.find(group => group.id === 'organization')!.views.includes('organization'));
  }
});

test('group totals use actual authorized action badges and do not reveal another role’s unavailable destination', () => {
  const seed = createSeed(now);
  seed.commonTasks = [];
  executeCommand(seed, 'u-seoyeon', { type: 'common.create', payload: { title: '그룹 배지 검토', description: '작성 부서장의 승인 대기', dueDate: '2026-11-30', frequency: 'once', requiredSteps: ['준비', '검토'], departmentIds: ['dept-support'] }, requestId: randomUUID(), expectedRevision: seed.revision }, now);
  let approvalVisible = false;
  for (const role of ['member', 'lead', 'manager', 'head', 'admin'] as const) {
    const workspace = getWorkspace(seed, people[role], now), badges = navBadges(workspace, now);
    const groups = navigationGroups(role), views = new Set(groups.flatMap(group => group.views));
    const total = groups.reduce((sum, group) => sum + groupPendingCount(group, badges), 0);
    assert.equal(total, Object.entries(badges).filter(([view]) => views.has(view as View)).reduce((sum, [, count]) => sum + (count ?? 0), 0));
    if (role === 'head') {
      assert.equal(badges.common, 1); approvalVisible = true;
      assert.ok(groupPendingCount(groups.find(group => group.id === 'collaboration')!, badges) >= 1);
    } else assert.equal(badges.common ?? 0, 0, `${role} cannot approve the source department request`);
  }
  assert.equal(approvalVisible, true);
  const memberCollaboration = navigationGroups('member').find(group => group.id === 'collaboration')!;
  assert.equal(groupPendingCount(memberCollaboration, { common: 2, allocation: 999, admin: 999 }), 2);
});

test('default groups expose the current route and real pending actions while keeping unrelated groups compact', () => {
  const groups = navigationGroups('admin');
  assert.deepEqual(initialGroupExpansion(groups, 'dashboard', {}), { my: true, collaboration: false, department: false, organization: false });
  assert.deepEqual(initialGroupExpansion(groups, 'dashboard', { common: 2, performance: 1 }), { my: true, collaboration: true, department: true, organization: false });
  for (const group of groups) {
    for (const view of group.views) assert.equal(initialGroupExpansion(groups, view, {})[group.id], true, view);
  }
  // Unavailable views are not an alternative way to open an unprivileged group.
  assert.equal(initialGroupExpansion(navigationGroups('member'), 'admin', {}).organization, false);
});

test('manual collapsing survives ordinary refreshes; a changed destination or increased pending count reopens only its group', () => {
  const groups = navigationGroups('admin');
  const expanded = { my: false, collaboration: false, department: false, organization: false };
  const previous = { activeView: 'common' as const, badges: { common: 2 }, expanded };
  const unchanged = reconcileGroupExpansion(groups, previous, 'common', { common: 2 });
  assert.deepEqual(unchanged, { ...expanded, my: true });
  assert.deepEqual(previous.expanded, expanded, 'the previous state remains unchanged');
  assert.equal(reconcileGroupExpansion(groups, previous, 'common', { common: 1 }).collaboration, false);
  assert.equal(reconcileGroupExpansion(groups, previous, 'common', { common: 3 }).collaboration, true);
  assert.deepEqual(reconcileGroupExpansion(groups, previous, 'budgets', { common: 2 }), { my: true, collaboration: false, department: true, organization: false });
  assert.equal(reconcileGroupExpansion(groups, previous, 'admin', { common: 2 }).organization, true);
  const manuallyOpened = { ...previous, expanded: { ...expanded, organization: true } };
  assert.equal(reconcileGroupExpansion(groups, manuallyOpened, 'common', { common: 2 }).organization, true);
  const sameSum = { ...previous, badges: { common: 2, delegation: 0 } };
  assert.equal(reconcileGroupExpansion(groups, sameSum, 'common', { common: 1, delegation: 1 }).collaboration, false);
});

test('group badge counts ignore invalid numbers and only aggregate the visible group’s destinations', () => {
  const groups = navigationGroups('admin'), collaboration = groups.find(group => group.id === 'collaboration')!;
  assert.equal(groupPendingCount(collaboration, { common: 2.9, allocation: Number.NaN, delegation: Number.POSITIVE_INFINITY, handover: -5, performance: 10 }), 2);
  assert.equal(groupPendingCount(collaboration, { common: 0, allocation: -1, delegation: 0.9, handover: undefined }), 0);
});

const componentRequire = createRequire(path.resolve('tests/navigation-groups.test.ts'));
const css = componentRequire.extensions['.css'];
let sidebar: typeof import('../src/components/grouped-sidebar');
try { componentRequire.extensions['.css'] = () => undefined; sidebar = componentRequire('../src/components/grouped-sidebar'); }
finally { if (css) componentRequire.extensions['.css'] = css; else delete componentRequire.extensions['.css']; }
const views: View[] = ['dashboard', 'personal', 'department', 'budgets', 'allocation', 'division', 'delegation', 'common', 'schedule', 'performance', 'handover', 'organization', 'admin'];
const titles = Object.fromEntries(views.map(view => [view, `메뉴:${view}`])) as Record<View, string>;
const attribute = (markup: string, name: string) => markup.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];

test('rendered role menus connect four named groups, hide collapsed items and keep one current destination', () => {
  const seed = createSeed(now);
  for (const role of ['member', 'lead', 'manager', 'head', 'admin'] as const) {
    const workspace = getWorkspace(seed, people[role], now);
    const html = renderToStaticMarkup(createElement(sidebar.GroupedSidebar, { workspace, activeView: 'dashboard', badges: {}, titles, onNavigate: () => undefined }));
    assert.match(html, /<nav[^>]*aria-label="주 메뉴"/);
    const groups = [...html.matchAll(/<section\b[^>]*role="group"[^>]*>[\s\S]*?<\/section>/g)].map(match => match[0]);
    assert.equal(groups.length, 4);
    assert.equal((html.match(/aria-expanded="false"/g) ?? []).length, 3);
    assert.equal((html.match(/class="sidebar-group-items" hidden=""/g) ?? []).length, 3);
    assert.equal((html.match(/aria-current="page"/g) ?? []).length, 1);
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
    assert.equal(ids.length, new Set(ids).size);
    for (const group of groups) {
      assert.ok(group.includes(`id="${attribute(group, 'aria-labelledby')}"`));
      const toggle = group.match(/<button[^>]*aria-controls="[^"]+"[^>]*>/)?.[0];
      if (toggle) assert.ok(group.includes(`id="${attribute(toggle, 'aria-controls')}"`));
      else assert.match(group, /<h2[^>]*>내 업무<\/h2>/);
    }
    const allowed = new Set(navigationGroups(role).flatMap(group => group.views));
    for (const view of views) assert.equal(html.includes(`aria-label="메뉴:${view}"`), allowed.has(view), `${role}: ${view}`);
  }
});

type NodeProps = { children?: ReactNode; className?: string; 'aria-label'?: string; 'aria-expanded'?: boolean; 'aria-controls'?: string; onClick?: () => void; onMouseEnter?: () => void; onFocus?: () => void };
function* componentNodes(node: ReactNode): Generator<ReactElement<NodeProps>> {
  if (Array.isArray(node)) { for (const child of node) yield* componentNodes(child); return; }
  if (!isValidElement<NodeProps>(node)) return;
  yield node; yield* componentNodes(node.props.children);
}

test('actual sidebar callbacks preserve manual collapse, show its badge total and delegate guarded navigation', () => {
  const navigated: View[] = [], preloaded: View[] = [];
  const props: import('../src/components/grouped-sidebar').GroupedSidebarProps = { workspace: getWorkspace(createSeed(now), people.manager, now), activeView: 'dashboard', badges: { common: 2, allocation: 1 }, titles, onNavigate: view => navigated.push(view), onPreload: view => preloaded.push(view) };
  const state: unknown[] = [];
  function render() {
    const react = componentRequire('react') as typeof import('react'), original = react.useState;
    let cursor = 0, tree: ReactNode;
    react.useState = ((initial: unknown) => {
      const [initialValue] = original(initial), slot = cursor++;
      if (!(slot in state)) state[slot] = initialValue;
      return [state[slot], (next: unknown) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    }) as typeof react.useState;
    try {
      renderToStaticMarkup(createElement(function Capture() {
        const outer = sidebar.GroupedSidebar(props);
        tree = (outer.type as (value: typeof props) => ReactNode)(props);
        return null;
      }));
    } finally { react.useState = original; }
    return tree;
  }
  let tree = render();
  let toggle = [...componentNodes(tree)].find(node => node.props['aria-label'] === '협업');
  assert.equal(toggle?.props['aria-expanded'], true); toggle?.props.onClick?.();
  tree = render();
  toggle = [...componentNodes(tree)].find(node => node.props['aria-label'] === '협업, 처리 대기 3건');
  assert.equal(toggle?.props['aria-expanded'], false);
  assert.match(renderToStaticMarkup(tree), /aria-label="협업, 처리 대기 3건"/);
  // Background refresh with unchanged counts must not override the user's collapse.
  props.badges = { common: 2, allocation: 1 }; tree = render();
  toggle = [...componentNodes(tree)].find(node => node.props['aria-label'] === '협업, 처리 대기 3건');
  assert.equal(toggle?.props['aria-expanded'], false); toggle?.props.onClick?.();
  tree = render();
  const destination = [...componentNodes(tree)].find(node => node.props['aria-label'] === '메뉴:common, 처리 대기 2건');
  assert.ok(destination?.props.onClick);
  destination.props.onMouseEnter?.(); destination.props.onFocus?.();
  assert.deepEqual(preloaded, ['common', 'common']); assert.deepEqual(navigated, []);
  destination.props.onClick(); assert.deepEqual(navigated, ['common']);
  assert.equal(props.activeView, 'dashboard', 'the root guard owns whether navigation is accepted');
  props.activeView = 'organization'; tree = render();
  assert.equal([...componentNodes(tree)].find(node => node.props['aria-label'] === '조직·시스템')?.props['aria-expanded'], true);
  const before = sidebar.GroupedSidebar(props);
  const anotherActor = sidebar.GroupedSidebar({ ...props, workspace: { currentUser: { ...props.workspace.currentUser, id: 'another-manager' } } });
  const anotherRole = sidebar.GroupedSidebar({ ...props, workspace: { currentUser: { ...props.workspace.currentUser, role: 'member' } } });
  assert.notEqual(before.key, anotherActor.key); assert.notEqual(before.key, anotherRole.key);
});
