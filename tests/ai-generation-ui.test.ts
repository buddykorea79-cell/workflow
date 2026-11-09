import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isValidElement, type ReactNode } from 'react';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import { defaultWorkflow } from '../src/lib/seed-helpers';

const requireUi = createRequire(path.resolve('tests/ai-generation-ui.test.ts'));
const previousCss = requireUi.extensions['.css']; requireUi.extensions['.css'] = () => undefined;
const guards = requireUi('../src/components/unsaved-changes');
const guardModule = requireUi.cache[requireUi.resolve('../src/components/unsaved-changes')]!;
let procedure: typeof import('../src/components/procedure-builder');
let description: typeof import('../src/components/task-description-files');
try {
  guardModule.exports = { ...guards, useUnsavedChanges: () => 'ai-test' };
  procedure = requireUi('../src/components/procedure-builder');
  description = requireUi('../src/components/task-description-files');
} finally {
  guardModule.exports = guards;
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
    button(label: string) { return this.one(props => !!props.onClick && text(props.children).trim() === label); },
    cancel() { this.one(props => typeof props.startedAt === 'number' && typeof props.onCancel === 'function').onCancel(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const procedureResult = (title: string) => Response.json({ draft: { steps: defaultWorkflow().map((step, index) => ({ ...step, title: index ? step.title : title })), references: [], warnings: [], evidence: {} }, model: 'mock' });

test('procedure cancellation ignores an abort-resistant old response and keeps the retry locked', async () => {
  const previous = globalThis.fetch; const pending: { finish: (response: Response) => void; signal?: AbortSignal | null }[] = [];
  globalThis.fetch = async (_url, init) => new Promise<Response>(finish => pending.push({ finish, signal: init?.signal }));
  const props = { taskId: 'task', overview: { title: '시험 업무', description: '담당자가 수합하고 부서장이 검토한다.', completionCriteria: '', descriptionAttachmentIds: [] }, overviewAttachments: [], workflow: [], onApply: async () => true };
  const view = host(() => procedure.ProcedureBuilder(props));
  try {
    view.render(); const generate = view.button('AI 업무 분석·절차 만들기'); generate.onClick(); generate.onClick();
    assert.equal(pending.length, 1); view.render(); view.cancel(); view.render();
    assert.equal(pending[0].signal?.aborted, true);
    view.button('AI 업무 분석·절차 만들기').onClick(); view.render();
    pending[0].finish(procedureResult('취소한 절차')); await tick();
    let rendered = view.render(); assert.doesNotMatch(rendered, /취소한 절차/);
    assert.equal(view.button('AI가 업무 개요·파일을 분석하는 중…').disabled, true);
    pending[1].finish(procedureResult('새 절차')); await tick();
    rendered = view.render(); assert.match(rendered, /새 절차/); assert.doesNotMatch(rendered, /취소한 절차/);
  } finally { view.dispose(); globalThis.fetch = previous; }
});

test('a procedure result cannot replace the draft after its source changed', async () => {
  const previous = globalThis.fetch; let finish!: (response: Response) => void;
  globalThis.fetch = async () => new Promise<Response>(resolve => { finish = resolve; });
  let overview = { title: '업무', description: '처음 설명', completionCriteria: '', descriptionAttachmentIds: [] as string[] };
  const view = host(() => procedure.ProcedureBuilder({ taskId: 'task', overview, overviewAttachments: [], workflow: [], onApply: async () => true }));
  try {
    view.render(); view.button('AI 업무 분석·절차 만들기').onClick(); view.render();
    overview = { ...overview, description: '분석 중 수정한 설명' }; view.render();
    finish(procedureResult('이전 자료로 만든 절차')); await tick();
    const rendered = view.render(); assert.match(rendered, /분석 중 수정한 설명/); assert.match(rendered, /변경되었습니다/); assert.doesNotMatch(rendered, /이전 자료로 만든 절차/);
  } finally { view.dispose(); globalThis.fetch = previous; }
});

test('description generation preserves editable text and drops results from an unmounted editor', async () => {
  const previous = globalThis.fetch; let finish!: (response: Response) => void; let generationSignal: AbortSignal | null | undefined; let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.action === 'extract') return Response.json({ text: '담당자가 자료를 수합한다.', format: 'txt', warnings: [] });
    calls++; generationSignal = init?.signal;
    return new Promise<Response>(resolve => { finish = resolve; });
  };
  const now = new Date('2026-11-08T03:00:00Z'); const workspace = getWorkspace(createSeed(now), 'u-jiho', now);
  workspace.attachments.push({ id: 'source', taskId: 'task', name: '가상.txt', mime: 'text/plain', size: 30, storageKey: '', sha256: '', status: 'quarantined', uploadedBy: workspace.currentUser.id, createdAt: now.toISOString() });
  let body = '기존 업무 설명'; const busy: boolean[] = [];
  const view = host(() => description.TaskDescriptionFiles({ workspace, taskId: 'task', attachmentIds: ['source'], title: '자료 수합', description: body, onDescriptionChange(value) { body = value; }, onAttachmentsChange() {}, onBusyChange(value) { busy.push(value); } }));
  try {
    view.render(); view.button('본문 읽기').onClick(); await tick(); view.render();
    const generate = view.button('AI로 업무 설명 초안 만들기'); generate.onClick(); generate.onClick(); view.render();
    assert.equal(calls, 1);
    body = '분석 중 수정한 설명'; view.render(); view.dispose();
    assert.equal(generationSignal?.aborted, true); assert.equal(busy.at(-1), false);
    finish(Response.json({ draft: { description: '늦게 도착한 초안', sources: [], warnings: [] } })); await tick();
    assert.equal(body, '분석 중 수정한 설명');
    assert.doesNotMatch(view.render(), /늦게 도착한 초안/);
  } finally { view.dispose(); globalThis.fetch = previous; }
});
