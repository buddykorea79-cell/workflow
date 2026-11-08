import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { changedDatePart, dateInputError, dateInputValue, pastedDateInput, splitDateInput } from '../src/lib/date-input';

const requireComponent = createRequire(path.resolve('tests/date-input.test.ts'));
const oldCss = requireComponent.extensions['.css'];
requireComponent.extensions['.css'] = () => undefined;
const guardModule = requireComponent.cache[requireComponent.resolve('../src/components/unsaved-changes')] ?? (requireComponent('../src/components/unsaved-changes'), requireComponent.cache[requireComponent.resolve('../src/components/unsaved-changes')]!);
const guardExports = guardModule.exports;
let localDraft = false;
let DateInput: typeof import('../src/components/date-input').DateInput;
try { guardModule.exports = { ...guardExports, useUnsavedChanges: (dirty: boolean) => { localDraft = dirty; return 'date-draft'; } }; ({ DateInput } = requireComponent('../src/components/date-input')); }
finally { guardModule.exports = guardExports; if (oldCss) requireComponent.extensions['.css'] = oldCss; else delete requireComponent.extensions['.css']; }

type Props = Record<string, any> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
// Execute the component's actual keyboard, paste, and calendar handlers. Focus is
// recorded by controls; this is not a claim of a browser end-to-end test.
function host(initial = '', extra: Partial<import('../src/components/date-input').DateInputProps> = {}) {
  const slots: any[] = []; let tree: ReactNode; let value = initial; let focused = ''; let validity = ''; let pickerCalls = 0;
  const emitted: string[] = [];
  const h = {
    render() {
      const react = requireComponent('react') as typeof import('react'); let index = 0;
      const original = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useId: react.useId };
      const effects: (() => void)[] = [];
      react.useState = ((initial: any) => { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], (update: any) => { slots[at] = typeof update === 'function' ? update(slots[at]) : update; }]; }) as typeof react.useState;
      react.useRef = ((initial: any) => { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; }) as typeof react.useRef;
      react.useEffect = ((effect: () => void) => { index++; effects.push(effect); }) as typeof react.useEffect;
      react.useId = () => `date-test-${index++}`;
      try { tree = DateInput({ value, onChange: next => { value = next; emitted.push(next); }, 'aria-label': '마감일', ...extra }); }
      finally { Object.assign(react, original); }
      for (const node of elements(tree)) if (node.type === 'input' && node.props.ref) {
        const control = { focus: () => { focused = node.props['aria-label']; }, select() {}, setCustomValidity: (message: string) => { validity = message; }, showPicker: () => { pickerCalls++; } };
        if (typeof node.props.ref === 'function') node.props.ref(control); else node.props.ref.current = control;
      }
      effects.forEach(effect => effect());
    },
    field(label: string): Props { const found = elements(tree).find(node => node.props['aria-label'] === `마감일 ${label}`); assert.ok(found); return found.props; },
    change(label: string, next: string) { this.field(label).onChange({ target: { value: next } }); this.render(); },
    paste(label: string, text: string) { let prevented = false; this.field(label).onPaste({ clipboardData: { getData: () => text }, preventDefault() { prevented = true; } }); this.render(); return prevented; },
    external(next: string) { value = next; this.render(); this.render(); },
    get value() { return value; }, get focused() { return focused; }, get validity() { return validity; }, get pickerCalls() { return pickerCalls; }, get localDraft() { return localDraft; }, emitted,
  };
  h.render(); return h;
}

test('date entry advances from a four-digit year to month and keeps month/day outside the year', () => {
  const view = host();
  view.change('연도', '2'); view.change('연도', '20'); view.change('연도', '202');
  assert.equal(view.focused, '');
  view.change('연도', '2026'); assert.equal(view.focused, '마감일 월');
  view.change('월', '09'); assert.equal(view.focused, '마감일 일');
  view.change('일', '08');
  assert.equal(view.value, '2026-09-08'); assert.equal(view.field('연도').value, '2026');
  assert.equal(view.field('연도').maxLength, 4); assert.equal(changedDatePart('year', '202609').text, '2026');
});

test('incomplete edits retain local segments and cannot leave the old valid date silently saved', () => {
  const view = host('2026-09-08', { required: true });
  view.change('연도', '202');
  assert.equal(view.value, ''); assert.equal(view.field('연도').value, '202'); assert.equal(view.field('월').value, '09');
  assert.match(view.validity, /연도 4자리/);
  view.change('연도', '2027'); assert.equal(view.value, '2027-09-08'); assert.equal(view.validity, '');
});

test('date entry accepts ISO and compact paste, rejects invalid dates, and honors leap years', () => {
  const view = host();
  assert.equal(view.paste('연도', '2026-09-08'), true); assert.equal(view.value, '2026-09-08');
  assert.equal(view.paste('월', '20280229'), true); assert.equal(view.value, '2028-02-29');
  assert.equal(view.paste('연도', '2026-02-29'), true); assert.equal(view.value, '2028-02-29'); assert.match(view.validity, /실제 날짜/);
  assert.equal(pastedDateInput('202609-01-01'), undefined);
  assert.equal(dateInputValue({ year: '2026', month: '02', day: '30' }), '');
  assert.equal(dateInputValue({ year: '0000', month: '01', day: '01' }), '');
});

test('calendar selection and external resets synchronize all segments; range constraints reach native validity', () => {
  const view = host('', { min: '2026-09-01', max: '2026-09-30' });
  view.field('달력 열기').onClick(); assert.equal(view.pickerCalls, 1);
  view.change('달력 선택', '2026-09-18'); assert.equal(view.value, '2026-09-18'); assert.equal(view.field('연도').value, '2026');
  view.change('일', '31'); assert.equal(view.value, ''); assert.match(view.validity, /실제 존재/);
  view.paste('연도', '2026-10-01'); assert.match(view.validity, /2026-09-30/);
  view.external('2026-09-20'); assert.equal(view.field('일').value, '20'); assert.equal(view.validity, '');
  view.external(''); assert.equal(view.field('연도').value, ''); assert.equal(view.field('월').value, '');
  assert.equal(dateInputError(splitDateInput('')), '');
});

test('partial optional dates and rejected paste protect local drafts even while the parent value remains empty', () => {
  const view = host();
  assert.equal(view.localDraft, false);
  view.change('연도', '202'); assert.equal(view.value, ''); assert.equal(view.localDraft, true);
  assert.equal(view.field('연도').required, true); assert.equal(view.field('월').required, true); assert.equal(view.field('일').required, true);
  view.paste('연도', '2026-09-08'); assert.equal(view.localDraft, false);
  view.paste('연도', '2026-02-30'); assert.equal(view.localDraft, true);
  view.change('일', '09'); assert.equal(view.localDraft, false);
  view.field('지우기').onClick(); view.render();
  assert.equal(view.value, ''); assert.equal(view.localDraft, false); assert.equal(view.field('연도').required, false);
});
