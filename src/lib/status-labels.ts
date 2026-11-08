import { runWorkflow } from './work-cycles';
import type { CommonExecutionStatus, CommonStage, DefinitionStatus, Run, RunStatus, Task, WorkflowStep } from './types';

export type StatusTone = 'dark' | 'soft' | 'outline' | 'success' | 'info' | 'warning';
export type StatusState<Key extends string> = { key: Key; label: string; tone: StatusTone };

const executionStates: Record<RunStatus, StatusState<RunStatus>> = {
  scheduled: { key: 'scheduled', label: '시작 전', tone: 'soft' },
  in_progress: { key: 'in_progress', label: '진행 중', tone: 'info' },
  review: { key: 'review', label: '검토 대기', tone: 'info' },
  paused: { key: 'paused', label: '일시 중지', tone: 'warning' },
  completed: { key: 'completed', label: '완료', tone: 'success' },
};
const definitionStates: Record<DefinitionStatus, StatusState<DefinitionStatus>> = {
  draft: { key: 'draft', label: '기준 작성 중', tone: 'soft' },
  review: { key: 'review', label: '기준 검토 중', tone: 'info' },
  confirmed: { key: 'confirmed', label: '기준 확정', tone: 'success' },
  revision: { key: 'revision', label: '기준 변경 중', tone: 'warning' },
  archived: { key: 'archived', label: '보관', tone: 'outline' },
};
const commonStageStates: Record<CommonStage, StatusState<CommonStage>> = {
  team_pending: { key: 'team_pending', label: '팀 배정 대기', tone: 'info' },
  person_pending: { key: 'person_pending', label: '개인 배정 대기', tone: 'info' },
  registration_pending: { key: 'registration_pending', label: '단위업무 등록 대기', tone: 'info' },
  in_progress: { key: 'in_progress', label: '수행', tone: 'info' },
  completed: { key: 'completed', label: '완료', tone: 'success' },
};

export const statusTerms = {
  assignmentManagement: '배정·승인 관리', departmentReceipt: '부서 접수', teamAssignment: '팀 배정',
  personAssignment: '개인 배정', unitRegistration: '단위업무 등록', execution: '수행', completion: '완료',
  overdue: '기한 경과', cycleOverdue: '회차 일정 지남',
} as const;

export const executionState = <Key extends RunStatus>(status: Key): StatusState<Key> => ({ ...executionStates[status], key: status });
export const executionLabel = (status: RunStatus): string => executionStates[status].label;
export const definitionState = (status: DefinitionStatus): StatusState<DefinitionStatus> => ({ ...definitionStates[status] });
export const definitionLabel = (status: DefinitionStatus): string => definitionStates[status].label;
export const commonStageState = (stage: CommonStage): StatusState<CommonStage> => ({ ...commonStageStates[stage] });
export const commonStageLabel = (stage: CommonStage): string => commonStageStates[stage].label;

/** The same dependency-aware next step drives task badges and shared-work summaries. */
export function nextExecutionStep(task?: Task, run?: Run) {
  const definition = run && task ? runWorkflow(task, run) : run?.workflowSnapshot ?? task?.workflow ?? [];
  const steps = run ? run.steps.map(step => ({ id: step.stepId, role: step.role, done: step.status === 'completed' })) : (task?.workflow ?? []).map(step => ({ id: step.id, role: step.role, done: step.done === true }));
  return steps.find(step => !step.done && (definition.find(item => item.id === step.id)?.dependsOn ?? []).every(dependency => steps.find(item => item.id === dependency)?.done)) ?? steps.find(step => !step.done);
}

/** Explicit pauses take precedence; otherwise recorded progress beats a stale scheduled flag. */
export function executionStatus(task: Task | undefined, run: Run | undefined, progress: number, nextRole?: WorkflowStep['role']): StatusState<RunStatus> {
  if (run?.status === 'paused') return executionState('paused');
  if (progress >= 100) return executionState('completed');
  const role = nextRole ?? nextExecutionStep(task, run)?.role;
  if (run?.status === 'review' || progress > 0 && role === 'reviewer') return executionState('review');
  if (progress > 0 || run?.status === 'in_progress') return executionState('in_progress');
  return executionState('scheduled');
}

/** Keep the existing public not_started key while sharing execution labels and tones. */
export function commonExecutionState(status: CommonExecutionStatus): StatusState<CommonExecutionStatus> {
  if (status === 'not_started') return { ...executionState('scheduled'), key: status };
  if (status === 'archived') return { key: status, label: definitionLabel('archived'), tone: definitionState('archived').tone };
  if (status === 'deleted') return { key: status, label: '삭제됨', tone: 'outline' };
  return executionState(status);
}
