import type { User, WorkspaceData } from './types';
import { activeTaskDelegations } from './delegations';
import { commonPublished } from './common-approval';

/** Organization-wide assignment titles only. Never include task bodies or file metadata. */
export interface OrganizationDivisionReadModel {
  generatedAt: string;
  departments: OrganizationDivisionDepartment[];
}
export interface OrganizationDivisionDepartment {
  id: string; name: string; shortName: string;
  people: OrganizationDivisionPerson[];
}
export interface OrganizationDivisionPerson {
  id: string; name: string; team: string;
  units: { id: string; title: string; tasks: { id: string; title: string; delegates: { id: string; name: string; team: string; startsAt: string; endsAt: string }[] }[] }[];
}
export interface OrganizationDivisionFilters { departmentId?: string; team?: string; name?: string }
export interface OrganizationDivisionRow { departmentId: string; department: string; personId: string; person: string; team: string; unitId: string; unit: string; taskId: string; task: string; delegate: string }

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'ko');

export function buildOrganizationDivision(state: WorkspaceData, now = new Date()): OrganizationDivisionReadModel {
  const units = state.units.filter(unit => !unit.deletedAt);
  const tasks = state.tasks.filter(task => {
    if (task.deletedAt || task.status === 'archived' || !units.some(unit => unit.id === task.unitId && unit.departmentId === task.departmentId)) return false;
    if (!task.commonId) return true;
    const common = state.commonTasks.find(item => item.id === task.commonId);
    return !!common && commonPublished(common) && common.distributions.some(item => item.departmentId === task.departmentId && item.taskId === task.id && ['registered', 'assigned', 'submitted'].includes(item.status));
  });
  return {
    generatedAt: now.toISOString(),
    departments: [...state.departments].sort(byName).map(department => {
      const departmentUnits = units.filter(unit => unit.departmentId === department.id);
      const departmentTasks = tasks.filter(task => task.departmentId === department.id);
      const personIds = [...new Set([...departmentUnits.map(unit => unit.ownerId), ...departmentTasks.map(task => task.primaryId)])];
      const people = personIds.map(personId => {
        const source = state.users.find(user => user.id === personId);
        const ownTasks = departmentTasks.filter(task => task.primaryId === personId);
        const ownUnitIds = [...new Set([...departmentUnits.filter(unit => unit.ownerId === personId).map(unit => unit.id), ...ownTasks.map(task => task.unitId)])];
        return {
          id: personId, name: source?.name || '이전 담당자', team: source?.departmentId === department.id ? source.team : '소속 확인 필요',
          units: ownUnitIds.map(unitId => {
            const unit = departmentUnits.find(item => item.id === unitId)!;
            return {
              id: unit.id, title: unit.title,
              tasks: ownTasks.filter(task => task.unitId === unit.id).sort((a, b) => a.title.localeCompare(b.title, 'ko')).map(task => ({
                id: task.id, title: task.title,
                delegates: activeTaskDelegations(state, task, undefined, now).map(delegation => {
                  const delegate = state.users.find(user => user.id === delegation.toId)!;
                  return { id: delegate.id, name: delegate.name, team: delegate.team, startsAt: delegation.startsAt, endsAt: delegation.endsAt };
                }).filter((delegate, index, all) => all.findIndex(item => item.id === delegate.id) === index).sort(byName),
              })),
            };
          }).sort((a, b) => a.title.localeCompare(b.title, 'ko')),
        };
      }).sort((a, b) => a.team.localeCompare(b.team, 'ko') || byName(a, b));
      return { id: department.id, name: department.name, shortName: department.shortName, people };
    }),
  };
}

/** Authenticated colleagues share assignment titles only; task and attachment access stays separate. */
export function organizationDivisionForUser(state: WorkspaceData, _user: User, now = new Date()): OrganizationDivisionReadModel {
  return buildOrganizationDivision(state, now);
}

/** Shared by browser and downloads so filters cannot change export semantics. */
export function filterOrganizationDivision(model: OrganizationDivisionReadModel, filters: OrganizationDivisionFilters): OrganizationDivisionReadModel {
  const name = (filters.name || '').trim().toLocaleLowerCase();
  return {
    generatedAt: model.generatedAt,
    departments: model.departments.filter(department => !filters.departmentId || filters.departmentId === 'all' || department.id === filters.departmentId).map(department => ({
      ...department,
      people: department.people.filter(person => (!filters.team || filters.team === 'all' || person.team === filters.team) && (!name || person.name.toLocaleLowerCase().includes(name))),
    })).filter(department => department.people.length || !name && (!filters.team || filters.team === 'all')),
  };
}

export function organizationDivisionRows(model: OrganizationDivisionReadModel): OrganizationDivisionRow[] {
  return model.departments.flatMap(department => department.people.flatMap(person => person.units.flatMap(unit => (unit.tasks.length ? unit.tasks : [null]).map(task => ({
    departmentId: department.id, department: department.name, personId: person.id, person: person.name, team: person.team,
    unitId: unit.id, unit: unit.title, taskId: task?.id || '', task: task?.title || '등록된 세부업무 없음', delegate: task?.delegates.map(delegate => delegate.name).join(', ') || '—',
  })))));
}
