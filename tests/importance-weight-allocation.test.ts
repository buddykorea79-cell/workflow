import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateWeightsByImportance, initialWeightValues, scoreUnitsForPeriod } from '../src/lib/unit-evaluation';
import { createSeed } from '../src/lib/seed';

test('importance proportions use integer remainders and sum to exactly 50', () => {
  assert.deepEqual(allocateWeightsByImportance([{ id: 'a', importance: 10 }, { id: 'b', importance: 5 }, { id: 'c', importance: 1 }]), [{ unitId: 'a', maxScore: 31 }, { unitId: 'b', maxScore: 16 }, { unitId: 'c', maxScore: 3 }]);
  assert.deepEqual(allocateWeightsByImportance([{ id: 'a', importance: 1 }, { id: 'b', importance: 1 }, { id: 'c', importance: 1 }]), [{ unitId: 'a', maxScore: 17 }, { unitId: 'b', maxScore: 17 }, { unitId: 'c', maxScore: 16 }]);
  assert.deepEqual(allocateWeightsByImportance([{ id: 'only' }]), [{ unitId: 'only', maxScore: 50 }]);
  assert.deepEqual(allocateWeightsByImportance([]), []);
});

test('tied remainders retain existing unit order and invalid legacy importance means five', () => {
  const units = [{ id: 'third', importance: 0 }, { id: 'first', importance: NaN }, { id: 'second', importance: 2.5 }];
  const before = structuredClone(units);
  assert.deepEqual(allocateWeightsByImportance(units), [{ unitId: 'third', maxScore: 17 }, { unitId: 'first', maxScore: 17 }, { unitId: 'second', maxScore: 16 }]);
  assert.deepEqual(units, before);
});

test('all one-to-ten weights retain exact totals with at least one point and stop above fifty units', () => {
  for (let count = 1; count <= 70; count++) {
    const units = Array.from({ length: count }, (_, index) => ({ id: String(index), importance: index % 10 + 1 }));
    const result = allocateWeightsByImportance(units);
    if (count > 50) { assert.deepEqual(result, []); continue; }
    assert.equal(result.reduce((sum, item) => sum + item.maxScore, 0), 50);
    assert.deepEqual(result.map(item => item.unitId), units.map(unit => unit.id));
    assert.ok(result.every(item => Number.isInteger(item.maxScore) && item.maxScore >= 1 && item.maxScore <= 50));
  }
});

test('minimum constraints preserve the high importance share instead of adding a baseline to every unit', () => {
  const units = [...Array.from({ length: 44 }, (_, index) => ({ id: `low-${index}`, importance: 1 })), { id: 'high', importance: 10 }];
  const allocation = allocateWeightsByImportance(units);
  assert.ok(allocation.slice(0, 44).every(item => item.maxScore === 1)); assert.equal(allocation[44].maxScore, 6);
  const repeated = [...units.slice(0, 40), ...Array.from({ length: 8 }, (_, index) => ({ id: `mid-${index}`, importance: 2 })), { id: 'high', importance: 10 }];
  const next = allocateWeightsByImportance(repeated);
  assert.ok(next.slice(0, 48).every(item => item.maxScore === 1)); assert.equal(next[48].maxScore, 2);
  assert.ok(allocateWeightsByImportance([...repeated, { id: 'fiftieth', importance: 10 }]).every(item => item.maxScore === 1));
});

test('new plans receive suggestions while saved manual and fractional allocations remain unchanged', () => {
  const units = [{ id: 'a', importance: 10 }, { id: 'b', importance: 1 }];
  assert.deepEqual(initialWeightValues(units), { a: '45', b: '5' });
  const plan = { allocations: [{ unitId: 'a', unitTitle: 'A', maxScore: 12.5 }, { unitId: 'b', unitTitle: 'B', maxScore: 37.5 }] };
  const before = structuredClone(plan);
  assert.deepEqual(initialWeightValues(units, plan), { a: '12.5', b: '37.5' });
  assert.deepEqual(initialWeightValues([...units, { id: 'new', importance: 10 }], plan), { a: '12.5', b: '37.5', new: '' });
  units[0].importance = 1; units[1].importance = 10;
  assert.deepEqual(initialWeightValues(units, plan), { a: '12.5', b: '37.5' });
  assert.deepEqual(plan, before);
  assert.deepEqual(initialWeightValues(units, { allocations: [{ unitId: 'a', unitTitle: 'A', maxScore: 0 }, { unitId: 'b', unitTitle: 'B', maxScore: 50 }] }), { a: '0', b: '50' });
  assert.ok(Object.values(initialWeightValues(Array.from({ length: 51 }, (_, index) => ({ id: String(index) })))).every(value => value === ''));
});

test('period units show current importance but historical unknown units default to five without rewriting plans', () => {
  const state = createSeed(new Date('2026-11-08T03:00:00Z'));
  const owned = state.units.find(unit => unit.ownerId === 'u-jiho')!; owned.importance = 9;
  state.unitScorePlans = [{ id: 'historical-plan', personId: 'u-jiho', departmentId: 'dept-plan', period: '2026-H2', version: 1, allocations: [{ unitId: owned.id, unitTitle: owned.title, maxScore: 12.5 }, { unitId: 'old-missing-unit', unitTitle: '이전 단위', maxScore: 37.5 }], updatedAt: '2026-11-08T03:00:00Z' }];
  const before = structuredClone(state);
  const units = scoreUnitsForPeriod(state, 'u-jiho', '2026-H2');
  assert.equal(units.find(unit => unit.id === owned.id)?.importance, 9);
  assert.equal(units.find(unit => unit.id === 'old-missing-unit')?.importance, 5);
  assert.deepEqual(state, before);
});
