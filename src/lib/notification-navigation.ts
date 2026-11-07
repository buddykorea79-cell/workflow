import type { Notification, Workspace } from './types';

export type NotificationDestination =
  | { view: 'delegation'; delegationId?: string }
  | { view: 'performance'; personId?: string; period?: string }
  | { view: 'handover' | 'common' }
  | { view: 'task'; taskId: string };

/** Old notifications remain useful; new ones carry the exact approval target. */
export function notificationDestination(notification: Notification, workspace: Pick<Workspace, 'delegations' | 'performances' | 'tasks'>): NotificationDestination {
  if (notification.destination) return notification.destination;
  if (notification.type === 'handover') return { view: 'handover' };
  if (notification.type === 'common') return { view: 'common' };
  if (notification.title.includes('업무대행')) {
    const records = workspace.delegations.filter(item => item.taskId === notification.targetId);
    const record = records.find(item => item.status === 'pending') || records[0];
    return { view: 'delegation', delegationId: record?.id };
  }
  if (/성과.*(평가|보완)/.test(notification.title)) {
    const period = notification.description.match(/\b\d{4}-H[12]\b/)?.[0];
    const record = workspace.performances.find(item => item.taskId === notification.targetId && (!period || item.period === period));
    return { view: 'performance', personId: record?.authorId || workspace.tasks.find(task => task.id === notification.targetId)?.primaryId, period: period || record?.period };
  }
  return workspace.tasks.some(task => task.id === notification.targetId) ? { view: 'task', taskId: notification.targetId } : { view: 'common' };
}
