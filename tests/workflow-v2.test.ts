import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { currentUserId } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-10-31T03:00:00Z');
const seed = () => createSeed(now);
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now);
  Object.assign(state, candidate);
}
function rejects(code: string, action: () => void) { assert.throws(action, e => e instanceof DomainError && e.code === code); }
function createCommon(state: WorkspaceData, extra: Record<string, unknown> = {}) {
  dispatch(state, 'u-minseo', 'common.create', { title: '사업별 공통 점검', description: '각 부서의 추진 상황 점검', dueDate: '2026-12-01', frequency: 'once', requiredSteps: ['접수', '결과 검토'], departmentIds: ['dept-support'], projectName: '행정 효율화 사업', ...(extra.kind === 'directive' ? { directiveIssuer: 'minister', instructedOn: '2026-10-01' } : {}), ...extra });
  return state.commonTasks[0];
}
function assignData(state: WorkspaceData, commonId: string, distributionId: string) {
  dispatch(state, 'u-doyun', 'common.assignTeam', { commonId, distributionId, team: '데이터팀', leadId: 'u-support-lead' });
  dispatch(state, 'u-support-lead', 'common.assignPerson', { commonId, distributionId, assigneeId: 'u-support-member' });
  dispatch(state, 'u-support-member', 'common.register', { commonId, distributionId, unitId: 'unit-data' });
}

test('v2: demo directory contains the three requested departments and complete fictional contacts', () => {
  const state = seed();
  assert.deepEqual(state.departments.map(d => d.name), ['기획재정담당관실', '데이터정보화담당관실', '혁신행정담당관실']);
  assert.equal(state.users.length, 33);
  for (const department of state.departments) assert.equal(new Set(state.users.filter(u => u.departmentId === department.id).map(u => u.role)).size, 5);
  assert.ok(state.users.every(u => u.email?.endsWith('@ieum.example') && /^02-0000-\d{4}$/.test(u.phone ?? '')));
  assert.ok(state.users.some(u => u.role !== 'admin' && u.commonTaskPermission));
});

test('v2: a missing local session requires login instead of impersonating a seeded member', async () => {
  const request = { url: 'http://127.0.0.1:3000/api/workspace', cookies: { get: () => undefined } } as unknown as NextRequest;
  await assert.rejects(currentUserId(request), e => e instanceof DomainError && e.code === 'SIGN_IN_REQUIRED');
});

test('v2: common permission is independent from org role and all mode distributes to every department', () => {
  const state = seed();
  const payload = { title: '기관 공통', description: '전 부서 수행', dueDate: '2026-12-01', frequency: 'once', requiredSteps: ['결과 검토'], departmentIds: ['dept-plan'], distributionMode: 'all' };
  rejects('COMMON_PERMISSION_REQUIRED', () => dispatch(state, 'u-seoyeon', 'common.create', payload));
  dispatch(state, 'u-minseo', 'common.create', payload);
  assert.equal(state.commonTasks[0].distributions.length, 3);
  assert.equal(state.commonTasks[0].managerId, 'u-minseo');
});

test('v2: common tasks enforce department → team → person → personal registration without shortcuts', () => {
  const state = seed(); const common = createCommon(state); const distributionId = common.distributions[0].id; const ref = { commonId: common.id, distributionId };
  rejects('STAGED_ASSIGNMENT_REQUIRED', () => dispatch(state, 'u-admin', 'common.assign', { commonId: common.id, departmentId: 'dept-support', unitId: 'unit-data', primaryId: 'u-support-member', reviewerId: 'u-support-head' }));
  rejects('DEPARTMENT_ASSIGNMENT_DENIED', () => dispatch(state, 'u-minseo', 'common.assignTeam', { ...ref, team: '데이터팀', leadId: 'u-support-lead' }));
  rejects('TEAM_ASSIGNMENT_DENIED', () => dispatch(state, 'u-support-lead', 'common.assignPerson', { ...ref, assigneeId: 'u-support-member' }));
  dispatch(state, 'u-doyun', 'common.assignTeam', { ...ref, team: '데이터팀', leadId: 'u-support-lead' });
  rejects('TEAM_ASSIGNMENT_DENIED', () => dispatch(state, 'u-plan-lead', 'common.assignPerson', { ...ref, assigneeId: 'u-support-member' }));
  rejects('TEAM_MEMBER_REQUIRED', () => dispatch(state, 'u-support-lead', 'common.assignPerson', { ...ref, assigneeId: 'u-jiho' }));
  dispatch(state, 'u-support-lead', 'common.assignPerson', { ...ref, assigneeId: 'u-support-member' });
  rejects('ASSIGNEE_ONLY', () => dispatch(state, 'u-admin', 'common.register', { ...ref, unitId: 'unit-data' }));
  rejects('UNIT_REQUIRED', () => dispatch(state, 'u-support-member', 'common.register', { ...ref, unitId: 'unit-budget' }));
  dispatch(state, 'u-support-member', 'common.register', { ...ref, unitId: 'unit-data' });
  const task = state.tasks.find(t => t.commonId === common.id)!;
  assert.equal(task.primaryId, 'u-support-member'); assert.equal(task.unitId, 'unit-data');
  assert.equal(state.commonTasks[0].distributions[0].status, 'registered');
  rejects('PERSON_ASSIGNMENT_REQUIRED', () => dispatch(state, 'u-support-member', 'common.register', { ...ref, unitId: 'unit-data' }));
});

test('v2: directive creation immediately creates department detail and registration transfers the same task', () => {
  const state = seed(); const common = createCommon(state, { kind: 'directive' }); const distributionId = common.distributions[0].id;
  const placeholder = state.tasks.find(t => t.commonId === common.id)!; assert.ok(placeholder); assert.equal(placeholder.primaryId, 'u-doyun'); assert.equal(placeholder.references?.[0].type, 'directive');
  rejects('REGISTRATION_REQUIRED', () => dispatch(state, 'u-doyun', 'task.configure', { taskId: placeholder.id, description: '배정 절차 우회' }));
  assignData(state, common.id, distributionId);
  assert.equal(state.tasks.filter(t => t.commonId === common.id).length, 1);
  assert.equal(state.tasks.find(t => t.id === placeholder.id)!.primaryId, 'u-support-member');
  dispatch(state, 'u-minseo', 'common.distribute', { commonId: common.id, departmentIds: ['dept-plan', 'dept-support'] });
  assert.equal(state.tasks.filter(t => t.commonId === common.id).length, 2);
});

test('v2: common owner sees cross-department aggregate progress without unrelated task content', () => {
  const state = seed(); const common = createCommon(state); assignData(state, common.id, common.distributions[0].id);
  const task = state.tasks.find(t => t.commonId === common.id)!;
  dispatch(state, 'u-support-member', 'task.setProgress', { taskId: task.id, stepId: 's1', done: true });
  let workspace = getWorkspace(state, 'u-minseo', now);
  assert.equal(workspace.commonTasks.find(c => c.id === common.id)!.distributions[0].progress, 50);
  assert.equal(workspace.tasks.some(t => t.id === task.id), false);
  assert.equal(workspace.tasks.some(t => t.id === 'task-data'), false);
  dispatch(state, 'u-support-head', 'task.setProgress', { taskId: task.id, stepId: 's2', done: true });
  workspace = getWorkspace(state, 'u-minseo', now);
  assert.equal(workspace.commonTasks.find(c => c.id === common.id)!.distributions[0].status, 'submitted');
  assert.equal(workspace.commonTasks.find(c => c.id === common.id)!.distributions[0].progress, 100);
});

test('v2: failed directive delivery is atomic if a target department has no responsible staff', () => {
  const state = seed(); dispatch(state, 'u-admin', 'organization.departmentCreate', { name: '빈 부서', shortName: '빈부서' });
  const before = JSON.stringify(state);
  rejects('DEPARTMENT_STAFF_REQUIRED', () => createCommon(state, { kind: 'directive', departmentIds: ['dept-support', state.departments.at(-1)!.id] }));
  assert.equal(JSON.stringify(state), before);
});

test('v2: each task has one editable performance per half and legacy evaluation cannot bypass person submission', () => {
  const state = seed(); const payload = { taskId: 'task-data', period: '2026-H2', title: '데이터 품질 향상', description: '오류 항목 정비', evidence: '진단 결과 보고서', metricName: '정비 건수', value: 25, unit: '건' };
  dispatch(state, 'u-support-member', 'performance.submitHalf', payload); const performanceId = state.performances[0].id;
  dispatch(state, 'u-support-member', 'performance.saveHalf', payload);
  assert.equal(state.performances.filter(performance => performance.id === performanceId).length, 1);
  rejects('HEAD_EVALUATION_REQUIRED', () => dispatch(state, 'u-head', 'performance.evaluate', { performanceId, score: 90, comment: '다른 부서 평가', decision: 'confirmed' }));
  rejects('HEAD_EVALUATION_REQUIRED', () => dispatch(state, 'u-doyun', 'performance.evaluate', { performanceId, score: 90, comment: '부서 담당자 평가', decision: 'confirmed' }));
  rejects('UNIT_EVALUATION_REQUIRED', () => dispatch(state, 'u-support-head', 'performance.evaluate', { performanceId, score: 75, comment: '이전 평가 경로', decision: 'changes_requested' }));
  rejects('PERFORMANCE_DENIED', () => dispatch(state, 'u-doyun', 'performance.submitHalf', payload));
  dispatch(state, 'u-support-member', 'performance.submitHalf', { ...payload, evidence: '보완 진단 보고서' });
  assert.equal(state.performances[0].id, performanceId); assert.equal(state.performances[0].status, 'draft'); assert.equal(state.performances[0].score, undefined);
  assert.equal(state.performances[0].evidence, '보완 진단 보고서');
  dispatch(state, 'u-support-member', 'performance.submitHalf', { ...payload, period: '2026-H1' });
  assert.equal(state.performances.filter(p => p.taskId === 'task-data').length, 2);
});

test('v2: half-year evaluation validates scores, periods, and self-review', () => {
  const state = seed();
  rejects('VALIDATION_ERROR', () => dispatch(state, 'u-support-member', 'performance.submitHalf', { taskId: 'task-data', period: '2026-Q4', title: '성과', description: '내용', evidence: '증빙' }));
  rejects('UNIT_EVALUATION_REQUIRED', () => dispatch(state, 'u-head', 'performance.evaluate', { performanceId: 'perf-budget', score: 101, comment: '평가', decision: 'confirmed' }));
  state.performances.find(p => p.id === 'perf-budget')!.authorId = 'u-head';
  rejects('SELF_APPROVAL', () => dispatch(state, 'u-head', 'performance.evaluate', { performanceId: 'perf-budget', score: 90, comment: '자기평가', decision: 'confirmed' }));
});

test('v2: legacy performance endpoints cannot bypass half-year score, comment, or department-head review', () => {
  const state = seed();
  rejects('HALF_COMMAND_REQUIRED', () => dispatch(state, 'u-head', 'performance.approve', { performanceId: 'perf-budget' }));
  rejects('HALF_COMMAND_REQUIRED', () => dispatch(state, 'u-head', 'performance.requestChanges', { performanceId: 'perf-budget', reason: '보완' }));
  rejects('HALF_COMMAND_REQUIRED', () => dispatch(state, 'u-minseo', 'performance.resubmit', { performanceId: 'perf-budget', description: '보완', evidence: '증빙' }));
  rejects('UNIT_EVALUATION_REQUIRED', () => dispatch(state, 'u-head', 'performance.evaluate', { performanceId: 'perf-budget', score: 90, comment: '성과 확인', decision: 'confirmed' }));
  state.performances.find(performance => performance.id === 'perf-budget')!.status = 'confirmed';
  rejects('HALF_COMMAND_REQUIRED', () => dispatch(state, 'u-minseo', 'performance.create', { taskId: 'task-budget', runId: state.performances.find(p => p.id === 'perf-budget')!.runId, title: '우회 정정', description: '우회', evidence: '새 증빙', previousId: 'perf-budget' }));
});

test('v2: version records require admin permission and reject duplicate versions', () => {
  const state = seed(); const payload = { version: '99.0.0', title: '검증용 버전', notes: '새 기능 구현 기록' };
  rejects('ADMIN_REQUIRED', () => dispatch(state, 'u-minseo', 'admin.release', payload));
  dispatch(state, 'u-admin', 'admin.release', payload);
  assert.equal(getWorkspace(state, 'u-admin', now).releases?.[0].version, '99.0.0');
  rejects('DUPLICATE_RELEASE', () => dispatch(state, 'u-admin', 'admin.release', payload));
});
