import type { User, WorkTransferRole, WorkspaceData } from './types';

export type TransferRoleState = Pick<WorkspaceData, 'users' | 'units' | 'tasks' | 'runs' | 'commonTasks' | 'delegations'>;
export const transferRoleLabels: Record<WorkTransferRole['kind'], string> = {
  task_support: '업무 지원담당', task_reviewer: '업무 검토자', run_support: '진행 회차 지원담당', run_reviewer: '진행 회차 검토자',
  common_manager: '공통업무 총괄', distribution_lead: '배정 대기 팀장', distribution_assignee: '등록 대기 담당자', delegation_revoke: '대행 권한 해제',
};

/** Client/server share the same remaining-responsibility inventory. Completed
 * executions and their historical authors are never transfer candidates. */
export function residualTransferRoles(state: TransferRoleState, fromId: string, departmentId: string, now = new Date()): WorkTransferRole[] {
  const roles: WorkTransferRole[] = [];
  const add = (kind: WorkTransferRole['kind'], targetId: string, title: string, basis: unknown, links: { taskId?: string; commonId?: string } = {}) => roles.push({ id: `${kind}:${targetId}`, kind, targetId, title, departmentId, fingerprint: JSON.stringify(basis), ...links });
  const activeTasks = state.tasks.filter(task => task.departmentId === departmentId && !task.deletedAt && task.status !== 'archived' && state.units.some(unit => unit.id === task.unitId && !unit.deletedAt));
  for (const task of activeTasks) {
    const confirmed = task.versions.at(-1);
    const basis = { version: task.version, primaryId: task.primaryId, supportIds: [...task.supportIds].sort(), reviewerId: task.reviewerId, status: task.status, title: task.title, description: task.description,
      workflow: task.workflow.map(({ done: _done, ...step }) => step),
      confirmedVersion: confirmed?.version, confirmedPrimaryId: confirmed?.primaryId, confirmedSupportIds: [...(confirmed?.supportIds ?? [])].sort(), confirmedReviewerId: confirmed?.reviewerId };
    if (task.supportIds.includes(fromId) || confirmed?.supportIds?.includes(fromId)) add('task_support', task.id, task.title, basis, { taskId: task.id });
    if (task.reviewerId === fromId || confirmed?.reviewerId === fromId) add('task_reviewer', task.id, task.title, basis, { taskId: task.id });
  }
  for (const run of state.runs.filter(run => run.departmentId === departmentId && run.status !== 'completed' && activeTasks.some(task => task.id === run.taskId))) {
    const basis = { primaryId: run.primaryId, supportIds: [...run.supportIds].sort(), reviewerId: run.reviewerId, definitionVersion: run.definitionVersion };
    if (run.supportIds.includes(fromId)) add('run_support', run.id, run.title, basis, { taskId: run.taskId });
    if (run.reviewerId === fromId) add('run_reviewer', run.id, run.title, basis, { taskId: run.taskId });
  }
  for (const common of state.commonTasks) {
    if (common.managerId === fromId && state.users.find(user => user.id === fromId)?.departmentId === departmentId) {
      add('common_manager', common.id, common.title, { managerId: common.managerId, version: common.version, departments: [...common.departmentIds].sort() }, { commonId: common.id });
    }
    for (const distribution of common.distributions.filter(item => item.departmentId === departmentId && ['team_assigned', 'person_assigned'].includes(item.status))) {
      const basis = { status: distribution.status, team: distribution.team, leadId: distribution.leadId, assigneeId: distribution.assigneeId, taskId: distribution.taskId };
      if (distribution.leadId === fromId) add('distribution_lead', distribution.id, common.title, basis, { commonId: common.id });
      if (distribution.status === 'person_assigned' && distribution.assigneeId === fromId) add('distribution_assignee', distribution.id, common.title, basis, { commonId: common.id });
    }
  }
  for (const delegation of state.delegations.filter(item => !item.revokedAt && new Date(item.endsAt) > now && [item.fromId, item.toId].includes(fromId))) {
    const task = state.tasks.find(task => task.id === delegation.taskId && task.departmentId === departmentId);
    if (task) add('delegation_revoke', delegation.id, task.title, { fromId: delegation.fromId, toId: delegation.toId, startsAt: delegation.startsAt, endsAt: delegation.endsAt, actions: [...delegation.actions].sort() }, { taskId: task.id });
  }
  return roles;
}

/** Empty string means eligible. The server checks this again at approval. */
export function transferRoleRecipientError(state: TransferRoleState, role: WorkTransferRole, recipient: User, now = new Date()): string {
  if (!recipient.active || recipient.endsAt && new Date(recipient.endsAt) <= now || recipient.departmentId !== role.departmentId) return '같은 부서의 활성 구성원을 선택해 주세요.';
  if (role.kind === 'delegation_revoke') return '';
  if (role.kind === 'common_manager') return recipient.role !== 'head' ? '' : '업무 담당자·팀장·부서 담당자·관리자 중 후임을 선택해 주세요.';
  if (role.kind.startsWith('distribution_')) {
    const distribution = state.commonTasks.find(common => common.id === role.commonId)?.distributions.find(item => item.id === role.targetId);
    if (!distribution || recipient.team !== distribution.team) return '현재 배정된 팀의 후임을 선택해 주세요.';
    return role.kind === 'distribution_lead' ? recipient.role === 'lead' ? '' : '팀장 역할의 후임을 선택해 주세요.' : ['member', 'manager', 'lead'].includes(recipient.role) ? '' : '업무 담당자·팀장·부서담당자 중 선택해 주세요.';
  }
  const task = state.tasks.find(item => item.id === role.taskId);
  const run = role.kind.startsWith('run_') ? state.runs.find(item => item.id === role.targetId) : undefined;
  const assignments = run ? [run] : task ? [task, ...(task.versions.at(-1) ? [task.versions.at(-1)!] : [])] : [];
  if (role.kind.endsWith('reviewer')) {
    if (!['head', 'manager', 'lead'].includes(recipient.role)) return '부서장·부서담당자·팀장 중 검토자를 선택해 주세요.';
    if (assignments.some(item => item.primaryId === recipient.id || item.supportIds?.includes(recipient.id))) return '수행·지원 담당자는 같은 업무의 검토자가 될 수 없습니다.';
  } else {
    if (!['member', 'manager', 'lead'].includes(recipient.role)) return '업무 담당자·팀장·부서담당자 중 지원담당자를 선택해 주세요.';
    if (assignments.some(item => item.primaryId === recipient.id || item.reviewerId === recipient.id)) return '주담당·검토자와 다른 지원담당자를 선택해 주세요.';
  }
  return '';
}
