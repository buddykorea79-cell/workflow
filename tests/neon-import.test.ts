import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createSeed } from '../src/lib/seed';
import { canonicalJson, importAction, importCounts, NeonImportError, readLocalImportAttachment, sameImportedWorkspace, validateImportWorkspace, verifyAttachmentBytes, workspaceFingerprint } from '../src/lib/neon-import';
import type { Attachment } from '../src/lib/types';

const bytes = Buffer.from('prototype attachment content');
function sampleAttachment(): Attachment {
  return { id: 'attachment-test', taskId: 'task-test', name: 'test.txt', size: bytes.length, mime: 'text/plain', sha256: createHash('sha256').update(bytes).digest('hex'), storageKey: 'attachment-test.bin', status: 'quarantined', uploadedBy: 'user-test', createdAt: '2026-11-01T00:00:00.000Z' };
}
const state = () => createSeed(new Date('2026-11-01T00:00:00Z'));

test('Neon import preserves all known and future workspace fields without reseeding', () => {
  const original = { ...state(), futureField: { values: ['historical-value'], flag: true } };
  original.revision = 41;
  const validated = validateImportWorkspace(original);
  assert.equal(validated, original);
  assert.equal(validated.revision, 41);
  assert.deepEqual((validated as typeof original).futureField, original.futureField);
  assert.equal(importCounts(validated).users, original.users.length);
  assert.equal(importAction(validated, undefined, false), 'create');
});

test('Neon import compares JSONB object ordering by value and keeps array order meaningful', () => {
  assert.equal(canonicalJson({ z: [1, 2], a: { y: true, x: 3 } }), canonicalJson({ a: { x: 3, y: true }, z: [1, 2] }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  const original = state();
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(workspaceFingerprint(original), workspaceFingerprint(validateImportWorkspace(reordered)));
  assert.equal(importAction(original, structuredClone(original), false), 'unchanged');
});

test('Neon import refuses a different remote workspace unless replacement is explicit', () => {
  const original = state();
  const remote = structuredClone(original);
  remote.tasks[0].description = 'DB에서 추가로 수정한 내용';
  assert.throws(() => importAction(original, remote, false), (error: unknown) => error instanceof NeonImportError && error.code === 'REMOTE_DATA_EXISTS');
  assert.equal(importAction(original, remote, true), 'replace');
  assert.equal(remote.tasks[0].description, 'DB에서 추가로 수정한 내용');
});

test('Neon import treats relocated identical files as already imported but preserves content differences', () => {
  const original = state(); original.attachments = [sampleAttachment()];
  const remote = structuredClone(original);
  remote.attachments[0] = { ...remote.attachments[0], storageProvider: 'neon', storageBucket: 'ieum-attachments', storageKey: 'development/imports/one/attachment-test/hash.bin' };
  assert.equal(sameImportedWorkspace(original, remote), true);
  assert.equal(importAction(original, remote, false), 'unchanged');
  assert.equal(original.attachments[0].storageProvider, undefined);
  remote.attachments[0].status = 'test_allowed';
  assert.equal(sameImportedWorkspace(original, remote), false);
  assert.throws(() => importAction(original, remote, false), /다른 데이터/);
});

test('Neon import migrates legacy files even when workspace rows already match', () => {
  const original = state(); original.attachments = [sampleAttachment()];
  assert.equal(importAction(original, structuredClone(original), false), 'migrate-files');
});

test('Neon import rejects malformed envelopes and duplicate identities without changing source', () => {
  const missing = { ...state(), tasks: undefined };
  assert.throws(() => validateImportWorkspace(missing), /tasks/);
  const duplicate = state(); duplicate.users.push(structuredClone(duplicate.users[0]));
  assert.throws(() => validateImportWorkspace(duplicate), /중복 ID/);
  const badRevision = state(); badRevision.revision = -1;
  assert.throws(() => validateImportWorkspace(badRevision), /revision/);
});

test('Neon import refuses broken, missing and traversal attachment files before upload', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'ieum-neon-import-'));
  try {
    await mkdir(path.join(folder, 'files'));
    const attachment = sampleAttachment();
    await assert.rejects(() => readLocalImportAttachment(folder, attachment), /읽을 수 없습니다/);
    await writeFile(path.join(folder, 'files', attachment.storageKey), bytes);
    assert.deepEqual(await readLocalImportAttachment(folder, attachment), bytes);
    await writeFile(path.join(folder, 'files', attachment.storageKey), Buffer.from('corrupt'));
    await assert.rejects(() => readLocalImportAttachment(folder, attachment), /SHA-256/);
    await assert.rejects(() => readLocalImportAttachment(folder, { ...attachment, storageKey: '../workspace.json' }), /저장 경로/);
    assert.throws(() => verifyAttachmentBytes(attachment, Buffer.from('wrong bytes')), /SHA-256/);
  } finally {
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('ieum-neon-import-'));
    await rm(folder, { recursive: true, force: true });
  }
});
