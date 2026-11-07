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
  assert.match(saved, /<button[^>]*class="btn btn-accent[^>]*disabled=""/);
  assert.doesNotMatch(edited, /<button[^>]*class="btn btn-accent[^>]*disabled=""/);
  assert.match(edited, /<option value="support" disabled="" selected=""/);
  assert.doesNotMatch(render(true, true), /<option value="support" disabled=""/);
  assert.deepEqual(workflow, before);
});
