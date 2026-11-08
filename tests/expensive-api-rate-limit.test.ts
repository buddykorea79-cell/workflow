import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST as generate } from '../src/app/api/procedure-generate/route';
import { POST as extract } from '../src/app/api/procedure-extract/route';
import { POST as description } from '../src/app/api/task-description/route';
import { GET as law } from '../src/app/api/law/route';
import { assertUserRateLimit } from '../src/lib/rate-limit';
import { sessionCookie, signSession } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';
import { procedureOverviewFingerprint, procedureReferenceFingerprint } from '../src/lib/procedure-ai-input';

test('all expensive API paths share the configured user quota and stop before file or provider access', async () => {
  const qaRoot = path.resolve('.qa-data'); await mkdir(qaRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(qaRoot, 'api-limit-test-'));
  const keys = ['IEUM_STORE', 'IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE', 'IEUM_API_RATE_LIMIT_PER_MINUTE'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]])); const originalFetch = globalThis.fetch;
  try {
    keys.forEach(key => { delete process.env[key]; });
    Object.assign(process.env, { IEUM_STORE: 'local', IEUM_DATA_DIR: dataDir, IEUM_API_RATE_LIMIT_PER_MINUTE: '1' });
    const state = createSeed(); const task = state.tasks.find(item => item.id === 'task-data')!;
    const attachmentId = 'synthetic-rate-limit-attachment';
    state.attachments.push({ id: attachmentId, taskId: task.id, name: 'source.txt', mime: 'text/plain', size: 10, sha256: '0'.repeat(64), storageKey: 'must-not-read.txt', status: 'quarantined', uploadedBy: task.primaryId, createdAt: new Date().toISOString() });
    await writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(state));
    globalThis.fetch = async () => { throw new Error('Rate-limited requests must not reach an external provider'); };
    assertUserRateLimit(task.primaryId);
    const request = (route: string, body?: unknown, userId = task.primaryId) => new NextRequest(`http://127.0.0.1:3000/api/${route}`, { method: body === undefined ? 'GET' : 'POST', headers: { cookie: `${sessionCookie}=${signSession(userId)}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const responses = [
      await generate(request('procedure-generate', { taskId: task.id, overviewFingerprint: procedureOverviewFingerprint(task), referenceIds: [], referencesFingerprint: procedureReferenceFingerprint([]) })),
      await extract(request('procedure-extract', { taskId: task.id, attachmentId })),
      await description(request('task-description', { action: 'extract', attachmentId })),
      await description(request('task-description', { action: 'generate', title: task.title, description: '', documents: [{ attachmentId, text: '분석할 본문' }] })),
      await law(request(`law?${new URLSearchParams({ taskId: task.id, action: 'search', kind: 'law', query: '통계' })}`)),
    ];
    for (const response of responses) {
      assert.equal(response.status, 429); assert.deepEqual(await response.json(), { code: 'RATE_LIMITED', error: '잠시 후 다시 시도해 주세요.' });
    }
    const denied = await extract(request('procedure-extract', { taskId: task.id, attachmentId }, 'u-jiho'));
    assert.equal(denied.status, 403, 'Access checks must precede quota decisions.');
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach(key => { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; });
    assert.equal(path.dirname(path.resolve(dataDir)), qaRoot); assert.ok(path.basename(dataDir).startsWith('api-limit-test-'));
    await rm(dataDir, { recursive: true, force: true });
  }
});
