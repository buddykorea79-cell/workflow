import { DomainError } from './domain-error';
import { organizationDivisionForUser, organizationDivisionRows } from './organization-division';
import { taskProcedureParticipants, type ProcedureParticipants } from './procedure-participants';
import type { User, WorkflowStep, WorkspaceData } from './types';

/** Public within the assignment directory: current flow and assignee labels only. */
export interface OrganizationDivisionProcedure {
  taskId: string;
  taskTitle: string;
  unitTitle: string;
  departmentName: string;
  workflow: Pick<WorkflowStep, 'id' | 'title' | 'role' | 'dependsOn'>[];
  participants: ProcedureParticipants;
}

/** The caller authenticates an active user. Directory membership is the read boundary. */
export function organizationDivisionProcedureForUser(state: WorkspaceData, user: User, taskId: string, now = new Date()): OrganizationDivisionProcedure {
  const row = organizationDivisionRows(organizationDivisionForUser(state, user, now)).find(item => item.taskId === taskId);
  const task = row && state.tasks.find(item => item.id === row.taskId);
  if (!row || !task) throw new DomainError(404, 'DIVISION_PROCEDURE_NOT_FOUND', '업무분장표에서 조회할 수 있는 세부업무를 찾지 못했습니다. 분장표를 새로고침해 주세요.');
  const stepIds = new Set(task.workflow.map(step => step.id));
  return {
    taskId: row.taskId,
    taskTitle: row.task,
    unitTitle: row.unit,
    departmentName: row.department,
    workflow: task.workflow.map(step => ({
      id: step.id, title: step.title, role: step.role,
      dependsOn: [...new Set(step.dependsOn.filter(id => id !== step.id && stepIds.has(id)))],
    })),
    participants: taskProcedureParticipants({ users: state.users, departments: state.departments }, task),
  };
}
