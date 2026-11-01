import { runWorkflow } from './work-cycles';
import type { CommonDistribution, CommonExecutionStatus, CommonStage, CommonSummary, CommonTask, Run, Task, WorkspaceData } from './types';

const timestamp = (value?: string) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;
const latestTimestamp = (values: (string | undefined)[], fallback: string) => values.reduce<string>((latest, value) => value && timestamp(value) > timestamp(latest) ? value : latest, fallback);

/** A new occurrence is authoritative, even when an earlier occurrence completed.
 * Insertion order breaks equal startedAt values because new runs are prepended. */
export function latestTaskRun(state: Pick<WorkspaceData, 'runs'>, taskId: string): Run | undefined {
  return state.runs.filter(run => run.taskId === taskId).reduce<Run | undefined>((latest, run) => !latest || timestamp(run.startedAt) > timestamp(latest.startedAt) ? run : latest, undefined);
}

export function taskExecution(state: Pick<WorkspaceData, 'runs'>, task?: Task) {
  if (!task) return { source: 'none' as const, run: undefined, completedSteps: 0, totalSteps: 0, progress: 0, nextRole: undefined, nextStepId: undefined };
  const latest = latestTaskRun(state, task.id);
  // Adding a new plan after a finished occurrence must not remain at 100%.
  // An unfinished historical occurrence still follows its own frozen definition.
  const run = latest && !(latest.status === 'completed' && task.version > latest.definitionVersion) ? latest : undefined;
  const definition = run ? runWorkflow(task, run) : task.workflow;
  const steps = run ? run.steps.map(step => ({ id: step.stepId, role: step.role, done: step.status === 'completed' })) : task.workflow.map(step => ({ id: step.id, role: step.role, done: step.done === true }));
  const completedSteps = steps.filter(step => step.done).length; const totalSteps = steps.length;
  const next = steps.find(step => !step.done && (definition?.find(item => item.id === step.id)?.dependsOn ?? []).every(dependency => steps.find(item => item.id === dependency)?.done)) ?? steps.find(step => !step.done);
  return { source: run ? 'run' as const : 'task' as const, run, completedSteps, totalSteps, progress: totalSteps ? Math.round(100 * completedSteps / totalSteps) : 0, nextRole: next?.role, nextStepId: next?.id };
}

/** Safe organizational summary only: no descriptions, budgets, evidence, notes,
 * checklist bodies or workflow contents are copied into the common dashboard. */
export function commonDistributionStatus(state: Pick<WorkspaceData, 'users' | 'tasks' | 'runs' | 'units'>, common: CommonTask, distribution: CommonDistribution, now = new Date()): CommonDistribution {
  const task = state.tasks.find(item => item.id === distribution.taskId);
  const unit = state.units.find(item => item.id === task?.unitId);
  const registered = ['registered', 'assigned', 'submitted'].includes(distribution.status);
  const execution = taskExecution(state, registered ? task : undefined);
  let executionStatus: CommonExecutionStatus = 'not_started';
  if (task?.deletedAt || unit?.deletedAt) executionStatus = 'deleted';
  else if (task?.status === 'archived') executionStatus = 'archived';
  else if (execution.run?.status === 'paused') executionStatus = 'paused';
  else if (registered && execution.totalSteps > 0 && execution.completedSteps === execution.totalSteps) executionStatus = 'completed';
  else if (registered && execution.nextRole === 'reviewer') executionStatus = 'review';
  else if (registered && (execution.completedSteps > 0 || execution.run && execution.run.status !== 'scheduled')) executionStatus = 'in_progress';

  let stage: CommonStage = distribution.status === 'pending' ? 'team_pending' : distribution.status === 'team_assigned' ? 'person_pending' : distribution.status === 'person_assigned' ? 'registration_pending' : executionStatus === 'completed' ? 'completed' : 'in_progress';
  const active = (userId?: string) => state.users.some(user => user.id === userId && user.active && (!user.endsAt || timestamp(user.endsAt) > now.getTime()));
  let nextActorIds: string[] = []; let nextAction = '';
  if (stage === 'team_pending') {
    nextActorIds = state.users.filter(user => user.departmentId === distribution.departmentId && user.role === 'manager' && active(user.id)).map(user => user.id);
    nextAction = '부서 담당자가 수행할 팀과 팀장을 배정해 주세요.';
  } else if (stage === 'person_pending') {
    nextActorIds = distribution.leadId ? [distribution.leadId] : [];
    nextAction = '배정받은 팀장이 팀원 중 수행 담당자를 지정해 주세요.';
  } else if (stage === 'registration_pending') {
    nextActorIds = distribution.assigneeId ? [distribution.assigneeId] : [];
    nextAction = '배정받은 담당자가 본인 단위업무에 세부업무로 등록해 주세요.';
  } else if (stage === 'completed') {
    nextAction = '현재 수행 절차가 모두 완료되었습니다.';
  } else if (!task) {
    nextActorIds = [common.managerId]; nextAction = '연결된 세부업무를 찾을 수 없습니다. 공통업무 담당자가 연결을 확인해 주세요.';
  } else {
    nextActorIds = execution.nextRole === 'reviewer' ? [execution.run?.reviewerId ?? task.reviewerId] : [execution.run?.primaryId ?? task.primaryId, ...(execution.run?.supportIds ?? task.supportIds)];
    nextAction = execution.nextRole === 'reviewer' ? '지정 검토자가 수행 결과를 확인하고 검토 절차를 완료해 주세요.' : '담당자가 세부업무의 다음 절차를 수행하고 진행사항을 기록해 주세요.';
  }
  if (['paused', 'archived', 'deleted'].includes(executionStatus)) {
    if (registered) stage = 'in_progress';
    nextActorIds = [executionStatus === 'paused' ? execution.run?.primaryId ?? task?.primaryId ?? common.managerId : common.managerId];
    nextAction = executionStatus === 'paused' ? '수행이 일시 중지되어 있습니다. 담당자가 재개 여부를 확인해 주세요.' : executionStatus === 'archived' ? '연결된 세부업무가 보관되었습니다. 공통업무 담당자가 업무 상태를 확인해 주세요.' : '연결된 업무 또는 단위업무가 삭제되었습니다. 공통업무 담당자가 복원 여부를 확인해 주세요.';
  }
  const eligibleActors = [...new Set(nextActorIds)].filter(active);
  if (nextActorIds.length && !eligibleActors.length) nextAction += ' 해당 역할의 활성 담당자도 확인해 주세요.';
  nextActorIds = eligibleActors;
  const dueDate = execution.run?.dueDate ?? task?.dueDate ?? common.dueDate;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const overdue = /^\d{4}-\d{2}-\d{2}$/.test(dueDate) && dueDate < today && stage !== 'completed' && !['paused', 'archived', 'deleted'].includes(executionStatus);
  const updatedAt = latestTimestamp([distribution.distributedAt, distribution.teamAssignedAt, distribution.personAssignedAt, distribution.registeredAt, task?.updatedAt, task?.deletedAt, unit?.deletedAt, execution.run?.startedAt, execution.run?.completedAt, execution.run?.updatedAt, ...(execution.run?.steps.flatMap(step => [step.completedAt, ...step.checklist.map(item => item.completedAt)]) ?? []), ...(execution.run?.notes.map(note => note.createdAt) ?? [])], distribution.distributedAt);
  // status stays compatible with older clients, while stage is the explicit
  // read model. Never leave a stale submitted badge on a new unfinished run.
  const status = registered ? executionStatus === 'completed' ? 'submitted' : distribution.status === 'assigned' ? 'assigned' : 'registered' : distribution.status;
  return { ...distribution, status, stage, executionStatus, nextActorIds, nextAction, currentAssigneeId: registered ? execution.run?.primaryId ?? task?.primaryId : undefined, taskOwnerId: registered ? task?.primaryId : undefined, progress: execution.progress, completedSteps: execution.completedSteps, totalSteps: execution.totalSteps, dueDate, updatedAt, overdue, unitTitle: unit?.title, taskTitle: task?.title, runId: execution.run?.id, period: execution.run?.period, progressSource: execution.source };
}

/** The denominator is the already permission-filtered department assignments.
 * Each assignment carries equal weight, including 0% before registration. */
export function summarizeCommon(distributions: CommonDistribution[]): CommonSummary {
  const count = (stage: CommonStage) => distributions.filter(item => item.stage === stage).length;
  const statusCount = (status: CommonExecutionStatus) => distributions.filter(item => item.executionStatus === status).length;
  return { totalDepartments: distributions.length, teamPending: count('team_pending'), personPending: count('person_pending'), registrationPending: count('registration_pending'), inProgress: count('in_progress'), completed: count('completed'), overdue: distributions.filter(item => item.overdue).length, paused: statusCount('paused'), archived: statusCount('archived'), deleted: statusCount('deleted'), averageProgress: distributions.length ? Math.round(distributions.reduce((sum, item) => sum + (item.progress ?? 0), 0) / distributions.length) : 0, completedSteps: distributions.reduce((sum, item) => sum + (item.completedSteps ?? 0), 0), totalSteps: distributions.reduce((sum, item) => sum + (item.totalSteps ?? 0), 0) };
}
