import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSeed } from '../src/lib/seed';
import { DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import type { Attachment, WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-06T03:00:00Z'), owner = 'u-seoyeon';
const input = { title: '파일로 설명한 업무', description: '상세 설명은 첨부한 자료를 확인합니다.', unitId: 'unit-record', primaryId: owner, frequency: 'monthly', dueDate: '2026-11-30' };
function dispatch(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) {
  executeCommand(state, actor, { type, payload, requestId: randomUUID(), expectedRevision: state.revision }, now);
}
function attachment(state: WorkspaceData, userId = owner, taskId = `draft:${userId}:${randomUUID()}`): Attachment {
  const item: Attachment = { id: randomUUID(), taskId, uploadedBy: userId, createdAt: now.toISOString(), name: '업무 설명.pdf', size: 100, mime: 'application/pdf', sha256: 'a'.repeat(64), storageKey: `test-${randomUUID()}.bin`, status: 'quarantined' };
  state.attachments.push(item); return item;
}
function denied(state: WorkspaceData, type: string, payload: Record<string, unknown>, code: string) {
  const before = structuredClone(state);
  assert.throws(() => dispatch(state, owner, type, payload), error => error instanceof DomainError && error.code === code);
  assert.deepEqual(state, before);
}

test('description attachments: only the uploader sees draft files and task creation atomically claims them', () => {
  const state = createSeed(now), own = attachment(state), foreign = attachment(state, 'u-jiho');
  const workspace = getWorkspace(state, owner, now);
  assert.ok(workspace.attachments.some(file => file.id === own.id && file.storageKey === ''));
  assert.equal(workspace.attachments.some(file => file.id === foreign.id), false);
  assert.equal(getWorkspace(state, 'u-jiho', now).attachments.some(file => file.id === own.id), false);
  dispatch(state, owner, 'task.create', { ...input, descriptionAttachmentIds: [own.id] });
  const task = state.tasks[0]; assert.deepEqual(task.descriptionAttachmentIds, [own.id]); assert.equal(own.taskId, task.id);
  assert.equal(foreign.taskId.startsWith('draft:'), true);
  assert.ok(getWorkspace(state, owner, now).attachments.some(file => file.id === own.id));
});

test('description attachments: duplicate, missing, another user draft and another task files are rejected without claiming any files', () => {
  const state = createSeed(now), own = attachment(state), foreign = attachment(state, 'u-jiho'), existing = attachment(state, owner, 'task-archive');
  for (const fileId of ['missing-file', foreign.id, existing.id]) denied(state, 'task.create', { ...input, descriptionAttachmentIds: [own.id, fileId] }, 'DESCRIPTION_ATTACHMENT_INVALID');
  denied(state, 'task.create', { ...input, descriptionAttachmentIds: [own.id, own.id] }, 'DESCRIPTION_ATTACHMENT_DUPLICATE');
  denied(state, 'task.create', { ...input, descriptionAttachmentIds: Array.from({ length: 11 }, () => own.id) }, 'VALIDATION_ERROR');
  assert.equal(own.taskId.startsWith('draft:'), true);
});

test('description attachments: failed embedded delegation leaves the task and selected draft files unchanged', () => {
  const state = createSeed(now), own = attachment(state);
  denied(state, 'task.create', { ...input, descriptionAttachmentIds: [own.id], deputy: { toId: owner, startsAt: now.toISOString(), endsAt: '2026-11-20T00:00:00Z', reason: '유효하지 않은 자기 대행' } }, 'DELEGATION_RECIPIENT');
  assert.equal(own.taskId.startsWith('draft:'), true);
});

test('description attachments: configure and update retain omitted links, claim only validated drafts and preserve version snapshots', () => {
  const state = createSeed(now), first = attachment(state);
  dispatch(state, owner, 'task.create', { ...input, descriptionAttachmentIds: [first.id] });
  const task = state.tasks[0], second = attachment(state);
  dispatch(state, owner, 'task.update', { taskId: task.id, description: '설명 본문만 변경' });
  assert.deepEqual(task.descriptionAttachmentIds, [first.id]);
  dispatch(state, owner, 'task.configure', { taskId: task.id, descriptionAttachmentIds: [first.id, second.id] });
  assert.equal(second.taskId, task.id);
  assert.deepEqual(task.versions[0].descriptionAttachmentIds, [first.id]);
  assert.deepEqual(task.versions.at(-1)!.descriptionAttachmentIds, [first.id, second.id]);
  const third = attachment(state), foreign = attachment(state, 'u-jiho');
  denied(state, 'task.configure', { taskId: task.id, descriptionAttachmentIds: [third.id, foreign.id] }, 'DESCRIPTION_ATTACHMENT_INVALID');
  assert.equal(third.taskId.startsWith('draft:'), true);
  dispatch(state, owner, 'task.update', { taskId: task.id, descriptionAttachmentIds: [third.id] });
  assert.deepEqual(task.descriptionAttachmentIds, [third.id]); assert.equal(third.taskId, task.id);
  // Removing the explanation link does not destroy the original attachment.
  assert.ok(state.attachments.some(file => file.id === first.id && file.taskId === task.id));
});

test('description attachments: an 8,000-character AI description survives create, update and configure', () => {
  const state = createSeed(now), description = '설'.repeat(8000);
  dispatch(state, owner, 'task.create', { ...input, description });
  const task = state.tasks[0]; assert.equal(task.description, description);
  dispatch(state, owner, 'task.update', { taskId: task.id, description: '명'.repeat(8000) });
  assert.equal(task.description, '명'.repeat(8000));
  dispatch(state, owner, 'task.configure', { taskId: task.id, description });
  assert.equal(task.description, description);
  denied(state, 'task.configure', { taskId: task.id, description: '길'.repeat(20_001) }, 'VALIDATION_ERROR');
});
