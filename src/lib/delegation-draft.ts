import type { Delegation, Task, Workspace } from './types';
import { activeTaskDelegations, delegationStatus } from './delegations';
import { getDefaultDeputy } from './default-deputy';

export type DeputyDraft = { toId: string; startsOn: string; endsOn: string; reason: string };
const dateFor = (value: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
export function deputyRequestCandidates(workspace: Workspace, fromId: string, excludedIds: readonly string[] = []) {
  const owner = workspace.users.find(person => person.id === fromId);
  const now = new Date(workspace.serverTime);
  return owner ? workspace.users.filter(person => person.active && (!person.endsAt || new Date(person.endsAt) > now)
    && person.departmentId === owner.departmentId && person.id !== owner.id && person.role !== 'head' && !excludedIds.includes(person.id)) : [];
}
export function initialDeputyDraft(workspace: Workspace, fromId = workspace.currentUser.id, excludedIds: readonly string[] = []): DeputyDraft {
  const now = new Date(workspace.serverTime);
  const owner = workspace.users.find(person => person.id === fromId);
  const deputy = owner && getDefaultDeputy(workspace, owner, now);
  return { toId: deputy && !excludedIds.includes(deputy.id) ? deputy.id : '', startsOn: dateFor(now), endsOn: dateFor(new Date(now.getTime() + 7 * 86400000)), reason: '' };
}
export function deputyPayload(draft: DeputyDraft) { return { toId: draft.toId, startsAt: new Date(draft.startsOn + 'T00:00:00+09:00').toISOString(), endsAt: new Date(new Date(draft.endsOn + 'T00:00:00+09:00').getTime() + 86400000).toISOString(), reason: draft.reason.trim() }; }
export function validDeputyDraft(draft: DeputyDraft) { return !!draft.toId && !!draft.startsOn && !!draft.endsOn && draft.endsOn >= draft.startsOn && !!draft.reason.trim(); }
export function delegationLabel(delegation: Delegation, now: Date, workspace?: Workspace, task?: Task) {
  const status = delegationStatus(delegation);
  if (status === 'revoked') return '대행 종료';
  if (status === 'pending') return '부서장 승인 대기';
  if (status === 'rejected') return '반려';
  if (status === 'cancelled') return '요청 취소';
  if (new Date(delegation.endsAt) <= now) return '기간 종료';
  if (new Date(delegation.startsAt) > now) return '승인 · 시작 예정';
  if (workspace && task && !activeTaskDelegations(workspace, task, undefined, now).some(item => item.id === delegation.id)) return '대행 자격 확인 필요';
  return '대행 중';
}

export const delegationPersonName = (workspace: Workspace, id?: string) => workspace.users.find(person => person.id === id)?.name || workspace.identities?.find(person => person.id === id)?.name || '구성원 확인 필요';
