import type { User, WorkspaceData } from './types';

type DefaultDeputyState = Pick<WorkspaceData, 'users'>;
const active = (person: User, now: Date) => person.active && (!person.endsAt || Date.parse(person.endsAt) > now.getTime());

/** An organizational contact only. This does not grant execution or approval rights. */
export function defaultDeputyCandidates(state: DefaultDeputyState, person: User, now = new Date()): User[] {
  if (!active(person, now)) return [];
  return state.users.filter(candidate => active(candidate, now) && candidate.id !== person.id
    && candidate.departmentId === person.departmentId && candidate.role !== 'head'
    && (person.role !== 'head' || candidate.role === 'lead'))
    .sort((a, b) => Number(b.team === person.team) - Number(a.team === person.team));
}

/** Revalidate the saved reference after personnel changes without rewriting it. */
export function getDefaultDeputy(state: DefaultDeputyState, person: User, now = new Date()): User | undefined {
  return person.defaultDeputyId ? defaultDeputyCandidates(state, person, now).find(candidate => candidate.id === person.defaultDeputyId) : undefined;
}
