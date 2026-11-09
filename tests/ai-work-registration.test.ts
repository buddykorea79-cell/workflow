import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import type { CommandFn, CommandOptions } from '../src/components/ui';
import type { WorkImportInput } from '../src/lib/work-import';

const componentRequire = createRequire(path.resolve('tests/ai-work-registration.test.ts'));
const previousCss = componentRequire.extensions['.css']; componentRequire.extensions['.css'] = () => undefined;
const ui = componentRequire('../src/components/ui');
const uiModule = componentRequire.cache[componentRequire.resolve('../src/components/ui')]!;
const guards = componentRequire('../src/components/unsaved-changes');
const guardModule = componentRequire.cache[componentRequire.resolve('../src/components/unsaved-changes')]!;
let dirty = false; let draftLabel = ''; let clearCount = 0;
let registration: typeof import('../src/components/ai-work-registration');
let personal: typeof import('../src/components/personal-work');
try {
  uiModule.exports = { ...ui, commandErrorTarget: () => null, showCommandError: () => true };
  guardModule.exports = { ...guards, useUnsavedChanges: (value: boolean, label: string) => { dirty = value; draftLabel = label; return 'ai-draft'; }, useUnsavedNavigation: () => ({ requestNavigation: (action: () => void) => action(), clearDraft: () => { clearCount++; }, draftIds: () => [] }) };
  registration = componentRequire('../src/components/ai-work-registration');
  personal = componentRequire('../src/components/personal-work');
} finally {
  uiModule.exports = ui; guardModule.exports = guards;
  if (previousCss) componentRequire.extensions['.css'] = previousCss; else delete componentRequire.extensions['.css'];
}
const now = new Date('2026-11-08T03:00:00Z');
function fixture(locked = false) { const state = createSeed(now); state.departmentWorkPlans = []; if (locked) state.departmentWorkPlans.push({ departmentId: 'dept-plan', status: 'confirmed', version: 1 }); return getWorkspace(state, 'u-jiho', now); }
function textOf(node: ReactNode): string { if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(textOf).join(''); return isValidElement<{ children?: ReactNode }>(node) ? textOf(node.props.children) : ''; }
type NodeProps = Record<string, unknown> & { children?: ReactNode; onClick?: () => unknown; onChange?: (event: { target: { value: string } }) => void; disabled?: boolean; name?: string };
function find(node: ReactNode, predicate: (props: NodeProps) => boolean): NodeProps | undefined { if (Array.isArray(node)) { for (const child of node) { const found = find(child, predicate); if (found) return found; } return; } if (!isValidElement<NodeProps>(node)) return; if (predicate(node.props)) return node.props; return find(node.props.children, predicate); }

function host(command: CommandFn) {
  const slots: unknown[] = []; let tree: ReactNode;
  let workspace = fixture();
  return {
    setWorkspace(value: ReturnType<typeof fixture>) { workspace = value; },
    render() {
      const react = componentRequire('react') as typeof import('react');
      const original = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect }; let index = 0;
      react.useState = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], (update: unknown) => { slots[at] = typeof update === 'function' ? update(slots[at]) : update; }]; }) as typeof react.useState;
      react.useRef = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; }) as typeof react.useRef;
      react.useEffect = (() => { index++; }) as typeof react.useEffect;
      try { tree = registration.AiWorkRegistration({ workspace, command, onClose() { throw new Error('A write must not close the dialog'); } }); }
      finally { Object.assign(react, original); }
      return renderToStaticMarkup(tree);
    },
    button(label: string) { const result = find(tree, props => !!props.onClick && textOf(props.children) === label); assert.ok(result, label); return result; },
    click(label: string) { return this.button(label).onClick?.(); },
    cancelAnalysis() { const status = find(tree, props => typeof props.startedAt === 'number' && typeof props.onCancel === 'function'); assert.ok(status); (status.onCancel as () => void)(); },
    confirmation() { const result = find(tree, props => props.title === '새 분석 결과로 바꿀까요?' && typeof props.onConfirm === 'function'); assert.ok(result); return result as NodeProps & { onConfirm: () => void; onCancel: () => void }; },
    change(name: string, value: string) { const field = find(tree, props => props.name === name); assert.ok(field, name); const control = find(field.children, props => !!props.onChange); assert.ok(control, name); control.onChange?.({ target: { value } }); },
    value(name: string) { const field = find(tree, props => props.name === name); assert.ok(field, name); const control = find(field.children, props => !!props.onChange); assert.ok(control, name); return control.value; },
  };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
function fill(view: ReturnType<typeof host>) { view.render(); view.click('단위업무 직접 추가'); view.render(); for (const [name, value] of Object.entries({ 'units.0.title': '정기 보고', 'units.0.description': '정기 보고 운영', 'units.0.tasks.0.title': '보고서 작성', 'units.0.tasks.0.description': '자료를 취합해 작성', 'units.0.tasks.0.dueDate': '2026-12-20' })) { view.change(name, value); view.render(); } }

test('personal entry is orange, precedes the two add actions and respects the division lock', () => {
  for (const locked of [false, true]) {
    const html = renderToStaticMarkup(createElement(personal.PersonalWork, { workspace: fixture(locked), command: async () => true }));
    const buttons = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map(item => item[0]);
    const ai = buttons.find(item => item.includes('AI 업무등록'))!;
    assert.ok(ai); assert.match(ai, /btn-accent/); assert.equal(/disabled=""/.test(ai), locked);
    assert.ok(html.indexOf('AI 업무등록') < html.indexOf('단위업무 추가'));
    assert.ok(html.indexOf('AI 업무등록') < html.indexOf('세부업무 추가'));
  }
});

test('manual preview defaults to the registration year end and yearly recurrence but still rejects a cleared date', () => {
  const view = host(async () => { throw new Error('A cleared date must not be submitted'); });
  let html = view.render(); assert.match(html, /BizRouter로 보내 분석/); assert.match(html, /분석용으로 보관/);
  view.click('단위업무 직접 추가'); html = view.render();
  assert.equal(view.value('units.0.tasks.0.dueDate'), '2026-12-31');
  assert.equal(view.value('units.0.tasks.0.frequency'), 'yearly');
  for (const [name, value] of Object.entries({ 'units.0.title': '정기 보고', 'units.0.description': '정기 보고 운영', 'units.0.tasks.0.title': '보고서 작성', 'units.0.tasks.0.description': '자료를 취합해 작성', 'units.0.tasks.0.dueDate': '' })) { view.change(name, value); view.render(); }
  view.click('검토한 업무 등록'); assert.match(view.render(), /필수 항목과 마감일/);
});

test('new task defaults use the Seoul registration year and do not overwrite existing dates on refresh', () => {
  const view = host(async () => true);
  view.setWorkspace({ ...fixture(), serverTime: '2026-12-31T15:30:00Z' });
  view.render(); view.click('단위업무 직접 추가'); view.render();
  assert.equal(view.value('units.0.tasks.0.dueDate'), '2027-12-31');
  assert.equal(view.value('units.0.tasks.0.frequency'), 'yearly');
  view.change('units.0.tasks.0.dueDate', '2027-06-15'); view.render();
  view.change('units.0.tasks.0.frequency', 'quarterly'); view.render();
  view.setWorkspace({ ...fixture(), serverTime: '2028-01-01T00:30:00Z' }); view.render();
  assert.equal(view.value('units.0.tasks.0.dueDate'), '2027-06-15');
  assert.equal(view.value('units.0.tasks.0.frequency'), 'quarterly');
  view.click('세부업무 추가'); view.render();
  assert.equal(view.value('units.0.tasks.1.dueDate'), '2028-12-31');
  assert.equal(view.value('units.0.tasks.1.frequency'), 'yearly');
});

test('five manually reviewed units remain intact and a sixth append is blocked', () => {
  const view = host(async () => true); view.render();
  for (let index = 0; index < 5; index++) {
    assert.equal(view.button('단위업무 직접 추가').disabled, false);
    view.click('단위업무 직접 추가'); view.render();
    view.change(`units.${index}.title`, `검토한 단위 ${index + 1}`); view.render();
  }
  assert.equal(view.button('단위업무 직접 추가').disabled, true);
  view.click('단위업무 직접 추가'); const html = view.render();
  assert.doesNotMatch(html, /data-field-path="units\.5\.title"/);
  for (let index = 0; index < 5; index++) {
    assert.equal(view.value(`units.${index}.title`), `검토한 단위 ${index + 1}`);
    assert.equal(view.value(`units.${index}.tasks.0.frequency`), 'yearly');
  }
});

test('registration submits edited dates and recurrence while untouched tasks retain their yearly default', async () => {
  const calls: WorkImportInput[] = [];
  const view = host(async (_type, payload) => { calls.push(structuredClone(payload) as unknown as WorkImportInput); return true; });
  fill(view); view.click('세부업무 추가'); view.render();
  for (const [name, value] of Object.entries({ 'units.0.tasks.1.title': '분기별 자료 점검', 'units.0.tasks.1.description': '분기별 자료를 점검합니다.', 'units.0.tasks.1.dueDate': '2027-04-30', 'units.0.tasks.1.frequency': 'quarterly' })) { view.change(name, value); view.render(); }
  view.click('검토한 업무 등록'); await tick(); view.render();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].units[0].tasks.map(({ dueDate, frequency }) => ({ dueDate, frequency })), [
    { dueDate: '2026-12-20', frequency: 'yearly' },
    { dueDate: '2027-04-30', frequency: 'quarterly' },
  ]);
  assert.equal(view.value('units.0.tasks.1.dueDate'), '2027-04-30');
  assert.equal(view.value('units.0.tasks.1.frequency'), 'quarterly');
});

test('an uncertain write retries its original request after edits and a division lock, then keeps unsaved additions', async () => {
  const calls: WorkImportInput[] = []; let finish: ((value: boolean) => void) | undefined; let options: CommandOptions | undefined;
  const view = host(async (_type, payload, opts) => { calls.push(structuredClone(payload) as unknown as WorkImportInput); options = opts; return new Promise<boolean>(resolve => { finish = resolve; }); });
  fill(view); clearCount = 0;
  view.click('검토한 업무 등록'); view.render();
  assert.equal(options?.silent, true);
  view.change('units.0.tasks.0.description', '등록 중 추가 작성'); view.render();
  options?.onFailure?.({ outcome: 'unknown', status: 502, message: '응답 미확인' }); finish?.(false); await tick();
  assert.match(view.render(), /같은 요청으로 등록 결과 확인/); assert.match(draftLabel, /등록 결과 미확인/);
  view.setWorkspace(fixture(true)); view.render(); assert.equal(view.button('같은 요청으로 등록 결과 확인').disabled, false);
  view.click('같은 요청으로 등록 결과 확인'); view.render(); assert.equal(calls.length, 2); assert.deepEqual(calls[1], calls[0]);
  finish?.(true); await tick(); const html = view.render();
  assert.match(html, /등록 완료/); assert.match(html, /등록 중 추가 작성/); assert.match(html, /저장 중 추가한 내용/);
  assert.equal(dirty, true); assert.equal(clearCount, 0); assert.doesNotMatch(html, />검토한 업무 등록<|>같은 요청으로 등록 결과 확인</);
});

test('a successful unchanged write clears draft protection without resetting the preview or sending twice', async () => {
  let calls = 0; const view = host(async () => { calls++; return true; }); fill(view); clearCount = 0;
  view.click('검토한 업무 등록'); await tick(); const html = view.render();
  assert.equal(calls, 1); assert.equal(clearCount, 1); assert.equal(dirty, false);
  assert.match(html, /등록 완료/); assert.match(html, /자료를 취합해 작성/);
});

test('late analysis preserves changed input and provides inspectable results before replacing the preview', async () => {
  const originalFetch = globalThis.fetch; let resolve: ((response: Response) => void) | undefined;
  globalThis.fetch = async () => new Promise<Response>(done => { resolve = done; });
  try {
    const view = host(async () => true); view.render(); view.change('description', '분석 시작 설명'); view.render();
    view.click('AI로 업무 초안 만들기'); view.render(); view.change('description', '분석 중 바꾼 설명'); view.render();
    resolve?.(Response.json({ preview: { units: [{ title: '검토할 새 단위', description: '새 범위', tasks: [{ title: '검토할 새 과제', description: '새 내용' }] }] } }));
    await tick(); const html = view.render();
    assert.match(html, /분석 중 바꾼 설명/); assert.match(html, /새 분석 결과 먼저 확인/); assert.match(html, /검토할 새 과제/);
    assert.doesNotMatch(html, /name="units\.0\.title"/);
    view.change('description', ''); view.render();
    assert.equal(dirty, true, 'pending analysis remains protected even when all source fields match the initial empty draft');
    view.click('단위업무 직접 추가'); view.render(); view.change('units.0.title', '기존에 검토한 단위'); view.render();
    view.change('description', '계속 보관할 업무 설명'); view.render();
    view.click('새 분석 결과 적용'); view.render();
    const confirmation = view.confirmation();
    assert.equal(confirmation.confirmLabel, '새 결과로 바꾸기'); assert.equal(confirmation.cancelLabel, '기존 내용 유지'); assert.equal(confirmation.destructive, false);
    assert.match(String(confirmation.description), /자료 본문은 유지/);
    confirmation.onCancel(); const cancelled = view.render();
    assert.match(cancelled, /value="기존에 검토한 단위"/); assert.match(cancelled, /계속 보관할 업무 설명/); assert.match(cancelled, /새 분석 결과 먼저 확인/);
    view.click('새 분석 결과 적용'); view.render(); view.confirmation().onConfirm(); const applied = view.render();
    assert.match(applied, /value="검토할 새 단위"/);
    assert.equal(view.value('units.0.tasks.0.dueDate'), '2026-12-31');
    assert.equal(view.value('units.0.tasks.0.frequency'), 'yearly');
    assert.match(applied, /계속 보관할 업무 설명/); assert.doesNotMatch(applied, /value="기존에 검토한 단위"/);
  } finally { globalThis.fetch = originalFetch; }
});

test('analysis cancellation preserves input, rejects double clicks and ignores an old response during retry', async () => {
  const originalFetch = globalThis.fetch;
  const calls: { finish: (response: Response) => void; signal?: AbortSignal | null }[] = [];
  globalThis.fetch = async (_url, init) => new Promise<Response>(finish => { calls.push({ finish, signal: init?.signal }); });
  try {
    const view = host(async () => true); view.render(); view.change('description', '보존할 업무 설명'); view.render();
    view.click('AI로 업무 초안 만들기'); view.click('AI로 업무 초안 만들기');
    assert.equal(calls.length, 1);
    assert.match(view.render(), /최대 약 3분/);
    view.cancelAnalysis(); assert.equal(calls[0].signal?.aborted, true);
    assert.match(view.render(), /보존할 업무 설명/);
    view.click('AI로 업무 초안 만들기'); view.render();
    assert.equal(calls.length, 2);
    const result = (title: string) => Response.json({ preview: { units: [{ title, description: '업무 범위', tasks: [{ title: '수행 과제', description: '수행 내용' }] }] } });
    calls[0].finish(result('취소한 이전 결과')); await tick();
    let html = view.render(); assert.match(html, /업무 분석 중/); assert.doesNotMatch(html, /취소한 이전 결과/);
    calls[1].finish(result('현재 요청 결과')); await tick();
    html = view.render(); assert.match(html, /현재 요청 결과/); assert.match(html, /보존할 업무 설명/); assert.doesNotMatch(html, /취소한 이전 결과/);
  } finally { globalThis.fetch = originalFetch; }
});

test('an oversized AI grouping is rejected without replacing or truncating the reviewed draft', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ preview: { units: Array.from({ length: 6 }, (_, index) => ({ title: `초과 단위 ${index + 1}`, description: '초과 결과', tasks: [{ title: `초과 과제 ${index + 1}`, description: '초과 내용' }] })) } });
  try {
    const view = host(async () => { throw new Error('Analysis must not register work'); });
    fill(view); view.change('description', '기존 업무를 유사한 범위로 묶습니다.'); view.render();
    view.click('AI로 업무 초안 만들기'); await tick(); const html = view.render();
    assert.match(html, /단위업무는 최대 5개/);
    assert.equal(view.value('units.0.title'), '정기 보고');
    assert.equal(view.value('units.0.tasks.0.dueDate'), '2026-12-20');
    assert.equal(view.value('units.0.tasks.0.frequency'), 'yearly');
    assert.doesNotMatch(html, /초과 단위|초과 과제|data-field-path="units\.1\.title"/);
  } finally { globalThis.fetch = originalFetch; }
});
