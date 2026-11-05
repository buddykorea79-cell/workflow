import { randomUUID } from 'node:crypto';
import { executeCommand } from '../src/lib/domain';
import type { WorkspaceData } from '../src/lib/types';

/** Existing execution tests start after publication; approve through the real command. */
export function approveLatestCommon(state: WorkspaceData, now: Date, commonId = state.commonTasks[0].id) {
  const common = state.commonTasks.find(item => item.id === commonId)!;
  const request = common.approvalRequests?.find(item => item.status === 'pending');
  if (!request) throw new Error('Expected a pending common approval in this fixture');
  const head = state.users.find(user => user.departmentId === request.departmentId && user.role === 'head' && user.active)!;
  const candidate = structuredClone(state);
  executeCommand(candidate, head.id, { type: 'common.approve', payload: { commonId, requestId: request.id }, expectedRevision: state.revision, requestId: randomUUID() }, now);
  Object.assign(state, candidate);
}
