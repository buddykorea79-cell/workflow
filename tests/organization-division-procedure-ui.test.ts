import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import { organizationDivisionRows } from '../src/lib/organization-division';
import type { OrganizationDivisionProcedure as ProcedureData } from '../src/lib/organization-division-procedure';

const requireUi = createRequire(path.resolve('tests/organization-division-procedure-ui.test.ts'));
const previousCss = requireUi.extensions['.css']; requireUi.extensions['.css'] = () => undefined;
let division: typeof import('../src/components/organization-division');
let viewer: typeof import('../src/components/organization-division-procedure');
try {
  division = requireUi('../src/components/organization-division');
  viewer = requireUi('../src/components/organization-division-procedure');
} finally {
  if (previousCss) requireUi.extensions['.css'] = previousCss; else delete requireUi.extensions['.css'];
}

type Props = Record<string, any> & { children?: ReactNode };
function all(node: ReactNode, predicate: (props: Props) => boolean): Props[] {
  if (Array.isArray(node)) return node.flatMap(child => all(child, predicate));
  if (!isValidElement<Props>(node)) return [];
  return [...(predicate(node.props) ? [node.props] : []), ...all(node.props.children, predicate)];
}
function text(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(text).join('');
  return isValidElement<Props>(node) ? text(node.props.children) : '';
}
function host(render: () => ReactNode) {
  const slots: any[] = []; let tree: ReactNode; let effects: (() => void)[] = [];
  return {
    render() {
      const react = requireUi('react') as typeof import('react');
      const saved = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect }; let index = 0;
      react.useState = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], (update: any) => { slots[at] = typeof update === 'function' ? update(slots[at]) : update; }]; }) as typeof react.useState;
      react.useRef = ((initial: unknown) => { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; }) as typeof react.useRef;
      react.useEffect = ((effect: () => unknown, deps: unknown[]) => { const at = index++; const previous = slots[at]; if (!previous || !deps || deps.some((value, i) => !Object.is(value, previous.deps?.[i]))) { slots[at] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[at].cleanup = effect(); }); } }) as typeof react.useEffect;
      try { tree = render(); } finally { Object.assign(react, saved); }
      const pending = effects; effects = []; pending.forEach(effect => effect());
      return text(tree);
    },
    one(predicate: (props: Props) => boolean) { const found = all(tree, predicate); assert.equal(found.length, 1); return found[0]; },
    matches(predicate: (props: Props) => boolean) { return all(tree, predicate); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const data = (taskId: string): ProcedureData => ({ taskId, taskTitle: `${taskId} 업무`, unitTitle: '자료 관리', departmentName: '다른 부서', participants: { primary: '담당 이름', support: '협업 부서', reviewer: '검토 이름' }, workflow: [{ id: 'collect', title: '자료 수합', role: 'primary', dependsOn: [] }, { id: 'review', title: '자료 검토', role: 'reviewer', dependsOn: ['collect'] }] });

test('assignment table keeps four columns and opens a foreign task flow without requiring a private task record', () => {
  const now = new Date('2026-11-08T03:00:00Z'); const workspace = getWorkspace(createSeed(now), 'u-jiho', now);
  const html = renderToStaticMarkup(createElement(division.OrganizationDivision, { workspace }));
  const headers = [...html.matchAll(/<th scope="col">([^<]+)<\/th>/g)].map(match => match[1]);
  assert.deepEqual(headers, ['담당자', '단위업무', '세부업무', '업무대행자']);
  assert.match(html, /aria-haspopup="dialog"/); assert.match(html, /절차도 보기/);
  const foreign = organizationDivisionRows(workspace.organizationDivision!).find(row => row.departmentId !== workspace.currentUser.departmentId && row.taskId)!;
  assert.ok(foreign); assert.equal(workspace.tasks.some(task => task.id === foreign.taskId), false);
  const view = host(() => division.OrganizationDivision({ workspace }));
  try {
    view.render(); view.one(props => props['aria-label'] === '전체 업무분장표 부서').onChange({ target: { value: foreign.departmentId } }); view.render();
    view.one(props => props['aria-label'] === `${foreign.task} 절차도 보기`).onClick(); view.render();
    assert.equal(view.one(props => props.title === '업무 절차도').description, foreign.task);
    assert.equal(view.one(props => props.taskId === foreign.taskId).taskId, foreign.taskId);
    assert.equal(view.one(props => props['aria-label'] === '전체 업무분장표 부서').value, foreign.departmentId);
    view.one(props => props.title === '업무 절차도').onClose(); view.render();
    assert.equal(view.matches(props => props.title === '업무 절차도').length, 0);
  } finally { view.dispose(); }
});

test('viewer maps only current step structure into a read-only flow and keeps server participant labels', async () => {
  const previous = globalThis.fetch; let seen: RequestInit | undefined;
  const payload = data('foreign'); const contaminated = { ...payload, workflow: payload.workflow.map(step => ({ ...step, done: true, description: 'PRIVATE-DESCRIPTION', output: 'PRIVATE-OUTPUT', attachmentIds: ['PRIVATE-FILE'] })) };
  globalThis.fetch = async (url, init) => { assert.equal(String(url), '/api/organization-division/procedure?taskId=foreign'); seen = init; return Response.json(contaminated); };
  const view = host(() => viewer.OrganizationDivisionProcedure({ taskId: 'foreign' }));
  try {
    assert.match(view.render(), /불러오고 있습니다/); await tick(); const rendered = view.render();
    assert.equal(seen?.cache, 'no-store'); assert.match(rendered, /현재 저장된 업무 기준/);
    assert.match(rendered, /다른 부서/);
    const flow = view.one(props => Array.isArray(props.workflow));
    assert.equal(flow.onSelect, undefined); assert.equal(flow.scrollOnly, true, 'read-only viewer uses the native scrolling diagram without another zoom dialog'); assert.deepEqual(flow.participants, payload.participants);
    assert.ok(flow.workflow.every((step: Props) => step.done === false && step.description === '' && step.output === '' && step.attachmentIds === undefined));
    assert.doesNotMatch(JSON.stringify(flow.workflow), /PRIVATE/);
    assert.equal(view.matches(props => typeof props.onApply === 'function' || typeof props.onSave === 'function').length, 0);
  } finally { view.dispose(); globalThis.fetch = previous; }
});

test('viewer retries errors, aborts on a new task and ignores late responses before showing an empty flow', async () => {
  const previous = globalThis.fetch; const pending: { finish: (response: Response) => void; signal?: AbortSignal | null }[] = [];
  globalThis.fetch = async (_url, init) => new Promise<Response>(finish => pending.push({ finish, signal: init?.signal }));
  let taskId = 'first'; const view = host(() => viewer.OrganizationDivisionProcedure({ taskId }));
  try {
    view.render(); pending[0].finish(Response.json({ error: '일시 조회 오류' }, { status: 503 })); await tick();
    assert.match(view.render(), /일시 조회 오류/);
    view.one(props => !!props.onClick && text(props.children) === '다시 불러오기').onClick(); view.render();
    assert.equal(pending.length, 2);
    taskId = 'second'; assert.match(view.render(), /불러오고 있습니다/); assert.equal(pending[1].signal?.aborted, true);
    pending[1].finish(Response.json(data('first'))); await tick(); assert.doesNotMatch(view.render(), /first 업무/);
    pending[2].finish(Response.json({ ...data('second'), workflow: [] })); await tick(); view.render();
    assert.equal(view.one(props => props.title === '아직 등록된 절차가 없습니다.').description, '담당자가 업무 절차를 저장하면 이곳에서 확인할 수 있습니다.');
    assert.equal(view.matches(props => Array.isArray(props.workflow)).length, 0);
    view.dispose(); assert.equal(pending[2].signal?.aborted, true);
  } finally { view.dispose(); globalThis.fetch = previous; }
});
