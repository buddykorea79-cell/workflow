import type { CommonApprovalRequest, CommonTask, User, WorkspaceData } from './types';

/** Creation is part of ordinary work responsibility, never a separate permission. */
export function canCreateCommon(user: User, now = new Date()) {
  return user.active && (!user.endsAt || new Date(user.endsAt) > now) && user.role !== 'head';
}

/** Existing distributed records predate approval metadata and remain published. */
export function commonPublished(common: CommonTask) {
  return !common.publicationStatus || common.publicationStatus === 'approved';
}

export function commonOriginDepartment(state: Pick<WorkspaceData, 'users'>, common: CommonTask) {
  return common.originDepartmentId || state.users.find(user => user.id === common.managerId)?.departmentId;
}

export function canReviewCommon(state: Pick<WorkspaceData, 'users'>, user: User, common: CommonTask, request = common.approvalRequests?.find(item => item.status === 'pending'), now = new Date()) {
  return !!request && request.status === 'pending' && user.active && (!user.endsAt || new Date(user.endsAt) > now)
    && user.role === 'head' && user.departmentId === commonOriginDepartment(state, common) && request.departmentId === user.departmentId
    && request.requestedBy !== user.id && common.managerId !== user.id;
}

export function commonApprovalSnapshot(common: CommonTask): CommonApprovalRequest['snapshot'] {
  const { managerId, title, description, dueDate, frequency, requiredSteps, kind, projectName, directiveIssuer, instructedOn } = common;
  return { managerId, title, description, dueDate, frequency, requiredSteps: [...requiredSteps], ...(kind ? { kind } : {}), ...(projectName ? { projectName } : {}), ...(directiveIssuer ? { directiveIssuer } : {}), ...(instructedOn ? { instructedOn } : {}) };
}
