import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderComponent } from './helpers/render-component';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';

const requireComponent = createRequire(path.resolve('tests/view-tabs.test.ts'));
const css = requireComponent.extensions['.css'];
let common: typeof import('../src/components/common-work');
let allocation: typeof import('../src/components/allocation-review');
let handover: typeof import('../src/components/personnel-handover');
let management: typeof import('../src/components/management');
try {
  requireComponent.extensions['.css'] = () => undefined;
  common = requireComponent('../src/components/common-work');
  allocation = requireComponent('../src/components/allocation-review');
  handover = requireComponent('../src/components/personnel-handover');
  management = requireComponent('../src/components/management');
} finally { if (css) requireComponent.extensions['.css'] = css; else delete requireComponent.extensions['.css']; }
const now = new Date('2026-11-08T03:00:00Z');
const workspace = (id = 'u-admin') => getWorkspace(createSeed(now), id, now);
const noop = () => undefined;
const command = async () => true;
const attr = (tag: string, name: string) => tag.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1];
function connectedTabs(html: string, groups: number, tabCount: number) {
  const tabs = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map(match => match[0]);
  const panels = [...html.matchAll(/<(?:div|section)\b[^>]*role="tabpanel"[^>]*>/g)].map(match => match[0]);
  assert.equal((html.match(/role="tablist"/g) ?? []).length, groups);
  assert.equal(tabs.length, tabCount); assert.equal(panels.length, tabCount);
  assert.equal(new Set(panels.map(panel => attr(panel, 'id'))).size, tabCount);
  assert.equal(tabs.filter(tab => attr(tab, 'tabindex') === '0').length, groups);
  assert.equal(panels.filter(panel => !panel.includes(' hidden=')).length, groups);
  for (const tab of tabs) {
    const panel = panels.find(candidate => attr(candidate, 'id') === attr(tab, 'aria-controls'));
    assert.ok(panel, 'every tab controls a present panel');
    assert.equal(attr(panel, 'aria-labelledby'), attr(tab, 'id'));
    assert.equal(panel.includes(' hidden='), attr(tab, 'aria-selected') !== 'true');
    assert.doesNotMatch(tab, /\sdisabled(?:=|\s|>)/);
    assert.doesNotMatch(tab, /aria-pressed=/);
  }
}

type Props = { children?: ReactNode; tabs?: { value: string; onChange: (value: string) => void }; label?: string; onClick?: () => void; role?: string };
function* nodes(node: ReactNode): Generator<ReactElement<Props>> {
  if (Array.isArray(node)) { for (const child of node) yield* nodes(child); return; }
  if (!isValidElement<Props>(node)) return;
  yield node; yield* nodes(node.props.children);
}
function tabControls(tree: ReactNode, label: string) {
  const found = [...nodes(tree)].find(node => node.props.label === label && node.props.tabs);
  assert.ok(found?.props.tabs); return found.props.tabs;
}
/** Execute real view callbacks under a server hook dispatcher; no browser or extra renderer dependency. */
function host(renderView: () => ReactNode, guard?: (action: () => void) => void) {
  const state: unknown[] = [];
  return () => {
    const react = requireComponent('react') as typeof import('react');
    const originalState = react.useState, originalContext = react.useContext;
    let cursor = 0, tree: ReactNode;
    react.useState = ((initial: unknown) => {
      const [initialValue] = originalState(initial), slot = cursor++;
      if (!(slot in state)) state[slot] = initialValue;
      return [state[slot], (next: unknown) => { state[slot] = typeof next === 'function' ? next(state[slot]) : next; }];
    }) as typeof react.useState;
    react.useContext = ((context: Parameters<typeof react.useContext>[0]) => {
      const value = originalContext(context);
      return guard && value && typeof value === 'object' && 'requestNavigation' in value ? { ...value, requestNavigation: guard } : value;
    }) as typeof react.useContext;
    try { renderToStaticMarkup(createElement(function Capture() { tree = renderView(); return null; })); }
    finally { react.useState = originalState; react.useContext = originalContext; }
    return tree;
  };
}

test('common approval and scope tabs connect all panels while stage and display choices remain filters', () => {
  const props = { workspace: workspace(), command, onOpenTask: noop };
  const render = host(() => common.CommonWork(props));
  let tree = render(), html = renderToStaticMarkup(tree);
  connectedTabs(html, 2, 7);
  assert.match(html, /class="cw-stage-filters"[\s\S]*?aria-pressed="true"/);
  assert.match(html, /class="tabs cw-view-toggle"[\s\S]*?aria-pressed="true"/);
  tabControls(tree, '공통업무 승인 조회').onChange('rejected');
  tabControls(tree, '공통업무 조회 범위').onChange('action');
  tree = render(); html = renderToStaticMarkup(tree);
  connectedTabs(html, 2, 7);
  assert.equal(tabControls(tree, '공통업무 승인 조회').value, 'rejected');
  assert.equal(tabControls(tree, '공통업무 조회 범위').value, 'action');
});

test('allocation tabs retain filters and resolve panels for every selection without widening access', () => {
  const props = { workspace: workspace('u-minseo'), command, onOpenCommon: noop, onOpenHandover: noop, onOpenDivision: noop };
  const render = host(() => allocation.AllocationReview(props));
  for (const value of ['received', 'approvals', 'handovers']) {
    tabControls(render(), '배정·승인 업무 구분').onChange(value);
    const html = renderToStaticMarkup(render()); connectedTabs(html, 1, 3);
    assert.match(html, /class="allocation-status-filter"[\s\S]*?aria-pressed="true"/);
  }
  const denied = renderToStaticMarkup(createElement(allocation.AllocationReview, { ...props, workspace: workspace('u-jiho') }));
  assert.doesNotMatch(denied, /role="tablist"/);
});

test('handover tabs remain available while saving and keep the open composer outside the changing panel', () => {
  const props = { workspace: workspace(), command, busy: false, onOpenTask: noop };
  const render = host(() => handover.PersonnelHandover(props));
  let tree = render(); connectedTabs(renderToStaticMarkup(tree), 1, 3);
  const request = [...nodes(tree)].find(node => Array.isArray(node.props.children) && node.props.children.includes('인수인계 요청'));
  assert.ok(request?.props.onClick); request.props.onClick();
  props.busy = true;
  tree = render(); connectedTabs(renderToStaticMarkup(tree), 1, 3);
  const composer = [...nodes(tree)].find(node => typeof node.type === 'function' && node.type.name === 'TransferComposer');
  assert.ok(composer);
  tabControls(tree, '인수인계 구분').onChange('history');
  tree = render();
  const nextComposer = [...nodes(tree)].find(node => typeof node.type === 'function' && node.type.name === 'TransferComposer');
  assert.equal(nextComposer?.type, composer.type); assert.equal(nextComposer?.key, composer.key);
  const panel = [...nodes(tree)].find(node => node.props.role === 'tabpanel');
  assert.ok(panel); assert.equal([...nodes(panel)].includes(nextComposer!), false);
  const member = renderToStaticMarkup(createElement(handover.PersonnelHandover, { ...props, workspace: workspace('u-jiho') }));
  connectedTabs(member, 1, 2); assert.doesNotMatch(member, />부서 보관 업무/);
});

test('admin tabs keep conditional content and wait for the unsaved-navigation approval before switching', async () => {
  const previousCss = requireComponent.extensions['.css'];
  requireComponent.extensions['.css'] = () => undefined;
  try {
  const pending: (() => void)[] = [];
  const render = host(() => management.AdminView({ workspace: workspace(), command }), action => pending.push(action));
  let tree = render(); connectedTabs(await renderComponent(tree), 1, 5);
  tabControls(tree, '시스템 관리 구분').onChange('budgets');
  assert.equal(pending.length, 1);
  tree = render(); assert.equal(tabControls(tree, '시스템 관리 구분').value, 'connections');
  assert.ok([...nodes(tree)].some(node => typeof node.type === 'function' && ((node.type as { displayName?: string }).displayName || node.type.name) === 'AdminIntegrations'));
  assert.equal([...nodes(tree)].some(node => typeof node.type === 'function' && ((node.type as { displayName?: string }).displayName || node.type.name) === 'AdminBudgetCatalog'), false);
  pending.pop()!(); tree = render();
  assert.equal(tabControls(tree, '시스템 관리 구분').value, 'budgets');
  connectedTabs(await renderComponent(tree), 1, 5);
  assert.equal([...nodes(tree)].some(node => typeof node.type === 'function' && ((node.type as { displayName?: string }).displayName || node.type.name) === 'AdminIntegrations'), false);
  tabControls(tree, '시스템 관리 구분').onChange('audit'); pending.pop();
  assert.equal(tabControls(render(), '시스템 관리 구분').value, 'budgets', 'cancel leaves the current form mounted');
  } finally { if (previousCss) requireComponent.extensions['.css'] = previousCss; else delete requireComponent.extensions['.css']; }
});
