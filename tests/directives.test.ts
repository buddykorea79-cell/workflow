import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { canManageDirective, canRecordDirectiveReport, directiveReportStartMonth, isDirectiveCoordinator } from '../src/lib/directives';
import { latestTaskRun } from '../src/lib/common-status';
import type { CommonTask, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-01T03:00:00Z');
const payload = { title: '자료 정비 지시', description: '부서별 정비 결과를 매월 기록합니다.', dueDate: '2026-12-31', frequency: 'once', requiredSteps: ['접수', '결과 검토'], departmentIds: ['dept-support'], kind: 'directive', directiveIssuer: 'minister', instructedOn: '2026-10-01' };
function dispatch(state: WorkspaceData, actor: string, type: string, input: Record<string, unknown>, at = now) {
  const candidate = structuredClone(state);
  executeCommand(candidate, actor, { type, payload: input, expectedRevision: state.revision, requestId: randomUUID() }, at);
  Object.assign(state, candidate);
}
function rejects(code: string, action: () => void) { assert.throws(action, error => error instanceof DomainError && error.code === code); }
function directive(state: WorkspaceData, extra: Record<string, unknown> = {}, actor = 'u-doyun') { dispatch(state, actor, 'common.create', { ...payload, ...extra }); return state.commonTasks[0].id; }
function common(state: WorkspaceData, id: string) { return state.commonTasks.find(item => item.id === id)!; }
function registered(state: WorkspaceData, commonId: string) {
  const distributionId = common(state, commonId).distributions.find(item => item.departmentId === 'dept-support')!.id;
  dispatch(state, 'u-doyun', 'common.assignTeam', { commonId, distributionId, leadId: 'u-support-lead', team: '데이터팀' });
  dispatch(state, 'u-support-lead', 'common.assignPerson', { commonId, distributionId, assigneeId: 'u-support-member' });
  dispatch(state, 'u-support-member', 'common.register', { commonId, distributionId, unitId: 'unit-data' });
  return distributionId;
}
function report(state: WorkspaceData, commonId: string, distributionId: string, month = '2026-11', actor = 'u-support-member', at = now) { dispatch(state, actor, 'directive.saveMonthlyReport', { commonId, distributionId, month, achievements: '자료 5건 검토 완료', nextPlan: '잔여 자료 확인', issues: '확인 요청 대기' }, at); }

test('directives: new directives require a known issuer and valid instruction date; common work does not retain directive fields', () => {
  const state = createSeed(now), before = JSON.stringify(state);
  rejects('DIRECTIVE_METADATA_REQUIRED', () => directive(state, { directiveIssuer: undefined }));
  rejects('DIRECTIVE_METADATA_REQUIRED', () => directive(state, { instructedOn: undefined }));
  rejects('VALIDATION_ERROR', () => directive(state, { directiveIssuer: 'president' }));
  rejects('VALIDATION_ERROR', () => directive(state, { instructedOn: '2026-02-30' }));
  rejects('DIRECTIVE_DATE_RANGE', () => directive(state, { instructedOn: '2026-11-02' }));
  rejects('DIRECTIVE_DATE_RANGE', () => directive(state, { dueDate: '2026-09-30' }));
  assert.equal(JSON.stringify(state), before);
  for (const directiveIssuer of ['minister', 'vice_minister', 'office_head', 'bureau_head']) { const id = directive(state, { directiveIssuer }); assert.equal(common(state, id).directiveIssuer, directiveIssuer); assert.equal(common(state, id).instructedOn, '2026-10-01'); }
  const id = directive(state, { kind: 'common' }); assert.equal(common(state, id).directiveIssuer, undefined); assert.equal(common(state, id).instructedOn, undefined);
});

test('directives: planning team jointly creates and manages minister/vice register without unrelated common or assignment authority', () => {
  const state = createSeed(now), person = state.users.find(user => user.id === 'u-seoyeon')!;
  assert.equal(person.commonTaskPermission, false); assert.equal(isDirectiveCoordinator(state, person, now), true);
  const id = directive(state, {}, person.id); assert.equal(common(state, id).managerId, person.id);
  rejects('COMMON_PERMISSION_REQUIRED', () => directive(state, { kind: 'common' }, person.id));
  rejects('COMMON_PERMISSION_REQUIRED', () => directive(state, { directiveIssuer: 'office_head' }, person.id));
  const foreignId = directive(state, { directiveIssuer: 'vice_minister' });
  dispatch(state, person.id, 'common.distribute', { commonId: foreignId, departmentIds: ['dept-innovation'] });
  assert.equal(common(state, foreignId).distributions.length, 2);
  const distributionId = common(state, foreignId).distributions[0].id;
  rejects('DEPARTMENT_ASSIGNMENT_DENIED', () => dispatch(state, person.id, 'common.assignTeam', { commonId: foreignId, distributionId, leadId: 'u-support-lead', team: '데이터팀' }));
  const lowerId = directive(state, { directiveIssuer: 'bureau_head' });
  rejects('DISTRIBUTION_DENIED', () => dispatch(state, person.id, 'common.distribute', { commonId: lowerId, departmentIds: ['dept-innovation'] }));
  assert.equal(isDirectiveCoordinator(state, { ...person, departmentId: 'dept-support' }, now), false);
  assert.equal(isDirectiveCoordinator(state, { ...person, team: '예산팀' }, now), false);
  assert.equal(isDirectiveCoordinator(state, { ...person, active: false }, now), false);
  assert.equal(isDirectiveCoordinator(state, { ...person, endsAt: '2026-10-31T00:00:00Z' }, now), false);
  assert.equal(isDirectiveCoordinator(state, state.users.find(user => user.id === 'u-head')!, now), false);
});

test('directives: monthly reports are persistent per-month upserts and leave execution progress unchanged', () => {
  const state = createSeed(now), id = directive(state), distributionId = registered(state, id);
  const taskId = common(state, id).distributions[0].taskId!;
  const taskBefore = JSON.stringify(state.tasks.find(task => task.id === taskId));
  report(state, id, distributionId, '2026-10'); report(state, id, distributionId);
  const first = structuredClone(common(state, id).distributions[0].monthlyReports!.find(item => item.month === '2026-10')!);
  dispatch(state, 'u-support-member', 'directive.saveMonthlyReport', { commonId: id, distributionId, month: '2026-10', achievements: '정정한 월별 실적' }, new Date('2026-11-01T05:00:00Z'));
  const reports = common(state, id).distributions[0].monthlyReports!;
  assert.equal(reports.length, 2); const updated = reports.find(item => item.month === '2026-10')!;
  assert.equal(updated.id, first.id); assert.equal(updated.createdAt, first.createdAt); assert.notEqual(updated.updatedAt, first.updatedAt); assert.equal(updated.achievements, '정정한 월별 실적'); assert.equal(updated.issues, '');
  assert.equal(JSON.stringify(state.tasks.find(task => task.id === taskId)), taskBefore);
  const roundtrip = JSON.parse(JSON.stringify(state)) as WorkspaceData;
  assert.equal(getWorkspace(roundtrip, 'u-support-member', now).commonTasks.find(item => item.id === id)!.distributions[0].monthlyReports?.length, 2);
});

test('directives: only registered current assignee may report and invalid months or content are rejected atomically', () => {
  const state = createSeed(now), id = directive(state); const distributionId = common(state, id).distributions[0].id;
  rejects('REGISTRATION_REQUIRED', () => report(state, id, distributionId)); registered(state, id);
  const before = JSON.stringify(state);
  for (const actor of ['u-doyun', 'u-support-head', 'u-support-lead', 'u-seoyeon', 'u-admin']) rejects('DIRECTIVE_REPORT_DENIED', () => report(state, id, distributionId, '2026-11', actor));
  rejects('DIRECTIVE_MONTH_RANGE', () => report(state, id, distributionId, '2026-09'));
  rejects('DIRECTIVE_MONTH_RANGE', () => report(state, id, distributionId, '2026-12'));
  rejects('VALIDATION_ERROR', () => report(state, id, distributionId, '2026-13'));
  rejects('VALIDATION_ERROR', () => dispatch(state, 'u-support-member', 'directive.saveMonthlyReport', { commonId: id, distributionId, month: '2026-11', achievements: '  ' }));
  assert.equal(JSON.stringify(state), before);
  // A Korean month boundary permits November even while UTC is still October.
  report(state, id, distributionId, '2026-11', 'u-support-member', new Date('2026-10-31T15:01:00Z'));
});

test('directives: reports remain available after department confirmation and pause; completion freezes history', () => {
  const state = createSeed(now), id = directive(state), distributionId = registered(state, id);
  dispatch(state, 'u-support-head', 'department.confirm', {});
  const taskId = common(state, id).distributions[0].taskId!, run = latestTaskRun(state, taskId)!;
  assert.ok(run); run.status = 'paused'; report(state, id, distributionId);
  run.status = 'in_progress';
  state.runs.find(item => item.id === run.id)!.steps.forEach(step => { step.status = 'completed'; });
  state.runs.find(item => item.id === run.id)!.status = 'completed';
  const before = JSON.stringify(common(state, id).distributions[0].monthlyReports);
  rejects('DIRECTIVE_COMPLETED', () => report(state, id, distributionId));
  assert.equal(JSON.stringify(common(state, id).distributions[0].monthlyReports), before);
  assert.equal(getWorkspace(state, 'u-seoyeon', now).commonTasks.find(item => item.id === id)!.distributions[0].monthlyReports?.length, 1);
});

test('directives: current execution owner follows assignment changes and deleted or archived work cannot accept reports', () => {
  const state = createSeed(now), id = directive(state), distributionId = registered(state, id);
  const task = state.tasks.find(item => item.id === common(state, id).distributions[0].taskId)!;
  task.primaryId = 'u-support-lead';
  rejects('DIRECTIVE_REPORT_DENIED', () => report(state, id, distributionId)); report(state, id, distributionId, '2026-11', 'u-support-lead');
  state.tasks.find(item => item.id === task.id)!.status = 'archived'; rejects('DIRECTIVE_REPORT_DENIED', () => report(state, id, distributionId, '2026-11', 'u-support-lead')); state.tasks.find(item => item.id === task.id)!.status = 'draft';
  state.units.find(item => item.id === task.unitId)!.deletedAt = now.toISOString();
  assert.equal(canRecordDirectiveReport(state, state.users.find(user => user.id === 'u-support-lead')!, common(state, id), common(state, id).distributions[0], now), false);
  rejects('DIRECTIVE_REPORT_DENIED', () => report(state, id, distributionId, '2026-11', 'u-support-lead'));
});

test('directives: central view receives all minister reports but never foreign task bodies or lower-level directives', () => {
  const state = createSeed(now), id = directive(state, { departmentIds: ['dept-support', 'dept-innovation'] }), distributionId = registered(state, id);
  report(state, id, distributionId);
  const task = state.tasks.find(item => item.id === common(state, id).distributions[0].taskId)!; task.description = 'PRIVATE TASK BODY'; task.budget = 123456789;
  const lower = directive(state, { directiveIssuer: 'office_head' }), unrelated = directive(state, { kind: 'common' });
  const before = JSON.stringify(state), central = getWorkspace(state, 'u-seoyeon', now);
  const projected = central.commonTasks.find(item => item.id === id)!;
  assert.equal(projected.distributions.length, 2); assert.equal(projected.distributions[0].monthlyReports?.[0].achievements, '자료 5건 검토 완료');
  assert.equal(central.tasks.some(item => item.id === task.id), false); assert.equal(JSON.stringify(central).includes('PRIVATE TASK BODY'), false);
  assert.equal(central.commonTasks.some(item => item.id === lower || item.id === unrelated), false);
  assert.equal(central.departmentDirectory?.length, 3); assert.ok(central.identities?.some(item => item.id === 'u-support-member'));
  const innovation = getWorkspace(state, 'u-innovation-member', now).commonTasks.find(item => item.id === id)!;
  assert.equal(innovation.distributions.length, 1); assert.equal(innovation.distributions[0].monthlyReports, undefined);
  assert.equal(JSON.stringify(state), before);
});

test('directives: legacy data stays readable and metadata correction respects classification and recorded months', () => {
  const state = createSeed(now), id = directive(state), distributionId = registered(state, id); report(state, id, distributionId, '2026-10');
  const item = common(state, id), owner = state.users.find(user => user.id === item.managerId)!;
  delete item.directiveIssuer; delete item.instructedOn;
  const before = JSON.stringify(state); getWorkspace(state, owner.id, now); assert.equal(JSON.stringify(state), before);
  assert.equal(directiveReportStartMonth(item, item.distributions[0]), '2026-11');
  dispatch(state, owner.id, 'directive.updateMetadata', { commonId: id, directiveIssuer: 'minister', instructedOn: '2026-10-01' });
  const coordinator = state.users.find(user => user.id === 'u-seoyeon')!;
  assert.equal(canManageDirective(state, coordinator, common(state, id), now), true);
  dispatch(state, coordinator.id, 'directive.updateMetadata', { commonId: id, directiveIssuer: 'vice_minister', instructedOn: '2026-10-02' });
  rejects('DIRECTIVE_MANAGEMENT_DENIED', () => dispatch(state, coordinator.id, 'directive.updateMetadata', { commonId: id, directiveIssuer: 'office_head', instructedOn: '2026-10-02' }));
  rejects('DIRECTIVE_REPORT_DATE_CONFLICT', () => dispatch(state, owner.id, 'directive.updateMetadata', { commonId: id, directiveIssuer: 'minister', instructedOn: '2026-11-01' }));
  const lower = directive(state, { directiveIssuer: 'office_head', departmentIds: ['dept-plan'] });
  rejects('DIRECTIVE_MANAGEMENT_DENIED', () => dispatch(state, coordinator.id, 'directive.updateMetadata', { commonId: lower, directiveIssuer: 'minister', instructedOn: '2026-10-01' }));
  dispatch(state, 'u-admin', 'directive.updateMetadata', { commonId: lower, directiveIssuer: 'minister', instructedOn: '2026-10-01' });
});
