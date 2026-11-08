import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAttachmentUploadAllowed } from '../src/lib/attachment-upload';
import { DomainError, getWorkspace } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import type { Performance } from '../src/lib/types';

const before = new Date('2026-06-30T14:59:59Z');
const after = new Date('2026-06-30T15:00:00Z');
function fixture() {
  const state = createSeed(before);
  const task = state.tasks.find(item => item.id === 'task-data')!;
  const performance: Performance = {
    id: 'future-half-record', taskId: task.id, runId: '', title: task.title,
    description: '기존 미래 반기 기록은 조회용으로 보존합니다.', evidence: '',
    authorId: task.primaryId, departmentId: task.departmentId, unitId: task.unitId,
    status: 'draft', period: '2026-H2', createdAt: before.toISOString(), attachmentIds: [],
  };
  state.performances = [performance]; state.unitScorePlans = []; state.unitEvaluations = [];
  return { state, task, performance };
}

test('future half evidence cannot be uploaded but the existing record remains readable', () => {
  const { state, task, performance } = fixture();
  const original = structuredClone(state);
  assert.throws(() => assertAttachmentUploadAllowed(state, task.primaryId, task.id, performance.id, before), error => error instanceof DomainError && error.code === 'PERIOD_NOT_STARTED');
  assert.deepEqual(state, original);
  assert.ok(getWorkspace(state, task.primaryId, before).performances.some(item => item.id === performance.id));
  assert.equal(assertAttachmentUploadAllowed(state, task.primaryId, task.id, performance.id, after).departmentId, task.departmentId);
});

test('future evidence checks preserve author permission and leave ordinary task files available', () => {
  const { state, task, performance } = fixture();
  assert.throws(() => assertAttachmentUploadAllowed(state, 'u-support-lead', task.id, performance.id, before), error => error instanceof DomainError && error.code === 'PERFORMANCE_ATTACHMENT_DENIED');
  assert.equal(assertAttachmentUploadAllowed(state, task.primaryId, task.id, undefined, before).task?.id, task.id);
});

test('current and past half evidence still enforces submission and evaluation locks', () => {
  const { state, task, performance } = fixture();
  performance.period = '2026-H1';
  assert.equal(assertAttachmentUploadAllowed(state, task.primaryId, task.id, performance.id, before).user.id, task.primaryId);
  performance.period = '2025-H2';
  assert.equal(assertAttachmentUploadAllowed(state, task.primaryId, task.id, performance.id, before).user.id, task.primaryId);
  performance.status = 'review';
  assert.throws(() => assertAttachmentUploadAllowed(state, task.primaryId, task.id, performance.id, before), error => error instanceof DomainError && error.code === 'PERFORMANCE_ATTACHMENT_LOCKED');
});
