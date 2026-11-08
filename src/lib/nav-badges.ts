import { canReviewCommon, commonPublished } from './common-approval';
import { canReviewTaskDelegation } from './delegations';
import { canReviewTransfer } from './transfer-permissions';
import { canEvaluateUnitPerformance } from './unit-evaluation';
import { canEditDepartmentDefinitions } from './work-division';
import type { Workspace } from './types';

type NavWorkspace = Pick<Workspace, 'currentUser' | 'users' | 'identities' | 'tasks' | 'commonTasks' | 'departmentWorkPlans' | 'workTransfers' | 'unitScorePlans' | 'unitEvaluations' | 'performances' | 'delegations' | 'serverTime'>;

/** Counts available review/assignment actions in the already authorized workspace. */
export function navBadges(workspace: NavWorkspace, now = new Date(workspace.serverTime)): Partial<Record<string, number>> {
  const user = workspace.currentUser;
  if (!user.active || user.endsAt && !(new Date(user.endsAt) > now)) return {};
  const badges: Partial<Record<string, number>> = {};
  const add = (view: 'common' | 'allocation' | 'handover' | 'performance' | 'delegation', count = 1) => { if (count) badges[view] = (badges[view] ?? 0) + count; };
  for (const common of workspace.commonTasks) {
    add('common', (common.approvalRequests ?? []).filter(request => canReviewCommon(workspace, user, common, request, now)).length);
    if (!commonPublished(common)) continue;
    for (const distribution of common.distributions) {
      if (!canEditDepartmentDefinitions(workspace, user, distribution.departmentId)) continue;
      // Allocation opens in the user's department. Preserve that existing scope even for admins;
      // pending team assignment in other departments is not advertised as a global total.
      if (distribution.status === 'pending' && ['manager', 'admin'].includes(user.role) && distribution.departmentId === user.departmentId) add('allocation');
      // Common work opens across readable departments; an admin can assign any team's recipient.
      if (distribution.status === 'team_assigned' && (user.role === 'admin' || user.role === 'lead' && distribution.leadId === user.id && distribution.departmentId === user.departmentId)) add('common');
      if (distribution.status === 'person_assigned' && distribution.assigneeId === user.id) add('common');
    }
  }
  add('handover', (workspace.workTransfers ?? []).filter(transfer => canReviewTransfer(user, transfer, now)).length);
  const evaluations = new Set((workspace.unitScorePlans ?? []).filter(plan => canEvaluateUnitPerformance(workspace, user, plan.personId, plan.period, now)).map(plan => JSON.stringify([plan.personId, plan.period])));
  add('performance', evaluations.size);
  // A batch is one review card, even when it contains several delegated tasks.
  const delegations = new Set(workspace.delegations.filter(record => canReviewTaskDelegation(workspace, user, record, now)).map(record => record.batchId || record.id));
  add('delegation', delegations.size);
  return badges;
}
