import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { renderComponent } from './helpers/render-component';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import type { Workspace } from '../src/lib/types';
import type { TaskTab } from '../src/lib/hash-route';
import type { CommandFn } from '../src/components/ui';

const requireComponent = createRequire(path.resolve('tests/personal-procedure-entry.test.ts'));
const previousCss = requireComponent.extensions['.css']; requireComponent.extensions['.css'] = () => undefined;
const ui = requireComponent('../src/components/ui');
const uiModule = requireComponent.cache[requireComponent.resolve('../src/components/ui')]!;
const guards = requireComponent('../src/components/unsaved-changes');
const guardModule = requireComponent.cache[requireComponent.resolve('../src/components/unsaved-changes')]!;
const revision = requireComponent('../src/components/command-revision');
const revisionModule = requireComponent.cache[requireComponent.resolve('../src/components/command-revision')]!;
let allowNavigation = true; let navigationCalls = 0; let conflicted = false;
const draftStates = new Map<string, boolean>();
let personal: typeof import('../src/components/personal-work');
try {
  uiModule.exports = { ...ui, Modal: ({ title, children }: { title: string; children: ReactNode }) => createElement('section', { role: 'dialog', 'aria-label': title }, children) };
  guardModule.exports = { ...guards, useUnsavedChanges: (dirty: boolean, label: string) => { draftStates.set(label, dirty); return label; }, useUnsavedNavigation: () => ({ requestNavigation: (action: () => void) => { navigationCalls++; if (allowNavigation) action(); }, requestWorkspaceNavigation: (action: () => void) => { if (allowNavigation) action(); } }) };
  revisionModule.exports = { ...revision, useRevisionCommand: (_workspace: Workspace, command: CommandFn) => ({ command, conflicted, conflict: null }) };
  personal = requireComponent('../src/components/personal-work');
} finally {
  uiModule.exports = ui; guardModule.exports = guards; revisionModule.exports = revision;
  if (previousCss) requireComponent.extensions['.css'] = previousCss; else delete requireComponent.extensions['.css'];
}

const now = new Date('2026-11-08T03:00:00Z');
const aiLabel = 'AI로 절차·절차도 작성';
function fixture() { const state = createSeed(now); state.departmentWorkPlans = []; return getWorkspace(state, 'u-jiho', now); }
type Props = Record<string, unknown> & { children?: ReactNode; onClick?: () => unknown; onChange?: (event: { target: { value: string } }) => void };
function text(node: ReactNode): string { return typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : isValidElement<Props>(node) ? text(node.props.children) : ''; }
function find(node: ReactNode, predicate: (node: ReactElement<Props>) => boolean): ReactElement<Props> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const match = find(child, predicate); if (match) return match; } return; }
  if (!isValidElement<Props>(node)) return;
  return predicate(node) ? node : find(node.props.children, predicate);
}
async function html(node: ReactNode) {
  const previous = requireComponent.extensions['.css']; requireComponent.extensions['.css'] = () => undefined;
  try { return await renderComponent(node); }
  finally { if (previous) requireComponent.extensions['.css'] = previous; else delete requireComponent.extensions['.css']; }
}
function host(render: () => ReactNode) {
  const slots: unknown[] = []; let tree: ReactNode;
  return {
    render() {
      const react = requireComponent('react') as typeof import('react');
      const original = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useId: react.useId }; let index = 0;
      react.useState = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], (update: unknown) => { slots[at] = typeof update === 'function' ? update(slots[at]) : update; }]; }) as typeof react.useState;
      react.useRef = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; }) as typeof react.useRef;
      react.useEffect = (() => { index++; }) as typeof react.useEffect;
      react.useId = () => `procedure-entry-${index++}`;
      try { tree = render(); } finally { Object.assign(react, original); }
      return tree;
    },
    find(predicate: (node: ReactElement<Props>) => boolean) { return find(tree, predicate); },
    get(predicate: (node: ReactElement<Props>) => boolean) { const result = this.find(predicate); assert.ok(result); return result; },
    html() { return html(tree); },
  };
}
function editor(options: { workspace?: Workspace; mode?: 'view' | 'edit'; tab?: TaskTab } = {}) {
  allowNavigation = true; navigationCalls = 0; conflicted = false; draftStates.clear();
  let workspace = options.workspace || fixture(); let routedTab = options.tab || 'workflow'; let commands = 0;
  const command: CommandFn = async () => { commands++; throw new Error('Opening AI must not write or generate'); };
  const panel = host(() => personal.TaskPanel({ workspace, taskId: 'task-meeting', command, onClose() {}, initialMode: options.mode || 'view', routedTab, onTabChange: value => { routedTab = value; } }));
  const content = host(() => {
    panel.render();
    const node = panel.get(item => typeof item.type === 'function' && item.type.name === 'TaskEditor');
    return (node.type as (props: Props) => ReactNode)(node.props);
  });
  content.render();
  return {
    ...content,
    get commands() { return commands; },
    setWorkspace(next: Workspace) { workspace = next; },
    button() { return content.get(node => !!node.props.onClick && text(node.props.children) === aiLabel).props; },
    builder() { return content.find(node => node.props.taskId === 'task-meeting' && !!node.props.overview && typeof node.props.onApply === 'function'); },
    changeTab(value: TaskTab) { const tabs = content.get(node => node.type === ui.Tabs).props.tabs as { onChange(value: TaskTab): void }; tabs.onChange(value); content.render(); },
    changeDescription(value: string) {
      const field = content.get(node => node.type === ui.Field && node.props.name === 'description');
      const control = find(field.props.children, node => node.type === 'textarea'); assert.ok(control); control.props.onChange?.({ target: { value } }); content.render();
    },
  };
}

test('detail tabs put supporting references before procedure and keep monthly reports last', async () => {
  const workspace = fixture();
  const render = () => html(createElement(personal.TaskPanel, { workspace, taskId: 'task-meeting', command: async () => true, initialMode: 'view', routedTab: 'overview', onClose() {} }));
  const tabValues = (value: string) => [...value.matchAll(/<button\b[^>]*role="tab"[^>]*aria-controls="[^"]+-panel-([^"]+)"[^>]*>/g)].map(match => match[1]);
  const ordered = ['overview', 'references', 'workflow', 'schedule', 'performance', 'budget'];
  assert.deepEqual(tabValues(await render()), ordered);
  const task = workspace.tasks.find(item => item.id === 'task-meeting')!;
  const common = workspace.commonTasks[0];
  common.kind = 'directive'; common.distributions[0].taskId = task.id; task.commonId = common.id;
  assert.deepEqual(tabValues(await render()), [...ordered, 'monthly']);
});

test('AI procedure entry is separate from new-work registration and appears above the current procedure', async () => {
  const workspace = fixture();
  const page = renderToStaticMarkup(createElement(personal.PersonalWork, { workspace, command: async () => true }));
  assert.match(page, /AI 업무등록/); assert.doesNotMatch(page, /AI로 절차·절차도 작성/);
  const view = editor({ workspace }); const rendered = await view.html();
  assert.match(rendered, /AI로 절차·절차도 작성/); assert.doesNotMatch(rendered, /AI 업무등록/);
  assert.ok(rendered.indexOf(aiLabel) < rendered.indexOf('aria-label="현재 적용된 업무 절차"'));
  assert.match(rendered, /업무 개요/); assert.match(rendered, /관련 근거/);
  assert.equal(view.button().disabled, false); assert.equal(view.commands, 0);
});

test('view mode enters the existing task procedure builder without creating work or changing its input', async () => {
  const workspace = fixture(); const task = workspace.tasks.find(item => item.id === 'task-meeting')!;
  const view = editor({ workspace }); assert.equal(view.builder(), undefined);
  view.button().onClick?.(); view.render();
  const builder = view.builder(); assert.ok(builder);
  assert.deepEqual(builder.props.overview, { title: task.title, description: task.description, completionCriteria: task.completionCriteria, descriptionAttachmentIds: task.descriptionAttachmentIds || [], reviewRequired: true });
  assert.deepEqual(builder.props.workflow, task.workflow);
  assert.equal(builder.props.disabled, false); assert.equal(view.commands, 0);
  const rendered = await view.html();
  assert.match(rendered, /업무 기준 수정 중/); assert.match(rendered, /우선 분석할 업무 개요와 붙임 파일/);
  assert.match(rendered, /관련 근거는 필요한 조건과 의무를 보완/);
});

test('dirty task input blocks the AI transition and retains both the draft and current procedure', async () => {
  const view = editor({ mode: 'edit', tab: 'overview' });
  view.changeDescription('AI를 열기 전에 작성 중인 업무 설명'); assert.equal(draftStates.get('업무·절차 수정'), true);
  view.changeTab('workflow'); assert.equal(view.button().disabled, true);
  const rendered = await view.html(); assert.match(rendered, /먼저 저장/);
  const reasonId = view.button()['aria-describedby']; assert.equal(typeof reasonId, 'string');
  assert.ok(rendered.includes(`id="${reasonId}"`), 'the disabled button must name its visible reason');
  view.button().onClick?.(); view.render(); assert.equal(view.builder(), undefined); assert.equal(view.commands, 0);
  view.changeTab('overview'); const field = view.get(node => node.type === ui.Field && node.props.name === 'description');
  assert.equal(find(field.props.children, node => node.type === 'textarea')!.props.value, 'AI를 열기 전에 작성 중인 업무 설명');
});

test('the AI entry respects cancelled navigation and cannot bypass definition or revision locks', async () => {
  const cancelled = editor(); allowNavigation = false;
  cancelled.button().onClick?.(); cancelled.render();
  assert.ok(navigationCalls > 0); assert.equal(cancelled.builder(), undefined); assert.equal(cancelled.commands, 0);
  for (const reason of ['confirmed', 'other-owner', 'head', 'archived', 'conflict', 'unavailable'] as const) {
    const workspace = fixture(); const task = workspace.tasks.find(item => item.id === 'task-meeting')!;
    if (reason === 'confirmed') workspace.departmentWorkPlans = [{ departmentId: task.departmentId, status: 'confirmed', version: 1 }];
    if (reason === 'other-owner') task.primaryId = 'u-seoyeon';
    if (reason === 'head') workspace.currentUser.role = 'head';
    if (reason === 'archived') task.status = 'archived';
    const view = editor({ workspace });
    if (reason === 'conflict') { conflicted = true; view.render(); }
    if (reason === 'unavailable') { view.setWorkspace({ ...workspace, tasks: workspace.tasks.filter(item => item.id !== task.id) }); view.render(); }
    assert.equal(view.button().disabled, true, reason);
    assert.equal(typeof view.button()['aria-describedby'], 'string', `${reason}: disabled entry must explain its restriction`);
    view.button().onClick?.(); view.render();
    assert.equal(view.builder(), undefined, reason); assert.equal(view.commands, 0, reason);
  }
});

test('attachment processing temporarily blocks AI entry while leaving tab navigation available', () => {
  const view = editor();
  const procedure = view.get(node => node.props.taskId === 'task-meeting' && typeof node.props.onBusyChange === 'function');
  (procedure.props.onBusyChange as (busy: boolean) => void)(true); view.render();
  assert.equal(view.button().disabled, true);
  view.button().onClick?.(); view.render(); assert.equal(view.builder(), undefined);
  const tabs = view.get(node => node.type === ui.Tabs).props.tabs as { items: { disabled?: boolean }[] };
  assert.ok(tabs.items.every(item => !item.disabled));
  (procedure.props.onBusyChange as (busy: boolean) => void)(false); view.render();
  assert.equal(view.button().disabled, false); assert.equal(view.commands, 0);
});
