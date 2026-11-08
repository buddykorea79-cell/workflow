import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import type { Attachment, Performance } from '../src/lib/types';

const componentRequire = createRequire(path.resolve('tests/read-only-performance.test.ts'));
const previousCssLoader = componentRequire.extensions['.css'];
componentRequire.extensions['.css'] = () => undefined;
let performance: typeof import('../src/components/task-performance');
let evaluation: typeof import('../src/components/unit-evaluation');
let attachments: typeof import('../src/components/task-file-attachments');
try {
  performance = componentRequire('../src/components/task-performance');
  evaluation = componentRequire('../src/components/unit-evaluation');
  attachments = componentRequire('../src/components/task-file-attachments');
} finally {
  if (previousCssLoader) componentRequire.extensions['.css'] = previousCssLoader;
  else delete componentRequire.extensions['.css'];
}

const now = new Date('2026-11-08T03:00:00Z');
const period = '2026-H2';
const actor = 'u-support-member';
const command = async () => { throw new Error('Rendering must not issue a command'); };

function fixture(status: Performance['status'] = 'draft', viewer = actor) {
  const state = createSeed(now);
  const task = state.tasks.find(item => item.id === 'task-data')!;
  state.unitScorePlans = []; state.unitEvaluations = [];
  const file = (id: string, name: string): Attachment => ({ id, name, taskId: task.id, performanceId: 'performance-readonly', size: 32, mime: 'text/plain', sha256: 'synthetic', storageKey: id, status: 'test_allowed', uploadedBy: actor, createdAt: now.toISOString() });
  const savedFile = file('file-saved', '저장된 결과.txt');
  const addedFile = file('file-added', '추가 작성 자료.txt');
  const record: Performance = { id: 'performance-readonly', taskId: task.id, runId: 'run-readonly', title: task.title, description: '서버에 저장된 성과\nhttps://example.test/saved', authorId: actor, departmentId: task.departmentId, unitId: task.unitId, status, period, evidence: '', attachmentIds: [savedFile.id], createdAt: now.toISOString() };
  state.performances = [record]; state.attachments = [savedFile, addedFile];
  const workspace = getWorkspace(state, viewer, now);
  return { workspace, task, record: workspace.performances.find(item => item.id === record.id)!, savedFile, addedFile };
}

/** Seed retained local values while keeping React's own setters and rendering. */
function renderWithState(element: ReactNode, retained: (initial: unknown) => unknown) {
  const react = componentRequire('react') as typeof import('react');
  const original = react.useState;
  react.useState = ((initial: unknown) => original(retained(initial))) as typeof react.useState;
  try { return renderToStaticMarkup(element); }
  finally { react.useState = original; }
}

test('a locked performance displays linked text and its file download without disabled editing controls', () => {
  const { workspace, record } = fixture('confirmed');
  const html = renderToStaticMarkup(createElement(evaluation.PerformanceEditor, { workspace, command, period, existing: record, embedded: true, readOnly: true, onClose() {} }));
  assert.match(html, /data-read-label="성과 내용"/);
  assert.match(html, /href="https:\/\/example.test\/saved"/);
  assert.match(html, /href="\/api\/attachments\/file-saved"/);
  assert.doesNotMatch(html, /<textarea|<select|첨부 해제|기존 파일 선택|>파일 추가</);
  assert.match(html, /현재 수정할 수 없는 성과/);
});

test('the retained task editor shows unsaved text and added files after becoming read-only, including its copy textarea', () => {
  const { workspace, task, record, savedFile, addedFile } = fixture('confirmed');
  const localDescription = '제출 요청 뒤 추가로 작성한 성과\nhttps://example.test/local-draft';
  const localIds = [savedFile.id, addedFile.id];
  const localSnapshot = JSON.stringify({ taskId: task.id, description: localDescription, attachmentIds: localIds });
  const savedSnapshot = JSON.stringify({ taskId: task.id, description: record.description, attachmentIds: record.attachmentIds });
  let seededEditorPeriod = false;
  const html = renderWithState(createElement(performance.TaskPerformance, { workspace, task, command, onGoPerformance() {} }), initial => {
    if (initial === null && !seededEditorPeriod) { seededEditorPeriod = true; return period; }
    if (initial === record.description) return localDescription;
    if (initial === record.attachmentIds) return localIds;
    if (initial === localSnapshot) return savedSnapshot;
    return initial;
  });
  assert.match(html, /ue-performance-editor/);
  assert.doesNotMatch(html, /class="tp-record"/);
  assert.match(html, /data-read-label="성과 내용"/);
  assert.match(html, /href="https:\/\/example.test\/local-draft"/);
  assert.match(html, /저장되지 않은 성과 초안/);
  assert.match(html, /<textarea[^>]*readOnly=""[^>]*>제출 요청 뒤 추가로 작성한 성과/);
  assert.match(html, /추가 작성 자료.txt/);
  assert.match(html, /href="\/api\/attachments\/file-added"/);
  assert.doesNotMatch(html, /서버에 저장된 성과|첨부 해제|기존 파일 선택/);
});

test('editable performances retain their 500-character input and file selection while a locked unpinned task becomes text', () => {
  const { workspace, record } = fixture();
  const editable = renderToStaticMarkup(createElement(evaluation.PerformanceEditor, { workspace, command, period, existing: record, embedded: true, onClose() {} }));
  assert.match(editable, /<textarea[^>]*maxLength="500"/);
  assert.match(editable, />파일 추가</);
  assert.match(editable, /기존 파일 선택/);
  assert.doesNotMatch(editable, /data-read-label="성과 내용"/);
  const locked = renderToStaticMarkup(createElement(evaluation.PerformanceEditor, { workspace, command, period, embedded: true, readOnly: true, onClose() {} }));
  assert.match(locked, /data-read-label="세부업무"/);
  assert.doesNotMatch(locked, /<select/);
});

test('a reviewer record uses the same readable fields without altering performance period controls or legacy metrics', () => {
  const { workspace, task, record } = fixture('confirmed', 'u-support-head');
  record.evidence = '이전 자료 https://example.test/legacy';
  record.metricName = '처리 건수'; record.value = 0; record.unit = '건';
  const html = renderToStaticMarkup(createElement(performance.TaskPerformance, { workspace, task, command, onGoPerformance() {} }));
  assert.match(html, /class="tp-record"/);
  assert.match(html, /data-read-label="성과 내용"/);
  assert.match(html, /data-read-label="기존 근거"/);
  assert.match(html, /href="https:\/\/example.test\/legacy"/);
  assert.match(html, /처리 건수/);
  assert.match(html, /<strong>0 건<\/strong>/);
  assert.equal((html.match(/<select/g) || []).length, 2, 'year and half remain usable lookup controls');
});

test('disabled attachment display keeps pending status, local files and errors while hiding only editing actions', () => {
  const { workspace, task, record, addedFile } = fixture();
  workspace.attachments = workspace.attachments.filter(file => file.id !== addedFile.id);
  let stateIndex = 0;
  const retained = [[addedFile], true, '파일 목록 갱신이 늦어지고 있습니다.', '요청 뒤 추가된 파일입니다.'];
  const html = renderWithState(createElement(attachments.TaskFileAttachments, { workspace, taskId: task.id, performanceId: record.id, attachmentIds: [addedFile.id], onChange() {}, command, disabled: true, label: '성과 참고 파일' }), initial => stateIndex < retained.length ? retained[stateIndex++] : initial);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /추가 작성 자료.txt/);
  assert.match(html, /data-read-label="성과 참고 파일" data-read-value="추가 작성 자료.txt"/);
  assert.match(html, /href="\/api\/attachments\/file-added"/);
  assert.match(html, /파일 처리 중/);
  assert.match(html, /파일 목록 갱신이 늦어지고 있습니다/);
  assert.doesNotMatch(html, /<select|첨부 해제|>파일 추가</);
});
