import type { Task, Workspace } from './types';

export interface ProcedureContext {
  departmentName: string;
  unitTitle: string;
  taskTitle: string;
}

export function taskProcedureContext(workspace: Pick<Workspace, 'departments' | 'units'>, task: Pick<Task, 'departmentId' | 'unitId' | 'title'>): ProcedureContext {
  return {
    departmentName: workspace.departments.find(department => department.id === task.departmentId)?.name || '확인 필요',
    unitTitle: workspace.units.find(unit => unit.id === task.unitId)?.title || '확인 필요',
    taskTitle: task.title,
  };
}

export function procedureContextText(context?: ProcedureContext): string {
  return `부서명: ${context?.departmentName || '—'} · 단위업무: ${context?.unitTitle || '—'} · 개인업무: ${context?.taskTitle || '—'}`;
}
