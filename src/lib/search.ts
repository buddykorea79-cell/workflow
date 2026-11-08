import { formatHash, parseHash, type HashRoute } from './hash-route';
import type { CommonTask, Unit, User, Workspace, WorkspaceTask } from './types';

type SearchWorkspace = Pick<Workspace, 'currentUser' | 'tasks' | 'units' | 'commonTasks' | 'users' | 'departments'>;
type PersonalUnitWorkspace = Pick<Workspace, 'currentUser' | 'tasks' | 'units' | 'commonTasks'>;
export interface SearchGroups { tasks: WorkspaceTask[]; units: Unit[]; commons: CommonTask[]; people: User[] }
export type SearchResult = { kind: 'task' | 'unit' | 'common' | 'person'; id: string; title: string; description: string };

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
const canonical = (route: HashRoute) => parseHash(formatHash(route));
const delegatedUnitId = '__personal_delegated_work__';
const taskVisible = (workspace: Pick<Workspace, 'units'>, task: WorkspaceTask) => !task.deletedAt && !workspace.units.some(unit => unit.id === task.unitId && unit.deletedAt);

/** Match PersonalWork's existing list, including its legacy missing-distribution fallback. */
export function canSelectPersonalUnit(workspace: PersonalUnitWorkspace, unit: Pick<Unit, 'id'>): boolean {
  const actual = workspace.units.find(item => item.id === unit.id);
  if (!actual || actual.deletedAt || actual.id === delegatedUnitId) return false;
  if (actual.ownerId === workspace.currentUser.id) return true;
  return workspace.tasks.some(task => {
    if (task.unitId !== actual.id || task.primaryId !== workspace.currentUser.id || task.deletedAt || task.status === 'archived') return false;
    const distribution = workspace.commonTasks.find(common => common.id === task.commonId)?.distributions.find(item => item.taskId === task.id);
    return !distribution || ['registered', 'submitted', 'assigned'].includes(distribution.status);
  });
}

function matching<T>(items: readonly T[], query: string, title: (item: T) => string, description: (item: T) => string, code?: (item: T) => string): T[] {
  return items.map((item, index) => {
    const name = normalize(title(item));
    const rank = name.startsWith(query) ? 0 : name.includes(query) ? 1 : code && normalize(code(item)).includes(query) ? 2 : normalize(description(item)).includes(query) ? 3 : -1;
    return { item, index, rank };
  }).filter(item => item.rank >= 0).sort((left, right) => left.rank - right.rank || left.index - right.index).slice(0, 5).map(item => item.item);
}

function personDescription(workspace: Pick<Workspace, 'departments'>, person: User): string {
  return [workspace.departments.find(department => department.id === person.departmentId)?.name, person.team, person.title].filter(Boolean).join(' · ');
}

function recentTimestamp(task: WorkspaceTask): number {
  for (const value of [task.updatedAt, task.createdAt]) {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

/** Search only the already authorized workspace, never the broader identity/reference directory. */
export function searchWorkspace(workspace: SearchWorkspace, query: string): SearchGroups {
  const normalized = normalize(query);
  const tasks = workspace.tasks.filter(task => taskVisible(workspace, task));
  if (!normalized) return { tasks: tasks.map((task, index) => ({ task, index })).sort((left, right) => recentTimestamp(right.task) - recentTimestamp(left.task) || left.index - right.index).slice(0, 5).map(item => item.task), units: [], commons: [], people: [] };
  return {
    tasks: matching(tasks, normalized, task => task.title, task => task.description, task => task.code),
    units: matching(workspace.units.filter(unit => !unit.deletedAt && unit.id !== delegatedUnitId), normalized, unit => unit.title, unit => unit.description),
    commons: matching(workspace.commonTasks, normalized, common => common.title, common => common.description),
    people: matching(workspace.users, normalized, person => person.name, person => personDescription(workspace, person)),
  };
}

/** Keep group order stable for keyboard navigation and refresh labels from readable entities. */
export function flattenSearchResults(workspace: SearchWorkspace, groups: SearchGroups): SearchResult[] {
  const results: SearchResult[] = [];
  for (const candidate of groups.tasks) {
    const task = workspace.tasks.find(item => item.id === candidate.id);
    if (task && taskVisible(workspace, task)) results.push({ kind: 'task', id: task.id, title: task.title, description: [task.code, task.description].filter(Boolean).join(' · ') });
  }
  for (const candidate of groups.units) {
    const unit = workspace.units.find(item => item.id === candidate.id);
    if (unit && !unit.deletedAt && unit.id !== delegatedUnitId) results.push({ kind: 'unit', id: unit.id, title: unit.title, description: unit.description });
  }
  for (const candidate of groups.commons) {
    const common = workspace.commonTasks.find(item => item.id === candidate.id);
    if (common) results.push({ kind: 'common', id: common.id, title: common.title, description: common.description });
  }
  for (const candidate of groups.people) {
    const person = workspace.users.find(item => item.id === candidate.id);
    if (person) results.push({ kind: 'person', id: person.id, title: person.name, description: personDescription(workspace, person) });
  }
  return results;
}

/** Recheck the latest readable data when a result is selected; stale/forged targets open only a base view. */
export function searchResultRoute(workspace: SearchWorkspace, result: SearchResult): HashRoute {
  switch (result.kind) {
    case 'task': {
      const view = workspace.currentUser.role === 'head' ? 'department' : 'personal';
      const task = workspace.tasks.find(item => item.id === result.id);
      return task && taskVisible(workspace, task) ? canonical({ view, taskId: task.id, tab: 'overview' }) : { view };
    }
    case 'unit': {
      const unit = workspace.units.find(item => item.id === result.id && !item.deletedAt && item.id !== delegatedUnitId);
      if (!unit) return { view: 'division' };
      const view = workspace.currentUser.role !== 'head' && canSelectPersonalUnit(workspace, unit) ? 'personal' : 'division';
      return canonical({ view, focus: unit.id });
    }
    case 'common': return workspace.commonTasks.some(item => item.id === result.id) ? canonical({ view: 'common', focus: result.id }) : { view: 'common' };
    case 'person': return workspace.users.some(item => item.id === result.id) ? canonical({ view: 'organization', focus: result.id }) : { view: 'organization' };
    default: return { view: 'dashboard' };
  }
}
