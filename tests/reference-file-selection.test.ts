import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import type { TaskReference } from '../src/lib/types';

const requireComponent = createRequire(path.resolve('tests/reference-file-selection.test.ts'));
const previousCss = requireComponent.extensions['.css'];
requireComponent.extensions['.css'] = () => undefined;
let TaskReferences: typeof import('../src/components/task-references').TaskReferences;
try { ({ TaskReferences } = requireComponent('../src/components/task-references')); }
finally { if (previousCss) requireComponent.extensions['.css'] = previousCss; else delete requireComponent.extensions['.css']; }
type Props = Record<string, any> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function host(content = '') {
  const state = createSeed(new Date('2026-11-08T01:00:00Z'));
  const task = state.tasks.find(task => task.id === 'task-data')!;
  state.attachments = [{ id: 'stored-file', taskId: task.id, name: '내부계획.txt', size: 40, sha256: '', storageKey: '', status: 'test_allowed', uploadedBy: task.primaryId, createdAt: '', mime: 'text/plain' }];
  const workspace = getWorkspace(state, task.primaryId);
  let references: TaskReference[] = [{ id: 'reference', type: 'guideline', title: '업무계획', content }];
  const slots: any[] = []; const initialized = new Set<number>(); let tree: ReactNode; let busy = false;
  const h = {
    render() {
      const react = requireComponent('react') as typeof import('react'); let index = 0;
      const original = { useState: react.useState, useRef: react.useRef, useEffect: react.useEffect };
      react.useState = ((initial: any) => { const at = index++; if (!(at in slots)) slots[at] = typeof initial === 'function' ? initial() : initial; return [slots[at], (update: any) => { slots[at] = typeof update === 'function' ? update(slots[at]) : update; }]; }) as typeof react.useState;
      react.useRef = ((initial: any) => { const at = index++; if (!(at in slots)) slots[at] = { current: initial }; return slots[at]; }) as typeof react.useRef;
      react.useEffect = ((effect: () => void) => { const at = index++; if (!initialized.has(at)) { initialized.add(at); effect(); } }) as typeof react.useEffect;
      try { tree = TaskReferences({ workspace, taskId: task.id, references, editable: true, onChange: next => { references = next; }, command: async () => true, onBusyChange: next => { busy = next; } }); }
      finally { Object.assign(react, original); }
    },
    select() { const node = elements(tree).find(node => node.type === 'select' && elements(node.props.children).some(child => child.type === 'option' && child.props.value === 'stored-file')); assert.ok(node); node.props.onChange({ target: { value: 'stored-file' } }); this.render(); },
    edit(text: string) { references = references.map(reference => ({ ...reference, content: text })); this.render(); },
    chooseNew() { const node = elements(tree).find(node => node.props.children === '새 본문으로 교체'); assert.ok(node); node.props.onClick(); this.render(); },
    get reference() { return references[0]; }, get busy() { return busy; },
    text() { return elements(tree).flatMap(node => typeof node.props.children === 'string' ? [node.props.children] : []).join(' '); },
  };
  h.render(); return h;
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));

test('selecting a saved attachment fills the real reference component without a second upload', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (url, init) => { calls++; assert.equal(url, '/api/procedure-extract'); assert.equal(JSON.parse(String(init?.body)).attachmentId, 'stored-file'); return Response.json({ text: '교육 이수 실적을 취합한다.' }); };
  try {
    const view = host(); view.select(); assert.equal(view.busy, true);
    await settle(); view.render();
    assert.equal(view.reference.attachmentId, 'stored-file'); assert.equal(view.reference.content, '교육 이수 실적을 취합한다.'); assert.equal(view.busy, false); assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('a stored-file response cannot overwrite text edited while extraction was running', async () => {
  const original = globalThis.fetch; let resolve!: (response: Response) => void;
  globalThis.fetch = () => new Promise<Response>(done => { resolve = done; });
  try {
    const view = host(); view.select(); view.edit('읽는 중 사용자가 직접 입력한 설명');
    resolve(Response.json({ text: '추출한 설명' })); await settle(); view.render();
    assert.equal(view.reference.content, '읽는 중 사용자가 직접 입력한 설명'); assert.equal(view.reference.attachmentId, undefined); assert.equal(view.busy, false); assert.match(view.text(), /입력 내용을 유지/);
  } finally { globalThis.fetch = original; }
});

test('existing text is replaced only after the user confirms the extracted body', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ text: '선택한 파일의 새 본문' });
  try {
    const view = host('기존에 작성한 본문'); view.select(); await settle(); view.render();
    assert.equal(view.reference.content, '기존에 작성한 본문'); assert.equal(view.reference.attachmentId, undefined); assert.equal(view.busy, true);
    view.chooseNew();
    assert.equal(view.reference.content, '선택한 파일의 새 본문'); assert.equal(view.reference.attachmentId, 'stored-file'); assert.equal(view.busy, false);
  } finally { globalThis.fetch = original; }
});

test('a denied extraction keeps the old reference and releases the busy state', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: '파일을 읽을 권한이 없습니다.' }, { status: 403 });
  try {
    const view = host('기존 본문'); view.select(); await settle(); view.render();
    assert.equal(view.reference.content, '기존 본문'); assert.equal(view.reference.attachmentId, undefined); assert.equal(view.busy, false); assert.match(view.text(), /권한이 없습니다/);
  } finally { globalThis.fetch = original; }
});
