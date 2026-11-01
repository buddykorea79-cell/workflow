import { commonDistributionStatus } from './common-status';
import type { CommonDistribution, CommonTask, DirectiveIssuer, User, WorkspaceData } from './types';

export const directiveIssuerLabels: Record<DirectiveIssuer, string> = { minister: '장관', vice_minister: '차관', office_head: '실장', bureau_head: '국장' };
export const isCentralDirective = (common: Pick<CommonTask, 'kind' | 'directiveIssuer'>) => common.kind === 'directive' && (common.directiveIssuer === 'minister' || common.directiveIssuer === 'vice_minister');

/** Coordination grants access to the common directive register, never foreign task bodies. */
export function isDirectiveCoordinator(state: Pick<WorkspaceData, 'departments'>, user: User, now = new Date()) {
  return user.active && (!user.endsAt || new Date(user.endsAt) > now) && user.role !== 'head' && user.team.trim() === '기획팀' && state.departments.some(department => department.id === user.departmentId && department.name === '기획재정담당관실');
}

export function canManageDirective(state: Pick<WorkspaceData, 'departments'>, user: User, common: CommonTask, now = new Date()) {
  return common.kind === 'directive' && user.active && (!user.endsAt || new Date(user.endsAt) > now) && user.role !== 'head' && (user.role === 'admin' || common.managerId === user.id && user.commonTaskPermission === true || isCentralDirective(common) && isDirectiveCoordinator(state, user, now));
}

export const directiveReportStartMonth = (common: CommonTask, distribution: CommonDistribution) => (common.instructedOn || distribution.distributedAt).slice(0, 7);

export function canRecordDirectiveReport(state: Pick<WorkspaceData, 'users' | 'tasks' | 'runs' | 'units'>, user: User, common: CommonTask, distribution: CommonDistribution, now = new Date()) {
  if (common.kind !== 'directive' || !user.active || user.endsAt && new Date(user.endsAt) <= now || !['registered', 'assigned', 'submitted'].includes(distribution.status)) return false;
  const task = state.tasks.find(item => item.id === distribution.taskId);
  if (!task || task.deletedAt || task.status === 'archived' || task.commonId !== common.id || task.departmentId !== distribution.departmentId || user.departmentId !== distribution.departmentId || !state.units.some(unit => unit.id === task.unitId && !unit.deletedAt)) return false;
  const projected = commonDistributionStatus(state, common, distribution, now);
  return projected.currentAssigneeId === user.id && !['completed', 'archived', 'deleted'].includes(projected.executionStatus || '');
}
