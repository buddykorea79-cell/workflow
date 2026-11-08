import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { executeCommand, getWorkspace } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-08T03:00:00Z');
function createTask(state: WorkspaceData, supportIds?: string[]) {
  executeCommand(state, 'u-jiho', {
    type: 'task.create', requestId: randomUUID(), expectedRevision: state.revision,
    payload: { title: '기본 절차 담당자 확인', description: '지원자 유무에 맞게 기본 절차를 생성합니다.', unitId: 'unit-meeting', primaryId: 'u-jiho', dueDate: '2026-11-30', frequency: 'once', ...(supportIds === undefined ? {} : { supportIds }) },
  }, now);
  return state.tasks[0];
}

test('task.create without support participants assigns default preparation to the owner', () => {
  for (const supportIds of [undefined, []]) {
    const state = createSeed(now), task = createTask(state, supportIds);
    assert.deepEqual(task.supportIds, []);
    assert.deepEqual(task.workflow.map(step => step.title), ['자료 준비', '내용 검증', '내부 검토', '최종 제출']);
    assert.deepEqual(task.workflow.map(step => step.role), ['primary', 'primary', 'reviewer', 'primary']);
    assert.ok(task.workflow.every(step => !step.done && step.output === '' && step.checklist.length === 0));
    const visible = getWorkspace(state, 'u-jiho', now).tasks.find(item => item.id === task.id)!;
    assert.equal(visible.workflow[0].role, 'primary');
    assert.equal(visible.reviewerId, 'u-head');
  }
});

test('task.create with a real support participant retains the support preparation step', () => {
  const state = createSeed(now), task = createTask(state, ['u-seoyeon']);
  assert.deepEqual(task.supportIds, ['u-seoyeon']);
  assert.deepEqual(task.workflow.map(step => step.role), ['support', 'primary', 'reviewer', 'primary']);
  assert.ok(task.workflow.every(step => !step.done && step.output === '' && step.checklist.length === 0));
  const visible = getWorkspace(state, 'u-seoyeon', now).tasks.find(item => item.id === task.id)!;
  assert.equal(visible.workflow[0].role, 'support');
  assert.deepEqual(visible.supportIds, ['u-seoyeon']);
});

test('new task defaults do not rewrite historical seed roles, outputs, checks, snapshots, or executions', () => {
  const state = createSeed(now), historical = state.tasks.find(task => task.id === 'task-data')!;
  assert.deepEqual(historical.supportIds, []);
  assert.equal(historical.workflow[0].role, 'support');
  assert.ok(historical.workflow[0].output && historical.workflow[0].checklist.length);
  const before = structuredClone({ task: historical, runs: state.runs.filter(run => run.taskId === historical.id) });
  createTask(state);
  createTask(state, ['u-seoyeon']);
  assert.deepEqual({ task: state.tasks.find(task => task.id === historical.id), runs: state.runs.filter(run => run.taskId === historical.id) }, before);
});
