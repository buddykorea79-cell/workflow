import { approveLatestCommon } from './common-approval-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-10-31T03:00:00Z');
function dispatch(data: WorkspaceData, userId: string, type: string, payload: Record<string, unknown>) {
  const candidate = structuredClone(data);
  executeCommand(candidate, userId, { type, payload, expectedRevision: data.revision, requestId: randomUUID() }, now);
  Object.assign(data, candidate);
}
function rejects(code: string, action: () => void) {
  assert.throws(action, error => error instanceof DomainError && error.code === code);
}
const findTask = (data: WorkspaceData, id: string) => data.tasks.find(task => task.id === id)!;

test('personal unit and rich task detail persist together without granting another member edit access', () => {
  const data = createSeed(now);
  dispatch(data, 'u-jiho', 'unit.create', { title: '개인 예산 운영', description: '개인 업무의 예산과 절차를 관리합니다.', ownerId: 'u-jiho' });
  const unit = data.units.at(-1)!;
  assert.equal(unit.ownerId, 'u-jiho');
  dispatch(data, 'u-jiho', 'task.create', { title: '예산 운영 자료 작성', description: '운영 자료를 작성합니다.', unitId: unit.id, primaryId: 'u-jiho', reviewerId: 'u-head', dueDate: '2026-11-30', frequency: 'once', budget: 1200000 });
  const taskId = data.tasks[0].id;
  const plan = structuredClone(findTask(data, taskId).workflow);
  plan[0].startDate = '2026-11-01'; plan[0].dueDate = '2026-11-05';
  dispatch(data, 'u-jiho', 'task.configure', {
    taskId, description: '집행 현황과 관련 근거를 함께 정리합니다.', budget: 1800000,
    expenses: [{ id: 'expense-example', date: '2026-11-02', description: '인쇄비', amount: 150000 }],
    references: [
      { id: 'reference-law', type: 'law', title: '가상 법령', content: '가상 제1조의 적용 내용을 검토합니다.', url: 'https://example.com/law' },
      { id: 'reference-agenda', type: 'national_agenda', title: '가상 국정과제', content: '행정서비스 개선을 지원합니다.' },
    ], workflow: plan,
  });
  const saved = findTask(data, taskId);
  assert.equal(saved.budget, 1800000);
  assert.equal(saved.expenses?.[0].amount, 150000);
  assert.equal(saved.references?.length, 2);
  assert.equal(saved.workflow[0].startDate, '2026-11-01');
  assert.equal(saved.versions.at(-1)?.budget, 1800000);
  assert.equal(saved.versions[0].budget, 1200000);
  const before = JSON.stringify(data);
  rejects('TASK_ACCESS_DENIED', () => dispatch(data, 'u-seoyeon', 'task.configure', { taskId, budget: 0 }));
  assert.equal(JSON.stringify(data), before);
});

test('schedule changes accept an omitted boundary and reject impossible or reversed dates atomically', () => {
  const data = createSeed(now);
  let plan = structuredClone(findTask(data, 'task-plan').workflow);
  delete plan[0].startDate;
  plan[0].dueDate = '2026-11-06';
  dispatch(data, 'u-minseo', 'task.configure', { taskId: 'task-plan', workflow: plan });
  assert.equal(findTask(data, 'task-plan').workflow[0].startDate, undefined);
  assert.equal(findTask(data, 'task-plan').workflow[0].dueDate, '2026-11-06');
  const before = JSON.stringify(data);
  plan = structuredClone(findTask(data, 'task-plan').workflow);
  plan[1].startDate = '2026-11-10'; plan[1].dueDate = '2026-11-09';
  rejects('SCHEDULE_ORDER', () => dispatch(data, 'u-minseo', 'task.configure', { taskId: 'task-plan', workflow: plan }));
  assert.equal(JSON.stringify(data), before);
  plan[1].startDate = '2026-02-30'; plan[1].dueDate = '2026-11-09';
  rejects('VALIDATION_ERROR', () => dispatch(data, 'u-minseo', 'task.configure', { taskId: 'task-plan', workflow: plan }));
  assert.equal(JSON.stringify(data), before);
});

test('replanning a pending procedure keeps active execution metadata consistent and preserves completed history', () => {
  const data = createSeed(now);
  const original = structuredClone(findTask(data, 'task-plan').versions[0]);
  const plan = structuredClone(findTask(data, 'task-plan').workflow);
  plan[1].title = '요구자료 대조';
  plan[1].role = 'support';
  plan[1].checklist = ['새 검증 기준 확인'];
  dispatch(data, 'u-minseo', 'task.configure', { taskId: 'task-plan', workflow: plan });
  const activeRun = data.runs.find(run => run.taskId === 'task-plan')!;
  const execution = activeRun.steps.find(step => step.stepId === plan[1].id)!;
  assert.equal(execution.title, '요구자료 대조');
  assert.equal(execution.role, 'support');
  assert.deepEqual(execution.checklist.map(item => item.title), ['새 검증 기준 확인']);
  assert.equal(activeRun.definitionVersion, findTask(data, 'task-plan').version);
  assert.deepEqual(findTask(data, 'task-plan').versions[0], original);
  const completedPlan = structuredClone(findTask(data, 'task-plan').workflow);
  completedPlan[0].title = '완료 후 이름 변경';
  rejects('COMPLETED_STEP_LOCKED', () => dispatch(data, 'u-minseo', 'task.configure', { taskId: 'task-plan', workflow: completedPlan }));
});

test('adding work to a submitted common task immediately reopens its aggregate progress', () => {
  const data = createSeed(now);
  dispatch(data, 'u-head', 'task.setProgress', { taskId: 'task-budget', stepId: 's3', done: true });
  dispatch(data, 'u-minseo', 'task.setProgress', { taskId: 'task-budget', stepId: 's4', done: true });
  assert.equal(data.commonTasks.find(item => item.id === 'common-budget')?.distributions[0].status, 'submitted');
  const plan = structuredClone(findTask(data, 'task-budget').workflow);
  plan.push({ id: 'followup', title: '추가 증빙 제출', role: 'primary', description: '보완된 증빙을 제출합니다.', output: '보완 증빙', required: true, dependsOn: ['s4'], checklist: [], dueDate: '2026-11-30' });
  dispatch(data, 'u-minseo', 'task.configure', { taskId: 'task-budget', workflow: plan });
  const aggregate = getWorkspace(data, 'u-admin', now).commonTasks.find(item => item.id === 'common-budget')!.distributions[0];
  assert.equal(aggregate.progress, 80);
  assert.equal(aggregate.status, 'registered');
  dispatch(data, 'u-minseo', 'task.setProgress', { taskId: 'task-budget', stepId: 'followup', done: true });
  assert.equal(getWorkspace(data, 'u-admin', now).commonTasks.find(item => item.id === 'common-budget')!.distributions[0].progress, 100);
});

test('step completion targets the newest active execution and only the reviewer can finish a review step', () => {
  const data = createSeed(now);
  const originalRun = data.runs.find(run => run.taskId === 'task-budget')!;
  const latestRun = structuredClone(originalRun);
  latestRun.id = 'newer-budget-run'; latestRun.startedAt = '2026-11-01T00:00:00.000Z';
  data.runs.unshift(latestRun);
  rejects('EXECUTION_DENIED', () => dispatch(data, 'u-minseo', 'task.setProgress', { taskId: 'task-budget', stepId: 's3', done: true }));
  dispatch(data, 'u-head', 'task.setProgress', { taskId: 'task-budget', stepId: 's3', done: true });
  assert.equal(data.runs.find(run => run.id === latestRun.id)!.steps.find(step => step.stepId === 's3')!.status, 'completed');
  assert.notEqual(data.runs.find(run => run.id === originalRun.id)!.steps.find(step => step.stepId === 's3')!.status, 'completed');
  rejects('DEPENDENT_COMPLETED', () => dispatch(data, 'u-minseo', 'task.setProgress', { taskId: 'task-budget', stepId: 's2', done: false }));
});

test('a department directive stays uneditable until the assignee registers the same generated task', () => {
  const data = createSeed(now);
  dispatch(data, 'u-minseo', 'common.create', { title: '시연 지시사항', description: '담당 부서에서 후속 업무를 수행합니다.', dueDate: '2026-11-30', frequency: 'once', requiredSteps: ['자료 정리', '결과 검토'], departmentIds: ['dept-plan'], kind: 'directive', directiveIssuer: 'bureau_head', instructedOn: '2026-10-01' }); approveLatestCommon(data, now);
  const common = data.commonTasks[0]; const distribution = common.distributions[0]; const taskId = distribution.taskId!;
  assert.ok(taskId);
  rejects('REGISTRATION_REQUIRED', () => dispatch(data, 'u-minseo', 'task.configure', { taskId, budget: 1000 }));
  rejects('REGISTRATION_REQUIRED', () => dispatch(data, 'u-minseo', 'task.update', { taskId, description: '배정 단계를 건너뛰는 수정' }));
  rejects('REGISTRATION_REQUIRED', () => dispatch(data, 'u-minseo', 'task.submit', { taskId }));
  assert.equal(getWorkspace(data, 'u-jiho', now).tasks.some(task => task.id === taskId), false);
  dispatch(data, 'u-minseo', 'common.assignTeam', { commonId: common.id, distributionId: distribution.id, team: '예산팀', leadId: 'u-budget-lead' });
  dispatch(data, 'u-budget-lead', 'common.assignPerson', { commonId: common.id, distributionId: distribution.id, assigneeId: 'u-jiho' });
  assert.equal(getWorkspace(data, 'u-jiho', now).tasks.some(task => task.id === taskId), false);
  dispatch(data, 'u-jiho', 'common.register', { commonId: common.id, distributionId: distribution.id, unitId: 'unit-meeting' });
  assert.equal(findTask(data, taskId).primaryId, 'u-jiho');
  assert.equal(findTask(data, taskId).unitId, 'unit-meeting');
  assert.equal(findTask(data, taskId).references?.[0].type, 'directive');
  dispatch(data, 'u-jiho', 'task.configure', { taskId, budget: 1000 });
  assert.equal(findTask(data, taskId).budget, 1000);
});

test('legacy draft updates cannot forge workflow completion or bypass the assigned reviewer', () => {
  const data = createSeed(now);
  dispatch(data, 'u-jiho', 'task.create', { title: '검토 권한 확인', description: '담당자가 검토 완료를 위조할 수 없어야 합니다.', unitId: 'unit-meeting', primaryId: 'u-jiho', reviewerId: 'u-head', dueDate: '2026-11-30', frequency: 'once' });
  const taskId = data.tasks[0].id;
  const spoofed = findTask(data, taskId).workflow.map(step => ({ ...step, done: true }));
  dispatch(data, 'u-jiho', 'task.update', { taskId, workflow: spoofed });
  assert.ok(findTask(data, taskId).workflow.every(step => step.done === false));
  const reviewerStep = findTask(data, taskId).workflow.find(step => step.role === 'reviewer')!;
  rejects('EXECUTION_DENIED', () => dispatch(data, 'u-jiho', 'task.setProgress', { taskId, stepId: reviewerStep.id, done: true }));
});

test('personal metadata can be corrected with history while common metadata remains centrally controlled', () => {
  const data = createSeed(now);
  const original = structuredClone(findTask(data, 'task-plan').versions[0]);
  dispatch(data, 'u-minseo', 'task.configure', { taskId: 'task-plan', title: '주요업무 추진계획 보완', dueDate: '2026-12-18', frequency: 'half_yearly' });
  const updated = findTask(data, 'task-plan');
  assert.equal(updated.title, '주요업무 추진계획 보완');
  assert.equal(updated.dueDate, '2026-12-18');
  assert.equal(updated.frequency, 'half_yearly');
  assert.equal(updated.versions.at(-1)?.dueDate, '2026-12-18');
  assert.deepEqual(updated.versions[0], original);
  const activeRun = data.runs.find(run => run.taskId === updated.id && run.status !== 'completed')!;
  assert.equal(activeRun.dueDate, '2026-12-18');
  assert.ok(activeRun.title.startsWith('주요업무 추진계획 보완'));
  for (const change of [{ title: '공통 기준 우회' }, { dueDate: '2027-01-01' }, { frequency: 'once' }]) {
    rejects('COMMON_STANDARD_LOCKED', () => dispatch(data, 'u-minseo', 'task.configure', { taskId: 'task-budget', ...change }));
  }
  const common = findTask(data, 'task-budget');
  dispatch(data, 'u-minseo', 'task.configure', { taskId: common.id, title: common.title, dueDate: common.dueDate, frequency: common.frequency, description: '공통 기준을 유지하며 부서 설명을 보완합니다.' });
  assert.equal(findTask(data, common.id).title, common.title);
});
