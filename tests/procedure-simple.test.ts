import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultWorkflow, commonWorkflow, createRun } from '../src/lib/seed-helpers';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import { generateProcedureDraft } from '../src/lib/procedure-draft';
import { taskProcedureParticipants } from '../src/lib/procedure-participants';

const componentRequire = createRequire(path.resolve('tests/procedure-simple.test.ts'));
const previousCssLoader = componentRequire.extensions['.css'];
let editorUi: typeof import('../src/components/procedure-editor');
try {
  componentRequire.extensions['.css'] = () => undefined;
  editorUi = componentRequire('../src/components/procedure-editor');
} finally {
  if (previousCssLoader) componentRequire.extensions['.css'] = previousCssLoader;
  else delete componentRequire.extensions['.css'];
}

test('new default and common procedures do not create unassigned support or hidden completion gates', () => {
  for (const workflow of [defaultWorkflow(), commonWorkflow(['자료 취합', '내용 작성'])]) {
    assert.ok(workflow.every(step => step.role !== 'support' && step.output === '' && step.checklist.length === 0));
    assert.ok(workflow.every(step => step.description.trim()));
    assert.ok(workflow.some(step => step.role === 'reviewer' && step.required));
  }
  assert.equal(defaultWorkflow({ hasSupport: true })[0].role, 'support');
  assert.equal(commonWorkflow(['자료 취합'], { hasSupport: true })[0].role, 'support');
});

test('rule-generated collection steps use the owner unless a support participant exists', () => {
  const source = { title: '수행 방법', type: 'guideline' as const, text: '1. 부서별 자료를 취합합니다.\n2. 결과를 검토합니다.' };
  const solo = generateProcedureDraft(source, 'solo');
  assert.equal(solo.steps[0].role, 'primary');
  assert.equal(generateProcedureDraft(source, 'team', { hasSupport: true }).steps[0].role, 'support');
  assert.ok(solo.steps.every(step => step.checklist.length === 0 && step.output === ''));
});

test('existing historical definitions retain their output and checklist when a run is created', () => {
  const state = createSeed(new Date('2026-11-07T03:00:00Z'));
  const task = state.tasks.find(item => item.id === 'task-data')!;
  const before = structuredClone(task);
  const run = createRun(task, '2027년 상반기');
  assert.ok(run.workflowSnapshot!.some(step => step.output && step.checklist.length));
  assert.ok(run.steps.every(step => step.checklist.length > 0));
  assert.deepEqual(task, before);
});

test('procedure editor disables unchanged saves and unassigned support while preserving old selections', () => {
  const state = createSeed(new Date('2026-11-07T03:00:00Z'));
  const workspace = getWorkspace(state, 'u-support-member', new Date('2026-11-07T03:00:00Z'));
  const task = workspace.tasks.find(item => item.id === 'task-data')!;
  const workflow = defaultWorkflow({ legacy: true }).map(step => ({ ...step, done: false }));
  const before = structuredClone(workflow);
  const render = (hasChanges: boolean, hasSupport = false) => renderToStaticMarkup(createElement(editorUi.ProcedureEditor, {
    workspace, taskId: task.id, workflow, originalWorkflow: workflow, participants: taskProcedureParticipants(workspace, task),
    command: async () => true, editable: true, busy: false, hasChanges, hasSupport, diagramChanged: hasChanges, redrawKey: 0,
    onApply: async () => true, onChange: () => undefined, onRemove: () => undefined, onMove: () => undefined, onAdd: () => undefined,
  }));
  const saved = render(false), edited = render(true);
  assert.match(saved, /<button[^>]*class="btn btn-accent(?: |")[^>]*disabled=""/);
  assert.doesNotMatch(edited, /<button[^>]*class="btn btn-accent(?: |")[^>]*disabled=""/);
  assert.match(edited, /<option value="support" disabled="" selected=""/);
  assert.doesNotMatch(render(true, true), /<option value="support" disabled=""/);
  assert.deepEqual(workflow, before);
});

test('missing support explains role selection and only offers shortcuts to editable roles', () => {
  const state = createSeed(new Date('2026-11-07T03:00:00Z'));
  const workspace = getWorkspace(state, 'u-support-member', new Date('2026-11-07T03:00:00Z'));
  const task = workspace.tasks.find(item => item.id === 'task-data')!;
  const workflow = defaultWorkflow({ legacy: true }).map(step => ({ ...step, done: false }));
  const props: Parameters<typeof editorUi.ProcedureEditor>[0] = {
    workspace, taskId: task.id, workflow, originalWorkflow: workflow, participants: taskProcedureParticipants(workspace, task),
    command: async () => true, editable: true, busy: false, hasSupport: false, diagramChanged: false, redrawKey: 0,
    onApply: async () => true, onChange: () => undefined, onRemove: () => undefined, onMove: () => undefined, onAdd: () => undefined,
  };
  const render = (overrides: Partial<typeof props> = {}) => renderToStaticMarkup(createElement(editorUi.ProcedureEditor, { ...props, ...overrides }));
  const editable = render();
  assert.match(editable, /<span[^>]*badge[^>]*>지원자 미지정<\/span>/);
  assert.match(editable, /아래 ‘누가’에서 담당자 역할로 바꾼 뒤 수정사항을 저장/);
  assert.match(editable, /<button[^>]*aria-label="자료 준비 담당자 지정"/);
  const warningId = editable.match(/class="pe-participant-warning" id="([^"]+)"/)?.[1];
  assert.ok(warningId);
  assert.ok(editable.includes(`aria-describedby="${warningId}"`));
  assert.match(render({ busy: true }), /<button[^>]*aria-label="자료 준비 담당자 지정"/);

  const viewing = render({ editable: false, onStartEditing: () => undefined });
  assert.match(viewing, />업무 기준 수정<\/button>/);
  assert.doesNotMatch(viewing, /aria-label="자료 준비 담당자 지정"/);
  const noPermission = render({ editable: false });
  assert.match(noPermission, /업무 담당자에게 담당 역할 수정을 요청/);
  assert.doesNotMatch(noPermission, />업무 기준 수정<\/button>/);

  const common = render({ requiredStepTitles: ['자료 준비'] });
  assert.match(common, /공통업무 담당자에게 절차 기준 확인을 요청/);
  assert.doesNotMatch(common, /aria-label="자료 준비 담당자 지정"/);
  const completed = render({ originalWorkflow: workflow.map(step => ({ ...step, done: step.role === 'support' })) });
  assert.match(completed, /완료된 절차의 담당 역할은 기록으로 보존/);
  assert.doesNotMatch(completed, /aria-label="자료 준비 담당자 지정"/);
  assert.doesNotMatch(render({ hasSupport: true }), /class="pe-participant-warning"/);
});

test('missing reviewer follows automatic department-head assignment without offering arbitrary selection', () => {
  const state = createSeed(new Date('2026-11-07T03:00:00Z'));
  const workspace = getWorkspace(state, 'u-support-member', new Date('2026-11-07T03:00:00Z'));
  const task = workspace.tasks.find(item => item.id === 'task-data')!;
  const workflow = defaultWorkflow().map(step => ({ ...step, done: false }));
  const props: Parameters<typeof editorUi.ProcedureEditor>[0] = {
    workspace, taskId: task.id, workflow, originalWorkflow: workflow, participants: { ...taskProcedureParticipants(workspace, task), reviewer: '검토자 미지정' },
    command: async () => true, editable: true, busy: false, hasReviewer: false, diagramChanged: false, redrawKey: 0,
    onOpenOrganization: () => undefined,
    onApply: async () => true, onChange: () => undefined, onRemove: () => undefined, onMove: () => undefined, onAdd: () => undefined,
  };
  const member = renderToStaticMarkup(createElement(editorUi.ProcedureEditor, props));
  assert.match(member, /<span[^>]*badge[^>]*>검토자 미지정<\/span>/);
  assert.match(member, /관리자에게 소유 부서의 부서장 등록·확인을 요청/);
  assert.doesNotMatch(member, />조직 · 구성원 확인<\/button>/);
  assert.doesNotMatch(member, /aria-label="내부 검토 담당자 지정"/);
  const admin = renderToStaticMarkup(createElement(editorUi.ProcedureEditor, { ...props, workspace: { ...workspace, currentUser: { ...workspace.currentUser, role: 'admin' } } }));
  assert.match(admin, /소유 부서의 활성 부서장으로 자동 지정/);
  assert.match(admin, />조직 · 구성원 확인<\/button>/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(editorUi.ProcedureEditor, { ...props, hasReviewer: true })), /class="pe-participant-warning"/);
});

test('review policy allows removing the last optional reviewer but retains common and completed protections', () => {
  const state = createSeed(new Date('2026-11-07T03:00:00Z'));
  const workspace = getWorkspace(state, 'u-support-member', new Date('2026-11-07T03:00:00Z'));
  const task = workspace.tasks.find(item => item.id === 'task-data')!;
  const workflow = defaultWorkflow().map(step => ({ ...step, done: false }));
  const props: Parameters<typeof editorUi.ProcedureEditor>[0] = {
    workspace, taskId: task.id, workflow, originalWorkflow: workflow, participants: taskProcedureParticipants(workspace, task),
    command: async () => true, editable: true, busy: false, hasSupport: false, diagramChanged: false, redrawKey: 0,
    onApply: async () => true, onChange: () => undefined, onRemove: () => undefined, onMove: () => undefined, onAdd: () => undefined,
  };
  const render = (overrides: Partial<typeof props>) => renderToStaticMarkup(createElement(editorUi.ProcedureEditor, { ...props, ...overrides }));
  assert.doesNotMatch(render({ reviewRequired: true }), /aria-label="내부 검토 절차 삭제"/);
  assert.match(render({ reviewRequired: true }), /마지막 검토 단계입니다/);
  assert.match(render({ reviewRequired: false }), /aria-label="내부 검토 절차 삭제"/);
  assert.doesNotMatch(render({ reviewRequired: false, requiredStepTitles: ['내부 검토'] }), /aria-label="내부 검토 절차 삭제"/);
  assert.doesNotMatch(render({ reviewRequired: false, workflow: workflow.map(step => ({ ...step, done: step.role === 'reviewer' })), originalWorkflow: workflow.map(step => ({ ...step, done: step.role === 'reviewer' })) }), /aria-label="내부 검토 절차 삭제"/);
});

test('prerequisite controls expose parallel execution and disable choices that would create a cycle', () => {
  const state = createSeed(new Date('2026-11-07T03:00:00Z'));
  const workspace = getWorkspace(state, 'u-support-member', new Date('2026-11-07T03:00:00Z'));
  const task = workspace.tasks.find(item => item.id === 'task-data')!;
  const workflow = defaultWorkflow().map(step => ({ ...step, done: false }));
  const html = renderToStaticMarkup(createElement(editorUi.ProcedureEditor, {
    workspace, taskId: task.id, workflow, originalWorkflow: workflow, participants: taskProcedureParticipants(workspace, task),
    command: async () => true, editable: true, busy: false, diagramChanged: false, redrawKey: 0,
    onApply: async () => true, onChange: () => undefined, onRemove: () => undefined, onMove: () => undefined, onAdd: () => undefined,
  }));
  assert.match(html, /선택하지 않으면 다른 절차와 병행할 수 있습니다/);
  assert.match(html, /aria-label="자료 준비 선행: 내부 검토" disabled=""/);
  assert.match(html, /aria-label="내용 검증 선행: 자료 준비" checked=""/);
  assert.doesNotMatch(html, /aria-label="자료 준비 선행: 자료 준비"/);
});
