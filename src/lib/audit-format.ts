import type { AuditEvent, UserIdentity } from './types';

type AuditPeople = { users: readonly Pick<UserIdentity, 'id' | 'name'>[]; identities?: readonly Pick<UserIdentity, 'id' | 'name'>[] };
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** Format this structured audit for display only; preserve its stored detail. */
export function auditDetailText(event: Pick<AuditEvent, 'action' | 'targetId' | 'detail'>, people: AuditPeople): string {
  if (event.action !== 'organization.setDefaultDeputy') return event.detail;
  const name = (id: string) => people.users.find(person => person.id === id)?.name
    || people.identities?.find(person => person.id === id)?.name || '구성원 확인 필요';
  const owner = name(event.targetId);
  let change: unknown;
  try { change = JSON.parse(event.detail); } catch { /* A damaged record must not expose raw JSON or identifiers. */ }
  if (!isRecord(change)) return `${owner} · 기본 대행자 변경 내역을 확인해 주세요.`;
  const deputyName = (snapshot: unknown) => {
    if (!isRecord(snapshot)) return '지정 정보 확인 필요';
    const id = snapshot.defaultDeputyId;
    return id === null ? '미지정' : typeof id === 'string' && id ? name(id) : '지정 정보 확인 필요';
  };
  const summary = `${owner} · 기본 대행자: ${deputyName(change.before)} → ${deputyName(change.after)}`;
  const reason = typeof change.reason === 'string' ? change.reason.trim() : '';
  return reason ? `${summary} · 사유: ${reason}` : summary;
}
