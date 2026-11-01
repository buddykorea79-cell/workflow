import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NextRequest } from 'next/server';
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createNeonStorageClient, getNeonStorageConfig, uploadNeonFile } from '../src/lib/attachment-storage';
import { signUploadManifest, verifyUploadManifest, type UploadManifest } from '../src/lib/attachment-upload';
import { POST } from '../src/app/api/attachments/upload/route';
import { GET } from '../src/app/api/attachments/[id]/route';
import { DomainError } from '../src/lib/domain';
import { sessionCookie, signSession } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';
import type { WorkspaceData } from '../src/lib/types';

const mockConfig: Record<string, string> = { IEUM_STORAGE_PROVIDER: 'neon', AWS_ENDPOINT_URL_S3: 'https://br-test.storage.c-1.us-east-2.aws.neon.tech', AWS_REGION: 'us-east-2', AWS_ACCESS_KEY_ID: 'test-access-id', AWS_SECRET_ACCESS_KEY: 'test-storage-secret' };
const errorCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;
const signingSecret = 'attachment-test-signing-secret-with-more-than-32-characters';

test('Neon configuration is explicit and incomplete settings cannot fall back to disk', async () => {
  assert.equal(getNeonStorageConfig({}), undefined);
  assert.equal(getNeonStorageConfig({ ...mockConfig, IEUM_STORAGE_PROVIDER: 'local' }), undefined);
  assert.throws(() => getNeonStorageConfig({ IEUM_STORAGE_PROVIDER: 'neon' }), errorCode('STORAGE_NOT_CONFIGURED'));
  assert.throws(() => getNeonStorageConfig({ ...mockConfig, IEUM_STORAGE_PROVIDER: 'noen' }), errorCode('STORAGE_CONFIG_INVALID'));
  assert.throws(() => getNeonStorageConfig({ ...mockConfig, AWS_ENDPOINT_URL_S3: 'https://user:password@example.com' }), errorCode('STORAGE_CONFIG_INVALID'));
  const config = getNeonStorageConfig(mockConfig)!;
  assert.equal(config.bucket, 'ieum-attachments');
  const client = createNeonStorageClient(config);
  try {
    assert.equal(client.config.forcePathStyle, true);
    assert.equal(await client.config.region(), 'us-east-2');
    assert.equal((await client.config.credentials()).accessKeyId, 'test-access-id');
    assert.equal(await client.config.requestChecksumCalculation(), 'WHEN_REQUIRED');
  } finally { client.destroy(); }
});

test('Upload confirmation is bound to an unmodified manifest, account and expiration', () => {
  const previous = process.env.IEUM_SESSION_SECRET;
  process.env.IEUM_SESSION_SECRET = signingSecret;
  try {
    const value: UploadManifest = { id: 'attachment-test', userId: 'u-test', taskId: 'task-test', name: 'source.txt', size: 1, mime: 'text/plain', sha256: 'a'.repeat(64), bucket: 'ieum-attachments', uploadKey: 'pending/test', storageKey: 'attachments/test', expiresAt: Date.now() + 60_000 };
    const token = signUploadManifest(value);
    assert.deepEqual(verifyUploadManifest(token, value.userId), value);
    const [body, signature] = token.split('.');
    const changed = Buffer.from(JSON.stringify({ ...value, taskId: 'other-task' })).toString('base64url');
    assert.throws(() => verifyUploadManifest(`${changed}.${signature}`, value.userId), errorCode('UPLOAD_TOKEN_INVALID'));
    assert.throws(() => verifyUploadManifest(`${body}.${'0'.repeat(64)}`, value.userId), errorCode('UPLOAD_TOKEN_INVALID'));
    assert.throws(() => verifyUploadManifest(token, 'other-user'), errorCode('UPLOAD_OWNER_MISMATCH'));
    assert.throws(() => verifyUploadManifest(token, value.userId, value.expiresAt), errorCode('UPLOAD_EXPIRED'));
  } finally { if (previous === undefined) delete process.env.IEUM_SESSION_SECRET; else process.env.IEUM_SESSION_SECRET = previous; }
});

test('Direct upload checks permission and content, finalizes once, and preserves legacy local files', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-storage-test-'));
  const keys = [...Object.keys(mockConfig), 'IEUM_STORAGE_BUCKET', 'IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_SESSION_SECRET', 'IEUM_WORKSPACE_ID', 'IEUM_PROTOTYPE_MODE'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const objects = new Map<string, Buffer>(); let storageCalls = 0;
  const missing = () => Object.assign(new Error('mock missing'), { name: 'NotFound', $metadata: { httpStatusCode: 404 } });
  t.mock.method(S3Client.prototype, 'send', async (command: unknown) => {
    storageCalls++;
    if (command instanceof HeadObjectCommand) { if (!objects.has(command.input.Key!)) throw missing(); return {}; }
    if (command instanceof GetObjectCommand) { const bytes = objects.get(command.input.Key!); if (!bytes) throw missing(); return { ContentLength: bytes.length, Body: { transformToByteArray: async () => bytes } }; }
    if (command instanceof PutObjectCommand) { objects.set(command.input.Key!, Buffer.from(command.input.Body as Buffer)); return {}; }
    if (command instanceof DeleteObjectCommand) { objects.delete(command.input.Key!); return {}; }
    throw new Error('Unexpected mock storage command');
  });
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, mockConfig, { IEUM_DATA_DIR: directory, IEUM_SESSION_SECRET: signingSecret, IEUM_WORKSPACE_ID: 'prototype-test' });
    const initial = createSeed(new Date('2026-11-01T04:00:00Z')); const task = initial.tasks.find(item => item.id === 'task-data')!;
    const stateFile = path.join(directory, 'workspace.json'); await writeFile(stateFile, JSON.stringify(initial, null, 2));
    const bytes = Buffer.from('prototype attachment text'); const hash = createHash('sha256').update(bytes).digest('hex');
    const descriptor = { taskId: task.id, name: 'source.txt', size: bytes.length, mime: 'text/plain', sha256: hash };
    const request = (payload: unknown, userId: string | null = task.primaryId, origin = 'http://127.0.0.1:3000') => new NextRequest('http://127.0.0.1:3000/api/attachments/upload', { method: 'POST', headers: { 'Content-Type': 'application/json', host: '127.0.0.1:3000', origin, ...(userId ? { cookie: `${sessionCookie}=${signSession(userId)}` } : {}) }, body: JSON.stringify(payload) });
    const prepare = { action: 'prepare', file: descriptor };
    assert.equal((await POST(request(prepare, null))).status, 401);
    assert.equal((await POST(request(prepare, 'u-jiho'))).status, 403);
    assert.equal((await POST(request(prepare, task.primaryId, 'https://other.example'))).status, 403);
    assert.equal(storageCalls, 0);
    let response = await POST(request(prepare)); assert.equal(response.status, 200);
    const prepared = await response.json(); assert.equal(prepared.provider, 'neon');
    const manifest = verifyUploadManifest(prepared.token, task.primaryId);
    const uploadUrl = new URL(prepared.uploadUrl); assert.match(uploadUrl.pathname, /pending/); assert.equal(uploadUrl.searchParams.get('X-Amz-Expires'), '300');
    objects.set(manifest.uploadKey, bytes);
    response = await POST(request({ action: 'complete', token: prepared.token }, 'u-jiho')); assert.equal(response.status, 403); assert.equal(storageCalls, 0);
    response = await POST(request({ action: 'complete', token: prepared.token })); assert.equal(response.status, 200);
    const completed = await response.json(); const attachment = completed.attachments.find((item: { id: string }) => item.id === manifest.id);
    assert.equal(attachment.storageProvider, 'neon'); assert.equal(attachment.storageKey, ''); assert.equal(attachment.status, 'quarantined');
    const savedRecord = (JSON.parse(await readFile(stateFile, 'utf8')) as WorkspaceData).attachments.find(item => item.id === manifest.id)!;
    assert.equal(savedRecord.storageKey, manifest.storageKey);
    assert.deepEqual(objects.get(manifest.storageKey), bytes); assert.equal(objects.has(manifest.uploadKey), false);
    const callsAfterCompletion = storageCalls;
    response = await POST(request({ action: 'complete', token: prepared.token })); assert.equal(response.status, 200);
    const repeated = await response.json(); assert.equal(repeated.revision, completed.revision); assert.equal(storageCalls, callsAfterCompletion);
    // Replaying a still-valid PUT only affects its staging key, not the saved object.
    objects.set(manifest.uploadKey, Buffer.from('replacement')); assert.deepEqual(objects.get(manifest.storageKey), bytes);
    await assert.rejects(uploadNeonFile(manifest.storageKey, Buffer.from('replacement'), 'text/plain'), errorCode('STORAGE_KEY_EXISTS'));
    assert.deepEqual(objects.get(manifest.storageKey), bytes);

    response = await POST(request(prepare)); const invalidPrepared = await response.json(); const invalidManifest = verifyUploadManifest(invalidPrepared.token, task.primaryId);
    objects.set(invalidManifest.uploadKey, Buffer.alloc(bytes.length + 1, 120));
    response = await POST(request({ action: 'complete', token: invalidPrepared.token })); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'FILE_INTEGRITY_ERROR');
    objects.set(invalidManifest.uploadKey, Buffer.alloc(bytes.length, 120));
    response = await POST(request({ action: 'complete', token: invalidPrepared.token })); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'FILE_INTEGRITY_ERROR');
    let state = JSON.parse(await readFile(stateFile, 'utf8')) as WorkspaceData;
    assert.ok(!state.attachments.some(item => item.id === invalidManifest.id));

    const download = (id: string) => new NextRequest(`http://127.0.0.1:3000/api/attachments/${id}`, { headers: { cookie: `${sessionCookie}=${signSession(task.primaryId)}` } });
    response = await GET(download(attachment.id), { params: Promise.resolve({ id: attachment.id }) }); assert.equal(response.status, 409);
    state.attachments.find(item => item.id === attachment.id)!.status = 'test_allowed';
    const legacy = { ...state.attachments[0], id: 'legacy-local', storageKey: 'legacy.bin', storageProvider: undefined, storageBucket: undefined, status: 'test_allowed' as const };
    state.attachments.push(legacy); await mkdir(path.join(directory, 'files')); await writeFile(path.join(directory, 'files', legacy.storageKey), bytes); await writeFile(stateFile, JSON.stringify(state));
    response = await GET(download(attachment.id), { params: Promise.resolve({ id: attachment.id }) }); assert.equal(response.status, 302); assert.match(response.headers.get('location')!, /X-Amz-Expires=60/);
    response = await GET(download(legacy.id), { params: Promise.resolve({ id: legacy.id }) }); assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);

    response = await POST(request(prepare)); const stale = await response.json(); const staleManifest = verifyUploadManifest(stale.token, task.primaryId); objects.set(staleManifest.uploadKey, bytes);
    state = JSON.parse(await readFile(stateFile, 'utf8')) as WorkspaceData; state.tasks.find(item => item.id === task.id)!.deletedAt = new Date().toISOString(); await writeFile(stateFile, JSON.stringify(state));
    const callsBeforeStale = storageCalls;
    response = await POST(request({ action: 'complete', token: stale.token })); assert.equal(response.status, 409); assert.equal(storageCalls, callsBeforeStale);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('ieum-storage-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});
