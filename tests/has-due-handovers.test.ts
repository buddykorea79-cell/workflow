import test from 'node:test';
import assert from 'node:assert/strict';
import { hasDueHandovers } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import type { Handover } from '../src/lib/types';

const now = new Date('2026-11-07T03:00:00Z');
const template = createSeed(now).handovers[0];
const handover = (status: Handover['status'], effectiveAt: string): Handover => ({ ...structuredClone(template), status, effectiveAt });

test('hasDueHandovers detects only scheduled handovers at or before the injected time', () => {
  assert.equal(hasDueHandovers({ handovers: [] }, now), false);
  for (const status of ['approval', 'acceptance', 'completed', 'cancelled', 'changes_requested'] as const) {
    assert.equal(hasDueHandovers({ handovers: [handover(status, '2026-11-01T00:00:00Z')] }, now), false);
  }
  assert.equal(hasDueHandovers({ handovers: [handover('scheduled', '2026-11-07T03:00:00.001Z')] }, now), false);
  assert.equal(hasDueHandovers({ handovers: [handover('scheduled', now.toISOString())] }, now), true);
  assert.equal(hasDueHandovers({ handovers: [handover('scheduled', '2026-11-06T03:00:00Z')] }, now), true);
  assert.equal(hasDueHandovers({ handovers: [handover('scheduled', 'invalid-date')] }, now), false);
});

test('hasDueHandovers respects explicit timezone offsets and never mutates the source', () => {
  const state = { handovers: [handover('scheduled', '2026-11-07T12:00:00+09:00')] };
  const before = structuredClone(state);
  Object.freeze(state.handovers[0]); Object.freeze(state.handovers); Object.freeze(state);
  assert.equal(hasDueHandovers(state, new Date('2026-11-07T02:59:59.999Z')), false);
  assert.equal(hasDueHandovers(state, now), true);
  assert.deepEqual(state, before);
});
