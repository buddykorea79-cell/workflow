import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/lib/seed';
import { getWorkspace } from '../src/lib/domain';
import { deputyRequestCandidates, initialDeputyDraft, validDeputyDraft } from '../src/lib/delegation-draft';

const now = new Date('2026-11-10T16:00:00Z');
const ownerId = 'u-support-member';
const deputyId = 'u-support-lead';

function fixture(actorId = ownerId) {
  const state = createSeed(now);
  state.users.find(person => person.id === ownerId)!.defaultDeputyId = deputyId;
  return getWorkspace(state, actorId, now);
}

test('a new delegation draft preselects the eligible owner default without submitting or filling the reason', () => {
  const workspace = fixture();
  const before = structuredClone(workspace);
  const draft = initialDeputyDraft(workspace);
  assert.equal(draft.toId, deputyId);
  assert.equal(draft.startsOn, '2026-11-11');
  assert.equal(draft.endsOn, '2026-11-18');
  assert.equal(draft.reason, '');
  assert.equal(validDeputyDraft(draft), false);
  assert.deepEqual(workspace, before);
});

test('changing the requested owner uses that owner default and never the administrator default', () => {
  const workspace = fixture('u-admin');
  const otherOwner = workspace.users.find(person => person.id === 'u-doyun')!;
  otherOwner.defaultDeputyId = ownerId;
  workspace.users.find(person => person.id === 'u-admin')!.defaultDeputyId = 'u-plan-lead';
  assert.equal(initialDeputyDraft(workspace, ownerId).toId, deputyId);
  assert.equal(initialDeputyDraft(workspace, otherOwner.id).toId, ownerId);
  delete otherOwner.defaultDeputyId;
  assert.equal(initialDeputyDraft(workspace, otherOwner.id).toId, '');
  assert.equal(initialDeputyDraft(workspace, 'unknown-owner').toId, '');
});

test('reviewers of any selected task are excluded from default selection and recipient candidates', () => {
  const workspace = fixture();
  const excluded = ['u-doyun', deputyId];
  assert.equal(initialDeputyDraft(workspace, ownerId, excluded).toId, '');
  assert.equal(deputyRequestCandidates(workspace, ownerId, excluded).some(person => excluded.includes(person.id)), false);
  assert.equal(initialDeputyDraft(workspace, ownerId, ['u-support-head']).toId, deputyId);
});

test('default-contact eligibility does not narrow the existing approved delegation recipient choices', () => {
  const workspace = fixture('u-admin');
  const head = workspace.users.find(person => person.id === 'u-support-head')!;
  head.defaultDeputyId = ownerId;
  assert.equal(initialDeputyDraft(workspace, head.id).toId, '');
  assert.equal(deputyRequestCandidates(workspace, head.id).some(person => person.id === ownerId), true);
});

test('saved defaults that are inactive, expired, foreign, self, head or missing are not preselected', () => {
  for (const invalidity of ['inactive', 'expired', 'foreign', 'self', 'head', 'missing'] as const) {
    const workspace = fixture();
    const owner = workspace.users.find(person => person.id === ownerId)!;
    const deputy = workspace.users.find(person => person.id === deputyId)!;
    if (invalidity === 'inactive') deputy.active = false;
    if (invalidity === 'expired') deputy.endsAt = now.toISOString();
    if (invalidity === 'foreign') deputy.departmentId = 'dept-plan';
    if (invalidity === 'self') owner.defaultDeputyId = ownerId;
    if (invalidity === 'head') deputy.role = 'head';
    if (invalidity === 'missing') owner.defaultDeputyId = 'unknown-deputy';
    assert.equal(initialDeputyDraft(workspace, ownerId).toId, '', invalidity);
    assert.equal(deputyRequestCandidates(workspace, ownerId).some(person => person.id === owner.defaultDeputyId), false, invalidity);
  }
});
