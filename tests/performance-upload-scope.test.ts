import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NextRequest } from 'next/server';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { assertAttachmentUploadAllowed, recordNeonAttachment, signUploadManifest, verifyUploadManifest, type UploadManifest } from '../src/lib/attachment-upload';
import { canReadAttachment, canReadTask, DomainError, executeCommand, getWorkspace } from '../src/lib/domain';
import { descriptionAttachment } from '../src/lib/task-description-access';
import { authorizeProcedureExtraction } from '../src/lib/procedure-extraction-access';
import { createSeed } from '../src/lib/seed';
import { getUnitScorePlan, scoreUnitsForPeriod } from '../src/lib/unit-evaluation';
import { POST as directUpload } from '../src/app/api/attachments/upload/route';
import { POST as localUpload } from '../src/app/api/attachments/route';
import { GET as download } from '../src/app/api/attachments/[id]/route';
import { sessionCookie, signSession } from '../src/lib/auth';
import type { WorkspaceData } from '../src/lib/types';

const now = new Date('2026-11-07T03:00:00Z');
const owner = 'u-support-member', successor = 'u-seoyeon', head = 'u-support-head', taskId = 'task-data', period = '2026-H2';
const signingSecret = 'performance-evidence-test-signing-secret-at-least-32';
const errorCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;
function send(state: WorkspaceData, actor: string, type: string, payload: Record<string, unknown>) {
  executeCommand(state, actor, { type, payload, expectedRevision: state.revision, requestId: randomUUID() }, now);
}
function fixture() {
  const state = createSeed(now); state.performances = []; state.handovers = [];
  send(state, owner, 'performance.saveHalf', { taskId, period, description: '인계 전에 수행한 성과' });
  const record = state.performances[0];
  Object.assign(state.tasks.find(task => task.id === taskId)!, { primaryId: successor, supportIds: [], reviewerId: 'u-head', departmentId: 'dept-plan' });
  for (const run of state.runs.filter(run => run.taskId === taskId)) Object.assign(run, { primaryId: successor, supportIds: [], reviewerId: 'u-head', departmentId: 'dept-plan' });
  return { state, record };
}
function manifest(performanceId: string): UploadManifest {
  return { id: `attachment-${randomUUID()}`, taskId, performanceId, userId: owner, name: '성과 증빙.txt', size: 8, mime: 'text/plain', sha256: 'a'.repeat(64), bucket: 'ieum-attachments', uploadKey: 'pending/test.bin', storageKey: `attachments/${randomUUID()}.bin`, expiresAt: Date.now() + 60_000 };
}
function submit(state: WorkspaceData) {
  const record = state.performances[0];
  send(state, owner, 'performance.setWeights', { period, allocations: scoreUnitsForPeriod(state, owner, period).map(unit => ({ unitId: unit.id, maxScore: unit.id === record.unitId ? 50 : 0 })) });
  send(state, owner, 'performance.submitPerson', { period, planVersion: getUnitScorePlan(state, owner, period)!.version });
}

test('historical evidence upload belongs to an editable existing record, never to regained task access', () => {
  const { state, record } = fixture();
  const user = state.users.find(user => user.id === owner)!;
  assert.equal(canReadTask(state, user, state.tasks.find(task => task.id === taskId)!, now), false);
  assert.equal(assertAttachmentUploadAllowed(state, owner, taskId, record.id).departmentId, record.departmentId);
  assert.throws(() => assertAttachmentUploadAllowed(state, owner, taskId), errorCode('ATTACHMENT_DENIED'));
  assert.throws(() => assertAttachmentUploadAllowed(state, successor, taskId, record.id), errorCode('PERFORMANCE_ATTACHMENT_DENIED'));
  assert.throws(() => assertAttachmentUploadAllowed(state, owner, 'task-plan', record.id), errorCode('PERFORMANCE_ATTACHMENT_DENIED'));
  assert.throws(() => assertAttachmentUploadAllowed(state, owner, taskId, 'missing'), errorCode('PERFORMANCE_ATTACHMENT_DENIED'));
  const upload = manifest(record.id); recordNeonAttachment(state, upload);
  const attachment = state.attachments.find(file => file.id === upload.id)!;
  assert.equal(canReadAttachment(state, user, attachment, now), true);
  assert.equal(canReadAttachment(state, state.users.find(user => user.id === successor)!, attachment, now), false);
  assert.ok(getWorkspace(state, owner, now).attachments.some(file => file.id === attachment.id));
  assert.ok(!getWorkspace(state, successor, now).attachments.some(file => file.id === attachment.id));
  assert.throws(() => descriptionAttachment(state, successor, attachment.id), errorCode('DESCRIPTION_EDIT_DENIED'));
  assert.throws(() => authorizeProcedureExtraction(state, successor, taskId, attachment.id, now), errorCode('PROCEDURE_ACCESS_DENIED'));
  send(state, owner, 'performance.saveHalf', { taskId, period, description: '인계 후 본인 성과 보완', attachmentIds: [attachment.id] });
  assert.deepEqual(record.attachmentIds, [attachment.id]);
  assert.equal(canReadAttachment(state, state.users.find(user => user.id === head)!, attachment, now), true);
  assert.equal(canReadAttachment(state, state.users.find(user => user.id === successor)!, attachment, now), false);
});

test('record-scoped files cannot be attached to another performance, procedure, description or reference', () => {
  const { state, record } = fixture(), upload = manifest(record.id);
  recordNeonAttachment(state, upload);
  const task = state.tasks.find(task => task.id === taskId)!;
  const other = { ...structuredClone(record), id: 'previous-half-record', period: '2026-H1' };
  state.performances.push(other);
  for (const [actor, type, payload, code] of [
    [owner, 'performance.saveHalf', { taskId, period: other.period, description: '다른 성과', attachmentIds: [upload.id] }, 'PERFORMANCE_ATTACHMENT_INVALID'],
    [successor, 'performance.saveHalf', { taskId, period, description: '인수자 성과', attachmentIds: [upload.id] }, 'PERFORMANCE_ATTACHMENT_INVALID'],
    [successor, 'task.configure', { taskId, workflow: task.workflow.map(step => ({ ...step, attachmentIds: step.done ? step.attachmentIds : [upload.id] })) }, 'PROCEDURE_ATTACHMENT_INVALID'],
    [successor, 'task.configure', { taskId, descriptionAttachmentIds: [upload.id] }, 'DESCRIPTION_ATTACHMENT_INVALID'],
    [successor, 'task.configure', { taskId, references: [{ id: 'bad-reference', type: 'document', title: '성과 파일 재사용', content: '', attachmentId: upload.id }] }, 'REFERENCE_ATTACHMENT_INVALID'],
  ] as const) {
    const before = structuredClone(state);
    assert.throws(() => send(state, actor, type, payload), errorCode(code));
    assert.deepEqual(state, before);
  }
});

test('upload completion rechecks submission, confirmation and superseded-record locks', () => {
  for (const status of ['review', 'confirmed'] as const) {
    const { state, record } = fixture(), upload = manifest(record.id); record.status = status;
    assert.throws(() => recordNeonAttachment(state, upload), errorCode('PERFORMANCE_ATTACHMENT_LOCKED'));
    assert.ok(!state.attachments.some(file => file.id === upload.id));
  }
  const { state, record } = fixture(), upload = manifest(record.id);
  assertAttachmentUploadAllowed(state, owner, taskId, record.id);
  submit(state);
  assert.throws(() => recordNeonAttachment(state, upload), errorCode('PERFORMANCE_ATTACHMENT_LOCKED'));
  assert.ok(!state.attachments.some(file => file.id === upload.id));
  const fresh = fixture(); fresh.state.performances.unshift({ ...fresh.record, id: 'replacement', previousId: fresh.record.id });
  assert.throws(() => assertAttachmentUploadAllowed(fresh.state, owner, taskId, fresh.record.id), errorCode('PERFORMANCE_ATTACHMENT_DENIED'));
});

test('signed upload tokens bind the performance scope and reject scope changes during replay', () => {
  const previous = process.env.IEUM_SESSION_SECRET; process.env.IEUM_SESSION_SECRET = signingSecret;
  try {
    const { state, record } = fixture(), upload = manifest(record.id);
    assert.deepEqual(verifyUploadManifest(signUploadManifest(upload), owner), upload);
    recordNeonAttachment(state, upload);
    assert.throws(() => recordNeonAttachment(state, { ...upload, performanceId: undefined, userId: successor }), errorCode('UPLOAD_CONFLICT'));
    const token = signUploadManifest(upload), parts = token.split('.');
    parts[0] = Buffer.from(JSON.stringify({ ...upload, performanceId: 'different' })).toString('base64url');
    assert.throws(() => verifyUploadManifest(parts.join('.'), owner), errorCode('UPLOAD_TOKEN_INVALID'));
  } finally { if (previous === undefined) delete process.env.IEUM_SESSION_SECRET; else process.env.IEUM_SESSION_SECRET = previous; }
});

test('local multipart upload carries the record scope and denies the successor download route', async () => {
  const keys = ['IEUM_STORAGE_PROVIDER', 'IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'IEUM_SESSION_SECRET', 'IEUM_APP_ORIGIN', 'NEON_AUTH_BASE_URL', 'IEUM_PROTOTYPE_MODE'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-performance-upload-'));
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { IEUM_STORAGE_PROVIDER: 'local', IEUM_DATA_DIR: directory, IEUM_SESSION_SECRET: signingSecret });
    const { state, record } = fixture(); await writeFile(path.join(directory, 'workspace.json'), JSON.stringify(state));
    const form = new FormData(); form.append('taskId', taskId); form.append('performanceId', record.id); form.append('file', new File(['성과 참고 파일'], '성과.txt', { type: 'text/plain' }));
    const origin = 'http://127.0.0.1:3000';
    const response = await localUpload(new NextRequest(`${origin}/api/attachments`, { method: 'POST', headers: { origin, host: '127.0.0.1:3000', cookie: `${sessionCookie}=${signSession(owner)}` }, body: form }));
    assert.equal(response.status, 200, await response.clone().text());
    const workspace = await response.json(); const attachment = workspace.attachments.find((file: { performanceId?: string }) => file.performanceId === record.id);
    assert.ok(attachment);
    const forbidden = await download(new NextRequest(`${origin}/api/attachments/${attachment.id}`, { headers: { cookie: `${sessionCookie}=${signSession(successor)}` } }), { params: Promise.resolve({ id: attachment.id }) });
    assert.equal(forbidden.status, 403);
    const stored = JSON.parse(await readFile(path.join(directory, 'workspace.json'), 'utf8')) as WorkspaceData;
    assert.equal(stored.attachments.find(file => file.id === attachment.id)!.performanceId, record.id);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('ieum-performance-upload-'));
    await rm(directory, { recursive: true, force: true });
  }
});

test('Neon prepare and completion preserve scope and reject a submission made between the two', async t => {
  const keys = ['IEUM_STORAGE_PROVIDER', 'IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'IEUM_SESSION_SECRET', 'IEUM_APP_ORIGIN', 'NEON_AUTH_BASE_URL', 'IEUM_PROTOTYPE_MODE', 'AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-performance-neon-'));
  const objects = new Map<string, Buffer>();
  t.mock.method(S3Client.prototype, 'send', async (command: unknown) => {
    if (command instanceof HeadObjectCommand) { if (!objects.has(command.input.Key!)) throw Object.assign(new Error('missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } }); return {}; }
    if (command instanceof GetObjectCommand) return { ContentLength: objects.get(command.input.Key!)!.length, Body: { transformToByteArray: async () => objects.get(command.input.Key!)! } };
    if (command instanceof PutObjectCommand) { objects.set(command.input.Key!, Buffer.from(command.input.Body as Buffer)); return {}; }
    if (command instanceof DeleteObjectCommand) { objects.delete(command.input.Key!); return {}; }
    throw new Error('Unexpected storage command');
  });
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { IEUM_STORAGE_PROVIDER: 'neon', IEUM_DATA_DIR: directory, IEUM_SESSION_SECRET: signingSecret, AWS_ENDPOINT_URL_S3: 'https://br-test.storage.c-1.us-east-2.aws.neon.tech', AWS_REGION: 'us-east-2', AWS_ACCESS_KEY_ID: 'test-key', AWS_SECRET_ACCESS_KEY: 'test-secret' });
    const { state, record } = fixture(), stateFile = path.join(directory, 'workspace.json'); await writeFile(stateFile, JSON.stringify(state));
    const bytes = Buffer.from('scoped performance evidence');
    const request = (payload: unknown) => new NextRequest('http://127.0.0.1:3000/api/attachments/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000', cookie: `${sessionCookie}=${signSession(owner)}` }, body: JSON.stringify(payload) });
    const response = await directUpload(request({ action: 'prepare', file: { taskId, performanceId: record.id, name: 'evidence.txt', size: bytes.length, mime: 'text/plain', sha256: createHash('sha256').update(bytes).digest('hex') } }));
    assert.equal(response.status, 200, await response.clone().text());
    const prepared = await response.json(), signed = verifyUploadManifest(prepared.token, owner); assert.equal(signed.performanceId, record.id); objects.set(signed.uploadKey, bytes);
    submit(state); await writeFile(stateFile, JSON.stringify(state));
    const denied = await directUpload(request({ action: 'complete', token: prepared.token })); assert.equal(denied.status, 409); assert.equal((await denied.json()).code, 'PERFORMANCE_ATTACHMENT_LOCKED');
    assert.ok(!objects.has(signed.storageKey));
    send(state, owner, 'performance.withdrawSubmission', { period }); await writeFile(stateFile, JSON.stringify(state));
    const completed = await directUpload(request({ action: 'complete', token: prepared.token })); assert.equal(completed.status, 200, await completed.clone().text());
    const workspace = await completed.json(); assert.equal(workspace.attachments.find((file: { id: string }) => file.id === signed.id).performanceId, record.id);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('ieum-performance-neon-'));
    await rm(directory, { recursive: true, force: true });
  }
});
