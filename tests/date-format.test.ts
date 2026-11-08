import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDate, formatDateFull, formatDateTimeFull, isPastDate } from '../src/lib/date-format';

test('compact dates show the year only when it differs from the Korean current year', () => {
  const today = '2026-11-08';
  assert.equal(formatDate('2026-01-01', { today }), '1. 1.');
  assert.equal(formatDate('2025-01-01', { today }), '2025. 1. 1.');
  assert.equal(formatDate('2027-12-31', { today }), '2027. 12. 31.');
  assert.equal(formatDateFull('2026-01-01'), '2026. 1. 1.');
  assert.equal(formatDateFull('2024-02-29'), '2024. 2. 29.');
});

test('timestamps use the Korean day, including UTC midnight and year boundaries', () => {
  assert.equal(formatDateFull('2026-11-07T14:59:59.999Z'), '2026. 11. 7.');
  assert.equal(formatDateFull('2026-11-07T15:00:00.000Z'), '2026. 11. 8.');
  assert.equal(formatDate('2026-12-31T15:00:00Z', { today: '2027-01-01' }), '1. 1.');
  assert.equal(formatDate('2026-12-31', { today: new Date('2026-12-31T15:00:00Z') }), '2026. 12. 31.');
  assert.equal(formatDateFull('2026-11-08T23:30:00-05:00'), '2026. 11. 9.');
  assert.equal(formatDateFull('2026-11-08T00:30:00+14:00'), '2026. 11. 7.');
});

test('calendar-only dates and offset-free Korean datetimes are independent of the host timezone', () => {
  const prior = process.env.TZ;
  try {
    for (const timezone of ['UTC', 'America/Los_Angeles', 'Pacific/Auckland']) {
      process.env.TZ = timezone;
      assert.equal(formatDateFull('2026-11-08'), '2026. 11. 8.');
      assert.equal(formatDateFull('2026-11-08T00:00:00'), '2026. 11. 8.');
      assert.equal(formatDateFull('2026-11-08T23:59'), '2026. 11. 8.');
      assert.equal(formatDateTimeFull('2026-11-08T00:05'), '2026. 11. 8. 오전 12:05');
    }
  } finally {
    if (prior === undefined) delete process.env.TZ; else process.env.TZ = prior;
  }
});

test('empty and impossible dates are unspecified rather than silently normalized', () => {
  for (const invalid of [undefined, null, '', '  ', 'bad', '2026-2-01', '2026-02-29', '2026-02-30T12:00:00Z', '2026-13-01', '2026-04-31', '2026-11-08T25:00:00Z', '2026-11-08T12:60:00Z', '2026-11-08T12:00:60Z', '2026-11-08T12:00:00+25:00', '2026-11-08T12:00:00+09:60', new Date(NaN)]) {
    assert.equal(formatDate(invalid, { today: '2026-11-08' }), '미지정');
    assert.equal(formatDateFull(invalid), '미지정');
    assert.equal(formatDateTimeFull(invalid), '미지정');
    assert.equal(isPastDate(invalid, '2026-11-08'), false);
  }
});

test('past-date warnings turn on at Korean midnight and allow today or future dates', () => {
  const before = new Date('2026-11-07T14:59:59.999Z'), midnight = new Date('2026-11-07T15:00:00.000Z');
  assert.equal(isPastDate('2026-11-07', before), false);
  assert.equal(isPastDate('2026-11-07', midnight), true);
  assert.equal(isPastDate('2026-11-08', midnight), false);
  assert.equal(isPastDate('2026-11-09', midnight), false);
  assert.equal(isPastDate('2026-11-07T16:00:00Z', midnight), false);
  assert.equal(isPastDate('2025-01-01', 'invalid'), false);
  assert.equal(isPastDate('2026-12-31', new Date('2026-12-31T15:00:00Z')), true);
});

test('record timestamps retain the same Korean date and clock, and leave Date inputs unchanged', () => {
  const instant = new Date('2026-11-07T18:35:00Z'), before = instant.getTime();
  assert.equal(formatDateFull(instant), '2026. 11. 8.');
  assert.equal(formatDateTimeFull(instant), '2026. 11. 8. 오전 03:35');
  assert.equal(formatDateTimeFull('2026-11-08T06:35:00Z'), '2026. 11. 8. 오후 03:35');
  assert.equal(formatDateTimeFull('2026-11-08'), '2026. 11. 8.');
  assert.equal(instant.getTime(), before);
});
