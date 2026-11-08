import test from 'node:test';
import assert from 'node:assert/strict';
import { createRevisionChain } from '../src/lib/command-revisions';

const expected = { kind: 'task' as const, id: 'task-a', rev: 0 };

test('queued drafts advance only through acknowledged changes to their own target', () => {
  const chain = createRevisionChain();
  chain.record([{ ...expected, fromRev: 0, toRev: 1 }, { ...expected, fromRev: 1, toRev: 2 }]);
  assert.equal(chain.advance(expected, 2).rev, 2);
  assert.equal(chain.advance({ ...expected, id: 'task-b' }, 2).rev, 0);
});

test('external changes and gaps are never silently absorbed by the queue', () => {
  const chain = createRevisionChain();
  chain.record([{ ...expected, fromRev: 0, toRev: 1 }]);
  assert.equal(chain.advance(expected, 2).rev, 0);
  chain.record([{ ...expected, fromRev: 2, toRev: 3 }]);
  assert.equal(chain.advance(expected, 3).rev, 0);
});

test('switching sessions discards previous local revision receipts', () => {
  const chain = createRevisionChain();
  chain.record([{ ...expected, fromRev: 0, toRev: 1 }]);
  chain.clear();
  assert.equal(chain.advance(expected, 1).rev, 0);
});

test('separately fetched catalog targets advance by own receipts without absorbing gaps', () => {
  const chain = createRevisionChain();
  const item = { kind: 'budgetItem' as const, id: 'item', rev: 0 };
  chain.record([{ ...item, fromRev: 0, toRev: 1 }, { ...item, fromRev: 2, toRev: 3 }]);
  assert.equal(chain.advance(item).rev, 1);
});
