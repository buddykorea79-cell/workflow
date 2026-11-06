import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/procedure-extract/route';
import { sessionCookie, signSession } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';

function smallPdf(): Buffer {
  const content = 'BT /F1 12 Tf 40 80 Td (Prototype attachment content.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let text = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(text)); text += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const start = Buffer.byteLength(text);
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text);
}

test('prototype PDF extraction checks task access and stored bytes before parsing a Neon attachment', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-prototype-extract-'));
  const keys = ['IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_PROTOTYPE_MODE', 'IEUM_SESSION_SECRET', 'IEUM_APP_ORIGIN', 'IEUM_STORAGE_PROVIDER', 'AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'IEUM_STORAGE_BUCKET'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalSend = S3Client.prototype.send;
  const originalFetch = globalThis.fetch;
  let storedBytes = smallPdf(); let storageReads = 0;
  try {
    keys.forEach(key => { delete process.env[key]; });
    Object.assign(process.env, {
      IEUM_DATA_DIR: directory, IEUM_PROTOTYPE_MODE: 'true', IEUM_SESSION_SECRET: 'mock-prototype-extraction-session-secret-long-enough', IEUM_APP_ORIGIN: 'https://prototype.example',
      IEUM_STORAGE_PROVIDER: 'neon', AWS_ENDPOINT_URL_S3: 'https://storage.example.test', AWS_REGION: 'us-east-2', AWS_ACCESS_KEY_ID: 'mock-key', AWS_SECRET_ACCESS_KEY: 'mock-secret', IEUM_STORAGE_BUCKET: 'test-attachments',
    });
    const mockSend = async (command: unknown) => {
      assert.ok(command instanceof GetObjectCommand);
      assert.equal(command.input.Bucket, 'test-attachments');
      assert.equal(command.input.Key, 'prototype/example.pdf');
      storageReads++;
      return { ContentLength: storedBytes.length, Body: { transformToByteArray: async () => new Uint8Array(storedBytes) } };
    };
    S3Client.prototype.send = mockSend as typeof S3Client.prototype.send;
    globalThis.fetch = async () => { throw new Error('Real network requests are forbidden in this test'); };
    const state = createSeed(new Date('2026-11-01T04:00:00Z'));
    const task = state.tasks.find(item => item.id === 'task-data')!;
    const attachment = { id: 'attachment-pdf', taskId: task.id, name: 'example.pdf', mime: 'application/pdf', size: storedBytes.length, sha256: createHash('sha256').update(storedBytes).digest('hex'), storageKey: 'prototype/example.pdf', storageProvider: 'neon' as const, storageBucket: 'test-attachments', status: 'quarantined' as const, uploadedBy: task.primaryId, createdAt: '2026-11-01T04:00:00Z' };
    state.attachments.push(attachment);
    const save = () => writeFile(path.join(directory, 'workspace.json'), JSON.stringify(state, null, 2));
    await save();
    const payload = { taskId: task.id, attachmentId: attachment.id };
    const request = (userId: string | null = task.primaryId, body: unknown = payload) => new NextRequest('https://prototype.example/api/procedure-extract', { method: 'POST', headers: { 'Content-Type': 'application/json', origin: 'https://prototype.example', ...(userId ? { cookie: `${sessionCookie}=${signSession(userId)}` } : {}) }, body: JSON.stringify(body) });

    assert.equal((await POST(request(null))).status, 401);
    assert.equal((await POST(request('u-jiho'))).status, 403);
    assert.equal((await POST(request(task.primaryId, { ...payload, extra: 'x'.repeat(2100) }))).status, 413);
    const missing = await POST(request(task.primaryId, { ...payload, attachmentId: 'other-task-attachment' }));
    assert.equal(missing.status, 404);
    assert.equal((await missing.json()).code, 'ATTACHMENT_NOT_FOUND');
    assert.equal(storageReads, 0);
    state.departmentWorkPlans = [{ departmentId: task.departmentId, status: 'confirmed', version: 1 }]; await save();
    const form = new FormData(); form.append('taskId', task.id); form.append('file', new File([new Uint8Array(storedBytes)], 'source.pdf', { type: 'application/pdf' }));
    const imported = await POST(new NextRequest('https://prototype.example/api/procedure-extract', { method: 'POST', headers: { origin: 'https://prototype.example', cookie: `${sessionCookie}=${signSession(task.primaryId)}` }, body: form }));
    assert.equal(imported.status, 409); assert.equal((await imported.json()).code, 'DEPARTMENT_CONFIRMED');
    assert.equal(storageReads, 0);
    const confirmedRead = await POST(request()); const confirmedResult = await confirmedRead.json();
    assert.equal(confirmedRead.status, 200, JSON.stringify(confirmedResult));
    assert.match(confirmedResult.text, /Prototype attachment content\./);
    assert.equal(storageReads, 1);

    state.departmentWorkPlans = []; attachment.sha256 = '0'.repeat(64); await save();
    const changed = await POST(request());
    const changedBody = await changed.json(); assert.equal(changed.status, 409, JSON.stringify({ changedBody, storageReads })); assert.equal(changedBody.code, 'ATTACHMENT_CHANGED');
    storedBytes = Buffer.from('Not PDF bytes'); attachment.size = storedBytes.length; attachment.sha256 = createHash('sha256').update(storedBytes).digest('hex'); await save();
    const invalid = await POST(request());
    assert.equal(invalid.status, 422); assert.equal((await invalid.json()).code, 'DOCUMENT_EXTRACTION_FAILED');

    storedBytes = smallPdf(); attachment.size = storedBytes.length; attachment.sha256 = createHash('sha256').update(storedBytes).digest('hex'); await save();
    const extracted = await POST(request()); const result = await extracted.json();
    assert.equal(extracted.status, 200, JSON.stringify(result));
    assert.equal(result.pageCount, 1); assert.match(result.text, /Prototype attachment content\./);
    assert.equal(storageReads, 4);
  } finally {
    S3Client.prototype.send = originalSend;
    globalThis.fetch = originalFetch;
    keys.forEach(key => { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; });
    await rm(directory, { recursive: true, force: true });
  }
});
