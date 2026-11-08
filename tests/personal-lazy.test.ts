import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import { taskProcedureParticipants } from '../src/lib/procedure-participants';
import { taskCycleState } from '../src/lib/work-cycles';
import { renderComponent } from './helpers/render-component';

const componentRequire = createRequire(path.resolve('tests/personal-lazy.test.ts'));
const previousCssLoader = componentRequire.extensions['.css'];
componentRequire.extensions['.css'] = () => undefined;
const originalUi = componentRequire('../src/components/ui');
const uiModule = componentRequire.cache[componentRequire.resolve('../src/components/ui')]!;
let personal: typeof import('../src/components/personal-work');
try {
  uiModule.exports = { ...originalUi, Modal: ({ title, children }: { title: string; children: ReactNode }) => createElement('section', { 'aria-label': title }, children) };
  personal = componentRequire('../src/components/personal-work');
} finally {
  uiModule.exports = originalUi;
  if (previousCssLoader) componentRequire.extensions['.css'] = previousCssLoader;
  else delete componentRequire.extensions['.css'];
}
const loadedInitially = new Set(Object.keys(componentRequire.cache));
const modulePath = (name: string) => componentRequire.resolve(`../src/components/${name}`);
const now = new Date('2026-11-08T03:00:00Z');
const command = async () => { throw new Error('Rendering must not send a command'); };

function fixture() {
  const workspace = getWorkspace(createSeed(now), 'u-jiho', now);
  return { workspace, task: workspace.tasks.find(item => item.id === 'task-meeting')! };
}

async function renderLoaded(element: ReactNode) {
  const previousCss = componentRequire.extensions['.css'];
  componentRequire.extensions['.css'] = () => undefined;
  try { return await renderComponent(element); }
  finally {
    if (previousCss) componentRequire.extensions['.css'] = previousCss;
    else delete componentRequire.extensions['.css'];
  }
}

test('basic personal detail is immediately rendered without loading inactive tabs or the delegation list', () => {
  for (const name of ['procedure-builder', 'procedure-editor', 'work-cycles', 'task-references', 'law-reference-picker', 'directive-monthly', 'task-budget', 'task-file-attachments', 'task-performance', 'unit-evaluation', 'delegation-work']) {
    assert.equal(loadedInitially.has(modulePath(name)), false, `${name} must not be an eager dependency of basic detail`);
  }
  const { workspace, task } = fixture();
  const html = renderToStaticMarkup(createElement(personal.TaskPanel, { workspace, taskId: task.id, command, onClose() {}, routedTab: 'overview' }));
  assert.match(html, /data-field-label="업무 설명"/);
  assert.match(html, /업무대행 지정/);
  assert.match(html, /현재 대행자 없음|현재 이 업무를 대행/);
  assert.doesNotMatch(html, /lazy-screen|화면을 불러오고 있습니다/);
});

test('opening the performance route loads actual performance content without replacing the detail tabs', async () => {
  const { workspace, task } = fixture();
  const html = await renderLoaded(createElement(personal.TaskPanel, { workspace, taskId: task.id, command, onClose() {}, routedTab: 'performance' }));
  assert.match(html, /aria-label="세부업무 업무 성과"/);
  assert.match(html, /성과 · 평가/);
  assert.match(html, /role="tablist" aria-label="세부업무 상세"/);
  // The completed stream can retain the initial fallback and its replacement script.
  // Assert the real requested content, rather than React's serialization strategy.
  assert.ok(componentRequire.cache[modulePath('task-performance')]);
  assert.equal(componentRequire.cache[modulePath('delegation-work')], undefined);
});

test('opening the procedure tab shows its compact diagram before the manual form', async () => {
  const { workspace, task } = fixture();
  const workflow = await renderLoaded(createElement(personal.TaskPanel, { workspace, taskId: task.id, command, onClose() {}, routedTab: 'workflow' }));
  assert.match(workflow, /aria-label="현재 적용된 업무 절차"/);
  const procedure = componentRequire('../src/components/procedure-editor') as typeof import('../src/components/procedure-editor');
  const props: Parameters<typeof procedure.ProcedureEditor>[0] = {
    workspace, taskId: task.id, command, workflow: task.workflow, originalWorkflow: task.workflow,
    participants: taskProcedureParticipants(workspace, task), editable: true, busy: false,
    diagramChanged: false, redrawKey: 0, onApply: async () => true, onChange() {}, onRemove() {}, onMove() {}, onAdd: () => undefined,
  };
  const open = await renderLoaded(createElement(procedure.ProcedureEditor, props));
  assert.match(open, /수기로 절차 추가/);
  assert.match(open, /procedure-flow-section is-compact/);
  assert.ok(open.indexOf('class="pe-diagram"') < open.indexOf('class="pw-section-intro"'));
  assert.doesNotMatch(open, /<details[^>]*pe-diagram/);
  assert.ok(componentRequire.cache[modulePath('procedure-builder')]);
  assert.match(open, /aria-label="담당자·지원·검토 역할별 절차 흐름도"/);
  assert.match(open, /aria-label="절차 편집 위치 선택"/);
  assert.match(open, /aria-haspopup="dialog"/);
  for (const step of task.workflow) assert.ok(open.includes(step.title));
});

test('a next-cycle definition renders its lazy flow while preserving current and history controls', async () => {
  const state = createSeed(now);
  const source = state.tasks.find(item => item.id === 'task-data')!;
  const run = taskCycleState(state, source).latest!;
  run.status = 'completed'; run.completedAt = now.toISOString(); run.cycleManaged = true;
  run.steps.forEach(step => { step.status = 'completed'; });
  source.version = run.definitionVersion + 1;
  const workspace = getWorkspace(state, source.primaryId, now);
  const task = workspace.tasks.find(item => item.id === source.id)!;
  const html = await renderLoaded(createElement(personal.TaskPanel, { workspace, taskId: task.id, command, onClose() {}, routedTab: 'schedule' }));
  assert.match(html, /다음 회차의 절차/);
  assert.match(html, /role="tablist" aria-label="업무 회차"/);
  assert.match(html, /완료한 회차의 원래 절차는 지난 회차에서 확인/);
  assert.match(html, /절차 목록으로 보기/);
});

test('reference and budget routes resolve their actual fields while retaining the parent task content', async () => {
  const { workspace, task } = fixture();
  const references = await renderLoaded(createElement(personal.TaskPanel, { workspace, taskId: task.id, command, onClose() {}, initialMode: 'view', routedTab: 'references' }));
  assert.match(references, /관련 근거와 생산 문서/);
  assert.ok(componentRequire.cache[modulePath('task-references')]);
  const budget = await renderLoaded(createElement(personal.TaskPanel, { workspace, taskId: task.id, command, onClose() {}, initialMode: 'view', routedTab: 'budget' }));
  assert.match(budget, /집행 내역/);
  assert.match(budget, /data-read-label="사업 예산/);
  assert.ok(componentRequire.cache[modulePath('task-budget')]);
  assert.ok(budget.includes(task.title));
});

test('a directive detail loads the monthly record interface on its routed monthly tab', async () => {
  const state = createSeed(now);
  const source = state.tasks.find(item => item.id === 'task-directive')!;
  const common = state.commonTasks.find(item => item.id === source.commonId)!;
  const distribution = common.distributions.find(item => item.taskId === source.id)!;
  distribution.status = 'registered'; distribution.assigneeId = source.primaryId;
  const workspace = getWorkspace(state, source.primaryId, now);
  const html = await renderLoaded(createElement(personal.TaskPanel, { workspace, taskId: source.id, command, onClose() {}, initialMode: 'view', routedTab: 'monthly' }));
  assert.match(html, /aria-label="지시사항 월별 실적관리"/);
  assert.match(html, /aria-label="실적 대상 월"/);
  assert.match(html, /aria-label="월별 실적 이력"/);
  assert.ok(componentRequire.cache[modulePath('directive-monthly')]);
});
