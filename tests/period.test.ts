import test from 'node:test';
import assert from 'node:assert/strict';
import { currentHalf, halfYearOptions, isFutureHalf } from '../src/lib/period';

test('half-year boundaries use the Korean calendar rather than UTC or the caller timezone', () => {
  const before = new Date('2026-06-30T14:59:59.999Z'), after = new Date('2026-06-30T15:00:00.000Z');
  assert.equal(currentHalf(before), '2026-H1'); assert.equal(isFutureHalf('2026-H2', before), true);
  assert.equal(currentHalf(after), '2026-H2'); assert.equal(isFutureHalf('2026-H2', after), false);
  assert.equal(currentHalf(new Date('2026-12-31T14:59:59.999Z')), '2026-H2');
  assert.equal(currentHalf(new Date('2026-12-31T15:00:00.000Z')), '2027-H1');
});

test('period comparison admits current and past halves and ignores malformed half identifiers', () => {
  const now = new Date('2026-11-07T03:00:00Z');
  for (const period of ['2000-H1', '2025-H2', '2026-H1', '2026-H2']) assert.equal(isFutureHalf(period, now), false);
  for (const period of ['2027-H1', '2027-H2', '2099-H2']) assert.equal(isFutureHalf(period, now), true);
  for (const period of ['', '2027-H3', '2027-H0', '2027-h1', '2027-01', '2027-H1 extra', ' 2027-H1', '2100-H1']) assert.equal(isFutureHalf(period, now), false);
});

test('both screens receive recent elapsed options plus valid historical and future records, without changing the input', () => {
  const now = new Date('2026-06-30T14:59:59Z');
  assert.deepEqual(halfYearOptions(now), ['2026-H1', '2025-H2', '2025-H1', '2024-H2', '2024-H1']);
  const existing = ['2021-H2', '2027-H2', '2026-H2', '2021-H2', '2026-H3', 'bad', undefined, null];
  const before = [...existing];
  assert.deepEqual(halfYearOptions(now, existing), ['2027-H2', '2026-H2', '2026-H1', '2025-H2', '2025-H1', '2024-H2', '2024-H1', '2021-H2']);
  assert.deepEqual(existing, before);
  assert.deepEqual(halfYearOptions(new Date('2026-06-30T15:00:00Z')), ['2026-H2', '2026-H1', '2025-H2', '2025-H1', '2024-H2', '2024-H1']);
});
