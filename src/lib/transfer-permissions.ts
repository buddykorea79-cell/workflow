import type { User, WorkTransfer } from './types';

/** Administrative access does not grant the department head's approval authority. */
export function canReviewTransfer(user: Pick<User, 'role' | 'departmentId' | 'active' | 'endsAt'>, transfer: Pick<WorkTransfer, 'departmentId' | 'status'>, now = new Date()): boolean {
  return user.active && (!user.endsAt || new Date(user.endsAt) > now) && user.role === 'head' && user.departmentId === transfer.departmentId && transfer.status === 'pending';
}

export function canCancelTransfer(user: Pick<User, 'id' | 'role' | 'departmentId'>, transfer: Pick<WorkTransfer, 'requestedBy' | 'departmentId' | 'status'>): boolean {
  return transfer.status === 'pending' && (user.id === transfer.requestedBy || user.role === 'admin' || user.role === 'manager' && user.departmentId === transfer.departmentId);
}
