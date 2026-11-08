import { taskExecution } from './common-status';
import { executionStatus } from './status-labels';
import { deadlineState } from './task-deadline';
import { isRegisteredWork } from './work-division';
import type { Workspace, WorkspaceTask } from './types';

type DashboardWorkspace = Pick<Workspace, 'currentUser' | 'tasks' | 'runs' | 'units' | 'commonTasks' | 'serverTime'>;
const koreanDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });

function validDay(value: string): boolean {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}

/** Summarize only the server-authorized workspace; never fetch or expand its task scope. */
export function dashboardTaskSummary(workspace: DashboardWorkspace) {
  const user = workspace.currentUser;
  const activeUnitIds = new Set(workspace.units.filter(unit => !unit.deletedAt).map(unit => unit.id));
  const tasks = workspace.tasks.filter(task => !task.deletedAt && task.status !== 'archived' && activeUnitIds.has(task.unitId) && isRegisteredWork(workspace, task)
    && (user.role === 'admin' || (user.role === 'head' ? task.departmentId === user.departmentId : task.primaryId === user.id)));
  const now = new Date(workspace.serverTime);
  const today = Number.isFinite(now.getTime()) ? koreanDay.format(now) : '';
  const end = today ? new Date(`${today}T00:00:00Z`) : undefined;
  end?.setUTCDate(end.getUTCDate() + 7);
  const through = end?.toISOString().slice(0, 10) ?? '';
  const inProgress: WorkspaceTask[] = [], dueSoon: WorkspaceTask[] = [];
  let completed = 0, notStarted = 0;
  for (const task of tasks) {
    const execution = taskExecution(workspace, task);
    const status = executionStatus(task, execution.run, execution.progress, execution.nextRole).key;
    if (status === 'in_progress' || status === 'review') inProgress.push(task);
    if (status === 'completed') completed++;
    if (status === 'scheduled') notStarted++;
    const deadline = deadlineState({ taskDueDate: task.dueDate, progress: execution.progress, runStatus: status, taskStatus: task.status, deletedAt: task.deletedAt }, today);
    if (today && status !== 'completed' && status !== 'paused' && !deadline.overdue && validDay(deadline.deadline) && deadline.deadline >= today && deadline.deadline <= through) dueSoon.push(task);
  }
  return { tasks, inProgress, completed, notStarted, dueSoon };
}
