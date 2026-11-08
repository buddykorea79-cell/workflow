import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import type { Unit, Workspace } from '../src/lib/types';
import type { CommandFn, CommandOptions } from '../src/components/ui';

const componentRequire = createRequire(path.resolve('tests/unit-importance-ui.test.ts'));
const previousCss = componentRequire.extensions['.css']; componentRequire.extensions['.css'] = () => undefined;
const ui = componentRequire('../src/components/ui');
const uiModule = componentRequire.cache[componentRequire.resolve('../src/components/ui')]!;
const guards = componentRequire('../src/components/unsaved-changes');
const guardModule = componentRequire.cache[componentRequire.resolve('../src/components/unsaved-changes')]!;
const dirty = new Map<string, boolean>();
let errors: { path: string; message: string }[] = [];
let personal: typeof import('../src/components/personal-work');
let common: typeof import('../src/components/common-registration-modal');
let fields: typeof import('../src/components/unit-form-fields');
try {
  uiModule.exports = { ...ui, Modal: ({ title, children }: { title: string; children: ReactNode }) => createElement('section', { role: 'dialog', 'aria-label': title }, children), showCommandError: (_message: string, issues: typeof errors) => { errors = issues; return true; } };
  guardModule.exports = { ...guards, useUnsavedChanges: (value: boolean, label: string) => { dirty.set(label, value); return label; }, useUnsavedNavigation: () => ({ requestNavigation: (action: () => void) => action(), clearDraft() {}, clearDrafts() {} }) };
  personal = componentRequire('../src/components/personal-work');
  common = componentRequire('../src/components/common-registration-modal');
  fields = componentRequire('../src/components/unit-form-fields');
} finally {
  uiModule.exports = ui; guardModule.exports = guards;
  if (previousCss) componentRequire.extensions['.css'] = previousCss; else delete componentRequire.extensions['.css'];
}

const now = new Date('2026-11-08T03:00:00Z');
function fixture() { const state = createSeed(now); state.departmentWorkPlans = []; return getWorkspace(state, 'u-jiho', now); }
type Props = Record<string, unknown> & { children?: ReactNode; onClick?: () => void; onSubmit?: (event: { preventDefault(): void }) => Promise<void>; onChange?: (event: { target: { value: string } }) => void };
function find(node: ReactNode, predicate: (node: ReactElement<Props>) => boolean): ReactElement<Props> | undefined {
  if (Array.isArray(node)) { for (const child of node) { const result = find(child, predicate); if (result) return result; } return; }
  if (!isValidElement<Props>(node)) return;
  return predicate(node) ? node : find(node.props.children, predicate);
}
function textOf(node: ReactNode): string { return typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(textOf).join('') : isValidElement<Props>(node) ? textOf(node.props.children) : ''; }

/** Exercise the actual component handlers across renders, without a browser or server writes. */
function host(render: () => ReactNode) {
  const slots: unknown[] = []; let tree: ReactNode;
  return {
    render() {
      const react = componentRequire('react') as typeof import('react');
      const original = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect, useId: react.useId }; let index = 0;
      react.useState = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], (update: unknown) => { slots[at] = typeof update === 'function' ? update(slots[at]) : update; }]; }) as typeof react.useState;
      react.useRef = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; }) as typeof react.useRef;
      react.useEffect = (() => { index++; }) as typeof react.useEffect;
      react.useId = () => `test-${index++}`;
      try { tree = render(); } finally { Object.assign(react, original); }
    },
    html() { return renderToStaticMarkup(tree); },
    get(predicate: (node: ReactElement<Props>) => boolean) { const result = find(tree, predicate); assert.ok(result); return result; },
    click(label: string) { this.get(node => !!node.props.onClick && textOf(node.props.children) === label).props.onClick?.(); },
    fields() { return this.get(node => node.type === fields.UnitFormFields).props as unknown as Parameters<typeof fields.UnitFormFields>[0]; },
    change(key: 'title' | 'description' | 'importance', value: string) { const controls = this.fields(); ({ title: controls.onTitleChange, description: controls.onDescriptionChange, importance: controls.onImportanceChange })[key](value); this.render(); },
    submit(className: string) { return this.get(node => node.type === 'form' && node.props.className === className).props.onSubmit?.({ preventDefault() {} }); },
  };
}
function unitForm(workspace: Workspace, command: CommandFn, unitId?: string) {
  const page = host(() => personal.PersonalWork({ workspace, command })); page.render();
  if (unitId) {
    page.get(node => String(node.props.className || '').startsWith('pw-unit-button') && textOf(node.props.children).includes(workspace.units.find(unit => unit.id === unitId)!.title)).props.onClick?.(); page.render();
    page.click('단위 수정');
  } else page.click('단위업무 추가');
  page.render();
  const node = page.get(item => typeof item.type === 'function' && item.type.name === 'UnitForm');
  let closed = 0;
  const view = host(() => (node.type as (props: Props) => ReactNode)({ ...node.props, onClose: () => { closed++; } })); view.render();
  return { view, closed: () => closed };
}
function savedUnit(workspace: Workspace, id: string, importance: number): Workspace {
  const unit: Unit = { ...workspace.units[0], id, ownerId: workspace.currentUser.id, departmentId: workspace.currentUser.departmentId, title: '새 업무 묶음', description: '업무 범위', importance, rev: 1 };
  return { ...workspace, revision: workspace.revision + 1, units: [...workspace.units.filter(item => item.id !== id), unit], commandChanges: [{ kind: 'unit', id, fromRev: 0, toRev: 1 }], audit: [{ ...workspace.audit[0], id: 'saved', action: 'unit.create', actorId: workspace.currentUser.id, targetId: id }, ...workspace.audit] };
}

test('shared importance input retains blank and invalid strings with accessible errors', () => {
  for (const value of ['', '-2', '3.5', '11', 'abc']) {
    let changed = '';
    const props = { title: '업무', description: '범위', importance: value, onTitleChange() {}, onDescriptionChange() {}, onImportanceChange(next: string) { changed = next; } };
    const html = renderToStaticMarkup(createElement(fields.UnitFormFields, props));
    const input = html.match(/<input\b[^>]*name="importance"[^>]*>/)![0];
    assert.match(input, /type="text"/); assert.match(input, /inputMode="numeric"/); assert.match(input, /required=""/);
    assert.match(html, /aria-invalid="true"/); assert.match(html, /aria-describedby="[^"]+-error/);
    assert.ok(html.includes(`value="${value}"`));
    const form = host(() => fields.UnitFormFields(props)); form.render();
    form.get(node => node.type === 'input' && node.props.name === 'importance').props.onChange?.({ target: { value: '미완성' } });
    assert.equal(changed, '미완성');
  }
  assert.equal(fields.unitImportanceInputError('10'), '');
  assert.equal(fields.unitImportanceInputError('1'), '');
});

test('new unit submits numeric importance and preserves a later edit for update of the same created unit', async () => {
  const workspace = fixture(); const calls: { type: string; payload: Record<string, unknown> }[] = [];
  let options: CommandOptions | undefined; let finish: ((value: boolean) => void) | undefined;
  const { view, closed } = unitForm(workspace, async (type, payload, next) => { calls.push({ type, payload }); options = next; return new Promise<boolean>(resolve => { finish = resolve; }); });
  assert.equal(view.fields().importance, '5');
  view.change('title', '새 업무 묶음'); view.change('description', '업무 범위');
  for (const invalid of ['', '-1', '1.5', '11']) { view.change('importance', invalid); await view.submit('form-stack'); assert.equal(calls.length, 0); assert.equal(errors[0].path, 'importance'); assert.equal(view.fields().importance, invalid); }
  view.change('importance', '7'); const pending = view.submit('form-stack'); view.render();
  assert.equal(calls[0].payload.importance, 7);
  view.change('importance', '9');
  assert.doesNotMatch(renderToStaticMarkup(createElement(fields.UnitFormFields, view.fields())), /disabled/);
  options?.onSaved?.(savedUnit(workspace, 'created-unit', 7)); finish?.(true); await pending; view.render();
  assert.equal(closed(), 0); assert.equal(view.fields().importance, '9'); assert.equal(dirty.get('단위업무'), true);
  assert.match(view.html(), /다시 저장하면 같은 단위업무/);
  const updated = view.submit('form-stack'); assert.equal(calls.length, 2);
  assert.equal(calls[1].type, 'unit.update'); assert.equal(calls[1].payload.unitId, 'created-unit'); assert.equal(calls[1].payload.importance, 9);
  finish?.(false); await updated;
});

test('editing an existing unit starts from its importance and includes importance in its dirty draft', async () => {
  const workspace = fixture(); const unit = workspace.units.find(item => item.ownerId === workspace.currentUser.id)!; unit.importance = 8;
  const calls: { type: string; payload: Record<string, unknown> }[] = [];
  const { view } = unitForm(workspace, async (type, payload) => { calls.push({ type, payload }); return false; }, unit.id);
  assert.equal(view.fields().importance, '8'); assert.equal(dirty.get('단위업무'), false);
  view.change('importance', '2'); assert.equal(dirty.get('단위업무'), true); await view.submit('form-stack');
  assert.equal(calls[0].type, 'unit.update'); assert.equal(calls[0].payload.unitId, unit.id); assert.equal(calls[0].payload.importance, 2);
});

test('common registration uses the same importance draft and preserves changes while creating its inline unit', async () => {
  const workspace = fixture();
  workspace.units = workspace.units.filter(unit => unit.ownerId !== workspace.currentUser.id);
  const commonTask = { ...workspace.commonTasks[0], id: 'importance-common', publicationStatus: 'approved' as const, distributions: [{ ...workspace.commonTasks[0].distributions[0], id: 'importance-distribution', departmentId: workspace.currentUser.departmentId, assigneeId: workspace.currentUser.id, status: 'person_assigned' as const }] };
  workspace.commonTasks = [commonTask];
  const calls: { type: string; payload: Record<string, unknown> }[] = []; let options: CommandOptions | undefined; let finish: ((value: boolean) => void) | undefined;
  const command: CommandFn = async (type, payload, next) => { calls.push({ type, payload }); options = next; return new Promise<boolean>(resolve => { finish = resolve; }); };
  const view = host(() => common.CommonRegistrationModal({ workspace, command, commonId: commonTask.id, distributionId: commonTask.distributions[0].id, onClose() { throw new Error('Changed draft must stay open'); } })); view.render();
  assert.equal(view.fields().importance, '5'); view.change('title', '새 업무 묶음'); view.change('description', '업무 범위');
  view.change('importance', '11'); await view.submit('common-registration-unit'); assert.equal(calls.length, 0);
  view.change('importance', '6'); const pending = view.submit('common-registration-unit'); view.render(); view.change('importance', '4');
  options?.onSaved?.(savedUnit(workspace, 'common-created-unit', 6)); finish?.(true); await pending; view.render();
  assert.equal(calls[0].payload.importance, 6); assert.equal(view.fields().importance, '4'); assert.equal(dirty.get('새 단위업무 내용'), true);
  assert.match(view.html(), /저장 중 추가한 내용은 그대로/);
  const updated = view.submit('common-registration-unit');
  assert.equal(calls[1].type, 'unit.update'); assert.equal(calls[1].payload.unitId, 'common-created-unit'); assert.equal(calls[1].payload.importance, 4);
  finish?.(false); await updated;
});

test('personal unit rail, all groups and creation choices use descending importance with stable ties', () => {
  const workspace = fixture(); const original = workspace.units.find(unit => unit.ownerId === workspace.currentUser.id)!;
  const units = [
    { ...original, id: 'sort-low', title: '정렬 낮음', importance: 1 },
    { ...original, id: 'sort-first', title: '정렬 먼저', importance: 9 },
    { ...original, id: 'sort-second', title: '정렬 다음', importance: 9 },
    { ...original, id: 'sort-default', title: '정렬 기본', importance: undefined },
  ];
  workspace.units = [...units, ...workspace.units.filter(unit => unit.ownerId !== workspace.currentUser.id)];
  workspace.tasks = workspace.tasks.filter(task => task.primaryId !== workspace.currentUser.id);
  const expected = ['정렬 먼저', '정렬 다음', '정렬 기본', '정렬 낮음'];
  const page = host(() => personal.PersonalWork({ workspace, command: async () => true })); page.render();
  const html = page.html();
  const rail = html.match(/<div class="pw-unit-list">([\s\S]*?)<\/div>/)![1];
  const groups = [...html.matchAll(/class="pw-tree-unit-title">([^<]+)/g)].map(match => match[1]);
  assert.deepEqual(groups, expected);
  for (let i = 1; i < expected.length; i++) assert.ok(rail.indexOf(expected[i - 1]) < rail.indexOf(expected[i]));
  assert.match(rail, /중요도 5/);
  page.click('세부업무 추가'); page.render();
  const createTask = page.get(node => typeof node.type === 'function' && node.type.name === 'CreateTask');
  const taskForm = host(() => (createTask.type as (props: Props) => ReactNode)(createTask.props)); taskForm.render();
  const select = taskForm.get(node => node.type === 'select' && Array.isArray(node.props.children));
  const options = (select.props.children as ReactNode[]).flat().filter(isValidElement<Props>);
  assert.deepEqual(options.filter(option => option.props.value).map(option => textOf(option.props.children).split(' · ')[0]), expected);
  assert.deepEqual(units.map(unit => unit.id), ['sort-low', 'sort-first', 'sort-second', 'sort-default'], 'sorting must not mutate the workspace order');
});

test('the virtual delegation group stays last without an invented importance', () => {
  const workspace = fixture(); const own = workspace.units.find(unit => unit.ownerId === workspace.currentUser.id)!;
  const original = workspace.tasks.find(task => task.primaryId === workspace.currentUser.id)!;
  const owner = workspace.users.find(user => user.id === 'u-seoyeon')!;
  workspace.units = [{ ...own, title: '실제 단위', importance: 1 }, { ...own, id: 'delegation-origin', ownerId: owner.id, title: '원담당자 묶음', importance: 10 }];
  const delegated = { ...original, id: 'importance-delegated', unitId: 'delegation-origin', primaryId: owner.id, title: '대행할 원본 업무', commonId: undefined };
  workspace.tasks = [delegated]; workspace.delegatedTaskIds = [delegated.id];
  workspace.delegations = [{ id: 'importance-delegation', taskId: delegated.id, fromId: owner.id, toId: workspace.currentUser.id, approvedBy: 'u-head', status: 'approved', startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z', actions: ['run.check'] }];
  const html = renderToStaticMarkup(createElement(personal.PersonalWork, { workspace, command: async () => true }));
  const rail = html.match(/<div class="pw-unit-list">([\s\S]*?)<\/div>/)![1];
  assert.ok(rail.indexOf('실제 단위') < rail.indexOf('업무대행'));
  const delegation = rail.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)!.find(button => button.includes('업무대행'))!;
  assert.ok(delegation); assert.doesNotMatch(delegation, /중요도/);
  const groups = [...html.matchAll(/class="pw-tree-unit-title">([^<]+)([\s\S]*?)class="pw-tree-count"/g)];
  assert.equal(groups.at(-1)![1], '업무대행'); assert.doesNotMatch(groups.at(-1)![2], /중요도/);
});

test('common registration choices use the same stable descending importance', () => {
  const workspace = fixture(); const own = workspace.units.find(unit => unit.ownerId === workspace.currentUser.id)!;
  workspace.units = [{ ...own, id: 'common-low', title: '공통 낮음', importance: 2 }, { ...own, id: 'common-first', title: '공통 먼저', importance: 8 }, { ...own, id: 'common-second', title: '공통 다음', importance: 8 }];
  const task = { ...workspace.commonTasks[0], publicationStatus: 'approved' as const, distributions: [{ ...workspace.commonTasks[0].distributions[0], departmentId: workspace.currentUser.departmentId, assigneeId: workspace.currentUser.id, status: 'person_assigned' as const }] };
  workspace.commonTasks = [task];
  const html = renderToStaticMarkup(createElement(common.CommonRegistrationModal, { workspace, command: async () => true, commonId: task.id, distributionId: task.distributions[0].id, onClose() {} }));
  const options = [...html.matchAll(/<option value="(common-[^"]+)"[^>]*>/g)].map(match => match[1]);
  assert.deepEqual(options, ['common-first', 'common-second', 'common-low']);
});
