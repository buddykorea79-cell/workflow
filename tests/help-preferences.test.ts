import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { helpStorageKey, readHelpPreference, writeHelpPreference, type HelpStorage } from '../src/lib/help-preferences';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';

function memory() {
  const values = new Map<string, string>();
  const writes: string[] = [];
  const storage: HelpStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { writes.push(key); values.set(key, value); } };
  return { values, writes, storage };
}

test('help preferences preserve each user and callout independently without writing on read', () => {
  const data = memory();
  const first = helpStorageKey('user-a', 'personal.hierarchy');
  const otherUser = helpStorageKey('user-b', 'personal.hierarchy');
  const otherPage = helpStorageKey('user-a', 'common.metrics');
  assert.equal(first, 'ieum.help.user-a.personal.hierarchy');
  assert.equal(readHelpPreference(first, () => data.storage), 'expanded');
  assert.equal(data.writes.length, 0);
  assert.equal(writeHelpPreference(first, 'dismissed', () => data.storage), true);
  assert.equal(readHelpPreference(first, () => data.storage), 'dismissed');
  assert.equal(readHelpPreference(otherUser, () => data.storage), 'expanded');
  assert.equal(readHelpPreference(otherPage, () => data.storage), 'expanded');
  for (const state of ['collapsed', 'expanded', 'dismissed'] as const) {
    writeHelpPreference(first, state, () => data.storage);
    assert.equal(readHelpPreference(first, () => data.storage), state);
  }
});

test('missing, malformed and blocked storage keep the first-visit expanded fallback', () => {
  const data = memory(), key = helpStorageKey('user', 'help');
  for (const invalid of ['', 'false', 'null', '{broken', 'unknown']) {
    data.values.set(key, invalid);
    assert.equal(readHelpPreference(key, () => data.storage), 'expanded');
  }
  const blocked = () => { throw new Error('Storage disabled'); };
  assert.equal(readHelpPreference(key, blocked), 'expanded');
  assert.equal(writeHelpPreference(key, 'collapsed', blocked), false);
  assert.equal(readHelpPreference(key, () => undefined), 'expanded');
  assert.equal(writeHelpPreference(key, 'collapsed', () => undefined), false);
  assert.equal(readHelpPreference(key, () => ({ ...data.storage, getItem: blocked })), 'expanded');
  assert.equal(writeHelpPreference(key, 'collapsed', () => ({ ...data.storage, setItem: blocked })), false);
  assert.equal(data.writes.length, 0);
});

const componentRequire = createRequire(path.resolve('tests/help-preferences.test.ts'));
const previousCssLoader = componentRequire.extensions['.css'];
componentRequire.extensions['.css'] = () => undefined;
let ui: typeof import('../src/components/ui');
try { ui = componentRequire('../src/components/ui'); }
finally {
  if (previousCssLoader) componentRequire.extensions['.css'] = previousCssLoader;
  else delete componentRequire.extensions['.css'];
}

type CalloutProps = Parameters<typeof ui.HelpCallout>[0];
type NodeProps = { children?: ReactNode; className?: string; onClick?: () => void };
function findButton(node: ReactNode, className: string): NodeProps {
  if (Array.isArray(node)) {
    for (const child of node) { const found = findNode(child, className); if (found) return found; }
  } else { const found = findNode(node, className); if (found) return found; }
  throw new Error(`Missing button ${className}`);
}
function findNode(node: ReactNode, className: string): NodeProps | undefined {
  if (!isValidElement<NodeProps>(node)) return;
  if (node.props.className === className) return node.props;
  const children = Array.isArray(node.props.children) ? node.props.children : [node.props.children];
  for (const child of children) { const found = findNode(child, className); if (found) return found; }
}

/** Small deterministic hook host: exercise the actual callbacks/effects without a browser or extra renderer. */
function calloutHost() {
  const slots: unknown[] = [];
  let queued: (() => void)[] = [];
  let rendered: ReactNode;
  return {
    render(props: CalloutProps) {
      const react = componentRequire('react') as typeof import('react');
      const originals = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useId: react.useId };
      let index = 0; queued = [];
      react.useState = ((initial: unknown) => {
        const slot = index++;
        if (!(slot in slots)) slots[slot] = initial;
        return [slots[slot], (value: unknown) => { slots[slot] = typeof value === 'function' ? value(slots[slot]) : value; }];
      }) as typeof react.useState;
      react.useRef = ((initial: unknown) => {
        const slot = index++; if (!(slot in slots)) slots[slot] = { current: initial }; return slots[slot];
      }) as typeof react.useRef;
      react.useId = () => `help-test-${index++}`;
      react.useEffect = ((effect: () => void, dependencies: unknown[]) => {
        const slot = index++, previous = slots[slot] as unknown[] | undefined;
        if (!previous || dependencies.some((value, position) => !Object.is(value, previous[position]))) queued.push(effect);
        slots[slot] = dependencies;
      }) as typeof react.useEffect;
      try { rendered = ui.HelpCallout(props); }
      finally { Object.assign(react, originals); }
      return renderToStaticMarkup(rendered);
    },
    effects() { const effects = queued; queued = []; effects.forEach(effect => effect()); },
    click(className: string) { findButton(rendered, className).onClick?.(); },
  };
}

function withStorage(run: (data: ReturnType<typeof memory>) => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const data = memory();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: data.storage } });
  try { run(data); }
  finally { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); }
}

function props(overrides: Partial<CalloutProps> = {}): CalloutProps {
  return { controls: { userId: 'user-a', reopenToken: 0, triggerRef: { current: null }, reopen: () => undefined }, id: 'common.metrics', summary: '항상 보존할 안내', children: '자세한 산식', ...overrides };
}

test('callout first visit expands, remembers only user actions and restores focus after dismissal', () => withStorage(data => {
  let focused = 0;
  const input = props(); input.controls.triggerRef.current = { focus: () => { focused++; } } as unknown as HTMLButtonElement;
  const host = calloutHost();
  const first = host.render(input);
  assert.match(first, /aria-expanded="true"/); assert.match(first, /자세한 산식/);
  host.effects(); host.render(input); assert.equal(data.writes.length, 0);
  host.click('help-callout-toggle');
  assert.match(host.render(input), /aria-expanded="false"/);
  assert.equal(data.values.get(helpStorageKey('user-a', input.id)), 'collapsed');
  host.click('help-callout-toggle'); host.render(input); host.click('help-callout-dismiss');
  assert.equal(host.render(input), ''); assert.equal(focused, 1);
  assert.equal(data.values.get(helpStorageKey('user-a', input.id)), 'dismissed');
  input.controls.reopenToken++;
  host.render(input); host.effects();
  assert.match(host.render(input), /aria-expanded="true"/);
  assert.equal(data.values.get(helpStorageKey('user-a', input.id)), 'expanded');
}));

test('stored dismissal survives mounting after an old help request and never leaks to a different user', () => withStorage(data => {
  const input = props(); input.controls.reopenToken = 3;
  const key = helpStorageKey('user-a', input.id); data.values.set(key, 'dismissed');
  const host = calloutHost(); host.render(input); host.effects();
  assert.equal(host.render(input), ''); assert.equal(data.writes.length, 0);
  input.controls = { ...input.controls, userId: 'user-b', reopenToken: 0 };
  assert.match(host.render(input), /aria-expanded="true"/); host.effects();
  assert.match(host.render(input), /aria-expanded="true"/);
  assert.equal(data.values.get(key), 'dismissed'); assert.equal(data.writes.length, 0);
  input.controls = { ...input.controls, userId: 'user-a', reopenToken: 0 };
  host.render(input); host.effects(); assert.equal(host.render(input), '');
}));

test('persistent metrics retain the real visible summary and details control when dismissed', () => withStorage(data => {
  const input = props({ persistentSummary: true });
  data.values.set(helpStorageKey(input.controls.userId, input.id), 'dismissed');
  const host = calloutHost(); host.render(input); host.effects();
  const html = host.render(input);
  assert.match(html, /help-callout-summary">항상 보존할 안내/);
  assert.match(html, /aria-expanded="false"/); assert.match(html, />자세히</);
  assert.match(html, /help-callout-body" hidden=""/);
  host.click('help-callout-toggle'); assert.match(host.render(input), /aria-expanded="true"/);
}));

test('visible controls still work when the browser rejects all storage access', () => withStorage(() => {
  Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Denied'); } });
  const input = props(), host = calloutHost();
  host.render(input); host.effects(); host.render(input);
  host.click('help-callout-toggle'); assert.match(host.render(input), /aria-expanded="false"/);
  host.click('help-callout-toggle'); host.render(input); host.click('help-callout-dismiss');
  assert.equal(host.render(input), '');
  input.controls.reopenToken++; host.render(input); host.effects();
  assert.match(host.render(input), /aria-expanded="true"/);
}));

test('page help button has an accessible visible label and calls the page reopen control', () => {
  let reopened = 0;
  const controls = props().controls; controls.reopen = () => { reopened++; };
  const button = ui.HelpButton({ controls, label: '공통업무 도움말 다시 보기' });
  assert.equal(button.props.type, 'button'); assert.equal(button.props['aria-label'], '공통업무 도움말 다시 보기');
  assert.match(renderToStaticMarkup(button), />도움말</);
  button.props.onClick(); assert.equal(reopened, 1);
});

test('common work keeps approval state, actions and the actual metrics legend when all help is dismissed', () => {
  const uiModule = componentRequire.cache[componentRequire.resolve('../src/components/ui')]!;
  const previousExports = uiModule.exports;
  const cssLoader = componentRequire.extensions['.css'];
  componentRequire.extensions['.css'] = () => undefined;
  let common: typeof import('../src/components/common-work');
  try {
    uiModule.exports = { ...ui, HelpCallout: (input: CalloutProps) => input.persistentSummary ? createElement('p', { 'data-help-id': input.id }, input.summary) : null };
    common = componentRequire('../src/components/common-work');
  } finally {
    uiModule.exports = previousExports;
    if (cssLoader) componentRequire.extensions['.css'] = cssLoader;
    else delete componentRequire.extensions['.css'];
  }
  const now = new Date('2026-11-08T03:00:00Z');
  const workspace = getWorkspace(createSeed(now), 'u-admin', now);
  const html = renderToStaticMarkup(createElement(common.CommonWork, { workspace, command: async () => true, onOpenTask: () => undefined }));
  assert.match(html, /승인 대기/); assert.match(html, /승인 전에는 대상 부서에 접수되지 않습니다/);
  assert.match(html, /공통 세부업무 작성/); assert.match(html, /요청 상세/);
  const headWorkspace = getWorkspace(createSeed(now), 'u-support-head', now);
  const headHtml = renderToStaticMarkup(createElement(common.CommonWork, { workspace: headWorkspace, command: async () => true, onOpenTask: () => undefined }));
  assert.match(headHtml, /검토 및 승인/);
  assert.match(html, /진행률은 절차 완료율이며, 지연은 중앙 제출기한 기준입니다/);
  assert.match(html, /공통업무 도움말 다시 보기/);
  assert.doesNotMatch(html, /data-help-id="common.approval-flow"|data-help-id="common.assignment-flow"/);
});
