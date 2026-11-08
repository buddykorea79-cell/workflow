import type { Run, Task, WorkflowStep, Workspace } from './types';

export type ProcedureParticipants = Record<WorkflowStep['role'], string>;

/** Resolve the assignment on the displayed task or run, never the viewer's role. */
export function taskProcedureParticipants(
  workspace: Pick<Workspace, 'users' | 'identities' | 'cooperationDepartments' | 'departmentDirectory'> & Partial<Pick<Workspace, 'departments'>>,
  assignment: Pick<Task | Run, 'primaryId' | 'supportIds' | 'reviewerId'> & { cooperationDepartmentIds?: string[] },
): ProcedureParticipants {
  const name = (id: string) => workspace.users.find(user => user.id === id)?.name
    || workspace.identities?.find(user => user.id === id)?.name
    || '이름 확인 필요';
  const departments = workspace.cooperationDepartments ?? workspace.departmentDirectory ?? workspace.departments ?? [];
  const support = [...new Set(assignment.supportIds)].map(name);
  if (assignment.cooperationDepartmentIds?.length) support.push(`${assignment.cooperationDepartmentIds.map(id => departments.find(department => department.id === id)?.name ?? '협조 부서').join(', ')} 협조`);
  return {
    primary: assignment.primaryId ? name(assignment.primaryId) : '담당자 미지정',
    support: support.length ? support.join(' · ') : '지원자 미지정',
    reviewer: assignment.reviewerId ? name(assignment.reviewerId) : '검토자 미지정',
  };
}
