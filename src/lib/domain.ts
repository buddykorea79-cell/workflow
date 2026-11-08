import { normalizePeriod, currentPeriod } from './schedule';
import { isFutureHalf } from './period';
import { DEFAULT_UNIT_IMPORTANCE, unitImportance } from './unit-importance';
import { executeBudgetCommand, getBudgetCatalog, resolveTaskBudget, validateTaskMoney } from './budget-catalog';
import { nextCycleWorkflow, runWorkflow, taskCycleState } from './work-cycles';
import { procedureScheduleConflicts } from './procedure-schedule';
import { DomainError } from './domain-error';
import { commandValidationLabels, parseInput } from './validation';
import { commandTarget, commandTargetKey, entityRevision, logicalTargets, revisionEntities, targetLabels, targetRevision } from './command-targets';
import { resolveAttachmentStoreMode, resolveStoreMode } from './store-mode';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { createRun, commonWorkflow, defaultCard, defaultWorkflow, koreaDate, snapshot } from './seed';
import { commonDistributionStatus, latestTaskRun, summarizeCommon, taskExecution } from './common-status';
import { departmentWorkPlan, isDepartmentConfirmed, isRegisteredWork, userIdentity, workDivisionSnapshot } from './work-division';
import { currentPersonPerformances, scoreUnitsForPeriod, getUnitEvaluation, getUnitScorePlan, hasCompletePerformance, missingPerformanceUnitIds, performanceUnitId, UNIT_SCORE_TOTAL } from './unit-evaluation';
import { canManageDirective, canRecordDirectiveReport, directiveIssuerLabels, directiveReportStartMonth, isCentralDirective, isDirectiveCoordinator } from './directives';
import { executePersonnelTransfer } from './personnel-handover';
import { canActAsDeputy } from './delegations';
import { executeDelegationCommand, prepareTaskDelegation, storeTaskDelegation } from './delegation-commands';
import { organizationDivisionForUser } from './organization-division';
import { withReplacedRunProcedure } from './procedure-replacement';
import { organizationIdentityIssue, organizationUserChangeIssue } from './organization-management';
import { canCreateCommon, canReviewCommon, commonApprovalSnapshot, commonOriginDepartment, commonPublished } from './common-approval';
import { canonicalWorkImport, validateWorkImport, workImportNeutralCard, type WorkImportInput } from './work-import';
import type { Attachment, AuditEvent, Command, CommandTargetKind, CommonApprovalRequest, CommonTask, CommonDistribution, DepartmentDivisionReadModel, Handover, Performance, PerformanceSubmissionStatus, Run, Source, TargetRevisionChange, Task, Unit, User, WorkflowStep, Workspace, WorkspaceData } from './types';

export { DomainError } from './domain-error';
function fail(status: number, code: string, message: string): never { throw new DomainError(status, code, message); }
function assertNotFutureHalf(period: string, now: Date, subject: '성과' | '업무 비중') {
  if (isFutureHalf(period, now)) fail(422, 'PERIOD_NOT_STARTED', `아직 시작하지 않은 반기의 ${subject}${subject === '성과' ? '는' : '은'} 입력할 수 없습니다.`);
}
const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 12)}`;
const text = z.string().trim().min(1).max(5000);
const commandTargetKind = z.enum(Object.keys(targetLabels) as [CommandTargetKind, ...CommandTargetKind[]]);
const taskDescription = z.string().trim().min(1).max(20_000);
const attachmentIdsInput = z.array(text).max(30);
const performanceFields = { title: z.string().trim().max(150).optional(), description: text.max(500, '성과 내용은 500자 이내로 입력해 주세요.'), evidence: z.string().trim().max(5000).optional(), attachmentIds: attachmentIdsInput.optional(), metricName: z.string().max(150).optional(), value: z.number().finite().optional(), unit: z.string().max(50).optional() };
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '날짜 형식이 올바르지 않습니다.').refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, '실제 존재하는 날짜를 입력해 주세요.');
const datetime = z.string().refine(v => !Number.isNaN(Date.parse(v)), '날짜와 시각을 확인해 주세요.');
const directiveIssuer = z.enum(['minister', 'vice_minister', 'office_head', 'bureau_head']);
const directiveMetadata = z.object({ directiveIssuer, instructedOn: date });
const commonInput = z.object({ title: text.max(150), description: text, dueDate: date, frequency: z.enum(['once', 'monthly', 'quarterly', 'half_yearly', 'yearly']), requiredSteps: z.array(text).min(1).max(20), departmentIds: z.array(text).min(1).max(100), kind: z.enum(['common', 'directive']).default('common'), projectName: z.string().trim().max(150).optional(), distributionMode: z.enum(['all', 'selected']).default('selected'), directiveIssuer: directiveIssuer.optional(), instructedOn: date.optional() });
const money = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const budgetFields = { budget: money.optional(), budgetMode: z.enum(['manual', 'catalog', 'none']).optional(), budgetItemId: z.string().trim().min(1).max(200).nullable().optional() };
const halfYear = z.string().regex(/^20\d{2}-H[12]$/, '예: 2026-H1 또는 2026-H2');
const unitScore = z.number().finite().min(0).max(UNIT_SCORE_TOTAL).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.000001, '점수는 소수 둘째 자리까지 입력해 주세요.');
const unitWeight = z.number().finite().int('업무 비중은 정수로 입력해 주세요.').min(1).max(UNIT_SCORE_TOTAL);
const importanceInput = z.number().finite().int('중요도는 정수로 입력해 주세요.').min(1).max(10);
// Optional time is retained only for compatibility with previously stored expense records.
const expenseInput = z.array(z.object({ id: text, date, time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).optional(), projectName: text.max(200).optional(), vendor: text.max(200).optional(), description: text.max(500), amount: money })).max(500);
const referenceInput = z.array(z.object({ id: text, type: z.enum(['law', 'guideline', 'national_agenda', 'directive', 'document', 'other']), title: text.max(300), content: z.string().max(200000), url: z.union([z.literal(''), z.url().refine(v => /^https?:\/\//i.test(v), 'HTTP(S) 주소만 입력할 수 있습니다.')]).optional(), attachmentId: text.optional() })).max(100);
const workflowInput = z.array(z.object({ id: text, title: text.max(150), role: z.enum(['primary', 'support', 'reviewer']), description: z.string().max(5000), output: z.string().max(1000), required: z.boolean(), dependsOn: z.array(text), checklist: z.array(text).max(50), attachmentIds: attachmentIdsInput.optional(), startDate: date.optional(), dueDate: date.optional(), scheduleDetails: z.string().trim().max(5000).optional(), done: z.boolean().optional() })).min(1).max(50);
const cycleScheduleInput = z.object({ title: text.max(150).optional(), startDate: date, dueDate: date, scheduleDetails: z.string().trim().max(5000).optional(), steps: z.array(z.object({ stepId: text, startDate: date.optional(), dueDate: date.optional(), scheduleDetails: z.string().trim().max(5000).optional() })).min(1).max(50) });
const legacyTaskInput = z.object({ title: text.max(150), description: taskDescription, unitId: text, primaryId: text, supportIds: z.array(text).max(30).default([]), reviewerId: text, dueDate: date, frequency: z.enum(['once', 'monthly', 'quarterly', 'half_yearly', 'yearly']), priority: z.enum(['high', 'medium', 'low']).default('medium'), completionCriteria: text.default('필수 체크와 결과물 확인 및 총괄 검토 완료'), card: z.object({ purpose: z.string(), stakeholders: z.string(), evidence: z.string(), responsibility: z.string(), procedure: z.string(), finance: z.string(), documents: z.string(), issues: z.string(), handover: z.string() }).optional(), workflow: z.array(z.object({ id: text, title: text.max(150), role: z.enum(['primary', 'support', 'reviewer']), description: z.string().max(5000), output: z.string().max(1000), required: z.boolean(), dependsOn: z.array(text), checklist: z.array(text).max(50) })).min(1).max(50).optional(), sourceIds: z.array(text).max(50).default([]) });
const taskInput = legacyTaskInput.extend({ reviewerId: text.optional(), descriptionAttachmentIds: z.array(text).max(10).optional(), ...budgetFields, expenses: expenseInput.optional(), references: referenceInput.optional(), workflow: workflowInput.optional() });
const unitInput = z.object({ title: text.max(100), description: text, importance: importanceInput.optional(), departmentId: z.string().optional(), ownerId: z.string().optional() });
function required(payload: Record<string, unknown>, key: string): string { return parseInput(text, payload[key], { path: key }); }
function validateDirectiveDate(common: Pick<CommonTask, 'dueDate' | 'distributions'>, instructedOn: string, now: Date) {
  if (instructedOn > koreaDate(now) || instructedOn > common.dueDate) fail(422, 'DIRECTIVE_DATE_RANGE', '지시일자는 오늘과 업무 마감일 이후로 지정할 수 없습니다.');
  if (common.distributions.some(distribution => distribution.monthlyReports?.some(report => report.month < instructedOn.slice(0, 7)))) fail(409, 'DIRECTIVE_REPORT_DATE_CONFLICT', '이미 기록한 월별 실적보다 이후로 지시일자를 변경할 수 없습니다.');
}
export function activeUser(state: WorkspaceData, userId: string, now = new Date()): User { const user = state.users.find(u => u.id === userId); if (!user || !user.active || (user.endsAt && new Date(user.endsAt) <= now)) return fail(401, 'ACCOUNT_INACTIVE', '활성 사용자로 다시 로그인해 주세요.'); return user; }
export function isManager(user: User) { return ['admin', 'head', 'manager'].includes(user.role); }
export function canManageCommon(user: User, now = new Date()) { return canCreateCommon(user, now); }
export function assertDepartmentEditable(state: WorkspaceData, departmentId: string) {
  if (isDepartmentConfirmed(state, departmentId)) fail(409, 'DEPARTMENT_CONFIRMED', '부서 업무분장이 확정되어 업무 정의와 배정을 변경할 수 없습니다. 부서장에게 재작성 허용을 요청해 주세요.');
}
export function assertDefinitionWritable(state: WorkspaceData, user: User, departmentId: string) {
  if (user.role === 'head') fail(403, 'HEAD_DEFINITION_DENIED', '부서장은 부서 업무 현황을 검토하고 업무분장을 확정하거나 재작성을 허용할 수 있습니다. 업무 정의는 담당자가 작성해 주세요.');
  if (user.role !== 'admin' && user.departmentId !== departmentId) fail(403, 'OUTSIDE_SCOPE', '소속 부서의 업무 정의만 변경할 수 있습니다.');
  assertDepartmentEditable(state, departmentId);
}
/** Central definition gate covers both current commands and legacy mutation paths. */
function assertDefinitionCommand(state: WorkspaceData, user: User, type: string, p: Record<string, unknown>) {
  if (type.startsWith('delegation.') || ['common.approve', 'common.reject'].includes(type)) return; // Head decisions are checked against the immutable requesting department.
  const taskDefinition = type.startsWith('task.') && !['task.setProgress', 'task.record'].includes(type);
  const unitDefinition = type.startsWith('unit.');
  const commonDefinition = type.startsWith('common.');
  const delegationDefinition = type.startsWith('delegation.');
  const handoverDefinition = type.startsWith('handover.') && type !== 'handover.cancel';
  if (!taskDefinition && !unitDefinition && !commonDefinition && !delegationDefinition && !handoverDefinition) return;
  if (user.role === 'head' && (taskDefinition || unitDefinition || commonDefinition || delegationDefinition || ['handover.create', 'handover.update'].includes(type))) {
    const registration = ['unit.create', 'task.create', 'common.create', 'common.assign', 'common.register'].includes(type);
    fail(403, registration ? 'HEAD_REGISTRATION_DENIED' : 'HEAD_DEFINITION_DENIED', registration ? '부서장은 개인·공통업무를 등록하지 않고 부서원 업무를 검토하고 업무분장을 확정합니다.' : '부서장은 업무 정의를 직접 변경하지 않습니다. 담당자의 재작성을 허용한 후 부서 업무분장을 확정해 주세요.');
  }
  const departments = new Set<string>();
  const addTask = (taskId: unknown) => { const task = state.tasks.find(item => item.id === taskId); if (task) departments.add(task.departmentId); };
  if (unitDefinition) { if (type === 'unit.create') departments.add(typeof p.departmentId === 'string' ? p.departmentId : user.departmentId); else { const unit = state.units.find(item => item.id === p.unitId); if (unit) departments.add(unit.departmentId); } }
  if (taskDefinition || delegationDefinition) {
    addTask(p.taskId);
    const unit = state.units.find(item => item.id === p.unitId); if (unit) departments.add(unit.departmentId);
    const delegation = state.delegations.find(item => item.id === p.delegationId); if (delegation) addTask(delegation.taskId);
  }
  if (commonDefinition) {
    const common = state.commonTasks.find(item => item.id === p.commonId);
    // Delivery adds an inbox item, not an approved departmental assignment.
    if (type === 'common.create' || type === 'common.distribute') { /* existing assignments remain locked */ }
    else if (type === 'common.assign') departments.add(typeof p.departmentId === 'string' ? p.departmentId : user.departmentId);
    else { const distribution = common?.distributions.find(item => item.id === p.distributionId); if (distribution) departments.add(distribution.departmentId); }
  }
  if (handoverDefinition) {
    const handover = state.handovers.find(item => item.id === p.handoverId);
    if (handover) { departments.add(handover.departmentId); departments.add(handover.targetDepartmentId); handover.taskIds.forEach(addTask); }
    if (Array.isArray(p.taskIds)) p.taskIds.forEach(addTask);
    const recipient = state.users.find(item => item.id === p.toId); if (recipient) departments.add(recipient.departmentId);
  }
  departments.forEach(departmentId => assertDepartmentEditable(state, departmentId));
}
function manageDepartment(user: User, departmentId: string) { return user.role === 'admin' || (user.departmentId === departmentId && isManager(user)); }
function approveDepartment(user: User, departmentId: string) { return user.role === 'admin' || (user.departmentId === departmentId && user.role === 'head'); }
function scoped(user: User, departmentId: string, approval = false) { if (!(approval ? approveDepartment(user, departmentId) : manageDepartment(user, departmentId))) fail(403, 'OUTSIDE_SCOPE', '이 부서의 요청을 처리할 권한이 없습니다.'); }
export function canReadTask(state: WorkspaceData, user: User, task: Task, now = new Date()): boolean { return manageDepartment(user, task.departmentId) || task.primaryId === user.id || task.supportIds.includes(user.id) || task.reviewerId === user.id || state.runs.some(r => r.taskId === task.id && r.status !== 'completed' && [r.primaryId, r.reviewerId, ...r.supportIds].includes(user.id)) || canActAsDeputy(state, user, task, undefined, now) || state.handovers.some(h => h.taskIds.includes(task.id) && h.toId === user.id && !['cancelled', 'completed'].includes(h.status)); }
export function canReadSource(state: WorkspaceData, user: User, source: Source, now = new Date()): boolean { if (source.classification === 'public' || source.ownerId === user.id) return true; if (source.classification === 'internal') return source.departmentId === user.departmentId; return state.tasks.some(t => t.sourceIds.includes(source.id) && ([t.primaryId, t.reviewerId, ...t.supportIds].includes(user.id) || state.runs.some(r => r.taskId === t.id && r.status !== 'completed' && [r.primaryId, r.reviewerId, ...r.supportIds].includes(user.id)) || canActAsDeputy(state, user, t, undefined, now))); }
export function assertTaskWritable(state: WorkspaceData, task: Task) {
  if (task.deletedAt) fail(409, 'TASK_DELETED', '휴지통의 세부업무입니다. 복원한 뒤 수정해 주세요.');
  const unit = state.units.find(item => item.id === task.unitId);
  if (!unit) fail(422, 'UNIT_REQUIRED', '연결된 단위업무를 찾을 수 없습니다.');
  if (unit.deletedAt) fail(409, 'UNIT_DELETED', '상위 단위업무가 삭제되었습니다. 먼저 단위업무를 복원해 주세요.');
}
function getTask(state: WorkspaceData, user: User, taskId: string, now: Date, allowDeleted = false): Task { const task = state.tasks.find(t => t.id === taskId); if (!task || !canReadTask(state, user, task, now)) return fail(403, 'TASK_ACCESS_DENIED', '업무에 접근할 수 없습니다.'); if (!allowDeleted) assertTaskWritable(state, task); return task; }
function ownedUnit(state: WorkspaceData, user: User, unitId: string, allowDeleted = false): Unit {
  const unit = state.units.find(item => item.id === unitId);
  if (!unit || (unit.ownerId !== user.id && user.role !== 'admin')) return fail(403, 'UNIT_ACCESS_DENIED', '본인 소유의 단위업무만 관리할 수 있습니다.');
  if (!allowDeleted && unit.deletedAt) fail(409, 'UNIT_DELETED', '휴지통의 단위업무입니다. 복원한 뒤 수정해 주세요.');
  return unit;
}
function personalTargetUnit(state: WorkspaceData, user: User, unitId: string, departmentId: string, ownerId = user.id): Unit {
  const unit = state.units.find(item => item.id === unitId);
  if (!unit || unit.departmentId !== departmentId) return fail(422, 'UNIT_REQUIRED', '같은 부서의 단위업무를 선택해 주세요.');
  if (unit.deletedAt) fail(409, 'UNIT_DELETED', '삭제된 단위업무에는 세부업무를 등록하거나 이동할 수 없습니다.');
  if (user.role !== 'admin' && unit.ownerId !== ownerId) fail(403, 'UNIT_OWNER_REQUIRED', '본인 소유의 단위업무를 선택해 주세요.');
  return unit;
}
function uniqueUnitTitle(state: WorkspaceData, unit: Pick<Unit, 'id' | 'ownerId' | 'departmentId' | 'title'>) {
  if (state.units.some(item => item.id !== unit.id && !item.deletedAt && item.ownerId === unit.ownerId && item.departmentId === unit.departmentId && item.title === unit.title)) fail(409, 'DUPLICATE_UNIT', '본인 소유의 활성 단위업무에 같은 이름이 있습니다.');
}
function getRun(state: WorkspaceData, user: User, runId: string, now: Date): Run { const run = state.runs.find(r => r.id === runId); if (!run) return fail(404, 'NOT_FOUND', '실행 회차를 찾을 수 없습니다.'); getTask(state, user, run.taskId, now); return run; }
function canExecute(state: WorkspaceData, user: User, run: Run, action: string, now: Date) { const task = state.tasks.find(item => item.id === run.taskId); return [run.primaryId, ...run.supportIds].includes(user.id) || !!task && task.primaryId === run.primaryId && canActAsDeputy(state, user, task, action, now); }
function executionAccess(state: WorkspaceData, user: User, run: Run, action: string, now: Date, reviewer = false) { const allowed = reviewer ? user.id === run.reviewerId || approveDepartment(user, run.departmentId) : canExecute(state, user, run, action, now); if (!allowed) fail(403, 'EXECUTION_DENIED', reviewer ? '지정된 총괄 또는 부서장만 검토 단계를 처리할 수 있습니다.' : '현재 회차의 담당자 또는 유효한 대행자만 수행할 수 있습니다.'); if (run.status === 'paused') fail(409, 'RUN_PAUSED', '일시 중지된 수행 회차는 진행 상태를 변경할 수 없습니다.'); if (run.status === 'completed') fail(409, 'RUN_COMPLETED', '완료된 회차는 직접 수정할 수 없습니다.'); }
function emit(state: WorkspaceData, user: User, action: string, targetType: string, targetId: string, title: string, detail: string, departmentId: string, now: Date) { state.audit.unshift({ id: id('audit'), actorId: user.id, action, targetType, targetId, title, detail, departmentId, createdAt: now.toISOString() }); }
function taskReviewer(state: WorkspaceData, departmentId: string, primaryId: string, now: Date): string {
  const head = state.users.find(member => member.departmentId === departmentId && member.role === 'head' && member.active && (!member.endsAt || new Date(member.endsAt) > now) && member.id !== primaryId);
  if (!head) fail(422, 'TASK_HEAD_REQUIRED', '업무를 검토할 소유 부서의 활성 부서장을 먼저 등록해 주세요.');
  return head.id;
}
function validateDescriptionAttachments(state: WorkspaceData, user: User, taskId: string, attachmentIds?: string[]) {
  if (!attachmentIds) return;
  if (new Set(attachmentIds).size !== attachmentIds.length) fail(422, 'DESCRIPTION_ATTACHMENT_DUPLICATE', '업무 설명 파일을 중복하여 선택할 수 없습니다.');
  for (const attachmentId of attachmentIds) {
    const attachment = state.attachments.find(item => item.id === attachmentId);
    if (!attachment || attachment.performanceId || attachment.taskId !== taskId && !(attachment.uploadedBy === user.id && attachment.taskId.startsWith(`draft:${user.id}:`))) fail(422, 'DESCRIPTION_ATTACHMENT_INVALID', '해당 업무의 파일 또는 본인이 미리 올린 설명 파일만 연결할 수 있습니다.');
  }
}
function claimDescriptionAttachments(state: WorkspaceData, task: Task) {
  for (const attachmentId of task.descriptionAttachmentIds ?? []) state.attachments.find(item => item.id === attachmentId)!.taskId = task.id;
}
function validateLinkedAttachments(state: WorkspaceData, taskId: string, attachmentIds: string[] | undefined, kind: 'PROCEDURE' | 'PERFORMANCE', allowedIds?: Set<string>, performanceId?: string) {
  if (!attachmentIds) return;
  if (new Set(attachmentIds).size !== attachmentIds.length) fail(422, `${kind}_ATTACHMENT_DUPLICATE`, '같은 파일을 중복하여 연결할 수 없습니다.');
  for (const attachmentId of attachmentIds) {
    const attachment = state.attachments.find(item => item.id === attachmentId && item.taskId === taskId);
    if (!attachment || attachment.performanceId && (kind !== 'PERFORMANCE' || attachment.performanceId !== performanceId) || allowedIds && !allowedIds.has(attachmentId)) fail(422, `${kind}_ATTACHMENT_INVALID`, '이 세부업무 또는 해당 성과에 업로드한 접근 가능한 파일만 연결할 수 있습니다.');
  }
}
/** Evaluation evidence remains available to its author and reviewing department after a transfer. */
export function canReadAttachment(state: WorkspaceData, user: User, attachment: Attachment, now = new Date()) {
  // Performance-only evidence never inherits the current task assignee's access.
  if (attachment.performanceId) {
    const record = state.performances.find(item => item.id === attachment.performanceId && item.taskId === attachment.taskId && item.authorId === attachment.uploadedBy);
    if (record && (record.authorId === user.id || record.attachmentIds?.includes(attachment.id) && approveDepartment(user, record.departmentId))) return true;
    return (state.unitEvaluations ?? []).some(evaluation => (evaluation.personId === user.id || approveDepartment(user, evaluation.departmentId)) && evaluation.performanceSnapshot.some(item => item.id === attachment.performanceId && item.taskId === attachment.taskId && item.attachmentIds?.includes(attachment.id)));
  }
  const task = state.tasks.find(item => item.id === attachment.taskId);
  const draftPrefix = `draft:${user.id}:`;
  if (task && canReadTask(state, user, task, now) || attachment.uploadedBy === user.id && attachment.taskId.startsWith(draftPrefix) && /^[a-f0-9-]{36}$/i.test(attachment.taskId.slice(draftPrefix.length))) return true;
  const canReadRecord = (record: Performance) => record.authorId === user.id || approveDepartment(user, record.departmentId);
  if (state.performances.some(record => record.taskId === attachment.taskId && record.attachmentIds?.includes(attachment.id) && canReadRecord(record))) return true;
  return (state.unitEvaluations ?? []).some(evaluation => (evaluation.personId === user.id || approveDepartment(user, evaluation.departmentId)) && evaluation.performanceSnapshot.some(record => record.taskId === attachment.taskId && record.attachmentIds?.includes(attachment.id)));
}
function saveEmbeddedDelegation(state: WorkspaceData, user: User, delegation: ReturnType<typeof prepareTaskDelegation>, now: Date) {
  storeTaskDelegation(state, delegation, now);
  emit(state, user, 'delegation.request', 'delegation', delegation.id, '업무대행 지정 · 부서장 승인 요청', JSON.stringify({ taskId: delegation.taskId, fromId: delegation.fromId, toId: delegation.toId, startsAt: delegation.startsAt, endsAt: delegation.endsAt, reason: delegation.reason }), delegation.departmentId!, now);
}
function validateAssignments(state: WorkspaceData, user: User, task: Task, now: Date) { for (const sourceId of task.sourceIds) { const source = state.sources.find(s => s.id === sourceId); if (source && !canReadSource(state, user, source, now)) fail(403, 'SOURCE_ACCESS_DENIED', '접근할 수 없는 자료는 업무에 연결할 수 없습니다.'); } const unit = state.units.find(u => u.id === task.unitId); if (!unit || unit.departmentId !== task.departmentId) fail(422, 'UNIT_REQUIRED', '같은 부서의 단위업무를 연결해야 합니다.'); if (unit.deletedAt) fail(409, 'UNIT_DELETED', '삭제된 단위업무에는 세부업무를 연결할 수 없습니다.'); if (task.deletedAt) fail(409, 'TASK_DELETED', '휴지통의 세부업무는 복원 후 변경해 주세요.'); const primary = activeUser(state, task.primaryId, now); if (primary.departmentId !== task.departmentId) fail(422, 'PRIMARY_SCOPE', '정담당은 업무 소유 부서의 활성 사용자여야 합니다.'); for (const userId of [...task.supportIds, task.reviewerId]) { const assigned = activeUser(state, userId, now); if (assigned.departmentId !== task.departmentId) fail(422, 'ASSIGNMENT_SCOPE', '업무 역할은 소유 부서 안에서 지정해 주세요.'); } if (new Set(task.supportIds).size !== task.supportIds.length || task.supportIds.includes(task.primaryId)) fail(422, 'DUPLICATE_ASSIGNMENT', '정담당과 부담당의 배정을 구분해 주세요.'); if (task.primaryId === task.reviewerId) fail(422, 'SELF_REVIEW', '정담당과 최종 검토자는 서로 달라야 합니다.'); if (!isManager(user) && task.primaryId !== user.id) fail(403, 'ASSIGNMENT_DENIED', '다른 직원의 신규 배정은 부서담당에게 요청해 주세요.'); }
export function validateWorkflow(task: Task, state: WorkspaceData) {
  const nodes = task.workflow; const ids = new Set(nodes.map(n => n.id)); if (!nodes.length || ids.size !== nodes.length) fail(422, 'WORKFLOW_IDS', '워크플로 단계 ID는 중복될 수 없습니다.');
  for (const step of nodes) { if (step.startDate && step.dueDate && step.startDate > step.dueDate) fail(422, 'SCHEDULE_ORDER', '절차의 종료일은 시작일 이후여야 합니다.'); }
  for (const step of nodes) { if (step.dependsOn.some(dep => !ids.has(dep) || dep === step.id)) fail(422, 'WORKFLOW_REFERENCE', '워크플로의 선행 단계 연결을 확인해 주세요.'); }
  const visited = new Set<string>(); const visiting = new Set<string>(); const visit = (nodeId: string) => { if (visiting.has(nodeId)) fail(422, 'WORKFLOW_CYCLE', '순환하는 선행 조건은 확정할 수 없습니다. 보완 기록을 별도로 남겨 주세요.'); if (visited.has(nodeId)) return; visiting.add(nodeId); nodes.find(n => n.id === nodeId)!.dependsOn.forEach(visit); visiting.delete(nodeId); visited.add(nodeId); }; nodes.forEach(n => visit(n.id));
  if (!nodes.some(n => n.role === 'reviewer' && n.required)) fail(422, 'REVIEW_REQUIRED', '필수 검토 단계를 지정해 주세요.');
  if (task.commonId) { const common = state.commonTasks.find(item => item.id === task.commonId); if (!common) fail(422, 'COMMON_REFERENCE', '공통 원본을 찾을 수 없습니다.'); const remaining = nodes.filter(n => n.required).map(n => n.title); for (const title of common.requiredSteps) { const index = remaining.indexOf(title); if (index < 0) fail(422, 'COMMON_REQUIRED_STEP', `공통 필수 단계 '${title}'은 삭제하거나 선택 사항으로 변경할 수 없습니다.`); remaining.splice(index, 1); } }
  for (const sourceId of task.sourceIds) { const source = state.sources.find(s => s.id === sourceId); if (!source || (source.classification !== 'public' && source.departmentId !== task.departmentId)) fail(422, 'SOURCE_REFERENCE', '접근 가능한 근거 자료의 버전을 연결해 주세요.'); if (source.type === 'law' && !source.verified) fail(422, 'UNVERIFIED_LAW', '법령 근거의 원문과 적용 시점을 검토한 뒤 확정해 주세요.'); }
  for (const [key, value] of Object.entries(task.card)) if (!value.trim()) fail(422, 'CARD_REQUIRED', `업무관리카드의 ${key} 항목을 작성해 주세요. 해당 사항이 없으면 사유를 남겨 주세요.`);
}
function detailValidation(task: Task, state: WorkspaceData) {
  validateTaskMoney(task);
  for (const step of task.workflow) validateLinkedAttachments(state, task.id, step.attachmentIds, 'PROCEDURE');
  for (const entries of [task.expenses ?? [], task.references ?? []]) if (new Set(entries.map(item => item.id)).size !== entries.length) fail(422, 'DUPLICATE_DETAIL', '집행 내역과 근거 항목의 ID는 중복될 수 없습니다.');
  for (const reference of task.references ?? []) if (reference.attachmentId && !state.attachments.some(attachment => attachment.id === reference.attachmentId && attachment.taskId === task.id && !attachment.performanceId)) fail(422, 'REFERENCE_ATTACHMENT_INVALID', '해당 업무에 업로드한 파일만 근거에 연결할 수 있습니다.');
}
/** Build and validate a new record without mutating state or claiming files. */
function buildUnitForCreate(state: WorkspaceData, user: User, input: z.infer<typeof unitInput>, now: Date): Unit {
  const deptId = input.departmentId ?? user.departmentId;
  if (deptId !== user.departmentId || (input.ownerId && input.ownerId !== user.id)) scoped(user, deptId);
  if (!state.departments.some(department => department.id === deptId)) fail(422, 'DEPARTMENT_MISSING', '유효한 소유 부서를 선택해 주세요.');
  const owner = activeUser(state, input.ownerId ?? user.id, now);
  if (owner.departmentId !== deptId) fail(422, 'ASSIGNMENT_SCOPE', '소유 부서의 담당자를 선택해 주세요.');
  const unit: Unit = { id: id('unit'), title: input.title, description: input.description, importance: input.importance ?? DEFAULT_UNIT_IMPORTANCE, departmentId: deptId, ownerId: owner.id, color: 'stone', icon: 'folder' };
  uniqueUnitTitle(state, unit);
  return unit;
}

function buildTaskForCreate(state: WorkspaceData, user: User, input: z.infer<typeof taskInput>, now: Date, cardFactory: (description: string) => Task['card'] = defaultCard): Task {
  const unit = state.units.find(item => item.id === input.unitId);
  if (!unit) fail(422, 'UNIT_REQUIRED', '단위업무를 선택해 주세요.');
  if (unit.departmentId !== user.departmentId && user.role !== 'admin') fail(403, 'OUTSIDE_SCOPE', '소속 부서의 단위업무를 선택해 주세요.');
  personalTargetUnit(state, user, unit.id, unit.departmentId);
  const resolvedBudget = resolveTaskBudget(state, undefined, input);
  const storedInput = { ...input }; delete storedInput.budgetItemId;
  const task: Task = {
    ...storedInput, ...resolvedBudget, reviewerId: taskReviewer(state, unit.departmentId, input.primaryId, now),
    id: id('task'), code: `WK-${String(state.tasks.length + 1).padStart(3, '0')}`, departmentId: unit.departmentId,
    status: 'draft', version: 1, tags: [], card: input.card ?? cardFactory(input.description),
    workflow: (input.workflow ?? defaultWorkflow({ hasSupport: input.supportIds.length > 0 })).map(step => ({ ...step, done: false })),
    versions: [], createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  validateAssignments(state, user, task, now); detailValidation(task, state); validateWorkflow(task, state);
  validateDescriptionAttachments(state, user, task.id, task.descriptionAttachmentIds);
  return task;
}
/** Treat omitted optional defaults as the same stored configuration. */
function comparableTaskConfiguration(task: Task) {
  return JSON.parse(JSON.stringify({
    ...task, version: 0, updatedAt: '', descriptionAttachmentIds: task.descriptionAttachmentIds ?? [],
    budget: task.budget ?? 0, budgetMode: task.budgetMode ?? 'manual', expenses: task.expenses ?? [], references: task.references ?? [],
    workflow: task.workflow.map(step => ({ ...step, done: !!step.done, attachmentIds: step.attachmentIds ?? [] })),
  }));
}
function validateCycleSchedule(workflow: WorkflowStep[], input: z.infer<typeof cycleScheduleInput>) {
  if (input.startDate > input.dueDate) fail(422, 'CYCLE_DATE_RANGE', '회차 종료일은 시작일 이후여야 합니다.');
  if (new Set(input.steps.map(step => step.stepId)).size !== input.steps.length || input.steps.length !== workflow.length || input.steps.some(step => !workflow.some(item => item.id === step.stepId))) fail(422, 'CYCLE_STEPS_REQUIRED', '모든 절차의 일정을 한 번씩 입력해 주세요.');
  for (const schedule of input.steps) {
    if (schedule.startDate && (schedule.startDate < input.startDate || schedule.startDate > input.dueDate) || schedule.dueDate && (schedule.dueDate < input.startDate || schedule.dueDate > input.dueDate) || schedule.startDate && schedule.dueDate && schedule.startDate > schedule.dueDate) fail(422, 'CYCLE_STEP_DATE_RANGE', '각 절차 일정은 회차 기간 안에서 시작일·종료일 순서로 입력해 주세요.');
  }
  if (procedureScheduleConflicts(workflow, input.steps).length) fail(422, 'CYCLE_DEPENDENCY_DATE', '일정 미정인 중간 절차를 포함해 모든 선행 절차의 종료일 이후에 다음 절차를 시작하도록 일정을 정해 주세요.');
}
function scheduledWorkflow(workflow: WorkflowStep[], input: z.infer<typeof cycleScheduleInput>): WorkflowStep[] {
  return workflow.map(step => { const schedule = input.steps.find(item => item.stepId === step.id)!; return { ...step, startDate: schedule.startDate, dueDate: schedule.dueDate, scheduleDetails: schedule.scheduleDetails }; });
}
function cycleDeadlineAuditDetail(task: Task, cycleDueDate: string) {
  return task.dueDate && cycleDueDate > task.dueDate
    ? ` · 업무 마감일 초과 (업무 마감 ${task.dueDate} · 회차 종료 ${cycleDueDate})`
    : '';
}
/** Procedure edits own the definition; a managed cycle owns its current dates and notes. */
function preserveManagedSchedule(task: Task, run: Run, workflow: WorkflowStep[]): WorkflowStep[] {
  const current = runWorkflow(task, run);
  const merged = workflow.map(step => {
    const { startDate: _startDate, dueDate: _dueDate, scheduleDetails: _scheduleDetails, ...definition } = step;
    const schedule = current.find(item => item.id === step.id);
    return { ...definition, ...(schedule?.startDate !== undefined ? { startDate: schedule.startDate } : {}), ...(schedule?.dueDate !== undefined ? { dueDate: schedule.dueDate } : {}), ...(schedule?.scheduleDetails !== undefined ? { scheduleDetails: schedule.scheduleDetails } : {}) };
  });
  const orderChanged = !isDeepStrictEqual(current.map(step => ({ id: step.id, dependsOn: step.dependsOn })), merged.map(step => ({ id: step.id, dependsOn: step.dependsOn })));
  if (orderChanged) {
    // Manual reordering deliberately clears dates that contradict the new order.
    // Recompute against the latest schedule instead of trusting an older draft's omissions.
    const conflicts = new Set(procedureScheduleConflicts(merged, merged.map(step => ({ ...step, stepId: step.id }))).map(issue => issue.stepId));
    for (const step of merged) if (conflicts.has(step.id) && run.steps.find(item => item.stepId === step.id)?.status !== 'completed') {
      delete step.startDate; delete step.dueDate;
    }
  }
  return merged;
}
function assertCycleOwner(state: WorkspaceData, task: Task, user: User, action: string, now: Date) {
  if (user.role === 'head' || user.role !== 'admin' && task.primaryId !== user.id && !canActAsDeputy(state, user, task, action, now)) fail(403, 'CYCLE_OWNER_REQUIRED', '세부업무의 담당자·승인된 업무대행자 또는 관리자만 회차 일정을 등록하고 완료할 수 있습니다.');
  if (task.status === 'archived') fail(409, 'TASK_ARCHIVED', '보관된 업무의 회차는 변경할 수 없습니다.');
}
/** Materialize pre-cycle task flags without inventing historical completion evidence. */
function legacyExecution(task: Task, now: Date): Run {
  const run = createRun({ ...task, versions: [] }, currentPeriod(task.frequency, now), task.createdAt);
  run.id = id('run-cycle'); run.cycleNumber = 1; run.workflowSnapshot = structuredClone(task.workflow); run.dueDate = task.dueDate;
  run.steps.forEach(step => { if (task.workflow.find(item => item.id === step.stepId)?.done) { step.status = 'completed'; step.checklist.forEach(check => { check.done = true; }); } });
  const next = run.steps.find(step => step.status !== 'completed'); run.status = !next ? 'completed' : next.role === 'reviewer' ? 'review' : 'in_progress';
  return run;
}
function commonDistribution(state: WorkspaceData, payload: Record<string, unknown>): { common: CommonTask; distribution: CommonDistribution } {
  const common = state.commonTasks.find(item => item.id === required(payload, 'commonId'));
  if (!common) return fail(404, 'NOT_FOUND', '공통업무를 찾을 수 없습니다.');
  if (!commonPublished(common)) fail(409, 'COMMON_APPROVAL_REQUIRED', '작성 부서장의 승인 후에만 배정·등록할 수 있습니다.');
  const distribution = common.distributions.find(item => item.id === required(payload, 'distributionId'));
  if (!distribution) return fail(404, 'DISTRIBUTION_NOT_FOUND', '배포 항목을 찾을 수 없습니다.');
  return { common, distribution };
}
function ensureRegistered(state: WorkspaceData, task: Task) {
  if (!task.commonId) return;
  const common = state.commonTasks.find(c => c.id === task.commonId);
  if (common && !commonPublished(common)) fail(409, 'COMMON_APPROVAL_REQUIRED', '작성 부서장의 승인 후에만 수행할 수 있습니다.');
  const distribution = common?.distributions.find(d => d.taskId === task.id);
  if (distribution && !['assigned', 'registered', 'submitted'].includes(distribution.status)) fail(409, 'REGISTRATION_REQUIRED', '부서·팀·개인 배정 후 개인 단위업무에 등록해 주세요.');
}
function syncTaskExecution(state: WorkspaceData, task: Task, run: Run, now: Date) {
  const current = taskExecution(state, task).run;
  if (current?.id === run.id && run.definitionVersion === task.version && run.steps.length === task.workflow.length && task.workflow.every(step => run.steps.some(item => item.stepId === step.id))) {
    task.workflow.forEach(step => { step.done = run.steps.find(item => item.stepId === step.id)?.status === 'completed'; }); task.updatedAt = now.toISOString();
  }
  const common = state.commonTasks.find(item => item.id === task.commonId); const distribution = common?.distributions.find(item => item.taskId === task.id);
  if (common && distribution && ['registered', 'assigned', 'submitted'].includes(distribution.status)) distribution.status = commonDistributionStatus(state, common, distribution, now).status;
}
function makeCommonTask(state: WorkspaceData, common: CommonTask, departmentId: string, unitId: string, primaryId: string, reviewerId: string, now: Date): Task {
  return { id: id('task'), code: `WK-${String(state.tasks.length + 1).padStart(3, '0')}`, title: common.title, description: common.description, unitId, departmentId, primaryId, supportIds: [], reviewerId, status: 'draft', priority: common.kind === 'directive' ? 'high' : 'medium', frequency: common.frequency, dueDate: common.dueDate, tags: [common.kind === 'directive' ? '지시사항' : '공통업무', ...(common.projectName ? [common.projectName] : [])], version: 1, completionCriteria: '공통 필수 절차 수행 및 부서장 결과 검토', card: defaultCard(common.description), workflow: commonWorkflow(common.requiredSteps), sourceIds: [], versions: [], commonId: common.id, budget: 0, expenses: [], references: common.kind === 'directive' ? [{ id: id('reference'), type: 'directive', title: common.title, content: common.description }] : [], createdAt: now.toISOString(), updatedAt: now.toISOString() };
}
function createDirectiveTask(state: WorkspaceData, common: CommonTask, distribution: CommonDistribution, now: Date) {
  // A confirmed division can receive directives without adding provisional units or tasks.
  if (isDepartmentConfirmed(state, distribution.departmentId)) return;
  const manager = state.users.find(u => u.departmentId === distribution.departmentId && u.role === 'manager' && u.active && (!u.endsAt || new Date(u.endsAt) > now));
  const head = state.users.find(u => u.departmentId === distribution.departmentId && u.role === 'head' && u.active && (!u.endsAt || new Date(u.endsAt) > now));
  if (!manager || !head) fail(422, 'DEPARTMENT_STAFF_REQUIRED', '지시사항을 받을 부서의 담당자와 부서장을 먼저 등록해 주세요.');
  let unit = state.units.find(u => u.departmentId === distribution.departmentId && u.title === '지시사항 접수' && u.ownerId === manager.id && !u.deletedAt);
  if (!unit) { unit = { id: id('unit'), title: '지시사항 접수', description: '부서에 도착한 지시사항을 개인 배정 전까지 보관합니다.', departmentId: distribution.departmentId, ownerId: manager.id, importance: DEFAULT_UNIT_IMPORTANCE, color: 'stone', icon: 'folder' }; state.units.push(unit); }
  const task = makeCommonTask(state, common, distribution.departmentId, unit.id, manager.id, head.id, now); state.tasks.unshift(task); distribution.taskId = task.id;
}
function notifyAssignment(state: WorkspaceData, userId: string, common: CommonTask, description: string, now: Date, distribution?: CommonDistribution) {
  state.notifications.unshift({ id: id('notification'), title: common.title, description, type: 'common', targetType: distribution ? 'distribution' : 'common', targetId: distribution?.id ?? common.id, createdAt: now.toISOString(), read: false, userId });
}
function requestCommonApproval(state: WorkspaceData, user: User, common: CommonTask, kind: CommonApprovalRequest['kind'], targetDepartmentIds: string[], now: Date) {
  if (common.approvalRequests?.some(request => request.status === 'pending')) fail(409, 'COMMON_APPROVAL_PENDING', '진행 중인 배포 승인 요청을 먼저 처리해 주세요.');
  const departmentId = commonOriginDepartment(state, common);
  if (!departmentId || !state.departments.some(department => department.id === departmentId)) fail(422, 'COMMON_ORIGIN_REQUIRED', '작성 부서 정보를 확인해 주세요.');
  common.originDepartmentId = departmentId;
  const request: CommonApprovalRequest = { id: id('common-approval'), kind, status: 'pending', departmentId, requestedBy: user.id, requestedAt: now.toISOString(), targetDepartmentIds: [...targetDepartmentIds], version: common.version, snapshot: commonApprovalSnapshot(common) };
  common.approvalRequests ??= []; common.approvalRequests.unshift(request);
  for (const head of state.users.filter(member => member.departmentId === departmentId && member.role === 'head' && member.active && (!member.endsAt || new Date(member.endsAt) > now))) notifyAssignment(state, head.id, common, `${user.name}님이 ${kind === 'initial' ? '공통 세부업무' : '대상 부서 추가'} 배포 승인을 요청했습니다.`, now);
  return request;
}
function handoverAccess(state: WorkspaceData, user: User, handoverId: string): Handover { const h = state.handovers.find(item => item.id === handoverId); if (!h || !([h.fromId, h.toId].includes(user.id) || manageDepartment(user, h.departmentId) || manageDepartment(user, h.targetDepartmentId))) return fail(403, 'HANDOVER_ACCESS_DENIED', '인수인계에 접근할 수 없습니다.'); return h; }
function invalidateHandoverConfirmations(state: WorkspaceData, taskId: string) { for (const h of state.handovers.filter(h => h.taskIds.includes(taskId) && !['completed', 'cancelled'].includes(h.status))) { h.revision++; h.approvedBy = undefined; h.approvedAt = undefined; h.acceptedBy = undefined; h.acceptedAt = undefined; h.acceptedRevision = undefined; h.checklist.forEach(c => { c.checked = false; }); h.status = 'approval'; h.feedback = '연결된 업무 기준이 변경되었습니다. 승인과 인수 확인을 다시 진행해 주세요.'; } }
function applyHandover(state: WorkspaceData, h: Handover, now: Date) {
  if (h.status === 'completed') return;
  assertDepartmentEditable(state, h.departmentId); assertDepartmentEditable(state, h.targetDepartmentId);
  if (!h.approvedBy || !h.acceptedBy || h.acceptedRevision !== h.revision || !h.checklist.every(c => c.checked)) fail(409, 'HANDOVER_NOT_READY', '승인과 인수자의 최신 버전 수락, 자료 확인이 모두 필요합니다.');
  for (const taskId of h.taskIds) { const task = state.tasks.find(item => item.id === taskId); if (!task) fail(409, 'HANDOVER_CONFLICT', '인계할 업무를 찾을 수 없습니다.'); assertTaskWritable(state, task); assertDepartmentEditable(state, task.departmentId); }
  if (new Date(h.effectiveAt) > now) { h.status = 'scheduled'; return; }
  const recipient = activeUser(state, h.toId, now); if (recipient.departmentId !== h.targetDepartmentId) fail(409, 'RECIPIENT_CHANGED', '인수자의 소속이 변경되었습니다. 인계 내용을 다시 검토해 주세요.');
  if (h.departmentId !== h.targetDepartmentId) fail(409, 'CROSS_DEPARTMENT_REVIEW', '부서 간 이동은 양쪽 부서 확인과 새 단위업무 지정이 필요합니다. 현재 버전에서는 부서 내 인계만 적용합니다.');
  for (const taskId of h.taskIds) { const task = state.tasks.find(t => t.id === taskId); if (!task || task.primaryId !== h.fromId || task.status === 'archived') fail(409, 'HANDOVER_CONFLICT', '기존 담당자 또는 업무 상태가 변경되었습니다. 인수인계를 다시 확인해 주세요.'); if (task.reviewerId === h.toId) fail(409, 'SELF_REVIEW', '인수자와 최종 검토자가 같아질 수 없습니다. 먼저 검토자를 조정해 주세요.'); }
  for (const taskId of h.taskIds) { const task = state.tasks.find(t => t.id === taskId)!; task.primaryId = h.toId; task.supportIds = task.supportIds.filter(u => u !== h.toId); task.updatedAt = now.toISOString(); task.version = (task.versions.at(-1)?.version ?? task.version) + 1; task.versions.push(snapshot(task, h.approvedBy, now.toISOString())); state.delegations.filter(d => d.taskId === taskId && !d.revokedAt).forEach(d => { d.revokedAt = now.toISOString(); }); }
  for (const runId of h.runIds) { const run = state.runs.find(r => r.id === runId); if (!run || !h.taskIds.includes(run.taskId) || run.primaryId !== h.fromId || run.status === 'completed') fail(409, 'RUN_HANDOVER_CONFLICT', '선택한 진행 회차의 담당자 또는 상태가 변경되었습니다.'); run.primaryId = h.toId; run.supportIds = run.supportIds.filter(u => u !== h.toId); }
  h.status = 'completed'; h.appliedAt = now.toISOString(); emit(state, recipient, 'handover.apply', 'handover', h.id, '책임 이전 완료', `효력 ${h.effectiveAt} · 실제 적용 ${h.appliedAt}`, h.departmentId, now);
}
type RevisionSnapshot = ReturnType<typeof captureEntityRevisions>;
function captureEntityRevisions(state: WorkspaceData) {
  return {
    records: new Map(revisionEntities(state).map(({ target, entity }) => {
      const { rev: _rev, ...value } = entity;
      return [commandTargetKey(target), { value: structuredClone(value), rev: entityRevision(entity) }] as const;
    })),
    logical: new Map(logicalTargets(state).map(target => [commandTargetKey(target), { target, rev: targetRevision(state, target) }] as const)),
  };
}
function advanceEntityRevisions(state: WorkspaceData, before: RevisionSnapshot): TargetRevisionChange[] {
  // Compare business content before touching any rev, including parent catalog snapshots.
  const updates = revisionEntities(state).map(({ target, entity }) => {
    const previous = before.records.get(commandTargetKey(target));
    const { rev: _rev, ...value } = entity;
    return { target, entity, previous, changed: !previous || !isDeepStrictEqual(previous.value, value) };
  });
  const changes: TargetRevisionChange[] = [];
  for (const { target, entity, previous, changed } of updates) {
    if (changed) {
      entity.rev = (previous?.rev ?? 0) + 1;
      changes.push({ ...target, fromRev: previous?.rev ?? 0, toRev: entity.rev });
    } else if (previous!.rev > 0) entity.rev = previous!.rev;
    else delete entity.rev;
  }
  const logical = new Map(before.logical);
  for (const target of logicalTargets(state)) if (!logical.has(commandTargetKey(target))) logical.set(commandTargetKey(target), { target, rev: 0 });
  for (const { target, rev: fromRev } of logical.values()) {
    const toRev = targetRevision(state, target);
    if (fromRev !== toRev) changes.push({ ...target, fromRev, toRev });
  }
  return changes;
}
export function hasDueHandovers(state: Pick<WorkspaceData, 'handovers'>, now = new Date()): boolean {
  return state.handovers.some(handover => handover.status === 'scheduled' && new Date(handover.effectiveAt) <= now);
}
export function reconcileDueHandovers(state: WorkspaceData, now = new Date()) {
  const due = state.handovers.filter(item => item.status === 'scheduled' && new Date(item.effectiveAt) <= now);
  if (!due.length) return false;
  const before = captureEntityRevisions(state);
  let applied = false;
  for (const h of due) {
    const candidate = structuredClone(state); const target = candidate.handovers.find(item => item.id === h.id)!;
    try { applyHandover(candidate, target, now); Object.assign(state, candidate); applied = true; }
    catch (error) { const current = state.handovers.find(item => item.id === h.id)!; current.feedback = error instanceof Error ? error.message : '적용 조건을 확인해 주세요.'; }
  }
  const changed = advanceEntityRevisions(state, before).length > 0;
  if (changed) state.revision++;
  return applied;
}

function departmentDivisionReadModel(state: WorkspaceData, departmentId: string, now: Date): DepartmentDivisionReadModel {
  const plan = departmentWorkPlan(state, departmentId);
  const units = state.units.filter(unit => unit.departmentId === departmentId && !unit.deletedAt).map(unit => ({ id: unit.id, title: unit.title, ownerId: unit.ownerId }));
  const unitIds = new Set(units.map(unit => unit.id));
  const tasks = state.tasks.filter(task => task.departmentId === departmentId && unitIds.has(task.unitId) && !task.deletedAt && task.status !== 'archived' && isRegisteredWork(state, task)
    && (!task.commonId || state.commonTasks.some(common => common.id === task.commonId && commonPublished(common)))).map(task => ({
    id: task.id, code: task.code, title: task.title, unitId: task.unitId, primaryId: task.primaryId, supportIds: [...task.supportIds], reviewerId: task.reviewerId,
    frequency: task.frequency, status: task.status, ...(task.commonId ? { commonId: task.commonId } : {}),
  }));
  const referencedMembers = new Set([...units.map(unit => unit.ownerId), ...tasks.flatMap(task => [task.primaryId, task.reviewerId, ...task.supportIds])]);
  const members = state.users.filter(member => member.departmentId === departmentId && (member.active && (!member.endsAt || new Date(member.endsAt) > now) || referencedMembers.has(member.id)))
    .map(member => ({ id: member.id, name: member.name, team: member.team }));
  return { departmentId, status: plan.status, version: plan.version, ...(plan.confirmedAt ? { confirmedAt: plan.confirmedAt } : {}), units, tasks, members };
}

export function getWorkspace(state: WorkspaceData, userId: string, now = new Date()): Workspace {
  const user = activeUser(state, userId, now); const tasks = state.tasks.filter(t => canReadTask(state, user, t, now)).map(task => {
    const latestRun = latestTaskRun(state, task.id);
    const view = latestRun ? { ...task, cycleStartDate: latestRun.startDate, cycleDueDate: latestRun.dueDate } : task;
    const run = taskExecution(state, task).run;
    if (!run || run.definitionVersion !== task.version || run.steps.length !== task.workflow.length || task.workflow.some(step => !run.steps.some(item => item.stepId === step.id))) return view;
    return { ...view, workflow: run.workflowSnapshot ? runWorkflow(task, run) : task.workflow.map(step => ({ ...step, done: run.steps.find(item => item.stepId === step.id)?.status === 'completed' })) };
  }); const taskIds = new Set(tasks.map(t => t.id)); const runs = state.runs.filter(r => taskIds.has(r.taskId));
  const deptIds = new Set(user.role === 'admin' ? state.departments.map(d => d.id) : [user.departmentId]); const audit = state.audit.filter(e => ((isManager(user) && deptIds.has(e.departmentId)) || e.actorId === user.id) && (!e.action.startsWith('performance.') || e.actorId === user.id || approveDepartment(user, e.departmentId)));
  const canSeeCommonRequests = (common: CommonTask) => user.role === 'admin' || common.managerId === user.id || ['head', 'manager'].includes(user.role) && commonOriginDepartment(state, common) === user.departmentId;
  const commonTasks = state.commonTasks.filter(common => canSeeCommonRequests(common) || commonPublished(common) && (common.departmentIds.includes(user.departmentId) || isCentralDirective(common) && isDirectiveCoordinator(state, user, now))).map(common => {
    const distributions = common.distributions.filter(distribution => canSeeCommonRequests(common) || distribution.departmentId === user.departmentId || isCentralDirective(common) && isDirectiveCoordinator(state, user, now)).map(distribution => commonDistributionStatus(state, common, distribution, now));
    const approvalRequests = canSeeCommonRequests(common) ? common.approvalRequests : common.approvalRequests?.filter(request => request.status === 'approved');
    return { ...common, ...(approvalRequests ? { approvalRequests } : {}), distributions, summary: summarizeCommon(distributions) };
  });
  const handovers = state.handovers.filter(h => [h.fromId, h.toId].includes(user.id) || (isManager(user) && (deptIds.has(h.departmentId) || deptIds.has(h.targetDepartmentId))));
  const workTransfers = (state.workTransfers ?? []).filter(transfer => [transfer.fromId, transfer.toId, transfer.requestedBy].includes(user.id) || isManager(user) && deptIds.has(transfer.departmentId));
  const identityIds = new Set<string>([user.id]);
  for (const unit of state.units.filter(item => deptIds.has(item.departmentId))) identityIds.add(unit.ownerId);
  for (const transfer of workTransfers) [transfer.fromId, transfer.toId, transfer.requestedBy, transfer.approvedBy, transfer.resolvedBy].forEach(value => { if (value) identityIds.add(value); });
  for (const task of tasks) [task.primaryId, task.reviewerId, ...task.supportIds].forEach(value => identityIds.add(value));
  for (const run of runs) [run.primaryId, run.reviewerId, ...run.supportIds, ...run.notes.map(note => note.authorId)].forEach(value => identityIds.add(value));
  for (const handover of handovers) [handover.fromId, handover.toId, handover.approvedBy, handover.acceptedBy].forEach(value => { if (value) identityIds.add(value); });
  for (const common of commonTasks) { identityIds.add(common.managerId); for (const request of common.approvalRequests ?? []) [request.requestedBy, request.resolvedBy].forEach(value => { if (value) identityIds.add(value); }); for (const distribution of common.distributions) [distribution.leadId, distribution.assigneeId, distribution.currentAssigneeId, distribution.taskOwnerId, ...(distribution.nextActorIds ?? []), ...(distribution.monthlyReports ?? []).map(report => report.authorId)].forEach(value => { if (value) identityIds.add(value); }); }
  const directoryIds = new Set(deptIds); for (const common of commonTasks) { for (const distribution of common.distributions) directoryIds.add(distribution.departmentId); for (const request of common.approvalRequests ?? []) request.targetDepartmentIds.forEach(value => directoryIds.add(value)); }
  const departmentWorkPlans = state.departments.filter(department => deptIds.has(department.id)).map(department => {
    const plan = departmentWorkPlan(state, department.id);
    if (user.role === 'admin' || user.role === 'head') return structuredClone(plan);
    const { snapshot: _snapshot, history: _history, ...metadata } = plan; return metadata;
  });
  const canReadEvaluation = (item: { personId: string; departmentId: string }) => user.role === 'admin' || user.role === 'head' && item.departmentId === user.departmentId || item.personId === user.id;
  for (const run of runs) for (const history of run.procedureHistory ?? []) {
    [history.replacedBy, history.primaryId, history.reviewerId, ...history.supportIds, ...history.notes.map(note => note.authorId), ...history.steps.flatMap(step => [step.completedBy, ...step.checklist.map(check => check.completedBy)])].forEach(personId => { if (personId) identityIds.add(personId); });
  }
  for (const item of [...(state.unitScorePlans ?? []), ...(state.unitEvaluations ?? []), ...state.performances.filter(performance => performance.period).map(performance => ({ personId: performance.authorId, departmentId: performance.departmentId }))].filter(canReadEvaluation)) identityIds.add(item.personId);
  const submissionKeys = new Map<string, { personId: string; departmentId: string; period: string }>();
  for (const item of [...(state.unitScorePlans ?? []), ...(state.unitEvaluations ?? []), ...state.performances.filter(performance => performance.period).map(performance => ({ personId: performance.authorId, departmentId: performance.departmentId, period: performance.period! }))]) {
    if (item.personId === user.id || isManager(user) && deptIds.has(item.departmentId)) submissionKeys.set(`${item.personId}:${item.period}`, { personId: item.personId, departmentId: item.departmentId, period: item.period });
  }
  const performanceSubmissionStatuses: PerformanceSubmissionStatus[] = [...submissionKeys.values()].map(item => {
    const plan = getUnitScorePlan(state, item.personId, item.period), evaluation = getUnitEvaluation(state, item.personId, item.period);
    return { ...item, status: evaluation ? 'evaluated' : plan?.submittedAt ? 'submitted' : 'not_submitted', submittedAt: plan?.submittedAt, evaluatedAt: evaluation?.evaluatedAt };
  });
  return { revision: state.revision, currentUser: user, users: state.users.filter(member => deptIds.has(member.departmentId)), departments: state.departments.filter(department => deptIds.has(department.id)), identities: state.users.filter(member => identityIds.has(member.id)).map(userIdentity), departmentDirectory: state.departments.filter(department => canManageCommon(user, now) || isDirectiveCoordinator(state, user, now) || directoryIds.has(department.id)), departmentWorkPlans, departmentDivision: departmentDivisionReadModel(state, user.departmentId, now), organizationDivision: organizationDivisionForUser(state, user, now), delegatedTaskIds: tasks.filter(task => canActAsDeputy(state, user, task, undefined, now)).map(task => task.id), units: state.units.filter(u => deptIds.has(u.departmentId)).map(unit => ({ ...unit, importance: unitImportance(unit) })), tasks, runs,
    handovers, workTransfers, commonTasks,
    sources: state.sources.filter(s => canReadSource(state, user, s, now)), performances: state.performances.filter(p => p.authorId === user.id || user.role === 'admin' || (user.role === 'head' ? p.departmentId === user.departmentId : !p.period && taskIds.has(p.taskId))), delegations: state.delegations.filter(d => [d.fromId, d.toId, d.requestedBy].includes(user.id) || manageDepartment(user, d.departmentId ?? state.tasks.find(task => task.id === d.taskId)?.departmentId ?? '')), audit, performanceSubmissionStatuses,
    notifications: state.notifications.filter(n => n.userId === user.id), attachments: state.attachments.filter(a => canReadAttachment(state, user, a, now)).map(a => ({ ...a, storageKey: '' })), releases: state.releases ?? [], unitScorePlans: (state.unitScorePlans ?? []).filter(canReadEvaluation), unitEvaluations: (state.unitEvaluations ?? []).filter(canReadEvaluation),
    mode: resolveStoreMode() === 'neon' ? 'connected' : 'local', integrations: { database: resolveStoreMode() === 'neon' ? 'Neon PostgreSQL 연결' : '로컬 파일 저장', auth: process.env.IEUM_PROTOTYPE_MODE === 'true' ? '프로토타입 역할 선택' : process.env.NEON_AUTH_BASE_URL ? 'Neon 인증 연결' : '로컬 데모 계정', storage: resolveAttachmentStoreMode() === 'neon' ? (['AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'].every(key => process.env[key]?.trim()) ? 'Neon Object Storage 연결 설정됨' : 'Neon 저장소 설정 필요') : process.env.VERCEL ? '미연결 · Neon 저장소 설정 필요' : '로컬 격리 저장', bizrouter: process.env.BIZROUTER_API_KEY?.trim() && process.env.BIZROUTER_MODEL?.trim() ? '연결 설정됨 · 호출 미검증' : process.env.BIZROUTER_API_KEY?.trim() ? '모델 설정 필요 · 수기 작성 가능' : '미연결 · 수기 작성 가능', law: process.env.LAW_API_OC ? '키 설정됨 · 호출 미검증' : '미연결 · 수기 등록 가능' }, serverTime: now.toISOString() };
}

export function executeCommand(state: WorkspaceData, userId: string, raw: unknown, now = new Date()): TargetRevisionChange[] {
  const user = activeUser(state, userId, now); const command: Command = parseInput(z.object({ type: text, payload: z.record(z.string(), z.unknown()), expectedRevision: z.number().int().nonnegative(), expected: z.object({ kind: commandTargetKind, id: text, rev: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).optional(), requestId: text.max(150) }), raw);
  const parse = <T>(schema: z.ZodType<T>, value: unknown): T => parseInput(schema, value, { labels: commandValidationLabels(command.type) });
  const required = (payload: Record<string, unknown>, key: string): string => parseInput(text, payload[key], { path: key, labels: commandValidationLabels(command.type) });
  let importInput: WorkImportInput | undefined;
  if (command.type === 'work.import') {
    const validated = validateWorkImport(command.payload);
    if (!validated.success) throw new DomainError(422, 'VALIDATION_ERROR', validated.issues[0]?.message ?? '등록할 업무 내용을 확인해 주세요.', validated.issues);
    importInput = validated.data;
  }
  // A response-loss retry may have a new transport request ID. The reviewed import owns a stable identity.
  const requestKey = importInput ? `work.import:${importInput.importId}` : command.requestId;
  const fingerprint = createHash('sha256').update(importInput ? `work.import\n${canonicalWorkImport(importInput)}` : JSON.stringify({ type: command.type, payload: command.payload })).digest('hex');
  const prior = state.processedRequests.find(request => request.id === requestKey && request.actorId === user.id);
  if (prior) { if (prior.fingerprint !== fingerprint) fail(409, 'IDEMPOTENCY_CONFLICT', '동일한 요청 ID에 다른 내용이 전달되었습니다.'); return []; }
  const target = commandTarget(command.type, command.payload, { actorId: user.id, departmentId: user.departmentId, delegations: state.delegations });
  if (command.expected) {
    if (!target || commandTargetKey(target) !== commandTargetKey(command.expected)) fail(422, 'COMMAND_TARGET_MISMATCH', '저장할 대상과 변경 확인 대상이 다릅니다. 입력 내용을 확인해 주세요.');
    if (targetRevision(state, target) !== command.expected.rev) fail(409, 'TARGET_CONFLICT', `이 ${targetLabels[target.kind]} 내용을 다른 사용자가 먼저 수정했습니다. 최신 내용을 불러왔으니 변경 내용을 확인한 뒤 다시 저장해 주세요.`);
  } else if (target) console.warn('[ieum] Command missing expected target revision:', command.type, target.kind);
  // The bundled catalog already exists logically before its first persisted edit.
  // Include it in that command's baseline so untouched items keep revision zero.
  const before = captureEntityRevisions(command.type.startsWith('budget.') && !state.budgetCatalog ? { ...state, budgetCatalog: getBudgetCatalog(state) } : state);
  const p = command.payload; let targetId = ''; let departmentId = user.departmentId; let detail = ''; let title = '';
  assertDefinitionCommand(state, user, command.type, p);
  switch (command.type) {
    case 'budget.upsert': case 'budget.setActive': case 'budget.import': {
      ({ targetId, departmentId, detail, title } = executeBudgetCommand(state, user, command.type, p, now));
      break;
    }
    case 'transfer.emergency': case 'transfer.request': case 'transfer.rolesRequest': case 'transfer.approve': case 'transfer.reject': case 'transfer.cancel': {
      const result = executePersonnelTransfer(state, user, command.type, p, now, fail);
      ({ targetId, departmentId, detail, title } = result);
      break;
    }
    case 'department.confirm': case 'department.reopen': {
      const deptId = p.departmentId === undefined ? user.departmentId : required(p, 'departmentId'); scoped(user, deptId, true);
      if (!state.departments.some(department => department.id === deptId)) fail(422, 'DEPARTMENT_MISSING', '유효한 부서를 선택해 주세요.');
      const current = departmentWorkPlan(state, deptId);
      if (command.type === 'department.confirm') {
        if (current.status === 'confirmed') fail(409, 'DEPARTMENT_ALREADY_CONFIRMED', '이미 확정된 부서 업무분장입니다. 변경이 필요하면 재작성을 허용해 주세요.');
        const candidate = structuredClone(state);
        const activeTasks = candidate.tasks.filter(task => task.departmentId === deptId && !task.deletedAt && task.status !== 'archived' && isRegisteredWork(candidate, task));
        for (const task of activeTasks) { assertTaskWritable(candidate, task); validateAssignments(candidate, user, task, now); detailValidation(task, candidate); validateWorkflow(task, candidate); }
        let confirmedCount = 0;
        for (const task of activeTasks.filter(task => task.status !== 'confirmed')) {
          task.version = (task.versions.at(-1)?.version ?? 0) + 1; task.versions.push(snapshot(task, user.id, now.toISOString())); task.status = 'confirmed'; task.updatedAt = now.toISOString(); confirmedCount++;
          invalidateHandoverConfirmations(candidate, task.id);
          const period = currentPeriod(task.frequency, now);
          if (!candidate.runs.some(run => run.taskId === task.id && (run.cycleManaged || normalizePeriod(task.frequency, run.period, now) === period))) {
            const run = createRun(task, period, now.toISOString()); run.updatedAt = now.toISOString(); candidate.runs.unshift(run); syncTaskExecution(candidate, task, run, now);
          }
        }
        const plan = structuredClone(current); const division = workDivisionSnapshot(candidate, deptId);
        plan.status = 'confirmed'; plan.version++; plan.confirmedBy = user.id; plan.confirmedAt = now.toISOString(); plan.snapshot = division;
        plan.history = [...(plan.history ?? []), { version: plan.version, confirmedBy: user.id, confirmedAt: now.toISOString(), snapshot: structuredClone(division) }];
        candidate.departmentWorkPlans = [...(candidate.departmentWorkPlans ?? []).filter(item => item.departmentId !== deptId), plan]; Object.assign(state, candidate);
        title = '부서 업무분장 확정'; detail = `업무분장 ${plan.version}차 · 세부업무 ${activeTasks.length}건 확인 · 신규 기준 확정 ${confirmedCount}건`;
      } else {
        if (current.status !== 'confirmed') fail(409, 'DEPARTMENT_NOT_CONFIRMED', '확정된 업무분장만 재작성을 허용할 수 있습니다.');
        const reason = required(p, 'reason');
        const plan = { ...current, status: 'draft' as const, reopenedBy: user.id, reopenedAt: now.toISOString(), reason };
        state.departmentWorkPlans = [...(state.departmentWorkPlans ?? []).filter(item => item.departmentId !== deptId), plan];
        title = '부서 업무분장 재작성 허용'; detail = reason;
      }
      targetId = deptId; departmentId = deptId; break;
    }
    case 'unit.create': {
      const unit = buildUnitForCreate(state, user, parse(unitInput, p), now);
      state.units.push(unit); targetId = unit.id; departmentId = unit.departmentId; detail = unit.title; title = '단위업무 등록'; break;
    }
    case 'work.import': {
      assertDefinitionWritable(state, user, user.departmentId);
      // Resolve the current reviewer at commit time, never from model output or a stale preview.
      taskReviewer(state, user.departmentId, user.id, now);
      const input = importInput!;
      const staged = { ...state, units: [...state.units], tasks: [...state.tasks] };
      const created: { unitId: string; taskIds: string[] }[] = [];
      for (const [index, unitDraft] of input.units.entries()) {
        let unit: Unit;
        try { unit = buildUnitForCreate(staged, user, { title: unitDraft.title, description: unitDraft.description }, now); }
        catch (error) {
          if (error instanceof DomainError && error.code === 'DUPLICATE_UNIT') throw new DomainError(error.status, error.code, error.message, [{ path: `units.${index}.title`, message: error.message }]);
          throw error;
        }
        staged.units.push(unit);
        const taskIds: string[] = [];
        for (const taskDraft of unitDraft.tasks) {
          const task = buildTaskForCreate(staged, user, parse(taskInput, { ...taskDraft, unitId: unit.id, primaryId: user.id, supportIds: [], sourceIds: [], completionCriteria: '필수 절차 수행 및 검토 완료' }), now, workImportNeutralCard);
          staged.tasks.unshift(task); taskIds.push(task.id);
        }
        created.push({ unitId: unit.id, taskIds });
      }
      // All validation above is read-only against existing records. Publish both collections together.
      state.units = staged.units; state.tasks = staged.tasks;
      targetId = input.importId; departmentId = user.departmentId; title = '개인 업무 일괄 등록';
      detail = JSON.stringify({ importId: input.importId, unitCount: created.length, taskCount: created.reduce((count, unit) => count + unit.taskIds.length, 0), created });
      break;
    }
    case 'unit.update': {
      const unit = ownedUnit(state, user, required(p, 'unitId')); const input = parse(z.object({ title: text.max(100), description: text, importance: importanceInput.optional() }), p);
      uniqueUnitTitle(state, { ...unit, ...input }); Object.assign(unit, input, { importance: input.importance ?? unitImportance(unit) });
      targetId = unit.id; departmentId = unit.departmentId; detail = unit.title; title = '개인 단위업무 수정'; break;
    }
    case 'unit.delete': {
      const unit = ownedUnit(state, user, required(p, 'unitId'));
      if (state.tasks.some(task => task.unitId === unit.id && !task.deletedAt && task.status !== 'archived')) fail(409, 'UNIT_NOT_EMPTY', '활성 세부업무가 남아 있습니다. 하위 세부업무를 먼저 다른 단위업무로 이동하거나 삭제해 주세요.');
      unit.deletedAt = now.toISOString(); targetId = unit.id; departmentId = unit.departmentId; detail = unit.title; title = '단위업무 휴지통 이동'; break;
    }
    case 'unit.restore': {
      const unit = ownedUnit(state, user, required(p, 'unitId'), true);
      if (!unit.deletedAt) fail(409, 'UNIT_NOT_DELETED', '휴지통에 있는 단위업무만 복원할 수 있습니다.');
      const owner = activeUser(state, unit.ownerId, now); if (owner.departmentId !== unit.departmentId) fail(422, 'ASSIGNMENT_SCOPE', '소유자의 부서가 변경되어 이 단위업무를 복원할 수 없습니다.');
      uniqueUnitTitle(state, unit); delete unit.deletedAt;
      targetId = unit.id; departmentId = unit.departmentId; detail = unit.title; title = '개인 단위업무 복원'; break;
    }
    case 'organization.departmentCreate': {
      if (user.role !== 'admin') fail(403, 'ADMIN_REQUIRED', '기관 관리자만 조직을 등록할 수 있습니다.');
      const input = parse(z.object({ name: text.max(100), shortName: text.max(10) }), p);
      if (state.departments.some(department => department.name.trim().toLowerCase() === input.name.toLowerCase() || department.shortName.trim().toLowerCase() === input.shortName.toLowerCase())) fail(409, 'DUPLICATE_DEPARTMENT', '같은 부서 이름 또는 짧은 이름이 있습니다.');
      const department = { ...input, id: id('dept') }; state.departments.push(department);
      targetId = department.id; departmentId = department.id; detail = `${department.name} · 부서장과 부서 담당자를 등록해 주세요.`; title = '조직 등록'; break;
    }
    case 'organization.userCreate': case 'organization.userUpdate': {
      if (user.role !== 'admin') fail(403, 'ADMIN_REQUIRED', '기관 관리자만 구성원의 등록·인사정보 변경을 처리할 수 있습니다.');
      const input = parse(z.object({ name: text.max(50), departmentId: text, team: text.max(100), role: z.enum(['admin', 'head', 'manager', 'lead', 'member']), title: text.max(100), email: z.string().trim().toLowerCase().max(254).refine(value => !value || z.email().safeParse(value).success, '이메일 형식을 확인해 주세요.').optional(), phone: z.string().trim().max(30).refine(value => !value || /^[+\d][\d\s().-]{3,29}$/.test(value), '전화번호 형식을 확인해 주세요.').optional() }), p);
      if (!state.departments.some(department => department.id === input.departmentId)) fail(422, 'DEPARTMENT_MISSING', '소속 부서를 선택해 주세요.');
      if (command.type === 'organization.userCreate') {
        const member: User = { ...input, email: input.email || undefined, phone: input.phone || undefined, id: id('user'), initials: input.name.slice(0, 1), color: 'stone', active: true };
        const issue = organizationIdentityIssue(state, member); if (issue) fail(issue.status, issue.code, issue.message);
        state.users.push(member); targetId = member.id; departmentId = member.departmentId; detail = JSON.stringify({ name: member.name, departmentId: member.departmentId, team: member.team, role: member.role }); title = '구성원 등록';
      } else {
        const member = state.users.find(item => item.id === required(p, 'userId'));
        if (!member) fail(404, 'USER_NOT_FOUND', '변경할 구성원을 찾을 수 없습니다.');
        const active = parse(z.boolean(), p.active); const reason = required(p, 'reason');
        const next: User = { ...member, ...input, email: input.email || undefined, phone: input.phone || undefined, initials: input.name.slice(0, 1), active };
        if (active && (!member.active || member.endsAt && Date.parse(member.endsAt) <= now.getTime())) delete next.endsAt;
        const issue = organizationUserChangeIssue(state, user, member, next, now); if (issue) fail(issue.status, issue.code, issue.message);
        const before = structuredClone(member); Object.assign(member, next); delete member.commonTaskPermission; if (!next.endsAt) delete member.endsAt;
        targetId = member.id; departmentId = before.departmentId; detail = JSON.stringify({ reason, before, after: member }); title = '구성원 인사정보 변경';
      }
      break;
    }
    case 'common.create': case 'common.resubmit': {
      if (!canCreateCommon(user, now)) fail(403, 'COMMON_CREATION_DENIED', '업무를 작성할 수 있는 활성 구성원으로 요청해 주세요.');
      const input = parse(commonInput, p);
      if (input.kind === 'directive') {
        if (!input.directiveIssuer || !input.instructedOn) fail(422, 'DIRECTIVE_METADATA_REQUIRED', '지시사항의 지시자와 지시일자를 입력해 주세요.');
        validateDirectiveDate({ dueDate: input.dueDate, distributions: [] }, input.instructedOn, now);
      } else { delete input.directiveIssuer; delete input.instructedOn; }
      const departmentIds = input.distributionMode === 'all' ? state.departments.map(d => d.id) : [...new Set(input.departmentIds)];
      if (departmentIds.some(deptId => !state.departments.some(d => d.id === deptId))) fail(422, 'DEPARTMENT_MISSING', '유효한 배포 대상 부서를 선택해 주세요.');
      let common: CommonTask;
      if (command.type === 'common.resubmit') {
        const existing = state.commonTasks.find(item => item.id === required(p, 'commonId'));
        if (!existing || existing.managerId !== user.id && user.role !== 'admin') fail(403, 'COMMON_AUTHOR_REQUIRED', '작성자 또는 관리자만 반려된 업무를 수정하여 다시 요청할 수 있습니다.');
        if (existing.publicationStatus !== 'rejected' || existing.approvalRequests?.some(request => request.status === 'pending')) fail(409, 'COMMON_RESUBMIT_STATE', '최초 배포 요청이 반려된 업무만 다시 요청할 수 있습니다.');
        const owner = activeUser(state, existing.managerId, now);
        if (owner.departmentId !== commonOriginDepartment(state, existing) || owner.role === 'head') fail(409, 'COMMON_AUTHOR_CHANGED', '작성자의 소속 또는 역할이 바뀌었습니다. 업무 책임을 확인해 주세요.');
        if (!state.departments.some(department => department.id === owner.departmentId)) fail(422, 'COMMON_ORIGIN_REQUIRED', '작성 부서 정보를 확인해 주세요.');
        common = existing; Object.assign(common, input, { departmentIds: [], distributions: [], publicationStatus: 'pending', version: existing.version + 1 });
        if (input.kind !== 'directive') { delete common.directiveIssuer; delete common.instructedOn; }
      } else {
        if (!state.departments.some(department => department.id === user.departmentId)) fail(422, 'COMMON_ORIGIN_REQUIRED', '작성 부서 정보를 확인해 주세요.');
        common = { ...input, departmentIds: [], id: id('common'), managerId: user.id, originDepartmentId: user.departmentId, publicationStatus: 'pending', version: 1, distributions: [] };
        state.commonTasks.unshift(common);
      }
      const request = requestCommonApproval(state, user, common, 'initial', departmentIds, now);
      targetId = common.id; departmentId = request.departmentId; detail = JSON.stringify({ requestId: request.id, targets: departmentIds, snapshot: request.snapshot }); title = command.type === 'common.resubmit' ? '공통 세부업무 수정 및 배포 재요청' : '공통 세부업무 작성 · 부서장 승인 요청'; break;
    }
    case 'common.approve': case 'common.reject': {
      const common = state.commonTasks.find(item => item.id === required(p, 'commonId'));
      if (!common) fail(404, 'NOT_FOUND', '공통업무를 찾을 수 없습니다.');
      const request = common.approvalRequests?.find(item => item.id === required(p, 'requestId'));
      if (!request || request.status !== 'pending') fail(409, 'COMMON_APPROVAL_STATE', '승인 대기 중인 배포 요청만 처리할 수 있습니다.');
      if (!canReviewCommon(state, user, common, request, now)) fail(403, 'COMMON_HEAD_APPROVAL_REQUIRED', '작성 부서의 부서장만 다른 구성원의 배포 요청을 승인·반려할 수 있습니다.');
      const reason = command.type === 'common.reject' ? required(p, 'reason') : p.reason === undefined ? '' : parse(z.string().trim().max(5000), p.reason);
      if (command.type === 'common.approve') {
        if (common.version !== request.version || !isDeepStrictEqual(commonApprovalSnapshot(common), request.snapshot)) fail(409, 'COMMON_APPROVAL_STALE', '요청 후 업무 기준이 변경되었습니다. 반려 후 최신 내용으로 다시 요청해 주세요.');
        const owner = activeUser(state, common.managerId, now); activeUser(state, request.requestedBy, now);
        if (owner.departmentId !== request.departmentId || !canCreateCommon(owner, now)) fail(409, 'COMMON_AUTHOR_CHANGED', '작성자의 소속 또는 역할이 변경되었습니다. 업무 책임을 확인해 주세요.');
        if (request.kind === 'initial' ? common.publicationStatus !== 'pending' || common.distributions.length > 0 : !commonPublished(common)) fail(409, 'COMMON_APPROVAL_STATE', '배포 상태가 변경되었습니다. 최신 요청을 확인해 주세요.');
        const targets = request.targetDepartmentIds;
        if (!targets.length || new Set(targets).size !== targets.length || targets.some(target => !state.departments.some(department => department.id === target) || common.departmentIds.includes(target))) fail(409, 'COMMON_TARGET_CHANGED', '대상 부서 구성이 변경되었습니다. 반려 후 대상 부서를 다시 선택해 주세요.');
        // Check every department before making any assignments or notifications.
        for (const target of targets) {
          if (!['manager', 'head'].every(role => state.users.some(member => member.departmentId === target && member.role === role && member.active && (!member.endsAt || new Date(member.endsAt) > now)))) fail(422, 'DEPARTMENT_STAFF_REQUIRED', '대상 부서의 활성 부서 담당자와 부서장을 먼저 등록해 주세요.');
        }
        for (const target of targets) {
          const distribution: CommonDistribution = { id: id('dist'), departmentId: target, status: 'pending', distributedAt: now.toISOString() };
          common.departmentIds.push(target); common.distributions.push(distribution);
          if (common.kind === 'directive') createDirectiveTask(state, common, distribution, now);
          for (const manager of state.users.filter(member => member.departmentId === target && member.role === 'manager' && member.active && (!member.endsAt || new Date(member.endsAt) > now))) notifyAssignment(state, manager.id, common, '작성 부서장이 승인한 업무가 도착했습니다. 담당 팀을 배정해 주세요.', now, distribution);
        }
        if (request.kind === 'initial') common.publicationStatus = 'approved';
        request.status = 'approved'; title = '부서장 승인 · 공통 세부업무 배포';
      } else {
        if (request.kind === 'initial') common.publicationStatus = 'rejected';
        request.status = 'rejected'; title = '공통 세부업무 배포 요청 반려';
      }
      request.resolvedBy = user.id; request.resolvedAt = now.toISOString(); request.reason = reason;
      for (const recipient of new Set([common.managerId, request.requestedBy])) notifyAssignment(state, recipient, common, request.status === 'approved' ? '부서장이 배포를 승인했습니다. 지정 부서에서 배정을 시작합니다.' : `부서장이 배포 요청을 반려했습니다. ${reason}`, now);
      targetId = common.id; departmentId = request.departmentId; detail = JSON.stringify({ requestId: request.id, status: request.status, targetDepartmentIds: request.targetDepartmentIds, reason }); break;
    }
    case 'task.create': {
      const task = buildTaskForCreate(state, user, parse(taskInput, p), now);
      const deputy = p.deputy === undefined ? undefined : prepareTaskDelegation(state, user, task, p.deputy, now, fail);
      state.tasks.unshift(task); claimDescriptionAttachments(state, task); if (deputy) saveEmbeddedDelegation(state, user, deputy, now);
      targetId = task.id; departmentId = task.departmentId; detail = task.title; title = '새 업무 초안 작성'; break;
    }
    case 'task.delete': {
      const task = getTask(state, user, required(p, 'taskId'), now);
      if (task.commonId) fail(403, 'COMMON_TASK_DELETE_DENIED', '공통업무와 지시사항은 개인이 삭제할 수 없습니다. 공통업무 작성자에게 조정을 요청해 주세요.');
      if (task.primaryId !== user.id && user.role !== 'admin') fail(403, 'TASK_OWNER_REQUIRED', '본인이 담당하는 개인 세부업무만 삭제할 수 있습니다.');
      if (state.handovers.some(h => h.taskIds.includes(task.id) && !['completed', 'cancelled'].includes(h.status))) fail(409, 'PENDING_HANDOVER', '진행 중인 인수인계를 먼저 완료하거나 취소해 주세요.');
      task.deletedFromStatus = task.status; task.status = 'archived'; task.deletedAt = now.toISOString(); task.updatedAt = now.toISOString();
      targetId = task.id; departmentId = task.departmentId; detail = task.title; title = '개인 세부업무 휴지통 이동'; break;
    }
    case 'task.restore': {
      const task = getTask(state, user, required(p, 'taskId'), now, true);
      if (task.commonId) fail(403, 'COMMON_TASK_DELETE_DENIED', '공통업무는 개인 휴지통에서 변경할 수 없습니다.');
      if (task.primaryId !== user.id && user.role !== 'admin') fail(403, 'TASK_OWNER_REQUIRED', '본인이 담당하는 개인 세부업무만 복원할 수 있습니다.');
      if (!task.deletedAt) fail(409, 'TASK_NOT_DELETED', '휴지통에 있는 세부업무만 복원할 수 있습니다.');
      const owner = activeUser(state, task.primaryId, now); if (owner.departmentId !== task.departmentId) fail(422, 'ASSIGNMENT_SCOPE', '담당자의 부서가 변경되어 이 세부업무를 복원할 수 없습니다.');
      const nextUnitId = p.unitId === undefined ? task.unitId : required(p, 'unitId');
      const unit = state.units.find(item => item.id === nextUnitId);
      if (!unit || unit.departmentId !== task.departmentId) fail(422, 'UNIT_REQUIRED', '같은 부서의 단위업무를 선택해 주세요.');
      if (unit.deletedAt) fail(409, 'UNIT_DELETED', '상위 단위업무가 삭제되었습니다. 먼저 복원하거나 다른 본인 단위업무를 선택해 주세요.');
      if (nextUnitId !== task.unitId) personalTargetUnit(state, user, nextUnitId, task.departmentId, task.primaryId);
      const originalUnitTitle = state.units.find(item => item.id === task.unitId)?.title ?? task.unitId;
      task.unitId = nextUnitId; task.status = task.deletedFromStatus ?? 'draft'; delete task.deletedAt; delete task.deletedFromStatus; task.updatedAt = now.toISOString();
      // Restoring a parent link is not a workflow revision. Preserve confirmed
      // definitions and each existing run's version, including unpublished drafts.
      targetId = task.id; departmentId = task.departmentId; detail = `${task.title} · ${originalUnitTitle} → ${unit.title}`; title = '개인 세부업무 복원'; break;
    }
    case 'task.record': {
      const input = parse(z.object({ taskId: text, expenses: expenseInput.optional(), documents: referenceInput.optional() }).strict(), p);
      const task = getTask(state, user, input.taskId, now); ensureRegistered(state, task);
      if (user.role !== 'admin' && (user.role === 'head' || ![task.primaryId, ...task.supportIds].includes(user.id) && !canActAsDeputy(state, user, task, 'task.record', now))) fail(403, 'RECORD_DENIED', '현재 담당자와 지원담당자만 수행 기록을 입력할 수 있습니다.');
      if (task.status === 'archived') fail(409, 'TASK_ARCHIVED', '보관된 업무의 수행 기록은 변경할 수 없습니다.');
      if (input.expenses === undefined && input.documents === undefined) fail(422, 'RECORD_REQUIRED', '집행내역 또는 생산 문서를 입력해 주세요.');
      if (input.documents?.some(reference => reference.type !== 'document')) fail(422, 'RECORD_DOCUMENT_ONLY', '수행 기록에서는 생산 문서만 변경할 수 있습니다. 법령·지침은 업무 기준 편집에서 변경해 주세요.');
      const expensesBefore = structuredClone(task.expenses ?? []);
      const documentsBefore = structuredClone((task.references ?? []).filter(reference => reference.type === 'document'));
      const expensesAfter = input.expenses ?? expensesBefore;
      const documentsAfter = input.documents ?? documentsBefore;
      const references = [...(task.references ?? []).filter(reference => reference.type !== 'document'), ...documentsAfter];
      if (references.length > 100) fail(422, 'REFERENCE_LIMIT', '관련 근거와 생산 문서는 합계 100개까지 등록할 수 있습니다.');
      detailValidation({ ...task, expenses: expensesAfter, references }, state);
      if (JSON.stringify(expensesBefore) !== JSON.stringify(expensesAfter) || JSON.stringify(documentsBefore) !== JSON.stringify(documentsAfter)) {
        task.recordHistory ??= [];
        task.recordHistory.push({ id: id('record'), recordedBy: user.id, recordedAt: now.toISOString(), expensesBefore, expensesAfter: structuredClone(expensesAfter), documentsBefore, documentsAfter: structuredClone(documentsAfter) });
        task.expenses = expensesAfter; task.references = references; task.updatedAt = now.toISOString();
      }
      targetId = task.id; departmentId = task.departmentId; title = '업무 수행 기록 저장'; detail = `${task.title} · 집행 ${expensesAfter.length}건 / 생산 문서 ${documentsAfter.length}건 · 업무 기준 유지`; break;
    }
    case 'task.procedure.replace': {
      const input = parse(z.object({ taskId: text, workflow: workflowInput, references: referenceInput.optional(), reason: z.string().trim().min(1).max(2000).default('AI·자료 분석 절차 적용') }).strict(), p);
      const task = getTask(state, user, input.taskId, now); ensureRegistered(state, task);
      if (task.primaryId !== user.id && !manageDepartment(user, task.departmentId)) fail(403, 'EDIT_DENIED', '담당자 또는 부서 관리자가 업무 절차를 적용할 수 있습니다.');
      if (task.status === 'archived') fail(409, 'TASK_ARCHIVED', '보관된 업무의 절차는 변경할 수 없습니다.');
      const next: Task = { ...task, workflow: input.workflow.map(step => ({ ...step, done: false })), ...(input.references !== undefined ? { references: input.references } : {}), version: Math.max(task.version, ...task.versions.map(version => version.version)) + 1 };
      detailValidation(next, state); validateWorkflow(next, state);
      const legacy = !state.runs.some(run => run.taskId === task.id) && task.workflow.some(step => step.done) ? legacyExecution(task, now) : undefined;
      const activeRuns = [...state.runs.filter(run => run.taskId === task.id && run.status !== 'completed'), ...(legacy && legacy.status !== 'completed' ? [legacy] : [])];
      // Replacing an undated procedure must not revalidate or rewrite an overdue legacy schedule.
      // Only newly supplied step dates need to fit the existing occurrence's date range.
      if (next.workflow.some(step => step.startDate || step.dueDate)) for (const run of activeRuns) validateCycleSchedule(next.workflow, { startDate: run.startDate ?? run.startedAt.slice(0, 10), dueDate: run.dueDate, steps: next.workflow.map(step => ({ stepId: step.id, startDate: step.startDate, dueDate: step.dueDate, scheduleDetails: step.scheduleDetails })) });
      const replacements = activeRuns.map(run => withReplacedRunProcedure(task, run, next.workflow, next.version, { id: id('procedure-change'), replacedAt: now.toISOString(), replacedBy: user.id, reason: input.reason }));
      // All permissions, evidence and workflow/schedule checks finish before modifying any record.
      if (!task.versions.some(version => version.version === task.version)) task.versions.push(snapshot(task, undefined, now.toISOString()));
      Object.assign(task, next, { updatedAt: now.toISOString() }); task.versions.push(snapshot(task, user.id, now.toISOString()));
      if (legacy) state.runs.unshift(legacy);
      for (const replacement of replacements) Object.assign(state.runs.find(run => run.id === replacement.id)!, replacement);
      invalidateHandoverConfirmations(state, task.id);
      const distribution = state.commonTasks.find(common => common.id === task.commonId)?.distributions.find(item => item.taskId === task.id);
      if (distribution) distribution.status = 'registered';
      targetId = task.id; departmentId = task.departmentId; title = '검토한 최종 절차 적용'; detail = `${task.title} · v${task.version} · ${task.workflow.length}단계 · 이전 수행 절차 ${replacements.length}건 이력 보관 · ${input.reason}`; break;
    }
    case 'task.configure': {
      const task = getTask(state, user, required(p, 'taskId'), now); ensureRegistered(state, task);
      if (task.primaryId !== user.id && !manageDepartment(user, task.departmentId)) fail(403, 'EDIT_DENIED', '담당자 또는 부서 관리자가 업무 정보를 수정할 수 있습니다.');
      if (task.status === 'archived') fail(409, 'TASK_ARCHIVED', '보관된 업무는 수정할 수 없습니다.');
      const input = parse(z.object({ unitId: text.optional(), title: text.max(150).optional(), dueDate: date.optional(), frequency: z.enum(['once', 'monthly', 'quarterly', 'half_yearly', 'yearly']).optional(), description: taskDescription.optional(), descriptionAttachmentIds: z.array(text).max(10).optional(), ...budgetFields, expenses: expenseInput.optional(), references: referenceInput.optional(), workflow: workflowInput.optional() }), p);
      if (input.unitId !== undefined && input.unitId !== task.unitId) {
        if (task.primaryId !== user.id && user.role !== 'admin') fail(403, 'TASK_OWNER_REQUIRED', '본인이 담당하는 세부업무만 다른 단위업무로 이동할 수 있습니다.');
        personalTargetUnit(state, user, input.unitId, task.departmentId, task.primaryId);
      }
      if (task.commonId && ((input.title !== undefined && input.title !== task.title) || (input.dueDate !== undefined && input.dueDate !== task.dueDate) || (input.frequency !== undefined && input.frequency !== task.frequency))) fail(409, 'COMMON_STANDARD_LOCKED', '공통업무의 이름·마감일·반복 주기는 중앙 기준을 따릅니다.');
      if (input.workflow) {
        for (const completed of task.workflow.filter(s => s.done)) {
          const next = input.workflow.find(s => s.id === completed.id);
          if (!next || next.title !== completed.title || next.role !== completed.role || next.description !== completed.description || next.output !== completed.output || next.required !== completed.required || JSON.stringify(next.dependsOn) !== JSON.stringify(completed.dependsOn) || JSON.stringify(next.checklist) !== JSON.stringify(completed.checklist) || !isDeepStrictEqual(next.attachmentIds ?? completed.attachmentIds ?? [], completed.attachmentIds ?? [])) fail(409, 'COMPLETED_STEP_LOCKED', '완료한 절차의 기준과 체크리스트는 보존됩니다. 미완료 절차를 수정하거나 후속 보완 절차를 추가해 주세요.');
        }
        input.workflow = input.workflow.map(step => { const previous = task.workflow.find(old => old.id === step.id); return { ...step, ...(step.attachmentIds === undefined && previous?.attachmentIds ? { attachmentIds: [...previous.attachmentIds] } : {}), done: previous?.done ?? false }; });
        const activeRun = taskExecution(state, task).run;
        if (activeRun?.cycleManaged && activeRun.status !== 'completed') input.workflow = preserveManagedSchedule(task, activeRun, input.workflow);
      }
      const resolvedBudget = resolveTaskBudget(state, task, input); delete input.budgetItemId;
      const next = { ...task, ...input, ...resolvedBudget, reviewerId: taskReviewer(state, task.departmentId, task.primaryId, now), version: Math.max(task.version, ...task.versions.map(version => version.version)) + 1 }; detailValidation(next, state); validateWorkflow(next, state); validateDescriptionAttachments(state, user, task.id, next.descriptionAttachmentIds); const deputy = p.deputy === undefined ? undefined : prepareTaskDelegation(state, user, next, p.deputy, now, fail);
      if (!deputy && isDeepStrictEqual(comparableTaskConfiguration(next), comparableTaskConfiguration(task))) {
        // Remember the idempotency key without producing a new business event or revision.
        state.processedRequests.push({ id: command.requestId, fingerprint, actorId: user.id });
        return [];
      }
      if (!task.versions.length) task.versions.push(snapshot(task, undefined, now.toISOString()));
      Object.assign(task, next); claimDescriptionAttachments(state, task); if (deputy) saveEmbeddedDelegation(state, user, deputy, now); task.updatedAt = now.toISOString();
      task.versions.push(snapshot(task, user.id, now.toISOString())); invalidateHandoverConfirmations(state, task.id);
      // Active execution follows this plan; each earlier plan remains in versions.
      for (const run of state.runs.filter(r => r.taskId === task.id && r.status !== 'completed')) {
        const preservedWorkflow = input.workflow ? run.cycleManaged ? preserveManagedSchedule(task, run, task.workflow) : structuredClone(task.workflow) : runWorkflow(task, run);
        run.definitionVersion = task.version; run.workflowSnapshot = preservedWorkflow; run.updatedAt = now.toISOString(); if (!run.cycleManaged) run.title = `${task.title} · ${run.period}`;
        // Legacy runs have no separate schedule; preserve their historical deadline sync.
        // Explicitly managed cycles keep their own dates when the task deadline changes.
        if (input.dueDate !== undefined && !run.cycleManaged) run.dueDate = task.dueDate;
        run.steps = task.workflow.map(step => {
          const prior = run.steps.find(s => s.stepId === step.id);
          return { id: prior?.id ?? `exec-${step.id}`, stepId: step.id, title: step.title, role: step.role, status: prior?.status ?? 'pending', output: prior?.output, completedAt: prior?.completedAt, completedBy: prior?.completedBy, checklist: step.checklist.map((title, i) => prior?.checklist.find(c => c.title === title) ?? { id: `${step.id}-c${i + 1}`, title, done: false }) };
        });
      }
      const distribution = state.commonTasks.find(c => c.id === task.commonId)?.distributions.find(d => d.taskId === task.id);
      if (distribution) distribution.status = task.workflow.every(s => s.done) ? 'submitted' : 'registered';
      targetId = task.id; departmentId = task.departmentId; detail = `${task.title} · v${task.version}`; title = '세부업무 정보 및 일정 저장'; break;
    }
    case 'task.setProgress': {
      const task = getTask(state, user, required(p, 'taskId'), now); ensureRegistered(state, task);
      if (task.status === 'archived') fail(409, 'TASK_ARCHIVED', '보관된 업무는 수정할 수 없습니다.');
      const step = task.workflow.find(s => s.id === required(p, 'stepId')); if (!step) fail(404, 'STEP_NOT_FOUND', '업무 절차를 찾을 수 없습니다.');
      const latest = taskExecution(state, task).run;
      if (latest?.status === 'paused') fail(409, 'RUN_PAUSED', '일시 중지된 수행 회차는 진행 상태를 변경할 수 없습니다.');
      const run = latest && latest.definitionVersion === task.version && latest.steps.some(item => item.stepId === step.id) ? latest : undefined;
      const execution = run?.steps.find(item => item.stepId === step.id);
      const role = execution?.role ?? step.role; const primaryId = run?.primaryId ?? task.primaryId; const supportIds = run?.supportIds ?? task.supportIds; const reviewerId = run?.reviewerId ?? task.reviewerId;
      const allowed = role === 'reviewer' ? user.id === reviewerId || approveDepartment(user, task.departmentId) : user.id === primaryId || supportIds.includes(user.id) || user.role === 'admin' || task.primaryId === primaryId && canActAsDeputy(state, user, task, 'task.setProgress', now);
      if (!allowed) fail(403, 'EXECUTION_DENIED', role === 'reviewer' ? '검토 절차는 지정 검토자 또는 부서장이 완료할 수 있습니다.' : '업무 담당자만 절차를 완료할 수 있습니다.');
      const done = parse(z.boolean(), p.done);
      if (run?.cycleManaged && run.status === 'completed') fail(409, 'RUN_COMPLETED', '완료된 회차의 절차 기록은 보존됩니다. 다음 회차를 시작해 주세요.');
      const definition = run ? run.workflowSnapshot ?? task.versions.find(version => version.version === run.definitionVersion)?.workflow : task.workflow;
      if (!definition) fail(409, 'DEFINITION_MISSING', '회차의 기준 버전을 찾을 수 없습니다.');
      const config = definition.find(item => item.id === step.id);
      if (!config) fail(409, 'DEFINITION_MISSING', '회차의 절차 기준을 찾을 수 없습니다.');
      const completed = (stepId: string) => run ? run.steps.find(item => item.stepId === stepId)?.status === 'completed' : task.workflow.find(item => item.id === stepId)?.done === true;
      if (done && config.dependsOn.some(dep => !completed(dep))) fail(409, 'PREREQUISITE_REQUIRED', '선행 절차를 먼저 완료해 주세요.');
      if (!done && definition.some(item => completed(item.id) && item.dependsOn.includes(step.id))) fail(409, 'DEPENDENT_COMPLETED', '완료된 후속 절차가 있어 이 절차를 되돌릴 수 없습니다.');
      step.done = done; task.updatedAt = now.toISOString();
      if (run && execution) {
        execution.status = done ? 'completed' : 'pending'; execution.completedAt = done ? now.toISOString() : undefined; execution.completedBy = done ? user.id : undefined; execution.output = done ? `${step.title} 수행 완료` : undefined; execution.checklist.forEach(item => { item.done = done; item.completedBy = done ? user.id : undefined; item.completedAt = done ? now.toISOString() : undefined; });
        const pending = run.steps.find(item => item.status !== 'completed'); run.status = !pending ? 'completed' : pending.role === 'reviewer' ? 'review' : 'in_progress'; run.completedAt = run.status === 'completed' ? now.toISOString() : undefined; run.updatedAt = now.toISOString(); syncTaskExecution(state, task, run, now);
      }
      const distribution = state.commonTasks.find(c => c.id === task.commonId)?.distributions.find(d => d.taskId === task.id);
      if (distribution && !run) distribution.status = task.workflow.every(s => s.done) ? 'submitted' : 'registered';
      targetId = task.id; departmentId = task.departmentId; detail = `${task.title} · ${step.title}`; title = done ? '업무 절차 완료' : '업무 절차 완료 취소'; break;
    }
    case 'task.update': {
      const task = getTask(state, user, required(p, 'taskId'), now); ensureRegistered(state, task); if (!manageDepartment(user, task.departmentId) && task.primaryId !== user.id) fail(403, 'EDIT_DENIED', '업무를 수정할 권한이 없습니다.'); if (!['draft', 'revision'].includes(task.status)) fail(409, 'DEFINITION_LOCKED', '확정·검토 중인 기준은 직접 수정할 수 없습니다. 수정 허용 후 변경본을 작성해 주세요.');
      if (typeof p.unitId === 'string' && p.unitId !== task.unitId) { if (task.primaryId !== user.id && user.role !== 'admin') fail(403, 'TASK_OWNER_REQUIRED', '본인이 담당하는 세부업무만 이동할 수 있습니다.'); personalTargetUnit(state, user, p.unitId, task.departmentId, task.primaryId); }
      const input = parse(taskInput, { ...task, ...p }); input.workflow = input.workflow?.map(step => { const previous = task.workflow.find(old => old.id === step.id); return { ...step, ...(step.attachmentIds === undefined && previous?.attachmentIds ? { attachmentIds: [...previous.attachmentIds] } : {}), done: previous?.done ?? false }; }); if (task.versions.length && (input.primaryId !== task.primaryId || input.unitId !== task.unitId)) fail(409, 'HANDOVER_REQUIRED', '확정된 업무의 담당자·소유 변경은 인수인계 절차를 이용해 주세요.'); if (task.commonId && input.dueDate !== task.dueDate) fail(409, 'COMMON_DEADLINE_LOCKED', '공통업무의 필수 기한은 부서에서 변경할 수 없습니다.'); const resolvedBudget = resolveTaskBudget(state, task, input); delete input.budgetItemId; const next = { ...task, ...input, ...resolvedBudget, reviewerId: taskReviewer(state, task.departmentId, input.primaryId, now), card: input.card ?? task.card, workflow: input.workflow ?? task.workflow }; validateAssignments(state, user, next, now); detailValidation(next, state); validateDescriptionAttachments(state, user, task.id, next.descriptionAttachmentIds); const deputy = p.deputy === undefined ? undefined : prepareTaskDelegation(state, user, next, p.deputy, now, fail); Object.assign(task, next, { updatedAt: now.toISOString() }); claimDescriptionAttachments(state, task); if (deputy) saveEmbeddedDelegation(state, user, deputy, now); if (task.versions.length) invalidateHandoverConfirmations(state, task.id); targetId = task.id; departmentId = task.departmentId; detail = task.title; title = '업무 초안 수정'; break;
    }
    case 'task.submit': case 'task.confirm': case 'task.revise': case 'task.archive': {
      const task = getTask(state, user, required(p, 'taskId'), now); ensureRegistered(state, task); targetId = task.id; departmentId = task.departmentId; detail = task.title;
      if (command.type === 'task.submit') { if (!manageDepartment(user, task.departmentId) && task.primaryId !== user.id) fail(403, 'EDIT_DENIED', '검토를 요청할 권한이 없습니다.'); if (!['draft', 'revision'].includes(task.status)) fail(409, 'INVALID_STATE', '작성 중인 초안만 검토 요청할 수 있습니다.'); validateAssignments(state, user, task, now); validateWorkflow(task, state); task.status = 'review'; title = '업무 검토 요청'; }
      if (command.type === 'task.confirm') { scoped(user, task.departmentId, true); if (task.status !== 'review') fail(409, 'INVALID_STATE', '검토 요청된 업무만 확정할 수 있습니다.'); validateAssignments(state, user, task, now); validateWorkflow(task, state); task.version = (task.versions.at(-1)?.version ?? 0) + 1; task.versions.push(snapshot(task, user.id, now.toISOString())); task.status = 'confirmed'; title = '업무 기준 확정'; }
      if (command.type === 'task.revise') { scoped(user, task.departmentId, true); if (task.status !== 'confirmed') fail(409, 'INVALID_STATE', '확정된 업무만 변경본을 만들 수 있습니다.'); task.revisionReason = required(p, 'reason'); task.status = 'revision'; title = '변경본 작성 허용'; }
      if (command.type === 'task.archive') { scoped(user, task.departmentId); if (state.handovers.some(h => h.taskIds.includes(task.id) && !['completed', 'cancelled'].includes(h.status))) fail(409, 'PENDING_HANDOVER', '진행 중인 인수인계를 먼저 처리해 주세요.'); task.status = 'archived'; title = '업무 폐기 · 이력 보존'; }
      task.updatedAt = now.toISOString(); break;
    }
    case 'run.schedule': {
      const task = getTask(state, user, required(p, 'taskId'), now); ensureRegistered(state, task); assertCycleOwner(state, task, user, command.type, now);
      const input = parse(cycleScheduleInput.extend({ runId: text.optional() }), p);
      const cycles = taskCycleState(state, task);
      if (cycles.latest?.id !== input.runId) fail(409, 'CYCLE_CHANGED', '현재 회차가 변경되었습니다. 최신 회차에서 일정을 다시 등록해 주세요.');
      if (cycles.latest?.status === 'completed' || cycles.completed) fail(409, 'RUN_COMPLETED', '완료된 회차 일정은 보존됩니다. 새 일정 등록으로 다음 회차를 시작해 주세요.');
      if (cycles.latest?.status === 'paused') fail(409, 'RUN_PAUSED', '일시 중지된 회차의 일정을 변경할 수 없습니다.');
      if (!cycles.latest && (task.status === 'revision' || task.status === 'review')) fail(409, 'CYCLE_DEFINITION_PENDING', '변경 중인 업무 기준을 확정한 뒤 일정을 등록해 주세요.');
      const definition = cycles.latest && (cycles.latest.workflowSnapshot ?? task.versions.find(version => version.version === cycles.latest!.definitionVersion)?.workflow);
      if (cycles.latest && (!definition || cycles.latest.steps.some(step => !definition.some(item => item.id === step.stepId)))) fail(409, 'DEFINITION_MISSING', '회차의 기준 버전을 찾을 수 없습니다.');
      const workflow = cycles.latest ? runWorkflow(task, cycles.latest) : structuredClone(task.workflow);
      validateCycleSchedule(workflow, input);
      const run = cycles.latest ?? legacyExecution(task, now);
      run.title = input.title ?? run.title; run.startDate = input.startDate; run.dueDate = input.dueDate; run.scheduleDetails = input.scheduleDetails;
      run.workflowSnapshot = scheduledWorkflow(workflow, input); run.cycleManaged = true; run.updatedAt = now.toISOString();
      if (!run.steps.some(step => step.status === 'completed' || step.checklist.some(check => check.done))) run.status = input.startDate > koreaDate(now) ? 'scheduled' : 'in_progress';
      if (!cycles.latest) state.runs.unshift(run);
      syncTaskExecution(state, task, run, now);
      targetId = run.id; departmentId = run.departmentId; detail = `${run.title} · ${input.startDate}~${input.dueDate}${cycleDeadlineAuditDetail(task, input.dueDate)}`; title = '업무 회차 일정 및 세부 내용 등록'; break;
    }
    case 'run.completeCycle': {
      const task = getTask(state, user, required(p, 'taskId'), now); ensureRegistered(state, task); assertCycleOwner(state, task, user, command.type, now);
      const input = parse(z.object({ runId: text.optional() }), p); const cycles = taskCycleState(state, task);
      if (cycles.latest?.id !== input.runId) fail(409, 'CYCLE_CHANGED', '현재 회차가 변경되었습니다. 최신 회차를 확인해 주세요.');
      if (cycles.latest?.status === 'paused') fail(409, 'RUN_PAUSED', '일시 중지된 회차는 완료할 수 없습니다.');
      const allComplete = cycles.latest ? cycles.latest.steps.length > 0 && cycles.latest.steps.every(step => step.status === 'completed') : task.workflow.length > 0 && task.workflow.every(step => step.done);
      if (!allComplete) fail(409, 'CYCLE_NOT_COMPLETED', '현재 회차의 모든 절차와 검토를 마친 뒤 업무 사이클을 완료해 주세요.');
      const run = cycles.latest ?? legacyExecution(task, now);
      if (!run.workflowSnapshot) run.workflowSnapshot = runWorkflow(task, run);
      run.status = 'completed'; run.completedAt ??= now.toISOString(); run.updatedAt = now.toISOString(); run.cycleManaged = true;
      if (!cycles.latest) state.runs.unshift(run);
      syncTaskExecution(state, task, run, now);
      targetId = run.id; departmentId = run.departmentId; detail = run.title; title = '업무 사이클 완료 · 수행 기록 보존'; break;
    }
    case 'run.nextCycle': {
      const task = getTask(state, user, required(p, 'taskId'), now); ensureRegistered(state, task);
      if (user.role === 'head' || user.role !== 'admin' && task.primaryId !== user.id && !canActAsDeputy(state, user, task, command.type, now)) fail(403, 'CYCLE_OWNER_REQUIRED', '세부업무의 본인 담당자 또는 관리자만 다음 회차를 시작할 수 있습니다.');
      if (task.status === 'archived') fail(409, 'TASK_ARCHIVED', '보관된 업무는 새 회차를 시작할 수 없습니다.');
      if (task.status === 'revision' || task.status === 'review') fail(409, 'CYCLE_DEFINITION_PENDING', '변경 중인 업무 기준을 확정한 뒤 다음 회차를 시작해 주세요.');
      const input = parse(cycleScheduleInput.extend({ previousRunId: text.optional() }), p);
      const cycles = taskCycleState(state, task);
      if ((cycles.latest?.id ?? undefined) !== input.previousRunId) fail(409, 'CYCLE_CHANGED', '현재 회차가 변경되었습니다. 최신 회차를 확인한 뒤 다시 시작해 주세요.');
      if (!cycles.canStart) fail(409, 'CYCLE_NOT_COMPLETED', '현재 회차의 모든 절차와 검토를 완료해야 다음 회차를 시작할 수 있습니다.');
      const workflow = nextCycleWorkflow(task);
      validateCycleSchedule(workflow, input);
      let previous = cycles.latest;
      if (!previous) {
        // Older completed work may exist only as task flags. With no recorded cycle
        // schedule, the task deadline is the only known historical date. Preserve
        // that fallback without changing the task deadline or an existing run.
        // Do not invent completion actors or timestamps.
        previous = createRun({ ...task, versions: [] }, `기존 완료 기록`, task.createdAt);
        previous.id = id('run-history'); previous.status = 'completed'; previous.cycleNumber = 1;
        previous.dueDate = task.dueDate; previous.workflowSnapshot = structuredClone(task.workflow);
        previous.steps.forEach(step => { step.status = 'completed'; step.checklist.forEach(check => { check.done = true; }); });
        state.runs.unshift(previous);
      }
      if (!previous.workflowSnapshot) previous.workflowSnapshot = runWorkflow(task, previous);
      const cycleNumber = cycles.nextCycleNumber;
      const period = currentPeriod(task.versions.at(-1)?.frequency ?? task.frequency, new Date(`${input.startDate}T12:00:00+09:00`));
      const run = createRun(task, period, now.toISOString());
      run.id = id('run-cycle'); run.title = input.title ?? `${task.title} · ${cycleNumber}회차`;
      run.startDate = input.startDate; run.dueDate = input.dueDate; run.scheduleDetails = input.scheduleDetails; run.previousRunId = previous.id; run.cycleNumber = cycleNumber; run.cycleManaged = true; run.updatedAt = now.toISOString();
      run.status = input.startDate > koreaDate(now) ? 'scheduled' : 'in_progress';
      run.workflowSnapshot = scheduledWorkflow(workflow, input).map(step => ({ ...step, done: false }));
      state.runs.unshift(run); syncTaskExecution(state, task, run, now);
      targetId = run.id; departmentId = run.departmentId; detail = `${task.title} · ${cycleNumber}회차 · ${input.startDate}~${input.dueDate}${cycleDeadlineAuditDetail(task, input.dueDate)}`; title = '완료 기록 보존 및 다음 업무 회차 시작'; break;
    }
    case 'run.create': {
      const task = getTask(state, user, required(p, 'taskId'), now); ensureRegistered(state, task); if (!manageDepartment(user, task.departmentId) && task.primaryId !== user.id && !canActAsDeputy(state, user, task, 'run.create', now)) fail(403, 'EXECUTION_DENIED', '회차를 생성할 권한이 없습니다.'); if (!task.versions.length || task.status === 'archived') fail(409, 'UNCONFIRMED_TASK', '유효한 확정 기준이 있는 업무만 회차를 만들 수 있습니다.'); if (state.runs.some(run => run.taskId === task.id && run.cycleManaged)) fail(409, 'CYCLE_COMMAND_REQUIRED', '회차 이력이 있는 업무는 일정 등록 탭의 새 일정 등록을 이용해 주세요.'); const frequency = task.versions.at(-1)?.frequency ?? task.frequency; const period = normalizePeriod(frequency, typeof p.period === 'string' ? p.period : undefined, now); if (!period) fail(422, 'INVALID_PERIOD', '반복 주기에 맞는 기간을 입력해 주세요. 월: 2026-11, 분기: 2026-Q4, 반기: 2026-H2, 연: 2026'); if (state.runs.some(r => r.taskId === task.id && normalizePeriod(frequency, r.period, now) === period)) fail(409, 'DUPLICATE_PERIOD', '해당 기간의 회차가 이미 있습니다.'); const run = createRun(task, period, now.toISOString()); if (p.dueDate && parse(date, p.dueDate) !== run.dueDate) fail(409, 'DEADLINE_CHANGE_REQUIRES_REVIEW', '회차 생성으로 기준 기한을 변경할 수 없습니다. 기준 변경을 검토한 뒤 새 회차를 생성해 주세요.'); run.updatedAt = now.toISOString(); state.runs.unshift(run); syncTaskExecution(state, task, run, now); targetId = run.id; departmentId = run.departmentId; detail = run.title; title = '실행 회차 생성'; break;
    }
    case 'run.check': case 'run.completeStep': case 'run.note': {
      const run = getRun(state, user, required(p, 'runId'), now); targetId = run.id; departmentId = run.departmentId; detail = run.title;
      if (command.type === 'run.note') { if (!canExecute(state, user, run, command.type, now) && run.reviewerId !== user.id && !approveDepartment(user, run.departmentId)) fail(403, 'EXECUTION_DENIED', '수행 메모를 작성할 권한이 없습니다.'); run.notes.push({ id: id('note'), authorId: user.id, body: required(p, 'body'), createdAt: now.toISOString(), stepId: typeof p.stepId === 'string' ? p.stepId : undefined }); run.updatedAt = now.toISOString(); title = '수행 메모 추가'; break; }
      const stepId = required(p, 'stepId'); const step = run.steps.find(s => s.id === stepId || s.stepId === stepId); if (!step) fail(404, 'STEP_NOT_FOUND', '단계를 찾을 수 없습니다.'); executionAccess(state, user, run, command.type, now, step.role === 'reviewer'); if (step.status === 'completed') fail(409, 'STEP_COMPLETED', '완료된 단계의 기록은 보존됩니다. 보완 메모를 남겨 주세요.'); const task = state.tasks.find(t => t.id === run.taskId)!; const config = (run.workflowSnapshot ?? task.versions.find(version => version.version === run.definitionVersion)?.workflow)?.find(s => s.id === step.stepId); if (!config) fail(409, 'DEFINITION_MISSING', '회차의 기준 버전을 찾을 수 없습니다.'); if (config.dependsOn.some(d => run.steps.find(s => s.stepId === d)?.status !== 'completed')) fail(409, 'PREREQUISITE_REQUIRED', '선행 단계를 먼저 완료해 주세요.');
      if (command.type === 'run.check') { const item = step.checklist.find(c => c.id === required(p, 'checkId')); if (!item) fail(404, 'CHECK_NOT_FOUND', '체크 항목을 찾을 수 없습니다.'); item.done = parse(z.boolean(), p.done); item.completedAt = item.done ? now.toISOString() : undefined; item.completedBy = item.done ? user.id : undefined; step.status = 'in_progress'; title = '체크리스트 기록'; }
      else { if (!step.checklist.every(c => c.done)) fail(409, 'CHECKLIST_REQUIRED', '필수 체크리스트를 모두 확인해 주세요.'); step.output = required(p, 'output'); step.status = 'completed'; step.completedBy = user.id; step.completedAt = now.toISOString(); const next = run.steps.find(s => s.status !== 'completed'); if (next) { next.status = 'in_progress'; run.status = next.role === 'reviewer' ? 'review' : 'in_progress'; } else { run.status = 'completed'; run.completedAt = now.toISOString(); } title = '업무 단계 완료'; } run.updatedAt = now.toISOString(); syncTaskExecution(state, task, run, now); break;
    }
    case 'handover.create': {
      const input = parse(z.object({ title: z.string().trim().max(150).optional(), taskIds: z.array(text).min(1).max(50), runIds: z.array(text).default([]), toId: text, effectiveAt: datetime, summary: text, pendingItems: text, nextAction: text, notes: z.string().max(5000).default('') }), p); const tasks = input.taskIds.map(taskId => getTask(state, user, taskId, now)); const fromId = tasks[0].primaryId; if (new Set(input.taskIds).size !== input.taskIds.length || tasks.some(t => t.primaryId !== fromId || t.departmentId !== tasks[0].departmentId || t.status === 'archived')) fail(422, 'HANDOVER_SCOPE', '같은 담당자와 부서의 유효한 업무를 선택해 주세요.'); if (fromId !== user.id && !manageDepartment(user, tasks[0].departmentId)) fail(403, 'HANDOVER_DENIED', '인계를 요청할 권한이 없습니다.'); const recipient = activeUser(state, input.toId, now); if (recipient.id === fromId) fail(422, 'SAME_RECIPIENT', '다른 인수자를 선택해 주세요.'); if (recipient.departmentId !== tasks[0].departmentId) fail(422, 'CROSS_DEPARTMENT_NOT_ENABLED', '현재 검증 버전은 부서 내 인계를 지원합니다. 부서 간 이동은 운영 정책과 추가 확인 절차가 필요합니다.'); if (state.handovers.some(h => !['completed', 'cancelled'].includes(h.status) && h.taskIds.some(t => input.taskIds.includes(t)))) fail(409, 'DUPLICATE_HANDOVER', '선택한 업무에 진행 중인 인수인계가 있습니다.'); for (const runId of input.runIds) { const run = state.runs.find(r => r.id === runId); if (!run || !input.taskIds.includes(run.taskId) || run.primaryId !== fromId || run.status === 'completed') fail(422, 'INVALID_RUN_SELECTION', '인계 가능한 진행 회차를 선택해 주세요.'); }
      const handover: Handover = { ...input, id: id('handover'), title: input.title || `${tasks[0].title}${tasks.length > 1 ? ` 외 ${tasks.length - 1}건` : ''} 인수인계`, fromId, departmentId: tasks[0].departmentId, targetDepartmentId: recipient.departmentId, status: 'approval', checklist: [{ id: 'hc-1', title: '현재 업무와 미완료 단계 확인', checked: false }, { id: 'hc-2', title: '관련 자료 및 접근 권한 확인', checked: false }, { id: 'hc-3', title: '다음 마감과 담당자 연락처 확인', checked: false }], revision: 1, createdAt: now.toISOString() }; state.handovers.unshift(handover); targetId = handover.id; departmentId = handover.departmentId; detail = handover.title; title = '인수인계 요청'; break;
    }
    case 'handover.approve': case 'handover.check': case 'handover.accept': case 'handover.requestChanges': case 'handover.cancel': case 'handover.apply': case 'handover.update': {
      const h = handoverAccess(state, user, required(p, 'handoverId')); targetId = h.id; departmentId = h.departmentId; detail = h.title; if (['completed', 'cancelled'].includes(h.status)) fail(409, 'HANDOVER_FINISHED', '종료된 인수인계는 변경할 수 없습니다.');
      if (command.type !== 'handover.cancel') for (const taskId of h.taskIds) { const task = state.tasks.find(item => item.id === taskId); if (!task) fail(409, 'HANDOVER_CONFLICT', '인계할 업무를 찾을 수 없습니다.'); assertTaskWritable(state, task); }
      if (command.type === 'handover.approve') { scoped(user, h.departmentId, true); if (h.status !== 'approval') fail(409, 'INVALID_STATE', '승인 검토 중인 인수인계만 승인할 수 있습니다.'); h.approvedBy = user.id; h.approvedAt = now.toISOString(); h.status = 'acceptance'; state.notifications.unshift({ id: id('notification'), title: '인수 확인이 필요해요', description: h.title, type: 'handover', targetType: 'handover', targetId: h.id, createdAt: now.toISOString(), read: false, userId: h.toId }); title = '인수인계 승인'; }
      if (command.type === 'handover.check') { if (user.id !== h.toId) fail(403, 'RECIPIENT_ONLY', '실제 인수자만 확인할 수 있습니다.'); if (h.status !== 'acceptance') fail(409, 'INVALID_STATE', '승인 후 인수 확인을 진행해 주세요.'); const item = h.checklist.find(c => c.id === required(p, 'checkId')); if (!item) fail(404, 'CHECK_NOT_FOUND', '확인 항목을 찾을 수 없습니다.'); item.checked = parse(z.boolean(), p.checked); title = '인수 자료 확인'; }
      if (command.type === 'handover.accept') { if (user.id !== h.toId) fail(403, 'RECIPIENT_ONLY', '실제 인수자만 인수를 수락할 수 있습니다.'); if (h.status !== 'acceptance' || !h.approvedBy || !h.checklist.every(c => c.checked)) fail(409, 'HANDOVER_NOT_READY', '승인 및 모든 인수 확인 항목을 완료해 주세요.'); h.acceptedBy = user.id; h.acceptedAt = now.toISOString(); h.acceptedRevision = h.revision; h.status = 'scheduled'; applyHandover(state, h, now); title = '인수 수락'; }
      if (command.type === 'handover.requestChanges') { if (user.id !== h.toId && !approveDepartment(user, h.departmentId)) fail(403, 'REVIEW_DENIED', '인수자 또는 승인자만 보완을 요청할 수 있습니다.'); h.feedback = required(p, 'reason'); h.status = 'changes_requested'; h.acceptedBy = undefined; h.acceptedAt = undefined; h.acceptedRevision = undefined; title = '인수인계 보완 요청'; }
      if (command.type === 'handover.update') { if (user.id !== h.fromId && !manageDepartment(user, h.departmentId)) fail(403, 'EDIT_DENIED', '인계 내용을 수정할 권한이 없습니다.'); const input = parse(z.object({ summary: text, pendingItems: text, nextAction: text, notes: z.string().default(''), effectiveAt: datetime }), { ...h, ...p }); Object.assign(h, input); h.revision++; h.approvedBy = undefined; h.approvedAt = undefined; h.acceptedBy = undefined; h.acceptedAt = undefined; h.acceptedRevision = undefined; h.checklist.forEach(c => { c.checked = false; }); h.status = 'approval'; title = '인계 변경 · 재승인 및 재수락 필요'; }
      if (command.type === 'handover.cancel') { if (h.fromId !== user.id && !approveDepartment(user, h.departmentId)) fail(403, 'CANCEL_DENIED', '인계자 또는 승인자만 취소할 수 있습니다.'); h.status = 'cancelled'; title = '인수인계 취소'; }
      if (command.type === 'handover.apply') { applyHandover(state, h, now); title = h.status === 'completed' ? '인수인계 적용' : '효력일 대기'; }
      break;
    }
    case 'common.assignTeam': {
      const { common, distribution } = commonDistribution(state, p);
      if (user.role !== 'admin' && (user.role !== 'manager' || user.departmentId !== distribution.departmentId)) fail(403, 'DEPARTMENT_ASSIGNMENT_DENIED', '해당 부서 담당자만 팀에 배정할 수 있습니다.');
      if (distribution.status !== 'pending') fail(409, 'ALREADY_ASSIGNED', '부서 접수 단계에서만 팀을 배정할 수 있습니다.');
      const team = required(p, 'team'); const lead = activeUser(state, required(p, 'leadId'), now);
      if (lead.departmentId !== distribution.departmentId || lead.role !== 'lead' || lead.team !== team) fail(422, 'TEAM_LEAD_REQUIRED', '해당 부서·팀의 팀장을 선택해 주세요.');
      distribution.team = team; distribution.leadId = lead.id; distribution.status = 'team_assigned'; distribution.teamAssignedAt = now.toISOString();
      notifyAssignment(state, lead.id, common, '팀에 업무가 배정되었습니다. 수행할 담당자를 지정해 주세요.', now, distribution);
      targetId = common.id; departmentId = distribution.departmentId; detail = `${common.title} → ${team}`; title = '부서 담당자의 팀 배정'; break;
    }
    case 'common.assignPerson': {
      const { common, distribution } = commonDistribution(state, p);
      if (user.role !== 'admin' && (user.id !== distribution.leadId || user.role !== 'lead' || user.departmentId !== distribution.departmentId)) fail(403, 'TEAM_ASSIGNMENT_DENIED', '배정받은 팀장만 개인에게 업무를 배정할 수 있습니다.');
      if (distribution.status !== 'team_assigned') fail(409, 'TEAM_ASSIGNMENT_REQUIRED', '먼저 부서 담당자가 팀을 배정해야 합니다.');
      const assignee = activeUser(state, required(p, 'assigneeId'), now);
      if (assignee.departmentId !== distribution.departmentId || assignee.team !== distribution.team || ['head', 'admin'].includes(assignee.role)) fail(422, 'TEAM_MEMBER_REQUIRED', '배정된 팀에 소속된 수행자를 선택해 주세요.');
      distribution.assigneeId = assignee.id; distribution.status = 'person_assigned'; distribution.personAssignedAt = now.toISOString();
      notifyAssignment(state, assignee.id, common, '개인에게 업무가 도착했습니다. 자신의 단위업무에 등록해 주세요.', now, distribution);
      targetId = common.id; departmentId = distribution.departmentId; detail = `${common.title} → ${assignee.name}`; title = '팀장의 개인 배정'; break;
    }
    case 'common.register': {
      const { common, distribution } = commonDistribution(state, p);
      if (distribution.assigneeId !== user.id) fail(403, 'ASSIGNEE_ONLY', '배정받은 본인만 개인 단위업무에 등록할 수 있습니다.');
      if (distribution.status !== 'person_assigned') fail(409, 'PERSON_ASSIGNMENT_REQUIRED', '개인 배정 단계의 업무만 등록할 수 있습니다.');
      const unit = state.units.find(u => u.id === required(p, 'unitId'));
      if (!unit || unit.departmentId !== distribution.departmentId) fail(422, 'UNIT_REQUIRED', '소속 부서의 단위업무를 선택해 주세요.');
      personalTargetUnit(state, user, unit.id, distribution.departmentId);
      const head = state.users.find(u => u.departmentId === distribution.departmentId && u.role === 'head' && u.active && (!u.endsAt || new Date(u.endsAt) > now));
      if (!head || head.id === user.id) fail(422, 'REVIEWER_REQUIRED', '부서의 별도 검토자를 지정해야 합니다.');
      let task = state.tasks.find(t => t.id === distribution.taskId);
      if (task) { assertTaskWritable(state, task); task.primaryId = user.id; task.unitId = unit.id; task.reviewerId = head.id; task.updatedAt = now.toISOString(); }
      else { task = makeCommonTask(state, common, distribution.departmentId, unit.id, user.id, head.id, now); state.tasks.unshift(task); }
      validateAssignments(state, user, task, now); validateWorkflow(task, state); distribution.taskId = task.id; distribution.status = 'registered'; distribution.registeredAt = now.toISOString();
      notifyAssignment(state, common.managerId, common, `${user.name}님이 개인 단위업무에 등록했습니다.`, now, distribution);
      targetId = common.id; departmentId = distribution.departmentId; detail = `${common.title} → ${unit.title}`; title = '개인 단위업무에 세부업무 등록'; break;
    }
    case 'common.assign': {
      const publication = state.commonTasks.find(item => item.id === p.commonId);
      if (publication && !commonPublished(publication)) fail(409, 'COMMON_APPROVAL_REQUIRED', '작성 부서장의 승인 후에만 배정할 수 있습니다.');
      if (state.commonTasks.find(c => c.id === p.commonId)?.kind) fail(409, 'STAGED_ASSIGNMENT_REQUIRED', '팀 배정 → 개인 배정 → 단위업무 등록 순서로 진행해 주세요.');
      const common = state.commonTasks.find(c => c.id === required(p, 'commonId')); if (!common) fail(404, 'NOT_FOUND', '공통업무를 찾을 수 없습니다.'); const deptId = typeof p.departmentId === 'string' ? p.departmentId : user.departmentId; scoped(user, deptId); const distribution = common.distributions.find(d => d.departmentId === deptId); if (!distribution || distribution.status !== 'pending') fail(409, 'ALREADY_ASSIGNED', '배정 대기 중인 공통업무가 아닙니다.'); const existing = state.tasks.find(t => t.commonId === common.id && t.departmentId === deptId); if (existing) fail(409, 'EXISTING_BINDING', '기존 부서 업무의 개정으로 연결해야 합니다.');
      const task: Task = { id: id('task'), code: `WK-${String(state.tasks.length + 1).padStart(3, '0')}`, title: common.title, description: common.description, unitId: required(p, 'unitId'), departmentId: deptId, primaryId: required(p, 'primaryId'), supportIds: parse(z.array(text), p.supportIds ?? []), reviewerId: required(p, 'reviewerId'), status: 'draft', priority: 'medium', frequency: common.frequency, dueDate: common.dueDate, tags: ['공통업무'], version: 1, completionCriteria: '공통 필수 기준에 따른 결과 제출과 검토 완료', card: defaultCard(common.description), workflow: commonWorkflow(common.requiredSteps), sourceIds: [], versions: [], commonId: common.id, createdAt: now.toISOString(), updatedAt: now.toISOString() }; validateAssignments(state, user, task, now); state.tasks.unshift(task); distribution.taskId = task.id; distribution.status = 'assigned'; targetId = common.id; departmentId = deptId; detail = common.title; title = '공통업무 부서 배정'; break;
    }
    case 'common.distribute': {
      const common = state.commonTasks.find(c => c.id === required(p, 'commonId'));
      if (!common || !(canCreateCommon(user, now) && (common.managerId === user.id || user.role === 'admin') || canManageDirective(state, user, common, now))) fail(403, 'DISTRIBUTION_DENIED', '공통업무 작성자 또는 장·차관 지시사항을 관리하는 기획팀만 추가 배포를 요청할 수 있습니다.');
      if (!commonPublished(common)) fail(409, 'COMMON_APPROVAL_REQUIRED', '최초 배포 승인 후에 대상 부서를 추가할 수 있습니다.');
      const departments = [...new Set(parse(z.array(text).min(1).max(100), p.departmentIds))];
      if (departments.some(deptId => !state.departments.some(department => department.id === deptId))) fail(422, 'DEPARTMENT_MISSING', '유효한 부서를 선택해 주세요.');
      const targets = departments.filter(deptId => !common.departmentIds.includes(deptId));
      if (!targets.length) fail(409, 'COMMON_NO_NEW_TARGET', '새로 추가할 대상 부서를 선택해 주세요.');
      const request = requestCommonApproval(state, user, common, 'additional', targets, now);
      targetId = common.id; departmentId = request.departmentId; detail = JSON.stringify({ requestId: request.id, targets, snapshot: request.snapshot }); title = '공통업무 대상 부서 추가 승인 요청'; break;
    }
    case 'directive.updateMetadata': {
      const common = state.commonTasks.find(item => item.id === required(p, 'commonId'));
      if (!common || common.kind !== 'directive') fail(404, 'DIRECTIVE_REQUIRED', '수정할 지시사항을 찾을 수 없습니다.');
      if (!canManageDirective(state, user, common, now)) fail(403, 'DIRECTIVE_MANAGEMENT_DENIED', '지시사항 작성자 또는 장·차관 지시사항을 관리하는 기획팀만 수정할 수 있습니다.');
      if (!commonPublished(common) || common.approvalRequests?.some(request => request.status === 'pending')) fail(409, 'COMMON_APPROVAL_PENDING', '승인 요청 중인 지시정보는 바꿀 수 없습니다. 반려 후 작성자가 수정하여 다시 요청해 주세요.');
      const input = parse(directiveMetadata, p);
      if (user.role !== 'admin' && common.managerId !== user.id && !isCentralDirective({ kind: 'directive', directiveIssuer: input.directiveIssuer })) fail(403, 'DIRECTIVE_MANAGEMENT_DENIED', '기획팀 공동 관리에서는 장·차관 지시사항을 실장·국장 지시사항으로 변경할 수 없습니다.');
      validateDirectiveDate(common, input.instructedOn, now);
      Object.assign(common, input); common.version++;
      targetId = common.id; detail = `${common.title} · ${directiveIssuerLabels[input.directiveIssuer]} · ${input.instructedOn}`; title = '지시사항 지시자·지시일자 수정'; break;
    }
    case 'directive.saveMonthlyReport': {
      const { common, distribution } = commonDistribution(state, p);
      if (common.kind !== 'directive') fail(422, 'DIRECTIVE_REQUIRED', '지시사항에만 월별 실적을 입력할 수 있습니다.');
      if (!['registered', 'assigned', 'submitted'].includes(distribution.status)) fail(409, 'REGISTRATION_REQUIRED', '개인 단위업무에 등록한 뒤 월별 실적을 입력해 주세요.');
      const projected = commonDistributionStatus(state, common, distribution, now);
      if (projected.executionStatus === 'completed') fail(409, 'DIRECTIVE_COMPLETED', '완료한 지시사항의 월별 실적은 변경할 수 없습니다. 기존 기록을 확인해 주세요.');
      if (!canRecordDirectiveReport(state, user, common, distribution, now)) fail(403, 'DIRECTIVE_REPORT_DENIED', '진행 중인 지시사항의 현재 담당자만 월별 실적을 입력할 수 있습니다.');
      const input = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '실적 월은 연도와 월 형식(예: 2026-11)으로 입력해 주세요.'), achievements: text, nextPlan: z.string().trim().max(5000).default(''), issues: z.string().trim().max(5000).default('') }), p);
      if (input.month < directiveReportStartMonth(common, distribution) || input.month > koreaDate(now).slice(0, 7)) fail(422, 'DIRECTIVE_MONTH_RANGE', '지시일자가 속한 월부터 현재 월까지 실적을 입력할 수 있습니다.');
      const existing = distribution.monthlyReports?.find(report => report.month === input.month);
      if (existing) Object.assign(existing, input, { authorId: user.id, updatedAt: now.toISOString() });
      else { distribution.monthlyReports ??= []; distribution.monthlyReports.unshift({ ...input, id: id('directive-report'), authorId: user.id, createdAt: now.toISOString(), updatedAt: now.toISOString() }); }
      targetId = common.id; departmentId = distribution.departmentId; detail = `${common.title} · ${input.month}`; title = '지시사항 월별 실적 저장'; break;
    }
    case 'performance.setWeights': {
      if (user.role === 'head') fail(403, 'SCORE_OWNER_REQUIRED', '단위업무 배점은 업무 담당자가 설정합니다.');
      const input = parse(z.object({ period: halfYear, allocations: z.array(z.object({ unitId: text, maxScore: unitWeight })).min(1).max(UNIT_SCORE_TOTAL, '단위업무가 50개를 넘으면 최소 1점씩 배분할 수 없습니다.') }), p);
      if (typeof p.personId === 'string' && p.personId !== user.id) fail(403, 'SCORE_OWNER_REQUIRED', '본인의 단위업무 배점만 설정할 수 있습니다.');
      if (getUnitEvaluation(state, user.id, input.period)) fail(409, 'EVALUATION_CONFIRMED', '평가가 확정된 반기의 배점은 변경할 수 없습니다.');
      if (getUnitScorePlan(state, user.id, input.period)?.submittedAt) fail(409, 'PERFORMANCE_SUBMITTED', '제출한 성과의 업무 비중은 변경할 수 없습니다. 평가 전 제출을 취소한 뒤 수정해 주세요.');
      const units = scoreUnitsForPeriod(state, user.id, input.period);
      if (units.length > UNIT_SCORE_TOTAL) fail(422, 'SCORE_UNIT_LIMIT', '이 반기의 평가 대상 단위업무가 50개를 초과하여 비중을 새로 배분·저장할 수 없습니다. 기존 계획·성과는 그대로 보관되며, 기존 계획이 있다면 기존 규칙에 따라 제출·평가할 수 있습니다.');
      const unitIds = new Set(input.allocations.map(allocation => allocation.unitId));
      if (unitIds.size !== input.allocations.length) fail(422, 'DUPLICATE_SCORE_UNIT', '같은 단위업무를 중복해서 배점할 수 없습니다.');
      if (input.allocations.some(allocation => !units.some(unit => unit.id === allocation.unitId))) fail(403, 'SCORE_OWNER_REQUIRED', '현재 담당 업무 또는 본인의 기존 배점·성과에 연결된 단위업무만 배점할 수 있습니다.');
      assertNotFutureHalf(input.period, now, '업무 비중');
      if (units.length !== unitIds.size) fail(422, 'SCORE_UNITS_REQUIRED', '모든 활성 단위업무의 배점을 최소 1점씩 설정해 주세요.');
      if (input.allocations.reduce((sum, allocation) => sum + Math.round(allocation.maxScore * 100), 0) !== UNIT_SCORE_TOTAL * 100) fail(422, 'SCORE_TOTAL_REQUIRED', '단위업무 배점의 합계는 50점이어야 합니다.');
      const existing = getUnitScorePlan(state, user.id, input.period);
      const plan = { id: existing?.id ?? id('score-plan'), personId: user.id, departmentId: existing?.departmentId ?? units[0].departmentId, period: input.period, version: (existing?.version ?? 0) + 1, allocations: units.map(unit => ({ unitId: unit.id, unitTitle: unit.title, maxScore: input.allocations.find(allocation => allocation.unitId === unit.id)!.maxScore })), updatedAt: now.toISOString() };
      if (existing) Object.assign(existing, plan); else { state.unitScorePlans ??= []; state.unitScorePlans.unshift(plan); }
      targetId = plan.id; departmentId = plan.departmentId; detail = `${input.period} · ${units.length}개 단위업무 · 합계 50점`; title = '개인 단위업무 배점 설정'; break;
    }
    case 'performance.submitPerson': {
      const input = parse(z.object({ period: halfYear, planVersion: z.number().int().positive() }), p);
      if (user.role === 'head' || typeof p.personId === 'string' && p.personId !== user.id) fail(403, 'PERFORMANCE_DENIED', '본인의 반기 성과만 제출할 수 있습니다.');
      assertNotFutureHalf(input.period, now, '성과');
      if (getUnitEvaluation(state, user.id, input.period)) fail(409, 'EVALUATION_CONFIRMED', '이미 평가가 확정된 반기입니다.');
      const plan = getUnitScorePlan(state, user.id, input.period);
      if (!plan) fail(409, 'SCORE_PLAN_REQUIRED', '모든 단위업무의 업무 비중을 합계 50점으로 먼저 설정해 주세요.');
      if (plan.submittedAt) fail(409, 'PERFORMANCE_SUBMITTED', '이미 부서장에게 제출한 반기 성과입니다.');
      if (plan.version !== input.planVersion) fail(409, 'SCORE_PLAN_CHANGED', '업무 비중이 변경되었습니다. 최신 내용을 확인한 뒤 제출해 주세요.');
      const units = scoreUnitsForPeriod(state, user.id, input.period);
      if (units.length !== plan.allocations.length || new Set(plan.allocations.map(allocation => allocation.unitId)).size !== units.length || units.some(unit => !plan.allocations.some(allocation => allocation.unitId === unit.id))) fail(409, 'SCORE_PLAN_STALE', '단위업무 구성이 바뀌었습니다. 업무 비중을 다시 설정해 주세요.');
      if (plan.allocations.some(allocation => !unitScore.safeParse(allocation.maxScore).success) || plan.allocations.reduce((sum, allocation) => sum + Math.round(allocation.maxScore * 100), 0) !== UNIT_SCORE_TOTAL * 100) fail(422, 'SCORE_TOTAL_REQUIRED', '단위업무 업무 비중의 합계는 50점이어야 합니다.');
      const records = currentPersonPerformances(state, user.id, input.period).filter(performance => performance.departmentId === plan.departmentId);
      if (records.some(performance => performance.status === 'changes_requested')) fail(409, 'PERFORMANCE_CHANGES_PENDING', '보완 요청된 성과를 저장한 뒤 제출해 주세요.');
      if (records.some(performance => !hasCompletePerformance(performance))) fail(422, 'PERFORMANCE_INCOMPLETE', '모든 성과의 내용을 입력해 주세요.');
      if (!records.some(performance => plan.allocations.some(allocation => allocation.maxScore > 0 && allocation.unitId === performanceUnitId(state, performance)))) fail(409, 'PERFORMANCE_REQUIRED', '업무 비중을 배정한 단위업무에 세부업무 성과를 먼저 입력해 주세요.');
      if (missingPerformanceUnitIds(state, plan.allocations, records, plan.departmentId).length) fail(409, 'UNIT_PERFORMANCE_REQUIRED', '업무 비중이 있는 모든 단위업무에 세부업무 성과를 입력해 주세요.');
      plan.submittedAt = now.toISOString(); plan.submittedBy = user.id;
      for (const performance of records) if (performance.status === 'draft') performance.status = 'review';
      for (const head of state.users.filter(member => member.departmentId === plan.departmentId && member.role === 'head' && member.active)) state.notifications.unshift({ id: id('notification'), title: '개인별 반기 성과 평가 요청', description: `${user.name} · ${input.period} · 업무 비중 50점`, type: 'task', targetType: 'performance', targetId: records[0].id, createdAt: now.toISOString(), destination: { view: 'performance', personId: user.id, period: input.period }, read: false, userId: head.id });
      targetId = plan.id; departmentId = plan.departmentId; detail = `${user.name} · ${input.period}`; title = '개인별 반기 성과 제출'; break;
    }
    case 'performance.withdrawSubmission': {
      const input = parse(z.object({ period: halfYear }), p);
      if (user.role === 'head' || typeof p.personId === 'string' && p.personId !== user.id) fail(403, 'PERFORMANCE_DENIED', '본인의 성과 제출만 취소할 수 있습니다.');
      if (getUnitEvaluation(state, user.id, input.period)) fail(409, 'EVALUATION_CONFIRMED', '평가가 확정된 반기는 제출을 취소할 수 없습니다.');
      const plan = getUnitScorePlan(state, user.id, input.period);
      if (!plan?.submittedAt) fail(409, 'PERFORMANCE_NOT_SUBMITTED', '제출한 반기 성과가 없습니다.');
      delete plan.submittedAt; delete plan.submittedBy;
      for (const performance of currentPersonPerformances(state, user.id, input.period)) if (performance.status === 'review') performance.status = 'draft';
      targetId = plan.id; departmentId = plan.departmentId; detail = input.period; title = '개인별 반기 성과 제출 취소'; break;
    }
    case 'performance.evaluatePerson': {
      const input = parse(z.object({ personId: text, period: halfYear, planVersion: z.number().int().positive(), scores: z.array(z.object({ unitId: text, score: unitScore, comment: z.string().trim().max(5000).default('') })).min(1).max(100), comment: z.string().trim().max(5000).default('') }), p);
      if (!['head', 'admin'].includes(user.role)) fail(403, 'HEAD_EVALUATION_REQUIRED', '배점 당시 부서의 부서장 또는 관리자만 평가할 수 있습니다.');
      const person = state.users.find(member => member.id === input.personId);
      if (!person) fail(403, 'HEAD_EVALUATION_REQUIRED', '평가할 직원을 확인해 주세요.');
      if (person.id === user.id) fail(403, 'SELF_APPROVAL', '본인의 성과를 직접 평가할 수 없습니다.');
      const plan = getUnitScorePlan(state, person.id, input.period);
      if (!plan) fail(409, 'SCORE_PLAN_REQUIRED', '직원이 먼저 단위업무 배점을 합계 50점으로 설정해야 합니다.');
      if (!approveDepartment(user, plan.departmentId)) fail(403, 'HEAD_EVALUATION_REQUIRED', '배점 당시 부서의 부서장 또는 관리자만 평가할 수 있습니다.');
      if (getUnitEvaluation(state, person.id, input.period)) fail(409, 'EVALUATION_CONFIRMED', '이미 확정된 개인별 평가입니다. 기존 결과는 보존됩니다.');
      if (input.planVersion !== plan.version) fail(409, 'SCORE_PLAN_CHANGED', '개인의 배점이 변경되었습니다. 최신 배점을 확인한 뒤 평가해 주세요.');
      if (!plan.submittedAt) fail(409, 'PERFORMANCE_NOT_SUBMITTED', '직원이 성과와 업무 비중을 제출한 뒤 평가할 수 있습니다.');
      // Submission freezes the period's allocation; later personnel changes do not invalidate it.
      const unitIds = new Set(input.scores.map(score => score.unitId));
      if (unitIds.size !== input.scores.length || input.scores.length !== plan.allocations.length || input.scores.some(score => !plan.allocations.some(allocation => allocation.unitId === score.unitId))) fail(422, 'EVALUATION_UNITS_REQUIRED', '배점한 모든 단위업무에 각각 한 번씩 점수를 입력해 주세요.');
      for (const score of input.scores) if (score.score > plan.allocations.find(allocation => allocation.unitId === score.unitId)!.maxScore) fail(422, 'SCORE_EXCEEDS_MAX', '평가 점수는 개인이 설정한 단위업무 배점을 초과할 수 없습니다.');
      const records = currentPersonPerformances(state, person.id, input.period).filter(performance => performance.departmentId === plan.departmentId);
      if (records.some(performance => performance.status === 'changes_requested')) fail(409, 'PERFORMANCE_CHANGES_PENDING', '보완 요청된 성과를 다시 제출한 뒤 평가해 주세요.');
      const performances = records.filter(performance => ['review', 'confirmed'].includes(performance.status));
      if (!performances.some(performance => plan.allocations.some(allocation => allocation.unitId === performanceUnitId(state, performance)))) fail(409, 'PERFORMANCE_REQUIRED', '배점한 단위업무에 평가할 반기 성과가 없습니다. 직원이 세부업무 성과를 먼저 제출해야 합니다.');
      for (const score of input.scores) if (score.score > 0 && !performances.some(performance => performanceUnitId(state, performance) === score.unitId)) fail(422, 'UNIT_PERFORMANCE_REQUIRED', '제출한 성과가 없는 단위업무는 0점으로 평가해 주세요.');
      const evaluation = { id: id('unit-evaluation'), planId: plan.id, planVersion: plan.version, personId: person.id, departmentId: plan.departmentId, period: plan.period, scores: plan.allocations.map(allocation => ({ ...allocation, ...input.scores.find(score => score.unitId === allocation.unitId)! })), totalScore: input.scores.reduce((sum, score) => sum + Math.round(score.score * 100), 0) / 100, comment: input.comment, evaluatedBy: user.id, evaluatedAt: now.toISOString(), performanceIds: performances.map(performance => performance.id), performanceSnapshot: performances.map(performance => ({ ...structuredClone(performance), unitId: performanceUnitId(state, performance), taskTitle: state.tasks.find(task => task.id === performance.taskId)?.title ?? '이전 세부업무' })) };
      state.unitEvaluations ??= []; state.unitEvaluations.unshift(evaluation);
      for (const performance of performances) { if (performance.status === 'review') { performance.status = 'confirmed'; performance.approvedBy = user.id; performance.approvedAt = now.toISOString(); } }
      state.notifications.unshift({ id: id('notification'), title: '개인별 반기 성과 평가 완료', description: `${input.period} · ${evaluation.totalScore}/50점`, type: 'task', targetType: 'performance', targetId: performances[0].id, createdAt: now.toISOString(), destination: { view: 'performance', personId: person.id, period: input.period }, read: false, userId: person.id });
      targetId = evaluation.id; departmentId = plan.departmentId; detail = `${person.name} · ${input.period} · ${evaluation.totalScore}/50점`; title = '단위업무별 개인 성과 평가 확정'; break;
    }
    case 'performance.saveHalf': case 'performance.submitHalf': {
      const taskId = required(p, 'taskId');
      const input = parse(z.object({ period: halfYear, ...performanceFields }), p);
      if (getUnitEvaluation(state, user.id, input.period)) fail(409, 'EVALUATION_CONFIRMED', '개인별 평가가 확정된 반기의 성과는 추가하거나 변경할 수 없습니다.');
      if (getUnitScorePlan(state, user.id, input.period)?.submittedAt) fail(409, 'PERFORMANCE_SUBMITTED', '부서장에게 제출한 성과는 수정할 수 없습니다. 평가 전 제출을 취소한 뒤 수정해 주세요.');
      const existing = currentPersonPerformances(state, user.id, input.period).find(perf => perf.taskId === taskId);
      const sourceTask = state.tasks.find(task => task.id === taskId && canReadTask(state, user, task, now));
      const performanceTitle = sourceTask?.title ?? existing?.title ?? '';
      const readableFiles = new Set(state.attachments.filter(file => canReadAttachment(state, user, file, now)).map(file => file.id));
      validateLinkedAttachments(state, taskId, input.attachmentIds, 'PERFORMANCE', readableFiles, existing?.id);
      if (existing) {
        assertNotFutureHalf(input.period, now, '성과');
        if (existing.status === 'confirmed') fail(409, 'PERFORMANCE_CONFIRMED', '이미 확정된 기존 성과는 변경할 수 없습니다.');
        // An author may complete their own historical record without regaining task access.
        Object.assign(existing, input, { title: performanceTitle, evidence: input.evidence ?? existing.evidence, attachmentIds: input.attachmentIds ?? existing.attachmentIds, metricName: input.metricName, value: input.value, unit: input.unit, status: 'draft', score: undefined, comment: undefined, approvedBy: undefined, approvedAt: undefined }); targetId = existing.id; departmentId = existing.departmentId;
      } else {
        const task = getTask(state, user, taskId, now); ensureRegistered(state, task);
        if (task.primaryId !== user.id) fail(403, 'PERFORMANCE_DENIED', '세부업무의 본인 담당자만 새 반기 성과를 작성할 수 있습니다.');
        if (task.status === 'archived') fail(409, 'TASK_ARCHIVED', '보관된 업무에는 새 성과를 제출할 수 없습니다.');
        const plan = getUnitScorePlan(state, user.id, input.period);
        const recordedDepartment = plan?.departmentId ?? currentPersonPerformances(state, user.id, input.period)[0]?.departmentId;
        if (recordedDepartment && recordedDepartment !== task.departmentId) fail(409, 'PERFORMANCE_DEPARTMENT_MISMATCH', '이 반기는 이전 부서 성과를 정리하는 기록이 있습니다. 현재는 한 반기에 한 부서의 평가를 지원합니다.');
        assertNotFutureHalf(input.period, now, '성과');
        const performance = { ...input, title: task.title, evidence: input.evidence ?? '', id: id('perf'), taskId: task.id, unitId: task.unitId, runId: state.runs.find(r => r.taskId === task.id)?.id ?? '', authorId: user.id, departmentId: task.departmentId, status: 'draft' as const, createdAt: now.toISOString() };
        state.performances.unshift(performance); targetId = performance.id; departmentId = task.departmentId;
      }
      detail = `${performanceTitle} · ${input.period}`; title = '세부업무 성과 저장'; break;
    }
    case 'performance.evaluate': {
      const perf = state.performances.find(item => item.id === required(p, 'performanceId'));
      if (!perf) fail(404, 'NOT_FOUND', '성과를 찾을 수 없습니다.');
      if (!approveDepartment(user, perf.departmentId)) fail(403, 'HEAD_EVALUATION_REQUIRED', '해당 부서장만 반기 성과를 평가할 수 있습니다.');
      getTask(state, user, perf.taskId, now);
      if (perf.authorId === user.id) fail(403, 'SELF_APPROVAL', '본인이 작성한 성과를 직접 평가할 수 없습니다.');
      if (perf.period) fail(409, 'UNIT_EVALUATION_REQUIRED', '성과 · 평가에서 개인이 제출한 단위업무별 성과를 50점 기준으로 평가해 주세요.');
      if (perf.status !== 'review') fail(409, 'INVALID_STATE', '평가 대기 중인 성과만 평가할 수 있습니다.');
      const input = parse(z.object({ score: z.number().finite().min(0).max(100), comment: text, decision: z.enum(['confirmed', 'changes_requested']) }), p);
      perf.score = input.score; perf.comment = input.comment; perf.status = input.decision; perf.approvedBy = user.id; perf.approvedAt = now.toISOString();
      state.notifications.unshift({ id: id('notification'), title: input.decision === 'confirmed' ? '반기 성과 평가 완료' : '반기 성과 보완 요청', description: input.comment, type: 'task', targetType: 'performance', targetId: perf.id, createdAt: now.toISOString(), read: false, userId: perf.authorId });
      targetId = perf.id; departmentId = perf.departmentId; detail = `${perf.title} · ${input.score}점`; title = input.decision === 'confirmed' ? '부서장 반기 성과 평가' : '반기 성과 보완 요청'; break;
    }
    case 'admin.release': {
      if (user.role !== 'admin') fail(403, 'ADMIN_REQUIRED', '관리자만 프로젝트 버전을 등록할 수 있습니다.');
      const input = parse(z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/, '예: 0.3.0'), title: text.max(150), notes: text }), p);
      if (state.releases?.some(release => release.version === input.version)) fail(409, 'DUPLICATE_RELEASE', '이미 등록한 버전입니다.');
      const release = { ...input, id: id('release'), date: koreaDate(now) }; state.releases ??= []; state.releases.unshift(release);
      targetId = release.id; detail = `${release.version} · ${release.title}`; title = '프로젝트 버전 등록'; break;
    }
    case 'performance.create': {
      const run = getRun(state, user, required(p, 'runId'), now);
      if (run.taskId !== required(p, 'taskId')) fail(422, 'RUN_TASK_MISMATCH', '성과와 회차의 업무가 일치해야 합니다.');
      if (!canExecute(state, user, run, command.type, now)) fail(403, 'PERFORMANCE_DENIED', '회차 담당자만 성과를 등록할 수 있습니다.');
      const input = parse(z.object({ ...performanceFields, previousId: z.string().optional() }), p);
      validateLinkedAttachments(state, run.taskId, input.attachmentIds, 'PERFORMANCE');
      const evidence = input.evidence ?? '';
      if (state.performances.some(item => item.runId === run.id && item.id !== input.previousId && item.metricName === input.metricName && (evidence ? item.evidence === evidence : !item.evidence && item.description === input.description && isDeepStrictEqual([...(item.attachmentIds ?? [])].sort(), [...(input.attachmentIds ?? [])].sort())))) fail(409, 'DUPLICATE_PERFORMANCE', '같은 회차에 동일한 성과가 있습니다. 기존 성과를 확인해 주세요.');
      if (input.previousId) {
        const previous = state.performances.find(item => item.id === input.previousId && item.runId === run.id && item.status === 'confirmed');
        if (previous?.period) fail(409, 'HALF_COMMAND_REQUIRED', '반기 성과는 반기 제출 및 부서장 평가 절차를 이용해 주세요.');
        if (!previous) fail(422, 'CORRECTION_TARGET', '확정된 같은 회차 성과를 정정 대상으로 선택해 주세요.');
        if (state.performances.some(item => item.previousId === previous.id)) fail(409, 'CORRECTION_EXISTS', '이 성과의 정정본이 이미 있습니다. 최신 정정본을 확인해 주세요.');
      }
      const performance = { ...input, title: state.tasks.find(task => task.id === run.taskId)!.title, evidence, id: id('perf'), taskId: run.taskId, runId: run.id, authorId: user.id, departmentId: run.departmentId, status: 'review' as const, createdAt: now.toISOString() };
      state.performances.unshift(performance); targetId = performance.id; departmentId = run.departmentId; detail = performance.title; title = '성과 검토 요청'; break;
    }
    case 'performance.resubmit': {
      const perf = state.performances.find(item => item.id === required(p, 'performanceId'));
      if (!perf) fail(404, 'NOT_FOUND', '성과를 찾을 수 없습니다.');
      if (perf.period) fail(409, 'HALF_COMMAND_REQUIRED', '반기 성과는 반기 제출 및 부서장 평가 절차를 이용해 주세요.');
      const run = getRun(state, user, perf.runId, now);
      if (perf.authorId !== user.id || !canExecute(state, user, run, 'performance.create', now)) fail(403, 'PERFORMANCE_DENIED', '현재 수행 권한이 있는 원작성자만 보완할 수 있습니다.');
      if (perf.status !== 'changes_requested') fail(409, 'INVALID_STATE', '보완 요청된 성과만 다시 제출할 수 있습니다.');
      const input = parse(z.object({ description: performanceFields.description, evidence: performanceFields.evidence, attachmentIds: performanceFields.attachmentIds }), p);
      validateLinkedAttachments(state, perf.taskId, input.attachmentIds, 'PERFORMANCE');
      perf.description = input.description; if (input.evidence !== undefined) perf.evidence = input.evidence; if (input.attachmentIds !== undefined) perf.attachmentIds = input.attachmentIds;
      perf.status = 'review'; targetId = perf.id; departmentId = perf.departmentId; detail = perf.title; title = '성과 보완 후 재검토 요청'; break;
    }
    case 'performance.approve': case 'performance.requestChanges': { const perf = state.performances.find(item => item.id === required(p, 'performanceId')); if (!perf) fail(404, 'NOT_FOUND', '성과를 찾을 수 없습니다.'); if (perf.period) fail(409, 'HALF_COMMAND_REQUIRED', '반기 성과는 반기 제출 및 부서장 평가 절차를 이용해 주세요.'); const run = getRun(state, user, perf.runId, now); if (user.id === perf.authorId) fail(403, 'SELF_APPROVAL', '작성자는 자신의 성과를 승인할 수 없습니다.'); if (run.reviewerId !== user.id && !approveDepartment(user, run.departmentId)) fail(403, 'REVIEW_DENIED', '지정된 총괄 또는 부서장만 검토할 수 있습니다.'); if (perf.status !== 'review') fail(409, 'INVALID_STATE', '검토 중인 성과만 처리할 수 있습니다.'); perf.status = command.type === 'performance.approve' ? 'confirmed' : 'changes_requested'; if (perf.status === 'confirmed' && perf.previousId && state.performances.some(item => item.id !== perf.id && item.previousId === perf.previousId && item.status === 'confirmed')) fail(409, 'CORRECTION_CONFLICT', '다른 정정본이 먼저 승인되었습니다. 최신 성과를 확인해 주세요.'); if (perf.status === 'confirmed') { perf.approvedBy = user.id; perf.approvedAt = now.toISOString(); } targetId = perf.id; departmentId = perf.departmentId; detail = perf.title + (typeof p.reason === 'string' ? ` · ${p.reason}` : ''); title = perf.status === 'confirmed' ? '성과 확정' : '성과 보완 요청'; break; }
    case 'source.create': { const input = parse(z.object({ title: text.max(150), type: z.enum(['manual', 'guideline', 'law', 'reference']), publisher: text, version: text.max(50), effectiveDate: date, url: z.union([z.literal(''), z.url().refine(url => /^https?:\/\//i.test(url), 'HTTP(S) 주소만 허용됩니다.')]).default(''), description: text, classification: z.enum(['public', 'internal', 'restricted']), aiAllowed: z.boolean().default(false) }), p); if (input.aiAllowed && input.classification !== 'public') fail(422, 'AI_POLICY', '현재 정책에서는 공개자료만 AI 전송 허용으로 지정할 수 있습니다.'); const source = { ...input, id: id('source'), departmentId: user.departmentId, ownerId: user.id, verified: false, updatedAt: now.toISOString() }; state.sources.unshift(source); targetId = source.id; detail = source.title; title = '근거 자료 등록'; break; }
    case 'source.verify': case 'source.revise': { const source = state.sources.find(s => s.id === required(p, 'sourceId')); if (!source) fail(404, 'NOT_FOUND', '근거 자료를 찾을 수 없습니다.'); if (!canReadSource(state, user, source, now)) fail(403, 'SOURCE_ACCESS_DENIED', '자료 본문에 접근할 권한이 없습니다.'); scoped(user, source.departmentId, command.type === 'source.verify'); if (command.type === 'source.verify') { if (source.type === 'law' && !source.url) fail(422, 'SOURCE_URL_REQUIRED', '법령의 공식 원문 URL을 입력해 주세요.'); source.verified = true; title = '근거 자료 검토 확인'; } else { const next = { ...source, id: id('source'), version: required(p, 'version'), effectiveDate: parse(date, p.effectiveDate), description: typeof p.description === 'string' ? p.description : source.description, verified: false, updatedAt: now.toISOString() }; state.sources.unshift(next); title = '새 자료 버전 등록 · 기존 참조 보존'; } targetId = source.id; departmentId = source.departmentId; detail = source.title; break; }
    case 'delegation.requestBatch': case 'delegation.request': case 'delegation.create': case 'delegation.approve': case 'delegation.reject': case 'delegation.cancel': case 'delegation.revoke': {
      ({ targetId, departmentId, detail, title } = executeDelegationCommand(state, user, command.type, p, now, fail)); break;
    }
    case 'attachment.allowTest': { if (user.role !== 'admin') fail(403, 'ADMIN_REQUIRED', '관리자가 출처를 확인한 테스트 파일만 허용할 수 있습니다.'); const attachment = state.attachments.find(a => a.id === required(p, 'attachmentId')); if (!attachment) fail(404, 'NOT_FOUND', '첨부파일을 찾을 수 없습니다.'); getTask(state, user, attachment.taskId, now); const reason = required(p, 'reason'); attachment.status = 'test_allowed'; targetId = attachment.id; detail = `${attachment.name} · 개발용 출처 확인: ${reason} · 악성코드 검사 통과 아님`; title = '테스트 파일 출처 확인'; break; }
    case 'notification.read': { if (p.all === true) { state.notifications.filter(n => n.userId === user.id).forEach(n => { n.read = true; }); targetId = user.id; } else { const n = state.notifications.find(item => item.id === required(p, 'notificationId') && item.userId === user.id); if (!n) fail(404, 'NOT_FOUND', '알림을 찾을 수 없습니다.'); n.read = true; targetId = n.id; } title = '알림 읽음'; break; }
    case 'reconcile': { if (!isManager(user)) fail(403, 'RECONCILE_DENIED', '예정 작업 보충은 부서담당 이상만 실행할 수 있습니다.'); let count = 0; for (const task of state.tasks.filter(t => !t.deletedAt && state.units.some(u => u.id === t.unitId && !u.deletedAt) && manageDepartment(user, t.departmentId) && t.status === 'confirmed' && t.frequency !== 'once' && !state.runs.some(run => run.taskId === t.id && run.cycleManaged))) { const period = periodFor(task.frequency, now); if (!state.runs.some(r => r.taskId === task.id && normalizePeriod(task.frequency, r.period, now) === period)) { const run = createRun(task, period, now.toISOString()); run.updatedAt = now.toISOString(); state.runs.unshift(run); syncTaskExecution(state, task, run, now); count++; } } targetId = user.departmentId; detail = `현재 기간 회차 ${count}건 보충 · 기존 회차 보존`; title = '예정 작업 보충'; break; }
    default: fail(422, 'UNKNOWN_COMMAND', '지원하지 않는 작업입니다.');
  }
  emit(state, user, command.type, command.type.split('.')[0], targetId, title, detail, departmentId, now); state.processedRequests.push({ id: requestKey, fingerprint, actorId: user.id }); state.revision++;
  return advanceEntityRevisions(state, before);
}
export function periodFor(frequency: Task['frequency'], now: Date) { const value = koreaDate(now); const year = value.slice(0, 4); const month = Number(value.slice(5, 7)); if (frequency === 'monthly') return `${year}년 ${month}월`; if (frequency === 'quarterly') return `${year}년 ${Math.ceil(month / 3)}분기`; if (frequency === 'half_yearly') return `${year}년 ${month <= 6 ? '상' : '하'}반기`; if (frequency === 'yearly') return `${year}년`; return value; }
export function denialEvent(state: WorkspaceData, userId: string, command: unknown, error: DomainError) { const user = state.users.find(u => u.id === userId); if (!user) return; const cmd = command as { type?: unknown }; state.audit.unshift({ id: id('audit'), actorId: userId, action: 'command.denied', targetType: 'command', targetId: '', title: '요청 거절', detail: `${typeof cmd?.type === 'string' ? cmd.type : 'invalid'} · ${error.code}`, departmentId: user.departmentId, createdAt: new Date().toISOString() }); }
