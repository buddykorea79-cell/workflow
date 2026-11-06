import type { Run, Task, WorkflowStep, Workspace } from './types';

export type ProcedureParticipants = Record<WorkflowStep['role'], string>;

/** Resolve the assignment on the displayed task or run, never the viewer's role. */
export function taskProcedureParticipants(
  workspace: Pick<Workspace, 'users' | 'identities'>,
  assignment: Pick<Task | Run, 'primaryId' | 'supportIds' | 'reviewerId'>,
): ProcedureParticipants {
  const name = (id: string) => workspace.users.find(user => user.id === id)?.name
    || workspace.identities?.find(user => user.id === id)?.name
    || '이름 확인 필요';
  return {
    primary: assignment.primaryId ? name(assignment.primaryId) : '담당자 미지정',
    support: assignment.supportIds.length ? [...new Set(assignment.supportIds)].map(name).join(', ') : '지원자 미지정',
    reviewer: assignment.reviewerId ? name(assignment.reviewerId) : '검토자 미지정',
  };
}
