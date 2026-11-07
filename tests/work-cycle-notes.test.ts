import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { taskCycleState } from '../src/lib/work-cycles';
import type { WorkspaceData } from '../src/lib/types';

const componentRequire = createRequire(path.resolve('tests/work-cycle-notes.test.ts'));
const previousCssLoader = componentRequire.extensions['.css'];
let cyclesUi: typeof import('../src/components/work-cycles');
try {
  componentRequire.extensions['.css'] = () => undefined;
  cyclesUi = componentRequire('../src/components/work-cycles');
} finally {
  if (previousCssLoader) componentRequire.extensions['.css'] = previousCssLoader;
  else delete componentRequire.extensions['.css'];
}

const now = new Date('2026-11-07T03:00:00Z');
const taskId = 'task-data', owner = 'u-support-member', head = 'u-support-head', manager = 'u-doyun';
const editorPlaceholder = '진행 중 확인한 사항이나 완료 후 보완할 내용을 적어 주세요.';
function fixture() {
  const state = createSeed(now);
  const task = state.tasks.find(item => item.id === taskId)!;
  const run = taskCycleState(state, task).latest!;
  run.supportIds = [];
  run.notes = [{ id: 'existing-note', authorId: owner, body: '현재 회차에서 확인한 기존 메모', createdAt: now.toISOString(), stepId: run.steps[0].stepId }];
  return { state, task, run };
}
function render(state: WorkspaceData, actor = owner) {
  const workspace = getWorkspace(state, actor, now);
  const task = workspace.tasks.find(item => item.id === taskId)!;
  return renderToStaticMarkup(createElement(cyclesUi.WorkCycles, { workspace, task, command: async () => true, dirty: false }));
}
function note(state: WorkspaceData, actor: string, runId: string, stepId: string) {
  executeCommand(state, actor, { type: 'run.note', payload: { runId, stepId, body: '완료 후 확인한 정정 사항' }, expectedRevision: state.revision, requestId: randomUUID() }, now);
}

test('current cycle renders saved notes with author, timestamp and related procedure', () => {
  const { state, run } = fixture();
  const html = render(state);
  assert.ok(html.includes('현재 회차에서 확인한 기존 메모'));
  assert.ok(html.includes('송주무관'));
  assert.ok(html.includes(`dateTime="${now.toISOString()}"`));
  assert.ok(html.includes(run.steps[0].title));
  assert.ok(html.includes(editorPlaceholder));
});

test('completed-cycle corrections are appended without changing completed execution records', () => {
  const { state, run } = fixture();
  run.status = 'completed'; run.completedAt = now.toISOString(); run.cycleManaged = true;
  for (const step of run.steps) { step.status = 'completed'; step.output = '보존할 원래 수행 결과'; step.checklist.forEach(check => { check.done = true; }); }
  const before = structuredClone({ steps: run.steps, workflowSnapshot: run.workflowSnapshot, completedAt: run.completedAt, status: run.status });
  assert.ok(render(state).includes(editorPlaceholder));
  note(state, owner, run.id, run.steps[0].stepId);
  assert.ok(render(state).includes('완료 후 확인한 정정 사항'));
  assert.deepEqual({ steps: run.steps, workflowSnapshot: run.workflowSnapshot, completedAt: run.completedAt, status: run.status }, before);
});

test('note form matches writer permissions, including an explicit active note delegation', () => {
  const { state, task, run } = fixture();
  assert.equal(render(state, manager).includes(editorPlaceholder), false);
  assert.throws(() => note(state, manager, run.id, run.steps[0].stepId), error => error instanceof DomainError && error.code === 'EXECUTION_DENIED');
  assert.ok(render(state, head).includes(editorPlaceholder));
  state.delegations.push({ id: 'note-delegation', taskId, fromId: task.primaryId, toId: manager, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-30T00:00:00Z', actions: ['run.check'], approvedBy: head, status: 'approved' });
  assert.equal(render(state, manager).includes(editorPlaceholder), false);
  state.delegations.at(-1)!.actions.push('run.note');
  assert.ok(render(state, manager).includes(editorPlaceholder));
  note(state, manager, run.id, run.steps[0].stepId);
  assert.equal(run.notes.at(-1)!.authorId, manager);
});
