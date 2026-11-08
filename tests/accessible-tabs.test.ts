import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, Fragment, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { tabDomIds, tabKeyAction } from '../src/lib/tab-navigation';

const items = [{ value: 'overview', label: '개요' }, { value: 'missing', label: '기록 없음', disabled: true }, { value: 'workflow', label: '절차' }, { value: 'history', label: '이력' }];

test('arrow navigation wraps through available tabs without requesting activation', () => {
  assert.deepEqual(tabKeyAction('ArrowRight', 'overview', items), { kind: 'focus', value: 'workflow' });
  assert.deepEqual(tabKeyAction('ArrowRight', 'history', items), { kind: 'focus', value: 'overview' });
  assert.deepEqual(tabKeyAction('ArrowLeft', 'overview', items), { kind: 'focus', value: 'history' });
  assert.deepEqual(tabKeyAction('ArrowLeft', 'workflow', items), { kind: 'focus', value: 'overview' });
});

test('Home and End focus the first and last available tabs, including after items disappear', () => {
  assert.deepEqual(tabKeyAction('Home', 'history', items), { kind: 'focus', value: 'overview' });
  assert.deepEqual(tabKeyAction('End', 'overview', items), { kind: 'focus', value: 'history' });
  assert.deepEqual(tabKeyAction('ArrowRight', 'removed', items), { kind: 'focus', value: 'overview' });
  assert.deepEqual(tabKeyAction('ArrowLeft', 'removed', items), { kind: 'focus', value: 'history' });
});

test('only Enter and Space request selection and unavailable or empty lists remain inert', () => {
  for (const key of ['Enter', ' ']) assert.deepEqual(tabKeyAction(key, 'workflow', items), { kind: 'select', value: 'workflow' });
  for (const key of ['Enter', ' ', 'ArrowRight', 'Home']) assert.equal(tabKeyAction(key, 'missing', [{ value: 'missing', disabled: true }]), undefined);
  assert.equal(tabKeyAction('ArrowLeft', 'overview', []), undefined);
  assert.equal(tabKeyAction('Tab', 'overview', items), undefined);
  assert.equal(tabKeyAction('ArrowDown', 'overview', items), undefined);
});

test('tab identifiers encode arbitrary values without colliding with panel identifiers', () => {
  const first = tabDomIds('group-one', 'value / 가');
  const second = tabDomIds('group-two', 'value / 가');
  assert.notEqual(first.tab, first.panel); assert.notEqual(first.tab, second.tab);
  assert.match(first.tab, /value%20%2F%20%EA%B0%80$/);
});

const componentRequire = createRequire(path.resolve('tests/accessible-tabs.test.ts'));
const cssLoader = componentRequire.extensions['.css'];
componentRequire.extensions['.css'] = () => undefined;
let tabsUi: typeof import('../src/components/accessible-tabs');
try { tabsUi = componentRequire('../src/components/accessible-tabs'); }
finally { if (cssLoader) componentRequire.extensions['.css'] = cssLoader; else delete componentRequire.extensions['.css']; }

test('each tab points to an existing unique panel, including hidden placeholders, while only active content mounts', () => {
  let mounted = 0;
  function Content() { mounted++; return createElement('p', {}, '현재 내용'); }
  function Group() {
    const tabs = tabsUi.useTabs({ value: 'overview', onChange: () => undefined, items });
    return createElement(Fragment, {},
      createElement(tabsUi.Tabs, { tabs, label: '세부업무 상세' }),
      // Existing active body keeps its place/key. Inactive panels are empty siblings.
      createElement('div', { ...tabs.panelAttrs('overview'), 'data-existing-parent': 'true' }, createElement(Content)),
      ...items.filter(item => item.value !== tabs.value).map(item => createElement('div', { key: item.value, ...tabs.panelAttrs(item.value) })),
    );
  }
  const html = renderToStaticMarkup(createElement(Fragment, {}, createElement(Group), createElement(Group)));
  const buttons = [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>/g)].map(match => match[0]);
  const panels = [...html.matchAll(/<div\b[^>]*role="tabpanel"[^>]*>/g)].map(match => match[0]);
  const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
  const panelIds = new Set(panels.map(panel => attr(panel, 'id')));
  const buttonIds = new Set(buttons.map(button => attr(button, 'id')));
  assert.equal(buttons.length, 8); assert.equal(panels.length, 8);
  assert.equal(panelIds.size, 8); assert.equal(buttonIds.size, 8);
  buttons.forEach(button => assert.ok(panelIds.has(attr(button, 'aria-controls'))));
  panels.forEach(panel => assert.ok(buttonIds.has(attr(panel, 'aria-labelledby'))));
  assert.equal(buttons.filter(button => attr(button, 'aria-selected') === 'true').length, 2);
  assert.equal(buttons.filter(button => attr(button, 'tabindex') === '0').length, 2);
  assert.equal(panels.filter(panel => panel.includes(' hidden=""')).length, 6);
  assert.equal(mounted, 2);
});

type TestButton = { ref: (element: HTMLButtonElement) => void; onClick: () => void; onKeyDown: (event: { key: string; preventDefault: () => void; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean }) => void; 'aria-selected': boolean; tabIndex: number; disabled?: boolean };

function buttonsFor(onChange: (value: string) => void) {
  const react = componentRequire('react') as typeof import('react');
  const originals = { useId: react.useId, useRef: react.useRef };
  react.useId = () => 'test-tabs';
  react.useRef = ((value: unknown) => ({ current: value })) as typeof react.useRef;
  try {
    const tabs = tabsUi.useTabs({ value: 'overview', onChange, items });
    const rendered = tabsUi.Tabs({ tabs, label: '실제 업무 탭' });
    return rendered.props.children as ReactElement<TestButton>[];
  } finally { Object.assign(react, originals); }
}

test('actual tab events focus without switching, then invoke caller guards once and retain controlled selection', () => {
  const changes: string[] = [], focused: number[] = [];
  const buttons = buttonsFor(value => changes.push(value));
  buttons.forEach((button, index) => button.props.ref({ focus: () => focused.push(index) } as unknown as HTMLButtonElement));
  let prevented = 0;
  buttons[0].props.onKeyDown({ key: 'ArrowRight', preventDefault: () => { prevented++; } });
  assert.deepEqual(focused, [2]); assert.equal(changes.length, 0);
  buttons[2].props.onKeyDown({ key: 'Enter', preventDefault: () => { prevented++; } });
  assert.deepEqual(changes, ['workflow']); assert.equal(prevented, 2);
  // A dirty guard may decline: the component never changes the supplied value itself.
  assert.equal(buttons[0].props['aria-selected'], true); assert.equal(buttons[2].props['aria-selected'], false);
  buttons[2].props.onKeyDown({ key: ' ', preventDefault: () => { prevented++; } });
  assert.deepEqual(changes, ['workflow', 'workflow']);
  buttons[1].props.onClick(); assert.equal(changes.length, 2);
  buttons[3].props.onClick(); assert.deepEqual(changes, ['workflow', 'workflow', 'history']);
  buttons[0].props.onClick(); assert.equal(changes.length, 3);
  buttons[0].props.onKeyDown({ key: 'ArrowRight', ctrlKey: true, preventDefault: () => assert.fail('Modified shortcut must remain available') });
  assert.deepEqual(focused, [2]);
});
