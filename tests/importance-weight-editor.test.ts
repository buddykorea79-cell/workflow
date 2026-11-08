import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isValidElement, type ReactNode } from 'react';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import type { CommandFn, CommandOptions } from '../src/components/ui';
import type { UnitScorePlan, Workspace } from '../src/lib/types';

const requireComponent = createRequire(path.resolve('tests/importance-weight-editor.test.ts'));
const css = requireComponent.extensions['.css']; requireComponent.extensions['.css'] = () => undefined;
const guardModule = requireComponent.cache[requireComponent.resolve('../src/components/unsaved-changes')] ?? (requireComponent('../src/components/unsaved-changes'), requireComponent.cache[requireComponent.resolve('../src/components/unsaved-changes')]!);
const guardExports = guardModule.exports;
const revisionModule = requireComponent.cache[requireComponent.resolve('../src/components/command-revision')] ?? (requireComponent('../src/components/command-revision'), requireComponent.cache[requireComponent.resolve('../src/components/command-revision')]!);
const revisionExports = revisionModule.exports;
let dirty = false;
let evaluation: typeof import('../src/components/unit-evaluation');
try {
  guardModule.exports = { ...guardExports, useUnsavedChanges: (value: boolean) => { dirty = value; return 'weights'; }, useUnsavedNavigation: () => ({ requestNavigation: (action: () => void) => action() }) };
  revisionModule.exports = { ...revisionExports, useRevisionCommand: (_w: Workspace, command: CommandFn) => ({ command, conflicted: false, conflict: null }) };
  evaluation = requireComponent('../src/components/unit-evaluation');
} finally {
  guardModule.exports = guardExports; revisionModule.exports = revisionExports;
  if (css) requireComponent.extensions['.css'] = css; else delete requireComponent.extensions['.css'];
}
const now = new Date('2026-11-08T03:00:00Z');
const period = '2026-H2';
function fixture(scores?: number[]): Workspace {
  const state = createSeed(now); state.performances = []; state.unitEvaluations = [];
  state.units = [{ id: 'a', title: '가 업무', description: '가', ownerId: 'u-jiho', departmentId: 'dept-plan', color: 'stone', icon: 'folder', importance: 10 }, { id: 'b', title: '나 업무', description: '나', ownerId: 'u-jiho', departmentId: 'dept-plan', color: 'stone', icon: 'folder', importance: 5 }];
  state.unitScorePlans = scores ? [{ id: 'plan', personId: 'u-jiho', departmentId: 'dept-plan', period, version: 1, updatedAt: now.toISOString(), allocations: state.units.map((unit, index) => ({ unitId: unit.id, unitTitle: unit.title, maxScore: scores[index] })) }] : [];
  return getWorkspace(state, 'u-jiho', now);
}
type Props = Record<string, unknown> & { children?: ReactNode; value?: string; onChange?: (event: { target: { value: string } }) => void; onClick?: () => void; onSubmit?: (event: { preventDefault: () => void }) => Promise<void>; onConfirm?: () => void; onCancel?: () => void };
function text(node: ReactNode): string { if (typeof node === 'string' || typeof node === 'number') return String(node); if (Array.isArray(node)) return node.map(text).join(''); return isValidElement<Props>(node) ? text(node.props.children) : ''; }
function find(node: ReactNode, predicate: (props: Props) => boolean): Props | undefined { if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } return; } if (!isValidElement<Props>(node)) return; return predicate(node.props) ? node.props : find(node.props.children, predicate); }
function host(initial: Workspace, command: CommandFn = async () => true) {
  const slots: unknown[] = []; let tree: ReactNode; let workspace = initial; let closed = 0;
  return {
    get closed() { return closed; }, get workspace() { return workspace; },
    setWorkspace(next: Workspace) { workspace = next; },
    render() {
      const react = requireComponent('react') as typeof import('react'); const original = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useId: react.useId }; let index = 0;
      react.useState = ((initialValue: unknown) => { const at = index++; if (!(at in slots)) slots[at] = typeof initialValue === 'function' ? initialValue() : initialValue; return [slots[at], (update: unknown) => { slots[at] = typeof update === 'function' ? update(slots[at]) : update; }]; }) as typeof react.useState;
      react.useRef = ((value: unknown) => { const at = index++; if (!(at in slots)) slots[at] = { current: value }; return slots[at]; }) as typeof react.useRef;
      react.useEffect = (() => { index++; }) as typeof react.useEffect; react.useId = (() => `weight-${index++}`) as typeof react.useId;
      try { tree = evaluation.WeightEditor({ workspace, command, period, plan: workspace.unitScorePlans?.[0], onClose() { closed++; } }); }
      finally { Object.assign(react, original); }
      return text(tree);
    },
    input(title: string) { const item = find(tree, props => props['aria-label'] === `${title} 업무 비중`); assert.ok(item); return item; },
    change(title: string, value: string) { this.input(title).onChange?.({ target: { value } }); },
    reallocation() { const button = find(tree, props => !!props.onClick && text(props.children) === '중요도 기준으로 다시 배분'); assert.ok(button); return button; },
    clickReallocate() { this.reallocation().onClick?.(); },
    saveButton() { const button = find(tree, props => props.type === 'submit'); assert.ok(button); return button; },
    confirmation() { const item = find(tree, props => props.title === '중요도 기준으로 다시 배분할까요?'); assert.ok(item); return item; },
    submit() { const form = find(tree, props => !!props.onSubmit); assert.ok(form); return form.onSubmit!({ preventDefault() {} }); },
  };
}

test('new editor proposes 50 integer points and never replaces typed values on importance refresh', () => {
  const view = host(fixture()); const rendered = view.render();
  assert.equal(view.input('가 업무').value, '33'); assert.equal(view.input('나 업무').value, '17'); assert.equal(view.input('가 업무').step, '1'); assert.equal(view.input('가 업무').min, '1');
  assert.match(rendered, /중요도 10 · 자동 배분 33점/);
  view.change('가 업무', '30'); view.change('나 업무', '20'); view.render(); assert.equal(dirty, true);
  const next = structuredClone(view.workspace); next.units[0].importance = 1; view.setWorkspace(next); view.render();
  assert.equal(view.input('가 업무').value, '30'); assert.equal(view.input('나 업무').value, '20');
  view.clickReallocate(); view.render(); view.confirmation().onCancel?.(); view.render(); assert.equal(view.input('가 업무').value, '30');
  view.clickReallocate(); view.render(); view.confirmation().onConfirm?.(); view.render();
  assert.equal(view.input('가 업무').value, '8'); assert.equal(view.input('나 업무').value, '42');
});

test('existing manual and legacy decimal plans open unchanged until explicit reallocation', () => {
  for (const scores of [[20, 30], [12.5, 37.5], [0, 50]]) {
    const view = host(fixture(scores)); view.render();
    assert.equal(view.input('가 업무').value, String(scores[0])); assert.equal(view.input('나 업무').value, String(scores[1])); assert.equal(dirty, false);
  }
});

test('more than fifty units have no misleading zero-point suggestion and cannot redistribute or save', () => {
  const workspace = fixture(); workspace.units = Array.from({ length: 51 }, (_, index) => ({ ...workspace.units[0], id: `unit-${index}`, title: `업무 ${index}`, importance: index % 10 + 1 }));
  const view = host(workspace); const rendered = view.render();
  assert.match(rendered, /이 반기의 평가 대상 단위업무가 51개로 50개를 초과하여 비중을 새로 배분·저장할 수 없습니다/);
  assert.doesNotMatch(rendered, /자동 배분 0점/); assert.equal(view.input('업무 0').value, '');
  assert.equal(view.reallocation().disabled, true); assert.equal(view.saveButton().disabled, true);
  workspace.unitScorePlans = [{ id: 'legacy-51', personId: 'u-jiho', departmentId: 'dept-plan', period, version: 1, updatedAt: now.toISOString(), allocations: workspace.units.map((unit, index) => ({ unitId: unit.id, unitTitle: unit.title, maxScore: index < 50 ? 1 : 0 })) }];
  workspace.units[50].deletedAt = now.toISOString();
  const legacy = host(workspace); const legacyText = legacy.render();
  assert.match(legacyText, /평가 대상 단위업무가 51개/); assert.match(legacyText, /기존 계획·성과는 그대로 보관되며 기존 규칙에 따라 제출·평가할 수 있습니다/);
  assert.doesNotMatch(legacyText, /구성을.*(?:조정|정리)/); assert.equal(legacy.input('업무 50').value, '0');
  assert.equal(legacy.reallocation().disabled, true); assert.equal(legacy.saveButton().disabled, true);
});

test('a changed importance or newly submitted plan cannot apply a stale redistribution confirmation', () => {
  for (const change of ['importance', 'submitted']) {
    const view = host(fixture([20, 30])); view.render(); view.clickReallocate(); view.render();
    const next = structuredClone(view.workspace);
    if (change === 'importance') next.units[0].importance = 1; else next.unitScorePlans![0].submittedAt = now.toISOString();
    view.setWorkspace(next); view.render(); view.confirmation().onConfirm?.(); const rendered = view.render();
    assert.equal(view.input('가 업무').value, '20'); assert.match(rendered, /현재 정보를 확인한 뒤 다시 배분/);
  }
});

test('successful delayed saving preserves later manual edits and does not close the editor', async () => {
  let resolve: (value: boolean) => void = () => undefined; let options: CommandOptions | undefined; let sent: Record<string, unknown> | undefined;
  const view = host(fixture(), async (_type, payload, supplied) => { sent = payload; options = supplied; return new Promise<boolean>(done => { resolve = done; }); });
  view.render(); const pending = view.submit(); view.render();
  assert.equal(dirty, true, 'a newly suggested plan is protected while its first save is pending');
  assert.equal(view.input('가 업무').readOnly, false); view.change('가 업무', '25'); view.change('나 업무', '25'); view.render();
  const saved = structuredClone(view.workspace); saved.unitScorePlans = [{ id: 'saved', personId: 'u-jiho', departmentId: 'dept-plan', period, version: 1, updatedAt: now.toISOString(), allocations: (sent!.allocations as UnitScorePlan['allocations']).map(item => ({ ...item, unitTitle: item.unitId })) }];
  options?.onSaved?.(saved); resolve(true); await pending; view.setWorkspace(saved); view.render();
  assert.equal(view.input('가 업무').value, '25'); assert.equal(view.input('나 업무').value, '25'); assert.equal(view.closed, 0); assert.equal(dirty, true);
  assert.deepEqual(sent!.allocations, [{ unitId: 'a', maxScore: 33 }, { unitId: 'b', maxScore: 17 }]);
});
