import assert from 'node:assert/strict';
import test from 'node:test';
import { auditDetailText } from '../src/lib/audit-format';

const people = { users: [{ id: 'owner-id', name: '송주무관' }, { id: 'deputy-id', name: '조주무관' }], identities: [{ id: 'former-deputy-id', name: '김팀장' }] };
const audit = (before: string | null, after: string | null) => ({
  action: 'organization.setDefaultDeputy', targetId: 'owner-id',
  detail: JSON.stringify({ reason: '  부재 시 연락 창구 정비  ', before: { defaultDeputyId: before }, after: { defaultDeputyId: after } }),
});

test('default deputy audit displays names, before and after assignments, and the reason without changing its source', () => {
  const event = audit(null, 'deputy-id');
  const source = structuredClone({ event, people });
  assert.equal(auditDetailText(event, people), '송주무관 · 기본 대행자: 미지정 → 조주무관 · 사유: 부재 시 연락 창구 정비');
  assert.equal(auditDetailText(audit('former-deputy-id', 'deputy-id'), people), '송주무관 · 기본 대행자: 김팀장 → 조주무관 · 사유: 부재 시 연락 창구 정비');
  assert.equal(auditDetailText(audit('deputy-id', null), people), '송주무관 · 기본 대행자: 조주무관 → 미지정 · 사유: 부재 시 연락 창구 정비');
  assert.deepEqual({ event, people }, source);
});

test('missing identities and malformed default deputy records use readable fallbacks without exposing IDs or JSON', () => {
  assert.equal(auditDetailText({ ...audit('unknown-deputy-id', null), targetId: 'unknown-owner-id' }, people), '구성원 확인 필요 · 기본 대행자: 구성원 확인 필요 → 미지정 · 사유: 부재 시 연락 창구 정비');
  for (const detail of ['{"before":{"defaultDeputyId":"private-id"}', 'null', '[]', '"private-id"']) {
    assert.equal(auditDetailText({ ...audit(null, null), detail }, people), '송주무관 · 기본 대행자 변경 내역을 확인해 주세요.');
  }
  assert.equal(auditDetailText({ ...audit(null, null), detail: '{"before":{},"after":{},"reason":42}' }, people), '송주무관 · 기본 대행자: 지정 정보 확인 필요 → 지정 정보 확인 필요');
});

test('unrelated audit actions retain their original display text exactly', () => {
  const event = { ...audit(null, 'deputy-id'), action: 'organization.userUpdate' };
  assert.equal(auditDetailText(event, people), event.detail);
  assert.equal(auditDetailText({ ...event, action: 'run.note', detail: '기존 수행 기록\n다음 작업 확인' }, people), '기존 수행 기록\n다음 작업 확인');
});
