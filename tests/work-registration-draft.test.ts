import assert from 'node:assert/strict';
import test from 'node:test';
import { failedRegistration, registrationAttempt, registrationDefaults, registrationPayload, registrationPreview, registrationSnapshot, registrationText } from '../src/lib/work-registration-draft';
import { WORK_REGISTRATION_UNIT_LIMIT } from '../src/lib/work-registration-policy';

const id = '99219cff-2506-4ddd-90b4-fb77ecf2a0ae';
const serverTime = '2026-11-09T03:00:00Z';
function fixture() { let count = 0; return registrationPreview([{ title: '단위', description: '범위', tasks: [{ title: '세부', description: '주요 내용', dueDate: '2099-01-01', frequency: 'monthly', priority: 'high', ownerId: 'foreign' } as { title: string; description: string }] }], serverTime, () => `key-${++count}`); }

test('analysis previews apply registration year-end and yearly defaults while excluding inferred dates and assignments', () => {
  const units = fixture();
  assert.equal(units[0].tasks[0].dueDate, '2026-12-31');
  assert.equal(units[0].tasks[0].frequency, 'yearly');
  assert.equal(units[0].tasks[0].priority, 'medium');
  assert.deepEqual(Object.keys(registrationPayload(units)[0].tasks[0]), ['title', 'description', 'dueDate', 'frequency', 'priority']);
});

test('registration defaults use the server instant in the Korean calendar across the year boundary', () => {
  assert.equal(registrationDefaults('2026-12-31T14:59:59Z').dueDate, '2026-12-31');
  assert.equal(registrationDefaults('2026-12-31T15:00:00Z').dueDate, '2027-12-31');
  assert.equal(registrationDefaults(new Date('2027-01-01T00:00:00+09:00')).dueDate, '2027-12-31');
  assert.equal(registrationDefaults(serverTime).frequency, 'yearly');
});

test('reviewed dates and repetition remain exact in the payload even when new drafts use a different year', () => {
  const units = fixture(); const task = units[0].tasks[0];
  task.dueDate = '2027-02-16'; task.frequency = 'quarterly'; task.priority = 'high';
  const edited = structuredClone(units);
  registrationPreview([{ title: '새 단위', description: '새 범위', tasks: [{ title: '새 세부', description: '새 설명' }] }], '2027-01-01T00:00:00+09:00');
  assert.deepEqual(units, edited);
  assert.deepEqual(registrationPayload(units)[0].tasks[0], { title: '세부', description: '주요 내용', dueDate: '2027-02-16', frequency: 'quarterly', priority: 'high' });
  task.dueDate = ''; task.frequency = 'once';
  assert.equal(registrationPayload(units)[0].tasks[0].dueDate, '', 'a deliberately cleared date must be validated, not silently defaulted again');
  assert.equal(registrationPayload(units)[0].tasks[0].frequency, 'once');
});

test('an oversized analysis is rejected without silently dropping its sixth unit', () => {
  const units = Array.from({ length: WORK_REGISTRATION_UNIT_LIMIT + 1 }, (_, index) => ({ title: `단위 ${index + 1}`, description: '범위', tasks: [{ title: '세부', description: '설명' }] }));
  assert.throws(() => registrationPreview(units, serverTime), /최대 5개/);
  const accepted = registrationPreview(units.slice(0, WORK_REGISTRATION_UNIT_LIMIT), serverTime);
  assert.equal(accepted.length, 5); assert.equal(accepted[4].title, '단위 5'); assert.equal(units.length, 6);
});

test('unknown outcomes retain the immutable original payload through later edits and rejections', () => {
  const input = { importId: id, units: registrationPayload(fixture()) };
  const first = registrationAttempt(null, input, 'original');
  input.units[0].title = 'later edit';
  assert.equal(first.input.units[0].title, '단위');
  const uncertain = failedRegistration(first, { outcome: 'unknown' });
  const laterRejected = failedRegistration(uncertain, { outcome: 'rejected' });
  assert.equal(laterRejected.everUnknown, true);
  assert.equal(registrationAttempt(laterRejected, input, 'new draft'), laterRejected);
  assert.equal(laterRejected.snapshot, 'original');
});

test('a proven first rejection permits reviewed edits while preserving the same import identity', () => {
  const first = registrationAttempt(null, { importId: id, units: registrationPayload(fixture()) }, 'first');
  const rejected = failedRegistration(first, { outcome: 'rejected' });
  const units = fixture(); units[0].title = '수정한 범위';
  const retry = registrationAttempt(rejected, { importId: 'must-not-replace-original', units: registrationPayload(units) }, 'edited');
  assert.equal(retry.input.importId, id); assert.equal(retry.input.units[0].title, '수정한 범위');
  assert.equal(retry.snapshot, 'edited'); assert.equal(retry.everUnknown, false);
  assert.equal(failedRegistration(first).everUnknown, true);
});

test('draft snapshots and recovery text retain source changes and reviewed task details', () => {
  const draft = { description: '설명', documents: [{ key: 'doc', name: '인수인계.txt', text: '원문' }], units: fixture() };
  const before = registrationSnapshot(draft); draft.documents[0].text = '읽는 동안 수정한 원문';
  assert.notEqual(registrationSnapshot(draft), before);
  const text = registrationText(draft);
  assert.match(text, /읽는 동안 수정한 원문/); assert.match(text, /마감: 2026-12-31/); assert.match(text, /주요 내용/);
  assert.match(text, /주기: 매년 · 중요도: 보통/);
});
