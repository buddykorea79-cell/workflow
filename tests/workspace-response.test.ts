import test from 'node:test';
import assert from 'node:assert/strict';
import { canApplyWorkspaceResponse } from '../src/lib/workspace-response';

test('late reads and uploads cannot replace a newer saved revision', () => {
  const latest = { revision: 12, currentUser: { id: '담당자' } };
  assert.equal(canApplyWorkspaceResponse(latest, { ...latest, revision: 11 }, 1, 1), false);
  assert.equal(canApplyWorkspaceResponse(latest, { ...latest, revision: 13 }, 1, 1), true);
});

test('a response started before logout/login cannot restore the former account', () => {
  const former = { revision: 99, currentUser: { id: '이전 계정' } };
  const current = { revision: 20, currentUser: { id: '현재 계정' } };
  assert.equal(canApplyWorkspaceResponse(current, former, 1, 2), false);
  assert.equal(canApplyWorkspaceResponse(null, former, 1, 2), false);
  assert.equal(canApplyWorkspaceResponse(current, former, 2, 2), false);
  assert.equal(canApplyWorkspaceResponse(null, current, 2, 2), true);
});
