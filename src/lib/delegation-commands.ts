import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { canRequestTaskDelegation, canReviewTaskDelegation, delegationActions, delegationStatus } from './delegations';
import { commonPublished } from './common-approval';
import { isRegisteredWork } from './work-division';
import type { Delegation, Task, User, WorkspaceData } from './types';

type Fail = (status: number, code: string, message: string) => never;
const active = (user: User | undefined, now: Date) => !!user?.active && (!user.endsAt || new Date(user.endsAt) > now);
const timestamp = z.string().refine(value => Number.isFinite(Date.parse(value)), '유효한 날짜와 시각을 입력해 주세요.');
const inputSchema = z.object({ toId: z.string().trim().min(1), startsAt: timestamp, endsAt: timestamp, reason: z.string().trim().min(1).max(2000), actions: z.array(z.enum(delegationActions)).min(1).max(delegationActions.length).optional() });
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
export function delegationTaskFingerprint(task: Task) {
  const { id, title, description, descriptionAttachmentIds, unitId, departmentId, primaryId, supportIds, reviewerId, frequency, dueDate, completionCriteria, card, sourceIds, budget } = task;
  return createHash('sha256').update(JSON.stringify(stable({ id, title, description, descriptionAttachmentIds, unitId, departmentId, primaryId, supportIds, reviewerId, frequency, dueDate, completionCriteria, card, sourceIds, budget,
    workflow: task.workflow.map(({ done: _done, ...step }) => step), references: task.references?.filter(reference => reference.type !== 'document'),
  }))).digest('hex');
}
function validateTask(state: WorkspaceData, task: Task, now: Date, fail: Fail) {
  if (task.deletedAt) fail(409, 'TASK_DELETED', '삭제된 업무의 대행을 요청할 수 없습니다.');
  if (task.status === 'archived') fail(409, 'TASK_ARCHIVED', '보관된 업무의 대행을 요청할 수 없습니다.');
  const unit = state.units.find(item => item.id === task.unitId);
  if (!unit || unit.deletedAt) fail(409, 'UNIT_DELETED', '활성 단위업무의 세부업무만 대행할 수 있습니다.');
  if (!isRegisteredWork(state, task) || task.commonId && !state.commonTasks.some(common => common.id === task.commonId && commonPublished(common))) fail(409, 'REGISTRATION_REQUIRED', '공통업무는 승인·배정·등록 후 대행을 요청해 주세요.');
  const owner = state.users.find(member => member.id === task.primaryId);
  if (!active(owner, now) || owner!.departmentId !== task.departmentId) fail(409, 'DELEGATION_OWNER_CHANGED', '원담당자의 재직과 소속을 확인해 주세요.');
}
function validateRecipient(state: WorkspaceData, task: Task, toId: string, now: Date, fail: Fail) {
  const recipient = state.users.find(member => member.id === toId);
  if (!active(recipient, now) || recipient!.departmentId !== task.departmentId || recipient!.role === 'head' || [task.primaryId, task.reviewerId].includes(toId)) fail(422, 'DELEGATION_RECIPIENT', '원담당자·검토자를 제외한 같은 부서의 활성 업무대행자를 선택해 주세요.');
}
function assertNoOverlap(state: WorkspaceData, candidate: Pick<Delegation, 'id' | 'taskId' | 'startsAt' | 'endsAt'>, fail: Fail) {
  if (state.delegations.some(item => item.id !== candidate.id && item.taskId === candidate.taskId && ['pending', 'approved'].includes(delegationStatus(item)) && new Date(item.startsAt) < new Date(candidate.endsAt) && new Date(candidate.startsAt) < new Date(item.endsAt))) fail(409, 'DELEGATION_OVERLAP', '이 업무에 기간이 겹치는 대행 요청 또는 승인이 있습니다. 기존 요청을 취소하거나 종료해 주세요.');
}
export function prepareTaskDelegation(state: WorkspaceData, user: User, task: Task, payload: unknown, now: Date, fail: Fail): Delegation {
  validateTask(state, task, now, fail);
  if (!canRequestTaskDelegation(state, user, task, now)) fail(403, 'DELEGATION_REQUEST_DENIED', '원담당자 또는 업무 소유 부서의 부서 담당자만 대행을 요청할 수 있습니다.');
  const parsed = inputSchema.safeParse(payload);
  if (!parsed.success) fail(422, 'VALIDATION_ERROR', parsed.error.issues.map(issue => issue.message).join('\n'));
  const input = parsed.data!;
  validateRecipient(state, task, input.toId, now, fail);
  if (new Date(input.endsAt) <= new Date(input.startsAt) || new Date(input.endsAt) <= now) fail(422, 'DELEGATION_PERIOD', '종료 시각은 시작 시각과 현재 시각 이후여야 합니다.');
  if (!state.users.some(member => active(member, now) && member.role === 'head' && member.departmentId === task.departmentId && ![user.id, task.primaryId, input.toId].includes(member.id))) fail(409, 'DELEGATION_HEAD_REQUIRED', '승인할 원부서의 부서장을 먼저 등록해 주세요.');
  const delegation: Delegation = { ...input, startsAt: new Date(input.startsAt).toISOString(), endsAt: new Date(input.endsAt).toISOString(), actions: [...new Set(input.actions ?? delegationActions)], id: `delegation-${randomUUID()}`, taskId: task.id, fromId: task.primaryId, departmentId: task.departmentId, taskTitle: task.title, unitTitle: state.units.find(unit => unit.id === task.unitId)?.title, status: 'pending', requestedBy: user.id, requestedAt: now.toISOString(), taskVersion: task.version, taskFingerprint: delegationTaskFingerprint(task) };
  assertNoOverlap(state, delegation, fail);
  return delegation;
}
function notify(state: WorkspaceData, userIds: string[], delegation: Delegation, title: string, description: string) {
  for (const userId of new Set(userIds)) state.notifications.unshift({ id: `notification-${randomUUID()}`, title, description, type: 'task', targetId: delegation.taskId, read: false, userId });
}
export function storeTaskDelegation(state: WorkspaceData, delegation: Delegation, now: Date) {
  state.delegations.unshift(delegation);
  notify(state, state.users.filter(member => active(member, now) && member.role === 'head' && member.departmentId === delegation.departmentId).map(member => member.id), delegation, '업무대행 승인 요청', `${delegation.taskTitle} · ${delegation.reason}`);
}
export function executeDelegationCommand(state: WorkspaceData, user: User, type: string, payload: Record<string, unknown>, now: Date, fail: Fail) {
  if (type === 'delegation.request' || type === 'delegation.create') {
    const task = state.tasks.find(item => item.id === payload.taskId);
    if (!task) return fail(404, 'NOT_FOUND', '대행할 업무를 찾을 수 없습니다.');
    const delegation = prepareTaskDelegation(state, user, task, { ...payload, ...(type === 'delegation.create' && !payload.reason ? { reason: '기간별 업무대행 요청' } : {}) }, now, fail);
    storeTaskDelegation(state, delegation, now);
    return { targetId: delegation.id, departmentId: task.departmentId, title: '업무대행 지정 · 부서장 승인 요청', detail: JSON.stringify({ taskId: task.id, fromId: task.primaryId, toId: delegation.toId, startsAt: delegation.startsAt, endsAt: delegation.endsAt, reason: delegation.reason }) };
  }
  const delegation = state.delegations.find(item => item.id === payload.delegationId);
  if (!delegation) return fail(404, 'NOT_FOUND', '대행 요청을 찾을 수 없습니다.');
  const task = state.tasks.find(item => item.id === delegation.taskId);
  const departmentId = delegation.departmentId ?? task?.departmentId;
  if (!departmentId) return fail(409, 'DELEGATION_SOURCE_MISSING', '원부서 정보를 확인할 수 없습니다.');
  const status = delegationStatus(delegation);
  const manager = user.role === 'admin' || user.departmentId === departmentId && ['manager', 'head'].includes(user.role);
  const reason = typeof payload.reason === 'string' ? payload.reason.trim() : '';
  if (reason.length > 2000) fail(422, 'VALIDATION_ERROR', '처리 사유는 2,000자 이내로 입력해 주세요.');
  if (type === 'delegation.approve' || type === 'delegation.reject') {
    if (status !== 'pending') fail(409, 'DELEGATION_STATE', '승인 대기 중인 요청만 처리할 수 있습니다.');
    if (!canReviewTaskDelegation(state, user, delegation, now)) fail(403, 'DELEGATION_HEAD_REQUIRED', '원부서의 부서장만 다른 구성원의 대행 요청을 승인·반려할 수 있습니다.');
    if (type === 'delegation.approve') {
      if (!task || task.primaryId !== delegation.fromId || task.departmentId !== departmentId || task.version !== delegation.taskVersion || delegationTaskFingerprint(task) !== delegation.taskFingerprint) fail(409, 'DELEGATION_STALE', '요청 후 원담당자 또는 업무 기준이 변경되었습니다. 반려 후 다시 요청해 주세요.');
      validateTask(state, task, now, fail); validateRecipient(state, task, delegation.toId, now, fail);
      const requester = state.users.find(member => member.id === delegation.requestedBy);
      if (!requester || !canRequestTaskDelegation(state, requester, task, now)) fail(409, 'DELEGATION_REQUESTER_CHANGED', '요청자의 재직 또는 역할이 변경되었습니다. 최신 담당자가 다시 요청해 주세요.');
      if (new Date(delegation.endsAt) <= now) fail(409, 'DELEGATION_EXPIRED', '대행 기간이 종료되었습니다. 새로운 기간으로 요청해 주세요.');
      assertNoOverlap(state, delegation, fail);
      delegation.status = 'approved'; delegation.approvedBy = user.id; delegation.approvedAt = now.toISOString();
    } else { if (!reason) fail(422, 'REASON_REQUIRED', '반려 사유를 입력해 주세요.'); delegation.status = 'rejected'; }
  } else if (type === 'delegation.cancel') {
    if (status !== 'pending') fail(409, 'DELEGATION_STATE', '승인 대기 중인 요청만 취소할 수 있습니다.');
    if (![delegation.requestedBy, delegation.fromId].includes(user.id) && !manager) fail(403, 'DELEGATION_CANCEL_DENIED', '요청자·원담당자 또는 원부서 관리자만 취소할 수 있습니다.');
    if (!reason) fail(422, 'REASON_REQUIRED', '취소 사유를 입력해 주세요.'); delegation.status = 'cancelled';
  } else {
    if (status !== 'approved') fail(409, 'DELEGATION_STATE', '승인된 대행만 종료할 수 있습니다.');
    if (![delegation.requestedBy, delegation.fromId, delegation.toId].includes(user.id) && !manager) fail(403, 'DELEGATION_REVOKE_DENIED', '대행 당사자 또는 원부서 관리자만 종료할 수 있습니다.');
    if (!reason) fail(422, 'REASON_REQUIRED', '종료 사유를 입력해 주세요.'); delegation.status = 'revoked'; delegation.revokedAt = now.toISOString();
  }
  delegation.resolvedBy = user.id; delegation.resolvedAt = now.toISOString(); delegation.resolutionReason = reason;
  const titles = { approved: '부서장 업무대행 승인', rejected: '업무대행 요청 반려', cancelled: '업무대행 요청 취소', revoked: '업무대행 종료' };
  const title = titles[delegation.status as keyof typeof titles];
  notify(state, [delegation.fromId, delegation.toId, ...(delegation.requestedBy ? [delegation.requestedBy] : [])], delegation, title, `${delegation.taskTitle ?? task?.title ?? '업무대행'}${reason ? ` · ${reason}` : ''}`);
  return { targetId: delegation.id, departmentId, title, detail: JSON.stringify({ taskId: delegation.taskId, fromId: delegation.fromId, toId: delegation.toId, status: delegation.status, reason }) };
}
