import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isValidElement, type ReactNode } from 'react';
import { defaultWorkflow } from '../src/lib/seed-helpers';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';

const requireUi = createRequire(path.resolve('tests/procedure-flow-navigation.test.ts'));
const cssLoader = requireUi.extensions['.css']; requireUi.extensions['.css'] = () => undefined;
const guard = requireUi('../src/components/unsaved-changes');
const guardModule = requireUi.cache[requireUi.resolve('../src/components/unsaved-changes')]!;
let flowUi: typeof import('../src/components/procedure-builder');
let editorUi: typeof import('../src/components/procedure-editor');
let ui: typeof import('../src/components/ui');
try {
  guardModule.exports = { ...guard, useUnsavedChanges: () => 'procedure-draft' };
  flowUi = requireUi('../src/components/procedure-builder');
  editorUi = requireUi('../src/components/procedure-editor');
  ui = requireUi('../src/components/ui');
} finally {
  guardModule.exports = guard;
  if (cssLoader) requireUi.extensions['.css'] = cssLoader; else delete requireUi.extensions['.css'];
}
type Props = Record<string, any> & { children?: ReactNode };
function all(node: ReactNode, predicate: (props: Props, type: unknown) => boolean): Props[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  if (!isValidElement<Props>(node)) return [];
  return [...(predicate(node.props, node.type) ? [node.props] : []), ...all(node.props.children, predicate)];
}
function label(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(label).join('');
  return isValidElement<Props>(node) ? label(node.props.children) : '';
}
function host(render: () => ReactNode) {
  const slots: any[] = []; let tree: ReactNode; let effects: (() => void)[] = [];
  return {
    render() {
      const react = requireUi('react') as typeof import('react');
      const saved = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useMemo: react.useMemo, useId: react.useId }; let index = 0;
      react.useState = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], (value: any) => { slots[at] = typeof value === 'function' ? value(slots[at]) : value; }]; }) as typeof react.useState;
      react.useRef = ((value: unknown) => { const at = index++; if (!(at in slots)) slots[at] = { current: value }; return slots[at]; }) as typeof react.useRef;
      react.useMemo = ((factory: () => unknown) => { index++; return factory(); }) as typeof react.useMemo;
      react.useId = (() => `procedure-${index++}`) as typeof react.useId;
      react.useEffect = ((effect: () => unknown, deps: unknown[]) => { const at = index++; const previous = slots[at]; if (!previous || !deps || deps.some((item, i) => !Object.is(item, previous.deps?.[i]))) { slots[at] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[at].cleanup = effect(); }); } }) as typeof react.useEffect;
      try { tree = render(); } finally { Object.assign(react, saved); }
      return tree;
    },
    commit() { const pending = effects; effects = []; pending.forEach(effect => effect()); },
    all(predicate: (props: Props, type: unknown) => boolean) { return all(tree, predicate); },
    one(predicate: (props: Props, type: unknown) => boolean) { const found = all(tree, predicate); assert.equal(found.length, 1); return found[0]; },
    button(text: string) { return this.one(props => !!props.onClick && label(props.children) === text); },
  };
}

test('compact flow supports direct and keyboard selection without changing the definition or trapping wheel scroll', () => {
  const workflow = defaultWorkflow(); const original = structuredClone(workflow); const selected: string[] = [];
  const view = host(() => flowUi.ProcedureFlow({ workflow, compact: true, onSelect: id => selected.push(id) }));
  view.render(); view.commit();
  const canvas = host(() => flowUi.ProcedureFlowCanvas(view.one(props => Array.isArray(props.nodes) && Array.isArray(props.edges)) as Parameters<typeof flowUi.ProcedureFlowCanvas>[0]));
  canvas.render();
  const chart = canvas.one(props => Array.isArray(props.nodes) && Array.isArray(props.edges));
  assert.equal(chart.zoomOnScroll, false); assert.equal(chart.preventScrolling, false); assert.equal(chart.nodesDraggable, false);
  chart.onNodeClick({}, { id: 'lane-primary' }); assert.deepEqual(selected, []);
  chart.onNodeClick({}, { id: workflow[1].id }); assert.deepEqual(selected, [workflow[1].id]);
  all(view.one(props => props['aria-label'] === '절차 편집 위치 선택').children, props => !!props.onClick)[0].onClick();
  assert.deepEqual(selected, [workflow[1].id, workflow[0].id]);
  let prevented = false;
  canvas.one(props => !!props.onKeyDownCapture).onKeyDownCapture({ key: 'Enter', target: { closest: () => ({ dataset: { id: workflow[2].id } }) }, preventDefault() { prevented = true; }, stopPropagation() {} });
  assert.equal(prevented, true); assert.equal(selected.at(-1), workflow[2].id); assert.deepEqual(workflow, original);
});

test('expanded flow uses the shared modal and only jumps after explicit selection and focus restoration', () => {
  const dom = requireUi('react-dom') as typeof import('react-dom'); const originalPortal = dom.createPortal;
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const raf = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
  const body = {}; const frames: FrameRequestCallback[] = []; const selected: string[] = []; let portalTarget: unknown;
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { body } });
  dom.createPortal = ((children, target) => { portalTarget = target; return children; }) as typeof dom.createPortal;
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; }; globalThis.cancelAnimationFrame = () => undefined;
  try {
    const workflow = defaultWorkflow();
    const context = { departmentName: '기획 부서', unitTitle: '자료 관리', taskTitle: '제출 자료 점검' };
    const view = host(() => flowUi.ProcedureFlow({ workflow, context, compact: true, onSelect: id => selected.push(id) }));
    view.render(); view.commit(); view.button(' 크게 보기').onClick(); view.render(); view.commit();
    assert.equal(portalTarget, body);
    assert.equal(view.all(props => Array.isArray(props.nodes)).length, 1, 'compact canvas stays mounted behind the native scrolling diagram');
    let modal = view.one((_props, type) => type === ui.Modal);
    assert.equal(modal.title, '업무 절차도');
    assert.equal(modal.description, '부서명: 기획 부서 · 단위업무: 자료 관리 · 개인업무: 제출 자료 점검');
    assert.equal(all(modal.children, props => ['procedure-flow-legend', 'procedure-flow-help', 'procedure-accessible-list'].includes(props.className)).length, 0, 'the enlarged body contains the diagram without extra explanations or lists');
    view.one(props => Array.isArray(props.workflow)).onSelect(workflow[2].id); view.render();
    assert.deepEqual(selected, [], 'inspecting an enlarged node does not yet move the underlying editor');
    modal = view.one((_props, type) => type === ui.Modal); modal.onClose(); view.render(); view.commit();
    assert.deepEqual(selected, []); assert.equal(view.all((_props, type) => type === ui.Modal).length, 0);
    view.button(' 크게 보기').onClick(); view.render(); view.commit();
    view.one(props => Array.isArray(props.workflow)).onSelect(workflow[1].id); view.render();
    view.button('선택한 절차로 이동 ').onClick(); view.render(); view.commit();
    assert.deepEqual(selected, []); frames.shift()!(0); assert.deepEqual(selected, []); frames.shift()!(0);
    assert.deepEqual(selected, [workflow[1].id]);
  } finally {
    dom.createPortal = originalPortal;
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor); else Reflect.deleteProperty(globalThis, 'document');
    globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel;
  }
});

test('scroll-only flow shows the full workflow without a canvas or a second enlargement dialog', () => {
  const workflow = defaultWorkflow(); const view = host(() => flowUi.ProcedureFlow({ workflow, scrollOnly: true }));
  view.render(); view.commit();
  assert.equal(view.all(props => Array.isArray(props.nodes)).length, 0);
  assert.equal(view.all(props => props['aria-haspopup'] === 'dialog').length, 0);
  const diagram = view.one(props => Array.isArray(props.workflow));
  assert.equal(diagram.workflow, workflow); assert.equal(diagram.onSelect, undefined);
  assert.equal(view.all(props => ['procedure-flow-legend', 'procedure-flow-help', 'procedure-accessible-list'].includes(props.className)).length, 0);
});

test('each canvas refits after an actual resize while preserving the viewport across ordinary rerenders', () => {
  const resizeDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const raf = globalThis.requestAnimationFrame, cancel = globalThis.cancelAnimationFrame;
  const frames: FrameRequestCallback[] = []; let resized: ResizeObserverCallback = () => undefined; let fitted = 0;
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: class { constructor(callback: ResizeObserverCallback) { resized = callback; } observe() {} disconnect() {} } });
  globalThis.requestAnimationFrame = callback => { frames.push(callback); return frames.length; }; globalThis.cancelAnimationFrame = () => undefined;
  try {
    const view = host(() => flowUi.ProcedureFlowCanvas({ nodes: [], edges: [], redrawKey: 0 })); view.render();
    view.one(props => props.className === 'procedure-flow').ref.current = { clientWidth: 900, clientHeight: 190 };
    view.one(props => !!props.onInit).onInit({ fitView: async () => { fitted++; return true; } }); view.commit();
    const notify = (width: number, height: number) => resized([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver);
    notify(900, 190); assert.equal(frames.length, 0);
    view.render(); view.commit(); assert.equal(frames.length, 0, 'typing or selecting must retain the user viewport');
    notify(300, 130); frames.shift()!(0); assert.equal(fitted, 1);
    notify(300, 130); assert.equal(frames.length, 0);
    notify(900, 190); frames.shift()!(0); assert.equal(fitted, 2);
  } finally {
    if (resizeDescriptor) Object.defineProperty(globalThis, 'ResizeObserver', resizeDescriptor); else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    globalThis.requestAnimationFrame = raf; globalThis.cancelAnimationFrame = cancel;
  }
});

test('diagram navigation focuses editable titles or their protected section while leaving edits and files untouched', () => {
  const now = new Date('2026-11-08T03:00:00Z'); const workspace = getWorkspace(createSeed(now), 'u-jiho', now);
  const task = workspace.tasks[0]; const workflow = defaultWorkflow(); const calls: string[] = [];
  const props: Parameters<typeof editorUi.ProcedureEditor>[0] = { workspace, taskId: task.id, command: async () => { throw new Error('navigation must not save'); }, workflow, originalWorkflow: workflow, participants: { primary: '담당자', support: '지원자 미지정', reviewer: '검토자' }, editable: true, busy: false, requiredStepTitles: [workflow[0].title], hasChanges: true, diagramChanged: true, redrawKey: 0, onApply: async () => { throw new Error('navigation must not save'); }, onAdd: () => undefined, onChange: () => { throw new Error('navigation must not change values'); }, onRemove() {}, onMove() {} };
  const view = host(() => editorUi.ProcedureEditor(props)); view.render(); view.commit();
  const sections = view.all(props => typeof props.className === 'string' && props.className.startsWith('pe-step '));
  sections.forEach((section, i) => section.ref({ focus: () => calls.push(`section-${i}`), scrollIntoView: ({ block }: { block: string }) => calls.push(`scroll-${i}-${block}`) }));
  view.all(props => props.maxLength === 150).forEach((input, i) => input.ref({ disabled: input.disabled, focus: () => calls.push(`input-${i}`) }));
  const diagram = () => view.one(props => props.compact === true);
  diagram().onSelect(workflow[0].id); view.render(); view.commit(); assert.deepEqual(calls, ['section-0', 'scroll-0-start']);
  calls.length = 0; diagram().onSelect(workflow[1].id); view.render(); view.commit(); assert.deepEqual(calls, ['input-1', 'scroll-1-start']);
  assert.equal(view.all(props => props.label === '절차 참고 파일').length, workflow.length);
  assert.equal(view.one(props => props.maxLength === 150 && props.value === workflow[0].title).disabled, true);
});

test('generated draft diagram navigation also moves focus to the selected draft editor', () => {
  const workflow = defaultWorkflow(); const calls: string[] = [];
  const view = host(() => flowUi.ProcedureBuilder({ taskId: 'draft', overview: { title: '업무', description: '업무 설명', completionCriteria: '' }, overviewAttachments: [], workflow, onApply: async () => { throw new Error('navigation must not apply'); } }));
  view.render(); view.commit(); view.button('본문으로 직접 초안 만들기').onClick(); view.render();
  view.one(props => props.placeholder === '예: 예산 집행 업무 지침').onChange({ target: { value: '업무 지침' } });
  view.one(props => props.rows === 7).onChange({ target: { value: '1. 담당자는 자료를 취합한다.\n2. 검토자는 결과를 검토한다.' } }); view.render();
  view.button('규칙 기반 절차 초안 만들기').onClick(); view.render(); view.commit();
  const diagram = view.one((_props, type) => type === flowUi.ProcedureFlow);
  diagram.onSelect(diagram.workflow[1].id); view.render();
  const editor = view.one(props => props.className === 'procedure-step-editor');
  editor.ref.current = { focus: () => calls.push('focus'), scrollIntoView: ({ block }: { block: string }) => calls.push(block) };
  view.commit(); assert.deepEqual(calls, ['focus', 'start']);
  assert.ok(editor['aria-label'].includes(diagram.workflow[1].title));
});
