import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';

const requireUi = createRequire(path.resolve('tests/modal-input-feedback.test.ts'));
const previousCss = requireUi.extensions['.css'];
requireUi.extensions['.css'] = () => undefined;
let Modal: typeof import('../src/components/ui').Modal;
try { ({ Modal } = requireUi('../src/components/ui')); }
finally { if (previousCss) requireUi.extensions['.css'] = previousCss; else delete requireUi.extensions['.css']; }

type Feedback = { message: string; fields: { path: string; message: string }[] };
type Props = Record<string, any> & { children?: ReactNode };
function find(node: ReactNode, predicate: (props: Props) => boolean): ReactElement<Props> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, predicate); if (result) return result; } return; }
  if (!isValidElement<Props>(node)) return;
  return predicate(node.props) ? node : find(node.props.children, predicate);
}

// Exercise the real Modal event handlers without DOM focus/layout effects. Real
// browser typing is checked separately; this covers the capture/bubble contract.
function modalHost(control: 'input' | 'textarea' | 'select' = 'input') {
  const slots: any[] = []; let tree: ReactNode; let value = ''; let feedbackWrites = 0;
  const dialog = {};
  const isFeedback = (item: any): item is Feedback => !!item && Array.isArray(item.fields) && typeof item.message === 'string';
  const host = {
    render() {
      const react = requireUi('react') as typeof import('react'); let index = 0;
      const original = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useLayoutEffect: react.useLayoutEffect, useId: react.useId };
      react.useState = ((initial: any) => {
        const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial;
        return [slots[at], (update: any) => {
          const next = typeof update === 'function' ? update(slots[at]) : update;
          if (isFeedback(slots[at]) && next !== slots[at]) feedbackWrites++;
          slots[at] = next;
        }];
      }) as typeof react.useState;
      react.useRef = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; }) as typeof react.useRef;
      react.useEffect = (() => { index++; }) as typeof react.useEffect;
      react.useLayoutEffect = (() => { index++; }) as typeof react.useLayoutEffect;
      react.useId = () => `modal-input-${index++}`;
      try {
        tree = Modal({ title: '등록 입력 검증', onClose() {}, children: createElement(control, { value, onChange: (event: { target: { value: string } }) => { value = event.target.value; } }) });
      } finally { Object.assign(react, original); }
      this.modal().ref.current = dialog;
    },
    modal(): Props { const node = find(tree, props => props.role === 'dialog'); assert.ok(node); return node.props; },
    field(): Props { const node = find(tree, props => typeof props.onChange === 'function' && 'value' in props); assert.ok(node); return node.props; },
    feedback(): Feedback { const item = slots.find(isFeedback); assert.ok(item); return item; },
    seedFeedback(feedback: Feedback) { const at = slots.findIndex(isFeedback); assert.ok(at >= 0); slots[at] = feedback; this.render(); },
    target(path = 'title', owner = dialog) {
      return { value: '', tagName: control.toUpperCase(), closest: (selector: string) => selector === '[data-field-path]' ? path ? { dataset: { fieldPath: path } } : null : owner };
    },
    change(next: string, fieldPath = 'title', nativeEvent: Record<string, unknown> = {}) {
      const target = this.target(fieldPath); target.value = next;
      const event = { target, currentTarget: dialog, nativeEvent };
      const before = feedbackWrites;
      this.modal().onInputCapture?.(event);
      this.modal().onChangeCapture?.(event);
      assert.equal(feedbackWrites, before, 'capture must not rerender controlled fields before their own change handler');
      this.field().onChange(event);
      assert.equal(value, next, 'the control owns its value before error cleanup');
      assert.equal(typeof this.modal().onChange, 'function');
      this.modal().onChange(event);
      this.render();
      assert.equal(this.field().value, next);
    },
    get feedbackWrites() { return feedbackWrites; },
    get value() { return value; },
    dialog,
  };
  host.render(); return host;
}

test('ordinary text typing does not update modal feedback before the controlled value changes', () => {
  const view = modalHost(); const feedback = view.feedback();
  for (const character of 'Input test 123') view.change(view.value + character);
  assert.equal(view.value, 'Input test 123');
  assert.equal(view.feedback(), feedback); assert.equal(view.feedbackWrites, 0);
});

test('textarea changes clear only their own field error after accepting the new value', () => {
  const view = modalHost('textarea');
  const remaining = { path: 'dueDate', message: '마감일을 입력하세요.' };
  view.seedFeedback({ message: '다른 확인 사항을 확인하세요.', fields: [{ path: 'description', message: '설명을 입력하세요.' }, remaining] });
  view.change('업무 목적과 수행 범위\n한글 설명을 입력합니다.', 'description');
  assert.deepEqual(view.feedback(), { message: '다른 확인 사항을 확인하세요.', fields: [remaining] });
  assert.equal(view.feedback().fields[0], remaining); assert.equal(view.feedbackWrites, 1);
  const after = view.feedback(); view.change(`${view.value}\n추가 내용`, 'description');
  assert.equal(view.feedback(), after); assert.equal(view.feedbackWrites, 1);
});

test('select changes accept the selected value and clear their specific validation error', () => {
  const view = modalHost('select');
  view.seedFeedback({ message: '', fields: [{ path: 'unitId', message: '단위업무를 선택하세요.' }] });
  view.change('unit-data', 'unitId');
  assert.equal(view.value, 'unit-data'); assert.deepEqual(view.feedback(), { message: '', fields: [] });
});

test('unrelated and unlabelled controls preserve the feedback object and other field errors', () => {
  const view = modalHost(); const feedback = { message: '확인 필요', fields: [{ path: 'dueDate', message: '마감일 필수' }] };
  view.seedFeedback(feedback);
  view.change('새 업무', 'title'); view.change('추가 설명', '');
  assert.equal(view.feedback(), feedback); assert.equal(view.feedbackWrites, 0);
});

test('nested dialog changes cannot clear the parent dialog field errors', () => {
  const view = modalHost(); const feedback = { message: '부모 안내', fields: [{ path: 'title', message: '부모 이름 필수' }] };
  view.seedFeedback(feedback);
  const nested = {}; const target = view.target('title', nested); target.value = '하위 창 이름';
  view.modal().onChange({ target, currentTarget: view.dialog, nativeEvent: {} });
  assert.equal(view.feedback(), feedback); assert.equal(view.feedbackWrites, 0);
});

test('Korean composition change values remain intact while feedback clears after input', () => {
  const view = modalHost();
  view.seedFeedback({ message: '', fields: [{ path: 'title', message: '이름 필수' }] });
  for (const value of ['ㅎ', '하', '한', '한ㄱ', '한그', '한글']) view.change(value, 'title', { isComposing: true, inputType: 'insertCompositionText' });
  view.change('한글 업무', 'title', { isComposing: false, inputType: 'insertText' });
  assert.equal(view.value, '한글 업무'); assert.deepEqual(view.feedback().fields, []); assert.equal(view.feedbackWrites, 1);
});
