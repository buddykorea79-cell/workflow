import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, createSeed } from '../src/lib/seed';
import { commonDistributionStatus, taskExecution } from '../src/lib/common-status';
import { commonExecutionState, commonStageLabel, commonStageState, definitionLabel, definitionState, executionLabel, executionState, executionStatus, nextExecutionStep, statusTerms } from '../src/lib/status-labels';
import type { Run, RunStatus, Task, WorkflowStep } from '../src/lib/types';

const now = new Date('2026-11-07T03:00:00Z');
const step = (id: string, role: WorkflowStep['role'], done = false, dependsOn: string[] = []): WorkflowStep => ({ id, role, title: id, description: `${id} 처리`, output: '', required: true, checklist: [], dependsOn, done });
function fixture() {
  const task: Task = { ...createSeed(now).tasks[0], workflow: [step('prepare', 'primary'), step('review', 'reviewer', false, ['prepare'])], versions: [] };
  const run = createRun(task, '2026-H2', now.toISOString());
  run.workflowSnapshot = structuredClone(task.workflow);
  return { task, run };
}

test('execution labels and tones use the shared glossary', () => {
  const expected = { scheduled: ['시작 전', 'soft'], in_progress: ['진행 중', 'info'], review: ['검토 대기', 'info'], paused: ['일시 중지', 'warning'], completed: ['완료', 'success'] } as const;
  for (const status of Object.keys(expected) as RunStatus[]) {
    assert.equal(executionLabel(status), expected[status][0]);
    assert.deepEqual(executionState(status), { key: status, label: expected[status][0], tone: expected[status][1] });
  }
  const copy = executionState('scheduled'); copy.label = '표시값 변경';
  assert.equal(executionLabel('scheduled'), '시작 전');
});

test('executionStatus applies the same progress, review and pause decisions with or without a run', () => {
  const { task, run } = fixture();
  const cases: { status?: RunStatus; progress: number; expected: RunStatus }[] = [
    { progress: 0, expected: 'scheduled' }, { progress: 50, expected: 'in_progress' }, { progress: 100, expected: 'completed' },
    { status: 'scheduled', progress: 0, expected: 'scheduled' }, { status: 'scheduled', progress: 50, expected: 'in_progress' }, { status: 'scheduled', progress: 100, expected: 'completed' },
    { status: 'in_progress', progress: 0, expected: 'in_progress' }, { status: 'in_progress', progress: 50, expected: 'in_progress' }, { status: 'in_progress', progress: 100, expected: 'completed' },
    { status: 'review', progress: 0, expected: 'review' }, { status: 'review', progress: 50, expected: 'review' }, { status: 'review', progress: 100, expected: 'completed' },
    { status: 'paused', progress: 0, expected: 'paused' }, { status: 'paused', progress: 50, expected: 'paused' }, { status: 'paused', progress: 100, expected: 'paused' },
  ];
  for (const item of cases) assert.deepEqual(executionStatus(task, item.status ? { ...run, status: item.status } : undefined, item.progress, 'primary'), executionState(item.expected), JSON.stringify(item));
  assert.equal(executionStatus(task, { ...run, status: 'scheduled' }, 50, 'reviewer').key, 'review');
  assert.equal(executionStatus(task, undefined, 0, 'reviewer').key, 'scheduled');
});

test('dependency-aware next roles stay identical in task summaries and status badges', () => {
  const { task, run } = fixture();
  task.workflow = [step('review', 'reviewer', false, ['prepare']), step('prepare', 'primary', false, ['received']), step('received', 'primary', true)];
  task.versions = []; run.workflowSnapshot = structuredClone(task.workflow);
  run.steps = task.workflow.map(item => ({ id: `exec-${item.id}`, stepId: item.id, title: item.title, role: item.role, status: item.done ? 'completed' : 'pending', checklist: [] }));
  run.status = 'scheduled';
  // The editable definition can differ from this occurrence's preserved order.
  task.workflow[0].dependsOn = [];
  const before = structuredClone({ task, run });
  assert.equal(nextExecutionStep(task, run)?.id, 'prepare');
  const summary = taskExecution({ runs: [run] }, task);
  assert.equal(summary.nextStepId, 'prepare'); assert.equal(summary.nextRole, 'primary');
  assert.deepEqual(executionStatus(task, run, summary.progress), executionStatus(task, run, summary.progress, summary.nextRole));
  assert.equal(executionStatus(task, run, summary.progress).key, 'in_progress');
  assert.deepEqual({ task, run }, before);
  run.steps.find(item => item.stepId === 'prepare')!.status = 'completed';
  assert.equal(taskExecution({ runs: [run] }, task).nextRole, 'reviewer');
  assert.equal(executionStatus(task, run, 67).key, 'review');
});

test('definition labels remain explicitly separate from execution and common stages', () => {
  const { task } = fixture();
  const labels = { draft: '기준 작성 중', review: '기준 검토 중', confirmed: '기준 확정', revision: '기준 변경 중', archived: '보관' } as const;
  for (const [status, label] of Object.entries(labels)) {
    const typed = status as Task['status'];
    assert.equal(definitionLabel(typed), label); assert.equal(definitionState(typed).label, label);
    assert.equal(executionStatus({ ...task, status: typed }, undefined, 0).label, '시작 전');
  }
  assert.equal(commonStageLabel('in_progress'), '수행');
  assert.deepEqual(commonStageState('team_pending'), { key: 'team_pending', label: '팀 배정 대기', tone: 'info' });
  assert.equal(commonStageLabel('person_pending'), '개인 배정 대기');
  assert.equal(commonStageLabel('registration_pending'), '단위업무 등록 대기');
  assert.equal(commonStageState('completed').tone, 'success');
  assert.equal(statusTerms.assignmentManagement, '배정·승인 관리');
  assert.equal(statusTerms.overdue, '기한 경과'); assert.equal(statusTerms.cycleOverdue, '회차 일정 지남');
});

test('common execution retains its legacy not_started key with the same execution label and tone', () => {
  assert.deepEqual(commonExecutionState('not_started'), { key: 'not_started', label: '시작 전', tone: 'soft' });
  for (const key of ['in_progress', 'review', 'paused', 'completed'] as const) assert.deepEqual(commonExecutionState(key), executionState(key));
  assert.deepEqual(commonExecutionState('archived'), { key: 'archived', label: '보관', tone: 'outline' });
  assert.deepEqual(commonExecutionState('deleted'), { key: 'deleted', label: '삭제됨', tone: 'outline' });
});

test('common backend uses shared execution decisions while preserving assignment stages and lifecycle exclusions', () => {
  const state = createSeed(now), task = state.tasks.find(item => item.id === 'task-budget')!;
  const common = state.commonTasks.find(item => item.id === task.commonId)!;
  const distribution = common.distributions.find(item => item.taskId === task.id)!;
  const run = state.runs.find(item => item.taskId === task.id)!;
  run.steps.forEach(item => { item.status = 'pending'; }); run.status = 'scheduled';
  let summary = commonDistributionStatus(state, common, distribution, now);
  assert.equal(summary.stage, 'in_progress'); assert.equal(summary.executionStatus, 'not_started');
  run.steps[0].status = 'completed';
  summary = commonDistributionStatus(state, common, distribution, now);
  const execution = taskExecution(state, task);
  assert.equal(summary.executionStatus, executionStatus(task, run, execution.progress, execution.nextRole).key);
  run.steps.forEach(item => { item.status = 'completed'; }); run.status = 'paused';
  summary = commonDistributionStatus(state, common, distribution, now);
  assert.equal(summary.executionStatus, 'paused'); assert.equal(summary.stage, 'in_progress'); assert.equal(summary.overdue, false);
  task.deletedAt = now.toISOString();
  assert.equal(commonDistributionStatus(state, common, distribution, now).executionStatus, 'deleted');
});
