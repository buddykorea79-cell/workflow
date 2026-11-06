import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeed } from '../src/lib/seed';
import { taskProcedureParticipants } from '../src/lib/procedure-participants';

test('procedure subjects follow the displayed assignment, including historical identities', () => {
  const state = createSeed(); const current = state.users[0]; const old = state.users[1];
  const directory = { users: [current], identities: [{ id: old.id, name: '이전 담당자', departmentId: old.departmentId, team: old.team }] };
  const subjects = taskProcedureParticipants(directory, { primaryId: old.id, supportIds: [current.id, current.id], reviewerId: 'unavailable' });
  assert.equal(subjects.primary, '이전 담당자'); assert.equal(subjects.support, current.name);
  assert.equal(subjects.reviewer, '이름 확인 필요');
  assert.equal(taskProcedureParticipants(directory, { primaryId: current.id, supportIds: [], reviewerId: old.id }).support, '지원자 미지정');
});
