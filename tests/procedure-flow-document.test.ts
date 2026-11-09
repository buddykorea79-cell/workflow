import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const requireUi = createRequire(path.resolve('tests/procedure-flow-document.test.ts'));
const cssLoader = requireUi.extensions['.css'];
requireUi.extensions['.css'] = () => undefined;
let ui: typeof import('../src/components/procedure-flow-document');
try { ui = requireUi('../src/components/procedure-flow-document'); }
finally { if (cssLoader) requireUi.extensions['.css'] = cssLoader; else delete requireUi.extensions['.css']; }

const workflow = [
  { id: 'first', title: '공동 담당자가 제출한 자료를 누락 없이 취합하고 긴 제목을 생략하지 않고 모두 확인하는 절차', role: 'primary' as const, dependsOn: [] },
  { id: 'support', title: '관계 부서와 필요한 보완 자료 협의', role: 'support' as const, dependsOn: ['first'] },
  { id: 'review', title: '취합 자료와 협의 결과를 검토하여 결과 확정', role: 'reviewer' as const, dependsOn: ['first', 'support'] },
];
const participants = { primary: '김담당 · 이공동담당 · 박공동담당 · 최공동담당', support: '오협업 · 정지원', reviewer: '한검토' };
type Props = Record<string, any> & { children?: ReactNode };
function all(node: ReactNode, predicate: (props: Props, type: unknown) => boolean): Props[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  if (!isValidElement<Props>(node)) return [];
  return [...(predicate(node.props, node.type) ? [node.props] : []), ...all(node.props.children, predicate)];
}
function renderHost(render: () => ReactNode) {
  const react = requireUi('react') as typeof import('react');
  const saved = { useState: react.useState, useRef: react.useRef, useMemo: react.useMemo, useEffect: react.useEffect, useId: react.useId };
  const effects: (() => void | (() => void))[] = [];
  react.useState = ((initial?: any) => [typeof initial === 'function' ? initial() : initial, () => undefined]) as typeof react.useState;
  react.useRef = ((initial: any) => ({ current: initial })) as typeof react.useRef;
  react.useMemo = ((factory: () => unknown) => factory()) as typeof react.useMemo;
  react.useEffect = ((effect: () => void | (() => void)) => { effects.push(effect); }) as typeof react.useEffect;
  react.useId = (() => 'test') as typeof react.useId;
  try { const tree = render(); return { tree, effects }; } finally { Object.assign(react, saved); }
}

test('read-only horizontal document preserves full titles and accessible relationships without duplicate card text or card tab stops', () => {
  const html = renderToStaticMarkup(createElement(ui.ProcedureFlowDocument, { workflow, participants, className: 'test-height' }));
  assert.match(html, /class="procedure-flow-document test-height" data-direction="horizontal" role="region" aria-label="역할별 업무 절차도, 왼쪽에서 오른쪽으로 진행" tabindex="0"/);
  assert.equal((html.match(/<article /g) || []).length, 3);
  assert.equal((html.match(/<button/g) || []).length, 0);
  for (const step of workflow) assert.ok(html.includes(step.title));
  for (const name of Object.values(participants)) assert.equal(html.split(name).length - 1, 3, 'full participants appear in the header text/title and the complete card');
  assert.ok(html.includes('선행 절차 01, 02'));
  assert.ok(html.includes('--pfd-grid-columns:220px 220px 220px'));
  assert.doesNotMatch(html, /react-flow|transform:|viewBox=/);
  const { tree } = renderHost(() => ui.ProcedureFlowDocument({ workflow, participants }));
  const lanes = all(tree, props => props.className === 'pfd-row');
  assert.deepEqual(lanes.map(lane => lane['data-role']), ['primary', 'support', 'reviewer']);
  const cards = all(tree, props => !!props['data-step-id']);
  assert.deepEqual(cards.map(card => card.style.gridColumn), [1, 2, 3]);
  assert.equal(all(tree, props => props.className === 'pfd-card-participant' || props.className === 'pfd-card-dependencies').length, 0);
});

test('selectable cards use native buttons and emit only the selected id without mutating the workflow', () => {
  const original = structuredClone(workflow), selected: string[] = [];
  const { tree } = renderHost(() => ui.ProcedureFlowDocument({ workflow, participants, selectedId: 'support', onSelect: id => selected.push(id) }));
  const buttons = all(tree, (_props, type) => type === 'button');
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map(button => button['aria-pressed']), [false, true, false]);
  assert.ok(buttons.every(button => button.type === 'button' && !button.onKeyDown && !button.onWheel && button.tabIndex === undefined));
  buttons[2].onClick();
  assert.deepEqual(selected, ['review']);
  assert.deepEqual(workflow, original);
});

test('horizontal connectors use stage and lane gaps without crossing an intervening card', () => {
  const source = { left: 24, right: 244, top: 24, bottom: 74, column: 0, laneTop: 6, laneBottom: 100 };
  const target = { left: 576, right: 796, top: 224, bottom: 274, column: 2, laneTop: 200, laneBottom: 294 };
  const path = ui.documentConnectorPath(source, target, false, 300);
  const points = [...path.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
  const obstacle = { left: 300, right: 520, top: 124, bottom: 174 };
  assert.deepEqual(points[0], { x: 244, y: 49 });
  assert.deepEqual(points.at(-1), { x: 574, y: 249 });
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const intersects = a.x === b.x
      ? a.x > obstacle.left && a.x < obstacle.right && Math.max(a.y, b.y) > obstacle.top && Math.min(a.y, b.y) < obstacle.bottom
      : a.y > obstacle.top && a.y < obstacle.bottom && Math.max(a.x, b.x) > obstacle.left && Math.min(a.x, b.x) < obstacle.right;
    assert.equal(intersects, false, 'an edge must stay in whitespace around intermediate cards');
  }
  const nextColumn = { ...target, left: 300, right: 520, column: 1 };
  assert.ok(ui.documentConnectorPath(source, nextColumn, false, 300).includes('272 49 L 272 249'), 'role changes use the gap between adjacent stages');
  const selfLoop = ui.documentConnectorPath(source, source, true, 300);
  assert.match(selfLoop, /L 262 297 L 6 297/);
  assert.ok(selfLoop.endsWith('L 22 49'));
});

test('selection scrolls horizontally past the sticky role label without moving the vertical viewport', () => {
  const raf = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
  const frames: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  globalThis.cancelAnimationFrame = () => undefined;
  try {
    const { tree, effects } = renderHost(() => ui.ProcedureFlowDocument({ workflow, participants, selectedId: 'review' }));
    const calls: ScrollToOptions[] = [];
    all(tree, props => props.role === 'region')[0].ref.current = {
      clientHeight: 400, clientWidth: 350, scrollTop: 0, scrollLeft: 0,
      getBoundingClientRect: () => ({ top: 100, left: 100 }),
      scrollTo: (options: ScrollToOptions) => calls.push(options),
    };
    all(tree, props => props.className === 'pfd-role-header')[0].ref.current = { getBoundingClientRect: () => ({ width: 124 }) };
    all(tree, props => props['data-step-id'] === 'review')[0].ref({ getBoundingClientRect: () => ({ top: 700, bottom: 880, left: 600, right: 880, width: 280, height: 180 }) });
    const cleanups = effects.map(effect => effect());
    frames.forEach(callback => callback(0));
    assert.deepEqual(calls, [{ left: 364, behavior: 'auto' }]);
    cleanups.forEach(cleanup => cleanup?.());
  } finally { globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel; }
});

test('shorter viewports expand text width without shrinking its type or an already sufficient card', () => {
  assert.equal(ui.expandedDocumentCardWidth(220, 156, 44, 50), 220);
  const expanded = ui.expandedDocumentCardWidth(220, 156, 112, 23);
  assert.ok(expanded >= 840);
  assert.equal(expanded % 16, 0);
  assert.equal(ui.expandedDocumentCardWidth(expanded, expanded - 64, 22.4, 23), expanded);
});

test('a returning connection remains visible and explained, while empty workflows have a clear state', () => {
  const html = renderToStaticMarkup(createElement(ui.ProcedureFlowDocument, { workflow: [{ ...workflow[0], dependsOn: ['first'] }] }));
  assert.ok(html.includes('점선은 앞 단계로 돌아가는 연결입니다.'));
  assert.ok(html.includes('선행 절차 01'));
  const empty = renderToStaticMarkup(createElement(ui.ProcedureFlowDocument, { workflow: [] }));
  assert.ok(empty.includes('등록된 절차가 없습니다.'));
  assert.doesNotMatch(empty, /tabindex/);
});
