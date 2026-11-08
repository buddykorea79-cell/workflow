'use client';

import type { Workspace } from '@/lib/types';

export function TaskAssignmentFields({ workspace, primaryId, departmentId, supportIds, cooperationDepartmentIds, onSupportChange, onDepartmentsChange }: {
  workspace: Workspace; primaryId: string; departmentId: string; supportIds: string[]; cooperationDepartmentIds: string[];
  onSupportChange: (ids: string[]) => void; onDepartmentsChange: (ids: string[]) => void;
}) {
  const people = workspace.users.filter(user => user.departmentId === departmentId && user.id !== primaryId && user.active && (!user.endsAt || user.endsAt > workspace.serverTime) && !['admin', 'head'].includes(user.role));
  const departments = workspace.cooperationDepartments ?? workspace.departmentDirectory ?? workspace.departments;
  const toggle = (values: string[], id: string, checked: boolean) => checked ? [...new Set([...values, id])] : values.filter(value => value !== id);
  return <section className="task-assignment-fields">
    <fieldset><legend>협업·지원 담당자</legend><p>함께 수행할 소속 부서의 직원을 선택하세요.</p><div className="task-assignment-options">{people.map(person => <label key={person.id}><input type="checkbox" checked={supportIds.includes(person.id)} onChange={event => onSupportChange(toggle(supportIds, person.id, event.target.checked))}/>{person.name} · {person.team}</label>)}</div></fieldset>
    <fieldset><legend>협조 대상 부서</legend><p>부서 협조 단계의 취합 결과는 업무 담당자가 기록합니다. 부서 지정은 업무 열람 권한을 부여하지 않습니다.</p><label><input type="checkbox" checked={departments.length > 0 && departments.every(department => cooperationDepartmentIds.includes(department.id))} onChange={event => onDepartmentsChange(event.target.checked ? departments.map(department => department.id) : [])}/>모든 부서 협조</label><div className="task-assignment-options">{departments.map(department => <label key={department.id}><input type="checkbox" checked={cooperationDepartmentIds.includes(department.id)} onChange={event => onDepartmentsChange(toggle(cooperationDepartmentIds, department.id, event.target.checked))}/>{department.name}</label>)}</div></fieldset>
  </section>;
}
