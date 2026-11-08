import assert from 'node:assert/strict';
import test from 'node:test';
import { failedRegistration, registrationAttempt, registrationPayload, registrationPreview, registrationSnapshot, registrationText } from '../src/lib/work-registration-draft';

const id = '99219cff-2506-4ddd-90b4-fb77ecf2a0ae';
function fixture() { let count = 0; return registrationPreview([{ title: '단위', description: '범위', tasks: [{ title: '세부', description: '주요 내용', dueDate: '2099-01-01', ownerId: 'foreign' } as { title: string; description: string }] }], () => `key-${++count}`); }

test('analysis previews leave dates blank and exclude inferred assignment and evidence fields', () => {
  const units = fixture();
  assert.equal(units[0].tasks[0].dueDate, '');
  assert.equal(units[0].tasks[0].frequency, 'once');
  assert.equal(units[0].tasks[0].priority, 'medium');
  assert.deepEqual(Object.keys(registrationPayload(units)[0].tasks[0]), ['title', 'description', 'dueDate', 'frequency', 'priority']);
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
  assert.match(text, /읽는 동안 수정한 원문/); assert.match(text, /마감: 미입력/); assert.match(text, /주요 내용/);
  assert.match(text, /주기: 한 번 · 중요도: 보통/);
});
