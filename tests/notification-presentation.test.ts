import assert from 'node:assert/strict';
import test from 'node:test';
import { notificationRelativeTime, notificationTimeTitle, sortNotifications } from '../src/lib/notification-presentation';

const now = new Date('2026-11-08T03:00:00Z');

test('unread notifications precede read ones with newest valid creation times first and stable legacy ordering', () => {
  const items = [
    { id: 'read-new', read: true, createdAt: '2026-11-08T03:00:00Z' },
    { id: 'legacy-first', read: false },
    { id: 'unread-old', read: false, createdAt: '2026-11-07T03:00:00Z' },
    { id: 'invalid', read: false, createdAt: 'invalid' },
    { id: 'unread-new', read: false, createdAt: '2026-11-08T12:00:00+09:00' },
    { id: 'equal-time', read: false, createdAt: '2026-11-08T03:00:00Z' },
    { id: 'legacy-last', read: false },
    { id: 'read-legacy', read: true },
  ];
  const before = structuredClone(items);
  assert.deepEqual(sortNotifications(items).map(item => item.id), ['unread-new', 'equal-time', 'unread-old', 'legacy-first', 'invalid', 'legacy-last', 'read-new', 'read-legacy']);
  assert.deepEqual(items, before);
  assert.notEqual(sortNotifications(items), items);
});

test('relative time has deterministic minute, hour and day boundaries', () => {
  for (const [age, label] of [
    [0, '방금 전'], [59_999, '방금 전'], [60_000, '1분 전'], [599_999, '9분 전'],
    [600_000, '10분 전'], [3_599_999, '59분 전'], [3_600_000, '1시간 전'],
    [86_399_999, '23시간 전'], [86_400_000, '1일 전'], [3 * 86_400_000, '3일 전'],
  ] as const) assert.equal(notificationRelativeTime(new Date(now.getTime() - age).toISOString(), now), label);
});

test('ISO offsets and offset-free Korean timestamps describe the same instant across year boundaries', () => {
  const reference = '2027-01-01T00:10:00+09:00';
  for (const instant of ['2026-12-31T23:50:00+09:00', '2026-12-31T14:50:00Z', '2026-12-31T23:50:00', '2026-12-31T235000']) {
    assert.equal(notificationRelativeTime(instant, reference), instant.endsWith('T235000') ? '이전 알림' : '20분 전');
  }
  assert.equal(notificationRelativeTime('2026-11-08T11:50:00', now), '10분 전');
  assert.match(notificationTimeTitle('2026-12-31T15:00:00Z')!, /^2027\. 1\. 1\./);
});

test('missing or invalid legacy timestamps never claim an age or invent a tooltip time', () => {
  for (const value of [undefined, null, '', '  ', 'invalid', '2026-11-08', '2026-02-30T00:00:00Z', '2026-11-08T24:00:00Z', '2026-11-08T03:60:00Z', '2026-11-08T03:00:00+25:00']) {
    assert.equal(notificationRelativeTime(value, now), '이전 알림');
    assert.equal(notificationTimeTitle(value), undefined);
  }
  assert.equal(notificationRelativeTime(now.toISOString(), new Date(NaN)), '이전 알림');
  assert.equal(notificationRelativeTime(now.toISOString(), 'invalid'), '이전 알림');
});

test('future timestamps do not produce negative ages while full time remains available for inspection', () => {
  for (const value of ['2026-11-08T03:00:01Z', '2027-01-01T00:00:00Z']) {
    assert.equal(notificationRelativeTime(value, now), '방금 전');
    assert.ok(notificationTimeTitle(value));
  }
});
