import type { User, WorkTransfer } from './types';

export function canCancelTransfer(user: Pick<User, 'id' | 'role' | 'departmentId'>, transfer: Pick<WorkTransfer, 'requestedBy' | 'departmentId' | 'status'>): boolean {
  return transfer.status === 'pending' && (user.id === transfer.requestedBy || user.role === 'admin' || user.role === 'manager' && user.departmentId === transfer.departmentId);
}
