import type { Delegation, Task, User, WorkspaceData } from './types';
import { commonPublished } from './common-approval';
import { isRegisteredWork } from './work-division';

export type DelegationState = Pick<WorkspaceData, 'users' | 'units' | 'delegations' | 'commonTasks'>;
export const delegationActions = ['run.check', 'run.completeStep', 'run.note', 'run.create', 'run.schedule', 'run.completeCycle', 'run.nextCycle', 'task.setProgress', 'task.record', 'performance.create', 'attachment.upload'] as const;
const active = (user: User | undefined, now: Date) => !!user?.active && (!user.endsAt || new Date(user.endsAt) > now);
export const delegationStatus = (delegation: Delegation) => delegation.revokedAt ? 'revoked' : delegation.status ?? (delegation.approvedBy ? 'approved' : 'pending');

/** Delegation grants execution of the original work, never ownership or review. */
export function activeTaskDelegations(state: DelegationState, task: Task, user?: User, now = new Date()): Delegation[] {
  if (task.deletedAt || task.status === 'archived' || !state.units.some(unit => unit.id === task.unitId && !unit.deletedAt) || !isRegisteredWork(state, task)) return [];
  if (task.commonId && !state.commonTasks.some(common => common.id === task.commonId && commonPublished(common))) return [];
  return state.delegations.filter(delegation => {
    if (delegation.taskId !== task.id || delegationStatus(delegation) !== 'approved' || !delegation.approvedBy || delegation.fromId !== task.primaryId || user && delegation.toId !== user.id || !(new Date(delegation.startsAt) <= now) || !(now < new Date(delegation.endsAt))) return false;
    if (delegation.departmentId && delegation.departmentId !== task.departmentId) return false;
    const recipient = state.users.find(member => member.id === delegation.toId);
    return active(recipient, now) && recipient!.departmentId === task.departmentId && recipient!.role !== 'head' && recipient!.id !== task.primaryId && recipient!.id !== task.reviewerId;
  });
}

export function canActAsDeputy(state: DelegationState, user: User, task: Task, action?: string, now = new Date()) {
  return active(user, now) && activeTaskDelegations(state, task, user, now).some(delegation => !action || delegation.actions.includes(action));
}

export function canRequestTaskDelegation(_state: DelegationState, user: User, task: Task, now = new Date()) {
  return active(user, now) && user.role !== 'head' && !task.deletedAt && task.status !== 'archived'
    && (user.role === 'admin' || user.departmentId === task.departmentId && (user.id === task.primaryId || user.role === 'manager'));
}

export function requestableDelegationTasks(state: DelegationState & Pick<WorkspaceData, 'tasks'>, user: User, now = new Date()) {
  return state.tasks.filter(task => canRequestTaskDelegation(state, user, task, now)
    && state.units.some(unit => unit.id === task.unitId && !unit.deletedAt)
    && isRegisteredWork(state, task)
    && (!task.commonId || state.commonTasks.some(common => common.id === task.commonId && commonPublished(common)))
    && state.users.some(owner => owner.id === task.primaryId && active(owner, now) && owner.departmentId === task.departmentId));
}

export function canReviewTaskDelegation(state: Pick<WorkspaceData, 'tasks'>, user: User, delegation: Delegation, now = new Date()) {
  const departmentId = delegation.departmentId ?? state.tasks.find(task => task.id === delegation.taskId)?.departmentId;
  return active(user, now) && delegationStatus(delegation) === 'pending' && user.role === 'head' && user.departmentId === departmentId
    && ![delegation.fromId, delegation.toId, delegation.requestedBy].includes(user.id);
}
