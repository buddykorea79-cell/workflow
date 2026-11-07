import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { currentPersonPerformances, eligibleScoreUnits, getUnitEvaluation, getUnitScorePlan, personUnitPerformanceSummary } from '../src/lib/unit-evaluation';
import type { Performance, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-10-31T09:00:00Z');
const personId = 'u-support-member';
const headId = 'u-support-head';
const period = '2026-H2';
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown> = {}) {
  const candidate = structuredClone(state); executeCommand(candidate, actor, { type, payload, requestId: randomUUID(), expectedRevision: state.revision }, now); Object.assign(state, candidate);
}
function rejects(code: string, action: () => void) { assert.throws(action, error => error instanceof DomainError && error.code === code); }
function weights(state: WorkspaceData, owner = personId) {
  const units = eligibleScoreUnits(state, owner);
  return units.map((unit, index) => ({ unitId: unit.id, maxScore: index === 0 ? 50 : 0 }));
}
function setPlan(state: WorkspaceData, owner = personId) { dispatch(state, owner, 'performance.setWeights', { period, allocations: weights(state, owner) }); return getUnitScorePlan(state, owner, period)!; }
function submitPerson(state: WorkspaceData, owner = personId) { dispatch(state, owner, 'performance.submitPerson', { period, planVersion: getUnitScorePlan(state, owner, period)!.version }); }
function addPerformance(state: WorkspaceData, owner = personId, unitId = eligibleScoreUnits(state, owner)[0].id, extra: Partial<Performance> = {}) {
  const task = state.tasks.find(item => item.primaryId === owner && item.unitId === unitId) ?? state.tasks.find(item => item.primaryId === owner)!;
  assert.ok(task, 'seed has assigned task');
  const performance: Performance = { id: randomUUID(), taskId: task.id, unitId, runId: '', title: '반기 성과', description: '검토할 상세 결과', evidence: '결과 보고서 01', authorId: owner, departmentId: state.users.find(user => user.id === owner)!.departmentId, period, status: 'review', createdAt: now.toISOString(), metricName: '처리 건수', value: 3, unit: '건', ...extra };
  state.performances.unshift(performance); return performance;
}
function evaluationInput(state: WorkspaceData, owner = personId) {
  const plan = getUnitScorePlan(state, owner, period)!;
  return { personId: owner, period, planVersion: plan.version, scores: plan.allocations.map(allocation => ({ unitId: allocation.unitId, score: allocation.maxScore ? 42.5 : 0, comment: '성과 근거를 확인했습니다.' })), comment: '반기 업무 수행 결과' };
}

test('unit evaluation: legacy stores remain unchanged on read; employee saves all owned units totaling exactly 50', () => {
  const state = createSeed(now); const before = JSON.stringify(state);
  assert.equal(getUnitScorePlan(state, personId, period), undefined); assert.equal(personUnitPerformanceSummary(state, personId, period).totalMaxScore, 0);
  getWorkspace(state, headId, now); assert.equal(JSON.stringify(state), before);
  const plan = setPlan(state); assert.equal(plan.version, 1); assert.equal(plan.allocations.reduce((sum, entry) => sum + entry.maxScore, 0), 50);
  assert.equal(plan.personId, personId); assert.equal(plan.departmentId, 'dept-support');
  assert.ok(plan.allocations.every(allocation => !!allocation.unitTitle));
  setPlan(state); assert.equal(getUnitScorePlan(state, personId, period)?.version, 2);
});

test('unit evaluation: invalid totals, duplicates, omitted units, foreign units and nonfinite scores fail atomically', () => {
  const state = createSeed(now); const allocations = weights(state); const before = JSON.stringify(state);
  rejects('SCORE_TOTAL_REQUIRED', () => dispatch(state, personId, 'performance.setWeights', { period, allocations: allocations.map(entry => ({ ...entry, maxScore: 0 })) }));
  rejects('DUPLICATE_SCORE_UNIT', () => dispatch(state, personId, 'performance.setWeights', { period, allocations: [allocations[0], allocations[0]] }));
  const foreign = state.units.find(unit => unit.ownerId !== personId && !unit.deletedAt)!;
  rejects('SCORE_OWNER_REQUIRED', () => dispatch(state, personId, 'performance.setWeights', { period, allocations: [{ unitId: foreign.id, maxScore: 50 }] }));
  rejects('VALIDATION_ERROR', () => dispatch(state, personId, 'performance.setWeights', { period, allocations: [{ ...allocations[0], maxScore: Number.NaN }] }));
  rejects('VALIDATION_ERROR', () => dispatch(state, personId, 'performance.setWeights', { period, allocations: [{ ...allocations[0], maxScore: 0.001 }] }));
  rejects('VALIDATION_ERROR', () => dispatch(state, personId, 'performance.setWeights', { period: '2026-H3', allocations }));
  rejects('SCORE_OWNER_REQUIRED', () => dispatch(state, personId, 'performance.setWeights', { personId: 'u-support-lead', period, allocations }));
  rejects('SCORE_OWNER_REQUIRED', () => dispatch(state, headId, 'performance.setWeights', { period, allocations }));
  if (allocations.length > 1) rejects('SCORE_UNITS_REQUIRED', () => dispatch(state, personId, 'performance.setWeights', { period, allocations: [allocations[0]] }));
  assert.equal(JSON.stringify(state), before);
});

test('unit evaluation: weights are independent of the department definition lock', () => {
  const state = createSeed(now); dispatch(state, headId, 'department.confirm');
  setPlan(state); assert.ok(getUnitScorePlan(state, personId, period));
});

test('unit evaluation: only own department head/admin evaluates, no self approval, plan required and versions checked', () => {
  const state = createSeed(now); addPerformance(state);
  rejects('SCORE_PLAN_REQUIRED', () => dispatch(state, headId, 'performance.evaluatePerson', { personId, period, planVersion: 1, scores: [{ unitId: weights(state)[0].unitId, score: 1 }] }));
  setPlan(state); const input = evaluationInput(state);
  for (const actor of [personId, 'u-support-lead', 'u-doyun', 'u-head']) rejects('HEAD_EVALUATION_REQUIRED', () => dispatch(state, actor, 'performance.evaluatePerson', input));
  rejects('SCORE_PLAN_CHANGED', () => dispatch(state, headId, 'performance.evaluatePerson', { ...input, planVersion: 999 }));
  rejects('PERFORMANCE_NOT_SUBMITTED', () => dispatch(state, headId, 'performance.evaluatePerson', input));
  submitPerson(state);
  // Administrators have broad scope, but may never evaluate their own records.
  state.unitScorePlans!.push({ ...getUnitScorePlan(state, personId, period)!, id: 'self-plan', personId: 'u-admin', departmentId: state.users.find(user => user.id === 'u-admin')!.departmentId });
  rejects('SELF_APPROVAL', () => dispatch(state, 'u-admin', 'performance.evaluatePerson', { ...input, personId: 'u-admin' }));
  dispatch(state, 'u-admin', 'performance.evaluatePerson', input); assert.equal(getUnitEvaluation(state, personId, period)?.evaluatedBy, 'u-admin');
});

test('unit evaluation: bounded per-unit scores, complete score set and submitted evidence are required', () => {
  const state = createSeed(now); const plan = setPlan(state); const input = evaluationInput(state);
  rejects('PERFORMANCE_REQUIRED', () => submitPerson(state));
  const record = addPerformance(state);
  submitPerson(state);
  rejects('SCORE_EXCEEDS_MAX', () => dispatch(state, headId, 'performance.evaluatePerson', { ...input, scores: input.scores.map((score, index) => ({ ...score, score: index === 0 ? 50 : 0 })).map((score, index) => ({ ...score, score: index === 0 ? 50 : 1 })) }));
  rejects('EVALUATION_UNITS_REQUIRED', () => dispatch(state, headId, 'performance.evaluatePerson', { ...input, scores: [input.scores[0], input.scores[0]] }));
  rejects('VALIDATION_ERROR', () => dispatch(state, headId, 'performance.evaluatePerson', { ...input, scores: input.scores.map(score => ({ ...score, score: Infinity })) }));
  state.performances.find(item => item.id === record.id)!.status = 'changes_requested'; rejects('PERFORMANCE_CHANGES_PENDING', () => dispatch(state, headId, 'performance.evaluatePerson', input));
  state.performances.find(item => item.id === record.id)!.status = 'review';
  const emptyUnit = plan.allocations.find(allocation => allocation.unitId !== record.unitId);
  if (emptyUnit) {
    dispatch(state, personId, 'performance.withdrawSubmission', { period });
    const reweighted = plan.allocations.map(allocation => ({ unitId: allocation.unitId, maxScore: allocation.unitId === record.unitId ? 25 : allocation.unitId === emptyUnit.unitId ? 25 : 0 }));
    dispatch(state, personId, 'performance.setWeights', { period, allocations: reweighted });
    rejects('UNIT_PERFORMANCE_REQUIRED', () => submitPerson(state));
  }
});

test('unit evaluation: submitted allocations survive later unit composition changes', () => {
  const state = createSeed(now); setPlan(state); addPerformance(state); submitPerson(state); const input = evaluationInput(state);
  state.units.push({ ...eligibleScoreUnits(state, personId)[0], id: 'new-unit', title: '새로 추가된 업무' });
  dispatch(state, headId, 'performance.evaluatePerson', input);
  assert.equal(getUnitEvaluation(state, personId, period)?.totalScore, 42.5);
});

test('unit evaluation: confirmed total and evidence snapshot survive later record or task changes; writes are frozen', () => {
  const state = createSeed(now); setPlan(state); const record = addPerformance(state); submitPerson(state); const input = evaluationInput(state);
  dispatch(state, headId, 'performance.evaluatePerson', input);
  const evaluation = getUnitEvaluation(state, personId, period)!; assert.equal(evaluation.totalScore, 42.5);
  assert.equal(state.performances.find(performance => performance.id === record.id)?.status, 'confirmed');
  const snapshot = structuredClone(evaluation.performanceSnapshot);
  state.performances.find(performance => performance.id === record.id)!.description = '이후 변경';
  state.tasks.find(task => task.id === record.taskId)!.title = '이후 업무명 변경';
  state.units.find(unit => unit.id === record.unitId)!.title = '이후 단위업무명 변경';
  assert.deepEqual(personUnitPerformanceSummary(state, personId, period).performances, snapshot);
  rejects('EVALUATION_CONFIRMED', () => dispatch(state, personId, 'performance.setWeights', { period, allocations: weights(state) }));
  rejects('EVALUATION_CONFIRMED', () => dispatch(state, headId, 'performance.evaluatePerson', input));
  const task = state.tasks.find(task => task.primaryId === personId && !task.deletedAt && task.status !== 'archived' && !task.commonId)!;
  rejects('EVALUATION_CONFIRMED', () => dispatch(state, personId, 'performance.submitHalf', { taskId: task.id, period, title: '새 성과', description: '추가 내용', evidence: '보고서' }));
});

test('unit evaluation: one current record per task, correction chains and other authors/periods never inflate totals', () => {
  const state = createSeed(now); state.performances = [];
  const old = addPerformance(state, personId, undefined, { id: 'old', value: 2, createdAt: '2026-10-01T00:00:00Z' });
  const correction = addPerformance(state, personId, undefined, { id: 'correction', previousId: old.id, value: 5 });
  addPerformance(state, personId, undefined, { id: 'legacy', period: undefined, value: 90 });
  addPerformance(state, personId, undefined, { id: 'other-period', period: '2026-H1', value: 90 });
  addPerformance(state, personId, undefined, { id: 'other-author', authorId: headId, value: 90 });
  assert.deepEqual(currentPersonPerformances(state, personId, period).map(item => item.id), [correction.id]);
  const summary = personUnitPerformanceSummary(state, personId, period); assert.equal(summary.performances.length, 1); assert.equal(summary.units.reduce((sum, unit) => sum + unit.performances.length, 0), 1);
});

test('unit evaluation: employee and manager only read their own plans/evaluations, head owns department and admin sees all', () => {
  const state = createSeed(now); setPlan(state); addPerformance(state); submitPerson(state); dispatch(state, headId, 'performance.evaluatePerson', evaluationInput(state));
  const plan = getUnitScorePlan(state, personId, period)!; const evaluation = getUnitEvaluation(state, personId, period)!;
  state.unitScorePlans!.push({ ...plan, id: 'foreign-plan', personId: 'u-member', departmentId: 'dept-policy' });
  state.unitEvaluations!.push({ ...evaluation, id: 'foreign-evaluation', personId: 'u-member', departmentId: 'dept-policy' });
  assert.equal(getWorkspace(state, personId, now).unitEvaluations?.length, 1);
  assert.equal(getWorkspace(state, 'u-doyun', now).unitEvaluations?.length, 0);
  assert.equal(getWorkspace(state, headId, now).unitScorePlans?.length, 1);
  assert.equal(getWorkspace(state, headId, now).unitEvaluations?.length, 1);
  assert.equal(getWorkspace(state, 'u-admin', now).unitEvaluations?.length, 2);
});

test('unit evaluation: half-year submission records its unit; legacy 100 point command cannot bypass a unit score plan', () => {
  const state = createSeed(now); state.performances = [];
  const task = state.tasks.find(task => task.primaryId === personId && !task.deletedAt && task.status !== 'archived' && !task.commonId)!;
  dispatch(state, personId, 'performance.submitHalf', { taskId: task.id, period, title: '새 성과', description: '상세 결과', evidence: '보고서' });
  const record = state.performances[0]; assert.equal(record.unitId, task.unitId);
  setPlan(state);
  rejects('UNIT_EVALUATION_REQUIRED', () => dispatch(state, headId, 'performance.evaluate', { performanceId: record.id, score: 100, comment: '이전 방식', decision: 'confirmed' }));
});

test('unit evaluation: a previous author keeps their submitted evidence after handover and a new owner submits independently', () => {
  const state = createSeed(now); state.performances = [];
  const task = state.tasks.find(task => task.primaryId === personId && !task.commonId)!;
  const record = addPerformance(state, personId, task.unitId, { taskId: task.id });
  // The original submitter no longer holds a task/run/support/delegated role.
  task.primaryId = 'u-support-lead'; task.supportIds = task.supportIds.filter(id => id !== personId);
  task.reviewerId = headId;
  state.runs.filter(run => run.taskId === task.id).forEach(run => { run.primaryId = 'u-support-lead'; run.supportIds = []; run.reviewerId = headId; });
  state.delegations = []; state.handovers = [];
  const ownWorkspace = getWorkspace(state, personId, now);
  assert.ok(!ownWorkspace.tasks.some(item => item.id === task.id));
  assert.ok(ownWorkspace.performances.some(item => item.id === record.id));
  dispatch(state, 'u-support-lead', 'performance.submitHalf', { taskId: task.id, period, title: '인수 후 담당 성과', description: '인수 후 처리 결과', evidence: '별도 결과보고서' });
  assert.equal(state.performances.filter(item => item.taskId === task.id && item.period === period).length, 2);
  assert.equal(currentPersonPerformances(state, personId, period).length, 1);
  assert.equal(currentPersonPerformances(state, 'u-support-lead', period).length, 1);
});

test('unit evaluation: old unit evidence stays visible as unscored reference after evaluation', () => {
  const state = createSeed(now); state.performances = [];
  setPlan(state); addPerformance(state);
  const otherTask = state.tasks.find(task => task.primaryId === personId && task.id !== state.performances[0].taskId)!;
  assert.ok(otherTask);
  const old = addPerformance(state, personId, 'old-deleted-unit', { taskId: otherTask.id, id: 'previous-unit-evidence', description: '이전 단위업무 성과' });
  submitPerson(state);
  dispatch(state, headId, 'performance.evaluatePerson', evaluationInput(state));
  const summary = personUnitPerformanceSummary(state, personId, period);
  assert.ok(summary.performances.some(item => item.id === old.id));
  const previousUnit = summary.units.find(unit => unit.unitId === 'old-deleted-unit')!;
  assert.equal(previousUnit.maxScore, undefined); assert.equal(previousUnit.performances[0].description, old.description);
  assert.equal(summary.totalMaxScore, 50); assert.equal(summary.totalScore, 42.5);
});

test('unit evaluation: head retains own-department historical evidence without access to the transferred task', () => {
  const state = createSeed(now); state.performances = [];
  const task = state.tasks.find(task => task.primaryId === personId && !task.commonId)!;
  const record = addPerformance(state, personId, task.unitId, { taskId: task.id });
  const foreignHead = state.users.find(user => user.role === 'head' && user.departmentId !== 'dept-support')!;
  // Simulate a later transfer: the new department can see the task, but not the former department's employee evaluation evidence.
  task.departmentId = foreignHead.departmentId; task.primaryId = foreignHead.id; task.reviewerId = foreignHead.id; task.supportIds = [];
  task.unitId = state.units.find(unit => unit.departmentId === foreignHead.departmentId)!.id;
  state.runs = state.runs.filter(run => run.taskId !== task.id);
  state.handovers = []; state.delegations = [];
  const ownHeadView = getWorkspace(state, headId, now);
  assert.ok(!ownHeadView.tasks.some(item => item.id === task.id));
  assert.ok(ownHeadView.performances.some(item => item.id === record.id));
  const foreignHeadView = getWorkspace(state, foreignHead.id, now);
  assert.ok(foreignHeadView.tasks.some(item => item.id === task.id));
  assert.ok(!foreignHeadView.performances.some(item => item.id === record.id));
  assert.ok(getWorkspace(state, 'u-admin', now).performances.some(item => item.id === record.id));
  assert.equal(currentPersonPerformances(ownHeadView, personId, period)[0].id, record.id);
});

test('unit submission: task drafts can be corrected repeatedly without requesting head review', () => {
  const state = createSeed(now); state.performances = [];
  const task = state.tasks.find(task => task.primaryId === personId && task.unitId === weights(state)[0].unitId && !task.commonId)!;
  const input = { taskId: task.id, period, title: '처리 결과', description: '첫 결과', evidence: '보고서', metricName: '처리 건수', value: 7, unit: '건' };
  const notifications = structuredClone(state.notifications);
  dispatch(state, personId, 'performance.saveHalf', input);
  const recordId = state.performances[0].id;
  assert.equal(state.performances[0].status, 'draft');
  assert.deepEqual(state.notifications, notifications);
  dispatch(state, personId, 'performance.saveHalf', { taskId: task.id, period, title: '수정 결과', description: '최종 결과', evidence: '확인 보고서' });
  assert.equal(state.performances.length, 1); assert.equal(state.performances[0].id, recordId);
  assert.equal(state.performances[0].description, '최종 결과'); assert.equal(state.performances[0].value, undefined);
  assert.equal(state.performances[0].metricName, undefined); assert.equal(state.performances[0].unit, undefined);
  rejects('PERFORMANCE_DENIED', () => dispatch(state, 'u-doyun', 'performance.saveHalf', input));
  rejects('UNIT_EVALUATION_REQUIRED', () => dispatch(state, headId, 'performance.evaluate', { performanceId: recordId, score: 50, comment: '우회 평가', decision: 'confirmed' }));
});

test('unit submission: explicit submission locks drafts and weights, withdrawal reopens, evaluation locks permanently', () => {
  const state = createSeed(now); state.performances = []; setPlan(state);
  const record = addPerformance(state, personId, undefined, { status: 'draft' });
  const input = { taskId: record.taskId, period, title: record.title, description: record.description, evidence: record.evidence };
  const before = state.notifications.length;
  submitPerson(state);
  assert.equal(getUnitScorePlan(state, personId, period)?.submittedAt, now.toISOString());
  assert.equal(getUnitScorePlan(state, personId, period)?.submittedBy, personId);
  assert.equal(state.performances[0].status, 'review');
  assert.ok(state.notifications.length > before);
  assert.ok(state.notifications.some(item => item.userId === headId && item.title === '개인별 반기 성과 평가 요청'));
  assert.equal(personUnitPerformanceSummary(state, personId, period).status, 'submitted');
  rejects('PERFORMANCE_SUBMITTED', () => setPlan(state));
  rejects('PERFORMANCE_SUBMITTED', () => submitPerson(state));
  rejects('PERFORMANCE_SUBMITTED', () => dispatch(state, personId, 'performance.saveHalf', input));
  rejects('PERFORMANCE_SUBMITTED', () => dispatch(state, personId, 'performance.submitHalf', input));
  dispatch(state, personId, 'performance.withdrawSubmission', { period });
  assert.equal(getUnitScorePlan(state, personId, period)?.submittedAt, undefined);
  assert.equal(state.performances[0].status, 'draft');
  dispatch(state, personId, 'performance.saveHalf', { ...input, description: '수정된 최종 성과' });
  setPlan(state); submitPerson(state);
  dispatch(state, headId, 'performance.evaluatePerson', evaluationInput(state));
  assert.equal(personUnitPerformanceSummary(state, personId, period).status, 'evaluated');
  rejects('EVALUATION_CONFIRMED', () => dispatch(state, personId, 'performance.withdrawSubmission', { period }));
  assert.equal(getUnitEvaluation(state, personId, period)?.performanceSnapshot[0].description, '수정된 최종 성과');
});

test('unit submission: ownership, plan version, missing content and invalid saved plans are rejected atomically', () => {
  const state = createSeed(now); state.performances = []; setPlan(state);
  rejects('PERFORMANCE_DENIED', () => dispatch(state, 'u-doyun', 'performance.submitPerson', { personId, period, planVersion: 1 }));
  rejects('PERFORMANCE_DENIED', () => dispatch(state, headId, 'performance.submitPerson', { period, planVersion: 1 }));
  rejects('PERFORMANCE_DENIED', () => dispatch(state, 'u-doyun', 'performance.withdrawSubmission', { personId, period }));
  rejects('PERFORMANCE_REQUIRED', () => submitPerson(state));
  addPerformance(state, personId, undefined, { status: 'draft', description: '', evidence: '' });
  rejects('PERFORMANCE_INCOMPLETE', () => submitPerson(state));
  state.performances[0].description = '확인한 성과 내용';
  rejects('SCORE_PLAN_CHANGED', () => dispatch(state, personId, 'performance.submitPerson', { period, planVersion: 999 }));
  getUnitScorePlan(state, personId, period)!.allocations[0].maxScore = 49;
  rejects('SCORE_TOTAL_REQUIRED', () => submitPerson(state));
  assert.equal(getUnitScorePlan(state, personId, period)?.submittedAt, undefined);
  assert.equal(state.performances[0].status, 'draft');
});

test('unit submission: managers see same-department status metadata without private drafts, scores or evaluation audit', () => {
  const state = createSeed(now); state.performances = []; setPlan(state); const record = addPerformance(state, personId, undefined, { status: 'draft' });
  const managerId = 'u-doyun';
  let workspace = getWorkspace(state, managerId, now);
  assert.equal(workspace.performanceSubmissionStatuses?.find(item => item.personId === personId && item.period === period)?.status, 'not_submitted');
  assert.ok(!workspace.performances.some(item => item.id === record.id));
  assert.ok(!workspace.unitScorePlans?.some(item => item.personId === personId));
  assert.ok(!getWorkspace(state, 'u-support-lead', now).performanceSubmissionStatuses?.some(item => item.personId === personId));
  submitPerson(state);
  workspace = getWorkspace(state, managerId, now);
  const status = workspace.performanceSubmissionStatuses!.find(item => item.personId === personId && item.period === period)!;
  assert.equal(status.status, 'submitted'); assert.equal(status.submittedAt, now.toISOString());
  assert.deepEqual(Object.keys(status).sort(), ['departmentId', 'evaluatedAt', 'period', 'personId', 'status', 'submittedAt'].sort());
  dispatch(state, headId, 'performance.evaluatePerson', evaluationInput(state));
  workspace = getWorkspace(state, managerId, now);
  assert.equal(workspace.performanceSubmissionStatuses?.find(item => item.personId === personId)?.status, 'evaluated');
  assert.ok(!workspace.unitEvaluations?.some(item => item.personId === personId));
  assert.ok(!workspace.audit.some(item => item.action === 'performance.evaluatePerson'));
  const foreignManager = state.users.find(user => user.role === 'manager' && user.departmentId !== 'dept-support')!;
  assert.ok(!getWorkspace(state, foreignManager.id, now).performanceSubmissionStatuses?.some(item => item.personId === personId));
});

test('unit submission: employee can elect to include new units by withdrawing and resubmitting a fresh plan', () => {
  const state = createSeed(now); state.performances = []; setPlan(state); addPerformance(state, personId, undefined, { status: 'draft' }); submitPerson(state);
  dispatch(state, personId, 'unit.create', { title: '제출 후 추가한 단위업무', description: '다음 수행을 위한 새 단위업무' });
  assert.ok(!getUnitScorePlan(state, personId, period)!.allocations.some(unit => unit.unitTitle === '제출 후 추가한 단위업무'));
  rejects('PERFORMANCE_SUBMITTED', () => setPlan(state));
  dispatch(state, personId, 'performance.withdrawSubmission', { period });
  setPlan(state); submitPerson(state);
  dispatch(state, headId, 'performance.evaluatePerson', evaluationInput(state));
  const evaluation = getUnitEvaluation(state, personId, period)!;
  assert.equal(evaluation.totalScore, 42.5);
  assert.equal(evaluation.scores.find(item => item.unitTitle === '제출 후 추가한 단위업무')?.maxScore, 0);
});
