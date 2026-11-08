import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderComponent } from './helpers/render-component';

const componentRequire = createRequire(path.resolve('tests/lazy-screen.test.ts'));
const previousCssLoader = componentRequire.extensions['.css'];
let screen: typeof import('../src/components/lazy-screen');
try { componentRequire.extensions['.css'] = () => undefined; screen = componentRequire('../src/components/lazy-screen'); }
finally { if (previousCssLoader) componentRequire.extensions['.css'] = previousCssLoader; else delete componentRequire.extensions['.css']; }

test('an unresolved screen exposes a named loading skeleton without mounting data forms', () => {
  const view = screen.createLazyScreen<{ text: string }>(() => new Promise(() => undefined), { label: '업무대행', kind: 'section' });
  const html = renderToStaticMarkup(createElement(view.Component, { text: '아직 마운트하지 않은 입력' }));
  assert.match(html, /role="status"/); assert.match(html, /aria-busy="true"/);
  assert.match(html, /업무대행 불러오는 중/); assert.match(html, /lazy-screen-section/);
  assert.doesNotMatch(html, /아직 마운트하지 않은 입력|<input|<textarea/);
});

test('streaming render waits for named-export content and subsequent props use the same cached module', async () => {
  let calls = 0;
  function Content({ text }: { text: string }) { return createElement('p', { 'data-loaded': 'yes' }, text); }
  const view = screen.createLazyScreen(async () => { calls++; return Content; }, { label: '성과' });
  await view.preload();
  const first = await renderComponent(createElement(view.Component, { text: '첫 번째 내용' }));
  const second = await renderComponent(createElement(view.Component, { text: '갱신된 내용' }));
  assert.match(first, /data-loaded="yes">첫 번째 내용/); assert.match(second, /data-loaded="yes">갱신된 내용/);
  assert.doesNotMatch(first, /화면을 불러오고/); assert.equal(calls, 1);
});

test('a failed prefetch can load successfully on first display with a default-export module', async () => {
  let calls = 0;
  const view = screen.createLazyScreen(async () => { if (++calls === 1) throw new Error('offline'); return { default: () => createElement('p', null, '연결 복구됨') }; }, { label: '인수인계' });
  await view.preload();
  assert.match(await renderComponent(createElement(view.Component)), /연결 복구됨/); assert.equal(calls, 2);
});

test('prop updates retain the lazy type, and only explicit retry creates a new type and boundary attempt', () => {
  const react = componentRequire('react') as typeof import('react');
  const original = react.useState;
  let state: unknown;
  react.useState = ((initial: unknown) => {
    if (state === undefined) state = typeof initial === 'function' ? initial() : initial;
    return [state, (update: unknown) => { state = typeof update === 'function' ? update(state) : update; }];
  }) as typeof react.useState;
  try {
    const view = screen.createLazyScreen(async () => ({ default: ({ text }: { text: string }) => createElement('p', null, text) }), { label: '관리자' });
    type Tree = ReactElement<{ fallback: ReactElement<{ onRetry: () => void }>; children: ReactElement<{ children: ReactElement<{ text: string }> }> }>;
    const render = view.Component as (props: { text: string }) => Tree;
    const first = render({ text: '초안' }); const updated = render({ text: '추가 초안' });
    assert.equal(first.props.children.props.children.type, updated.props.children.props.children.type);
    assert.equal(updated.props.children.props.children.props.text, '추가 초안'); assert.equal(first.key, updated.key);
    updated.props.fallback.props.onRetry();
    const retried = render({ text: '추가 초안' });
    assert.notEqual(retried.props.children.props.children.type, updated.props.children.props.children.type);
    assert.notEqual(retried.key, updated.key);
  } finally { react.useState = original; }
});

test('successful retry remains recovered after leaving and mounting the screen again', async () => {
  let calls = 0;
  const view = screen.createLazyScreen(async () => { if (++calls === 1) throw new Error('offline-once'); return () => createElement('p', null, '재시도 뒤 복구한 화면'); }, { label: '인수인계' });
  await assert.rejects(renderComponent(createElement(view.Component)), /offline-once/);
  const react = componentRequire('react') as typeof import('react');
  const original = react.useState;
  let state: unknown; let recoveredTree: ReactElement;
  react.useState = ((initial: unknown) => {
    if (state === undefined) state = typeof initial === 'function' ? initial() : initial;
    return [state, (update: unknown) => { state = typeof update === 'function' ? update(state) : update; }];
  }) as typeof react.useState;
  try {
    const render = view.Component as () => ReactElement<{ fallback: ReactElement<{ onRetry: () => void }> }>;
    render().props.fallback.props.onRetry();
    recoveredTree = render();
  } finally { react.useState = original; }
  assert.match(await renderComponent(recoveredTree!), /재시도 뒤 복구한 화면/);
  assert.match(await renderComponent(createElement(view.Component)), /재시도 뒤 복구한 화면/);
  assert.equal(calls, 2, 'remount reuses the successful code request instead of reviving the first rejected lazy type');
});

test('reload waits for the global dirty guard, including drafts preserved under a modal boundary', () => {
  const react = componentRequire('react') as typeof import('react');
  const originals = { useContext: react.useContext, useCallback: react.useCallback };
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  let requests: unknown[][] = []; let reloads = 0; let retry = 0; let contextCall = 0;
  react.useContext = (() => ++contextCall === 1 ? { requestNavigation: (...args: unknown[]) => { requests.push(args); } } : ['underlying-unsaved-draft']) as typeof react.useContext;
  react.useCallback = ((callback: unknown) => callback) as typeof react.useCallback;
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { reload: () => { reloads++; } } } });
  try {
    const element = screen.ScreenLoadError({ label: '관리자', onRetry: () => { retry++; } });
    const actions = element.props.children.at(-1) as ReactElement<{ children: ReactElement<{ onClick: () => void }>[] }>;
    actions.props.children[0].props.onClick(); assert.equal(retry, 1); assert.equal(requests.length, 0);
    actions.props.children[1].props.onClick(); assert.equal(requests.length, 1); assert.equal(reloads, 0);
    assert.equal(requests[0].length, 1, 'reload uses workspace navigation, without excluding underlying modal drafts');
    (requests[0][0] as () => void)(); assert.equal(reloads, 1);
  } finally {
    Object.assign(react, originals);
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
