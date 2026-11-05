import { residualTransferRoles, transferRoleLabels, transferRoleRecipientError } from './transfer-roles';
import type { User, WorkspaceData } from './types';

type OrganizationState = Pick<WorkspaceData, 'users' | 'units' | 'tasks' | 'runs' | 'commonTasks' | 'delegations' | 'handovers' | 'workTransfers'>;
export interface OrganizationResponsibility { id: string; kind: string; label: string; title: string; departmentId: string; taskId?: string }
export interface OrganizationChangeIssue { status: 403 | 409; code: string; message: string }
export const isOrganizationUserActive = (user: User, now: Date) => user.active && (!user.endsAt || Date.parse(user.endsAt) > now.getTime());

/** Metadata only; the same inventory is used by the editor and the server gate. */
export function organizationResponsibilities(state: OrganizationState, userId: string, now = new Date()): OrganizationResponsibility[] {
  const result: OrganizationResponsibility[] = [];
  const activeTasks = state.tasks.filter(task => !task.deletedAt && task.status !== 'archived' && state.units.some(unit => unit.id === task.unitId && !unit.deletedAt));
  for (const unit of state.units.filter(unit => !unit.deletedAt && unit.ownerId === userId)) result.push({ id: `unit:${unit.id}`, kind: 'unit', label: '단위업무 소유', title: unit.title, departmentId: unit.departmentId });
  for (const task of activeTasks.filter(task => task.primaryId === userId || task.versions.at(-1)?.primaryId === userId)) result.push({ id: `primary:${task.id}`, kind: 'primary', label: '세부업무 주담당', title: task.title, departmentId: task.departmentId, taskId: task.id });
  for (const run of state.runs.filter(run => run.status !== 'completed' && run.primaryId === userId && activeTasks.some(task => task.id === run.taskId))) result.push({ id: `run_primary:${run.id}`, kind: 'run_primary', label: '진행 회차 주담당', title: run.title, departmentId: run.departmentId, taskId: run.taskId });
  const departments = new Set([...state.users.map(user => user.departmentId), ...state.tasks.map(task => task.departmentId), ...state.runs.map(run => run.departmentId), ...state.commonTasks.flatMap(common => common.departmentIds)]);
  for (const departmentId of departments) for (const role of residualTransferRoles(state, userId, departmentId, now)) result.push({ id: role.id, kind: role.kind, label: transferRoleLabels[role.kind], title: role.title, departmentId: role.departmentId, taskId: role.taskId });
  for (const transfer of (state.workTransfers ?? []).filter(transfer => transfer.status === 'pending' && [transfer.fromId, transfer.toId].includes(userId))) result.push({ id: `transfer:${transfer.id}`, kind: 'transfer', label: '승인 대기 인수인계', title: `${transfer.fromName} → ${transfer.toName}`, departmentId: transfer.departmentId });
  for (const transfer of state.handovers.filter(transfer => !['completed', 'cancelled'].includes(transfer.status) && [transfer.fromId, transfer.toId].includes(userId))) result.push({ id: `legacy:${transfer.id}`, kind: 'transfer', label: '기존 인수인계 진행', title: transfer.title, departmentId: transfer.departmentId });
  return result;
}

export function organizationIdentityIssue(state: Pick<WorkspaceData, 'users'>, next: Pick<User, 'id' | 'email'>): OrganizationChangeIssue | undefined {
  if (next.email && state.users.some(user => user.id !== next.id && user.email?.trim().toLowerCase() === next.email?.trim().toLowerCase())) return { status: 409, code: 'DUPLICATE_USER_EMAIL', message: '같은 이메일을 사용하는 구성원이 있습니다. 비활성 계정도 확인해 주세요.' };
}

export function organizationUserChangeIssue(state: OrganizationState, actor: User, current: User, next: User, now = new Date()): OrganizationChangeIssue | undefined {
  const issue = (code: string, message: string, status: 403 | 409 = 409): OrganizationChangeIssue => ({ status, code, message });
  if (actor.role !== 'admin') return issue('ADMIN_REQUIRED', '기관 관리자만 인사정보를 변경할 수 있습니다.', 403);
  const identity = organizationIdentityIssue(state, next); if (identity) return identity;
  const remainsActive = isOrganizationUserActive(next, now);
  const wasActive = isOrganizationUserActive(current, now);
  if (actor.id === current.id && (next.role !== 'admin' || !remainsActive)) return issue('SELF_ADMIN_LOCKOUT', '본인의 관리자 권한을 해제하거나 계정을 비활성화할 수 없습니다. 다른 관리자에게 요청해 주세요.');
  if (wasActive && current.role === 'admin' && (next.role !== 'admin' || !remainsActive) && !state.users.some(user => user.id !== current.id && user.role === 'admin' && isOrganizationUserActive(user, now))) return issue('LAST_ADMIN_REQUIRED', '활성 기관 관리자를 최소 1명 유지해야 합니다.');
  if (wasActive && ['head', 'manager'].includes(current.role) && (!remainsActive || next.role !== current.role || next.departmentId !== current.departmentId) && !state.users.some(user => user.id !== current.id && user.departmentId === current.departmentId && user.role === current.role && isOrganizationUserActive(user, now))) return issue('DEPARTMENT_OFFICER_REQUIRED', `${current.role === 'head' ? '부서장' : '부서 담당자'}를 먼저 후임으로 지정해 주세요. 기존 부서에 활성 담당자를 최소 1명 유지해야 합니다.`);
  const responsibilities = organizationResponsibilities(state, current.id, now);
  if ((next.departmentId !== current.departmentId || wasActive && !remainsActive) && responsibilities.length) return issue('PERSONNEL_RESPONSIBILITIES_REMAIN', `남은 업무 책임 ${responsibilities.length}건을 인수인계하거나 해제한 뒤 전보·비활성화를 처리해 주세요.`);
  const assignmentChanged = next.role !== current.role || next.team !== current.team || !!next.commonTaskPermission !== !!current.commonTaskPermission;
  if (assignmentChanged) {
    if (responsibilities.some(item => item.kind === 'transfer')) return issue('PERSONNEL_TRANSFER_PENDING', '진행 중인 인수인계를 먼저 완료하거나 취소한 뒤 팀·역할을 변경해 주세요.');
    if (['head', 'admin'].includes(next.role) && responsibilities.some(item => ['unit', 'primary', 'run_primary'].includes(item.kind))) return issue('PERSONNEL_ROLE_CONFLICT', '부서장·관리자로 변경하기 전에 개인 소유 업무와 진행 회차를 인수인계해 주세요.');
    for (const departmentId of new Set(responsibilities.map(item => item.departmentId))) {
      for (const role of residualTransferRoles(state, current.id, departmentId, now)) {
        if (role.kind === 'delegation_revoke') continue;
        const error = transferRoleRecipientError(state, role, next, now);
        if (error) return issue('PERSONNEL_ROLE_CONFLICT', `${transferRoleLabels[role.kind]} · ${role.title}: ${error} 해당 역할을 먼저 인수인계해 주세요.`);
      }
    }
  }
}
