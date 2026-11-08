import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { helpStorageKey } from '../src/lib/help-preferences';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';

const requireUi = createRequire(path.resolve('tests/help-reopen.test.ts'));
const cssLoader = requireUi.extensions['.css'];
requireUi.extensions['.css'] = () => undefined;
let ui: typeof import('../src/components/ui');
let personal: typeof import('../src/components/personal-work');
try { ui = requireUi('../src/components/ui'); personal = requireUi('../src/components/personal-work'); }
finally { if (cssLoader) requireUi.extensions['.css'] = cssLoader; else delete requireUi.extensions['.css']; }

type NodeProps = { children?: ReactNode; className?: string; onClick?: () => void };
function find(node: ReactNode, className: string): NodeProps | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, className); if (result) return result; } return; }
  if (!isValidElement<NodeProps>(node)) return;
  return node.props.className === className ? node.props : find(node.props.children, className);
}

function host<T>(render: () => T) {
  const slots: any[] = []; let queued: (() => void)[] = [];
  return {
    render() {
      const react = requireUi('react') as typeof import('react'); let index = 0;
      const saved = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useId: react.useId };
      react.useState = ((initial: any) => {
        const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
        return [slots[at], (next: any) => { slots[at] = typeof next === 'function' ? next(slots[at]) : next; }];
      }) as typeof react.useState;
      react.useRef = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; }) as typeof react.useRef;
      react.useId = () => `help-reopen-${index++}`;
      react.useEffect = ((effect: () => void, deps: unknown[]) => {
        const at = index++; const previous = slots[at] as unknown[] | undefined;
        if (!previous || deps.some((item, i) => !Object.is(item, previous[i]))) queued.push(effect);
        slots[at] = deps;
      }) as typeof react.useEffect;
      try { return render(); } finally { Object.assign(react, saved); }
    },
    effects() { const pending = queued; queued = []; pending.forEach(effect => effect()); },
  };
}

function withStorage(run: (values: Map<string, string>) => void) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } } });
  try { run(values); }
  finally { if (descriptor) Object.defineProperty(globalThis, 'window', descriptor); else Reflect.deleteProperty(globalThis, 'window'); }
}

test('page help restores every registered callout including ones not currently mounted', () => withStorage(values => {
  const ids = ['common.assignment-flow', 'common.metrics', 'common.additional-distribution'];
  for (const id of ids) values.set(helpStorageKey('user-a', id), 'dismissed');
  values.set(helpStorageKey('user-b', ids[2]), 'dismissed');
  values.set(helpStorageKey('user-a', 'handover.emergency'), 'collapsed');
  const controlsHost = host(() => ui.useHelpControls('user-a', ids));
  const first = controlsHost.render();
  assert.equal(values.get(helpStorageKey('user-a', ids[2])), 'dismissed', 'mounting alone must not reset preferences');
  first.reopen();
  assert.equal(controlsHost.render().reopenToken, 1);
  for (const id of ids) assert.equal(values.get(helpStorageKey('user-a', id)), 'expanded');
  assert.equal(values.get(helpStorageKey('user-b', ids[2])), 'dismissed');
  assert.equal(values.get(helpStorageKey('user-a', 'handover.emergency')), 'collapsed');
}));

test('a conditional callout opens after page help, but a later dismissal survives its next mount', () => withStorage(values => {
  const id = 'common.additional-distribution';
  values.set(helpStorageKey('user-a', id), 'dismissed');
  const controlsHost = host(() => ui.useHelpControls('user-a', [id]));
  controlsHost.render().reopen();
  const controls = controlsHost.render();
  const props = { controls, id, summary: '대상 부서 추가 안내', children: '업무별 보기에서 요청합니다.' };
  const callout = host(() => ui.HelpCallout(props));
  callout.render(); callout.effects();
  const opened = callout.render();
  assert.match(renderToStaticMarkup(opened), /aria-expanded="true"/);
  const dismiss = find(opened, 'help-callout-dismiss'); assert.ok(dismiss?.onClick);
  dismiss.onClick();
  assert.equal(callout.render(), null);
  assert.equal(values.get(helpStorageKey('user-a', id)), 'dismissed');
  const remounted = host(() => ui.HelpCallout(props));
  remounted.render(); remounted.effects();
  assert.equal(remounted.render(), null, 'an old reopen token must not override a newer dismissal');
}));

test('mounted and conditionally mounted help both recover from one explicit page help request', () => withStorage(values => {
  const ids = ['performance.process', 'performance.scoring'];
  ids.forEach(id => values.set(helpStorageKey('user-a', id), 'dismissed'));
  const controlsHost = host(() => ui.useHelpControls('user-a', ids));
  let controls = controlsHost.render();
  const mounted = host(() => ui.HelpCallout({ controls, id: ids[0], summary: '성과 제출', children: '성과와 업무 비중 확인' }));
  mounted.render(); mounted.effects(); assert.equal(mounted.render(), null);
  controls.reopen(); controls = controlsHost.render();
  mounted.render(); mounted.effects();
  assert.match(renderToStaticMarkup(mounted.render()), /aria-expanded="true"/);
  const later = host(() => ui.HelpCallout({ controls, id: ids[1], summary: '평가 점수', children: '단위업무별 점수 합계' }));
  later.render(); later.effects();
  assert.match(renderToStaticMarkup(later.render()), /aria-expanded="true"/);
}));

test('reopening after an account change only resets the current user preferences', () => withStorage(values => {
  const id = 'handover.remaining-roles'; let userId = 'user-a';
  values.set(helpStorageKey(userId, id), 'dismissed');
  values.set(helpStorageKey('user-b', id), 'collapsed');
  const controlsHost = host(() => ui.useHelpControls(userId, [id]));
  controlsHost.render(); userId = 'user-b';
  const switched = controlsHost.render(); assert.equal(switched.reopenToken, 0);
  switched.reopen();
  assert.equal(values.get(helpStorageKey('user-b', id)), 'expanded');
  assert.equal(values.get(helpStorageKey('user-a', id)), 'dismissed');
  assert.equal(controlsHost.render().reopenToken, 1);
}));

test('page help remains usable when preference storage is blocked', () => withStorage(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Storage unavailable'); } });
  const controlsHost = host(() => ui.useHelpControls('user-a', ['common.metrics', 'common.additional-distribution']));
  assert.doesNotThrow(() => controlsHost.render().reopen());
  assert.equal(controlsHost.render().reopenToken, 1);
}));

type ElementProps = Record<string, any> & { children?: ReactNode };
function matching(node: ReactNode, predicate: (node: ReactElement<ElementProps>) => boolean): ReactElement<ElementProps> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = matching(child, predicate); if (result) return result; } return; }
  if (!isValidElement<ElementProps>(node)) return;
  return predicate(node) ? node : matching(node.props.children, predicate);
}

test('personal work shows the requested subtitle without the removed hierarchy help box', () => {
  const now = new Date('2026-11-08T03:00:00Z');
  const workspace = getWorkspace(createSeed(now), 'u-jiho', now);
  const html = renderToStaticMarkup(createElement(personal.PersonalWork, { workspace, command: async () => true }));
  assert.match(html, /<p class="muted">단위업무는 업무 묶음, 세부업무는 실제 수행할 과제입니다\.<\/p>/);
  assert.doesNotMatch(html, /personal\.hierarchy|단위업무에 세부업무를 묶어 관리하세요|단위업무를 펼쳐 세부업무와 진행 상황을 확인하세요/);
  assert.match(html, /aria-label="개인업무 도움말"[^>]*aria-haspopup="dialog"|aria-haspopup="dialog"[^>]*aria-label="개인업무 도움말"/);
  assert.doesNotMatch(html, /role="dialog"/);
});

test('personal help opens and closes on demand without commands or resetting the current work context', () => {
  const now = new Date('2026-11-08T03:00:00Z');
  const state = createSeed(now); state.departmentWorkPlans = [];
  const workspace = getWorkspace(state, 'u-jiho', now); const before = structuredClone(workspace);
  let commands = 0;
  const view = host(() => personal.PersonalWork({ workspace, command: async () => { commands++; return true; } }));
  let tree = view.render();
  const get = (predicate: (node: ReactElement<ElementProps>) => boolean) => { const result = matching(tree, predicate); assert.ok(result); return result; };
  const help = () => get(node => node.props['aria-label'] === '개인업무 도움말');
  const modal = () => get(node => node.type === ui.Modal && node.props.title === '개인업무 도움말');
  const search = () => get(node => node.props['aria-label'] === '단위업무와 세부업무 검색');
  search().props.onChange({ target: { value: '예산' } }); tree = view.render();
  get(node => node.type === ui.Button && Array.isArray(node.props.children) && node.props.children.includes('세부업무 추가')).props.onClick(); tree = view.render();
  const registration = get(node => typeof node.type === 'function' && node.type.name === 'CreateTask');
  help().props.onClick(); tree = view.render();
  assert.ok(modal()); assert.equal(search().props.value, '예산');
  const preserved = get(node => node.type === registration.type);
  assert.equal(preserved.key, registration.key); assert.equal(preserved.props.selectedUnitId, registration.props.selectedUnitId);
  modal().props.onClose(); tree = view.render();
  assert.equal(matching(tree, node => node.type === ui.Modal && node.props.title === '개인업무 도움말'), undefined);
  assert.equal(search().props.value, '예산'); assert.ok(get(node => node.type === registration.type));
  help().props.onClick(); tree = view.render();
  get(node => node.props.children === '도움말 닫기').props.onClick(); tree = view.render();
  assert.equal(matching(tree, node => node.type === ui.Modal && node.props.title === '개인업무 도움말'), undefined);
  assert.equal(commands, 0); assert.deepEqual(workspace, before);
});
