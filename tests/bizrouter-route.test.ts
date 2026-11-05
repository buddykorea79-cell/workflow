import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/procedure-generate/route';
import { sessionCookie, signSession } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';
import { procedureReferenceFingerprint } from '../src/lib/procedure-ai-input';

test('AI route checks identity, source ownership, saved content and department lock before external calls', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-ai-route-'));
  const environment = ['IEUM_DATA_DIR', 'BIZROUTER_API_KEY', 'BIZROUTER_MODEL', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN'] as const;
  const previous = Object.fromEntries(environment.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    for (const key of environment) delete process.env[key];
    process.env.IEUM_DATA_DIR = directory;
    process.env.BIZROUTER_API_KEY = 'mock-only-test-key';
    process.env.BIZROUTER_MODEL = 'provider/test-model';
    globalThis.fetch = async () => { calls++; throw new Error('No network call is permitted in this test'); };
    const state = createSeed(new Date('2026-11-01T04:00:00Z'));
    const task = state.tasks.find(task => task.id === 'task-data')!;
    task.references = [{ id: 'saved-source', type: 'law', title: '점검 지침', content: '담당자는 자료를 작성한다. 검토자는 자료를 검토한다.' }];
    const file = path.join(directory, 'workspace.json');
    const save = () => writeFile(file, JSON.stringify(state, null, 2));
    await save();
    const payload = { taskId: task.id, referenceIds: ['saved-source'], referencesFingerprint: procedureReferenceFingerprint(task.references) };
    const request = (userId: string | null = task.primaryId, body: unknown = payload, origin = 'http://127.0.0.1:3000') => new NextRequest('http://127.0.0.1:3000/api/procedure-generate', { method: 'POST', headers: { 'Content-Type': 'application/json', host: '127.0.0.1:3000', origin, ...(userId ? { cookie: `${sessionCookie}=${signSession(userId)}` } : {}) }, body: JSON.stringify(body) });
    let response = await POST(request(null));
    assert.equal(response.status, 401);
    response = await POST(request('u-jiho'));
    assert.equal(response.status, 403);
    response = await POST(request(task.primaryId, payload, 'https://other.example'));
    assert.equal(response.status, 403);
    response = await POST(request(task.primaryId, { ...payload, referenceIds: ['another-task-reference'] }));
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'AI_REFERENCES_CHANGED');
    response = await POST(request(task.primaryId, { ...payload, referencesFingerprint: 'unsaved-content' }));
    assert.equal(response.status, 409); assert.equal((await response.json()).code, 'AI_REFERENCES_CHANGED');
    response = await POST(request(task.primaryId, { ...payload, referenceIds: ['saved-source', 'saved-source'] }));
    assert.equal(response.status, 409);
    state.departmentWorkPlans = [{ departmentId: task.departmentId, status: 'confirmed', version: 1 }]; await save();
    response = await POST(request());
    assert.equal(response.status, 409);
    assert.equal(calls, 0);

    state.departmentWorkPlans = []; await save();
    globalThis.fetch = async (_url, init) => {
      calls++;
      if (calls === 1) return Response.json({ models: [{ id: 'provider/test-model', response_format_modes: ['json_schema'] }] });
      const messages = JSON.parse(String(init?.body)).messages;
      assert.deepEqual(JSON.parse(messages[1].content).references.map((reference: { id: string }) => reference.id), ['saved-source']);
      return Response.json({ model: 'provider/test-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '작성된 자료를 검토하는 절차입니다.', sourceSummaries: [{ referenceId: 'saved-source', summary: '담당자가 작성한 자료를 검토자가 확인합니다.', locator: '본문', quote: '검토자는 자료를 검토한다.' }], steps: [{ id: 'review', title: '자료 검토', role: 'reviewer', description: '제출된 자료를 검토합니다.', output: '검토 결과', required: true, dependsOn: [], checklist: ['검토 완료'], evidence: { referenceId: 'saved-source', locator: '본문', quote: '검토자는 자료를 검토한다.' } }], warnings: [] }) } }] });
    };
    response = await POST(request());
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify({ calls, result }));
    assert.equal(result.draft.steps.length, 1); assert.equal(calls, 2);
    assert.equal(result.draft.analysis.sources[0].referenceId, 'saved-source');
    assert.equal(result.draft.analysis.sources[0].sourceTitle, '점검 지침');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).revision, state.revision);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).tasks.find((item: { id: string }) => item.id === task.id).workflow, task.workflow);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of environment) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ieum-ai-route-'));
    await rm(directory, { recursive: true, force: true });
  }
});
