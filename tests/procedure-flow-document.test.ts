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

test('read-only document preserves full titles, participants, dependency numbers and has no card tab stops', () => {
  const html = renderToStaticMarkup(createElement(ui.ProcedureFlowDocument, { workflow, participants, className: 'test-height' }));
  assert.match(html, /class="procedure-flow-document test-height" role="region" aria-label="역할별 업무 절차도" tabindex="0"/);
  assert.equal((html.match(/<article /g) || []).length, 3);
  assert.equal((html.match(/<button/g) || []).length, 0);
  for (const step of workflow) assert.ok(html.includes(step.title));
  for (const name of Object.values(participants)) assert.equal(html.split(name).length - 1, 3, 'full participants appear in the header text/title and the complete card');
  assert.ok(html.includes('선행 절차 01, 02'));
  assert.ok(html.includes('--pfd-min-width:976px'));
  assert.doesNotMatch(html, /react-flow|transform:|viewBox=/);
  const { tree } = renderHost(() => ui.ProcedureFlowDocument({ workflow, participants }));
  for (const card of all(tree, props => props.className === 'pfd-card-participant')) assert.equal(card.title, undefined, 'full card names do not rely on a hover tooltip');
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

test('connectors use row gaps and role gutters without crossing an intervening card', () => {
  const source = { left: 24, right: 304, top: 24, bottom: 180, row: 0, rowTop: 24, rowBottom: 260 };
  const target = { left: 672, right: 952, top: 620, bottom: 790, row: 2, rowTop: 620, rowBottom: 790 };
  const path = ui.documentConnectorPath(source, target, false, 976);
  const points = [...path.matchAll(/[ML] ([\d.-]+) ([\d.-]+)/g)].map(match => ({ x: Number(match[1]), y: Number(match[2]) }));
  const obstacle = { left: 348, right: 628, top: 332, bottom: 548 };
  assert.deepEqual(points[0], { x: 164, y: 180 });
  assert.deepEqual(points.at(-1), { x: 812, y: 618 });
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1], b = points[index];
    const intersects = a.x === b.x
      ? a.x > obstacle.left && a.x < obstacle.right && Math.max(a.y, b.y) > obstacle.top && Math.min(a.y, b.y) < obstacle.bottom
      : a.y > obstacle.top && a.y < obstacle.bottom && Math.max(a.x, b.x) > obstacle.left && Math.min(a.x, b.x) < obstacle.right;
    assert.equal(intersects, false, 'an edge must stay in whitespace around intermediate cards');
  }
  const nextRow = { ...target, top: 332, row: 1, rowTop: 332 };
  assert.ok(ui.documentConnectorPath(source, nextRow, false, 976).includes('164 296'), 'departure clears the tallest card in the source row');
  const selfLoop = ui.documentConnectorPath(source, source, true, 976);
  assert.match(selfLoop, /L 967 282 L 967 2/);
  assert.ok(selfLoop.endsWith('L 164 22'));
});

test('selection scrolls only its own viewport and keeps the card below the sticky role header', () => {
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
    all(tree, props => props.className === 'pfd-role-header')[0].ref.current = { getBoundingClientRect: () => ({ height: 70 }) };
    all(tree, props => props['data-step-id'] === 'review')[0].ref({ getBoundingClientRect: () => ({ top: 700, bottom: 880, left: 600, right: 880, height: 180 }) });
    const cleanups = effects.map(effect => effect());
    frames.forEach(callback => callback(0));
    assert.deepEqual(calls, [{ top: 394, left: 444, behavior: 'auto' }]);
    cleanups.forEach(cleanup => cleanup?.());
  } finally { globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel; }
});

test('a returning connection remains visible and explained, while empty workflows have a clear state', () => {
  const html = renderToStaticMarkup(createElement(ui.ProcedureFlowDocument, { workflow: [{ ...workflow[0], dependsOn: ['first'] }] }));
  assert.ok(html.includes('점선은 앞 단계로 돌아가는 연결입니다.'));
  assert.ok(html.includes('선행 절차 01'));
  const empty = renderToStaticMarkup(createElement(ui.ProcedureFlowDocument, { workflow: [] }));
  assert.ok(empty.includes('등록된 절차가 없습니다.'));
  assert.doesNotMatch(empty, /tabindex/);
});
