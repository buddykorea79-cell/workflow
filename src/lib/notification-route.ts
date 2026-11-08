import { commonPublished } from './common-approval';
import { formatHash, parseHash, type HashRoute } from './hash-route';
import { notificationDestination } from './notification-navigation';
import type { CommonDistribution, CommonTask, Notification, Workspace } from './types';

type RouteWorkspace = Pick<Workspace, 'currentUser' | 'tasks' | 'units' | 'commonTasks' | 'handovers' | 'workTransfers' | 'performances' | 'delegations'>;
const canonical = (route: HashRoute) => parseHash(formatHash(route));

/** Resolve only objects in the permission-filtered workspace; stale targets open a safe base view. */
export function notificationRoute(notification: Notification, workspace: RouteWorkspace): HashRoute {
  const user = workspace.currentUser;
  const taskView = user.role === 'head' ? 'department' : 'personal';
  const taskRoute = (id: string): HashRoute => {
    const task = workspace.tasks.find(item => item.id === id);
    return task && !task.deletedAt && !workspace.units.some(unit => unit.id === task.unitId && unit.deletedAt)
      ? canonical({ view: taskView, taskId: task.id, tab: 'overview' }) : { view: taskView };
  };
  const commonRoute = (common?: CommonTask, distribution?: CommonDistribution): HashRoute => {
    if (!common) return { view: 'common' };
    // Allocation's default department matches the existing sidebar scope, including admins.
    const received = distribution ? distribution.departmentId === user.departmentId && distribution.status === 'pending'
      : common.distributions.some(item => item.departmentId === user.departmentId && item.status === 'pending');
    return canonical({ view: ['manager', 'admin'].includes(user.role) && received && commonPublished(common) ? 'allocation' : 'common', focus: common.id });
  };
  const sharedRoute = (id: string, distributionOnly = false): HashRoute => {
    if (!distributionOnly) {
      const common = workspace.commonTasks.find(item => item.id === id);
      if (common) return commonRoute(common);
    }
    const common = workspace.commonTasks.find(item => item.distributions.some(distribution => distribution.id === id));
    return commonRoute(common, common?.distributions.find(item => item.id === id));
  };
  const handoverRoute = (id: string, kind?: 'handover' | 'transfer'): HashRoute => {
    const visible = kind !== 'transfer' && workspace.handovers.some(item => item.id === id)
      || kind !== 'handover' && (workspace.workTransfers ?? []).some(item => item.id === id);
    return visible ? canonical({ view: 'handover', focus: id }) : { view: 'handover' };
  };

  // Keep the exact person/period or delegation ID in notificationDestination for the caller;
  // these two screens intentionally have no generic focus parameter in the hash contract.
  if (notification.destination) return { view: notification.destination.view };
  if (notification.targetType === 'task') return taskRoute(notification.targetId);
  if (notification.targetType === 'common') return sharedRoute(notification.targetId);
  if (notification.targetType === 'distribution') return sharedRoute(notification.targetId, true);
  if (notification.targetType === 'handover' || notification.targetType === 'transfer') return handoverRoute(notification.targetId, notification.targetType);
  if (notification.targetType === 'performance' || notification.targetType === 'delegation') return { view: notification.targetType };

  if (notification.type === 'common') return sharedRoute(notification.targetId);
  if (notification.type === 'handover') return handoverRoute(notification.targetId);
  const legacy = notificationDestination(notification, workspace);
  if (legacy.view === 'performance' || legacy.view === 'delegation') return { view: legacy.view };
  return taskRoute(notification.targetId);
}
