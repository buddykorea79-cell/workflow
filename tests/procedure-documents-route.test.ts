import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { markdownToHwpx } from 'kordoc';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/procedure-generate/route';
import { sessionCookie, signSession } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';
import { procedureReferenceFingerprint } from '../src/lib/procedure-ai-input';
import type { Attachment } from '../src/lib/types';

test('procedure route reads a file-only HWPX reference with Kordoc before AI and checks file ownership and integrity', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-ai-doc-route-'));
  const keys = ['IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE', 'BIZROUTER_API_KEY', 'BIZROUTER_MODEL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    for (const key of keys) delete process.env[key];
    process.env.IEUM_DATA_DIR = directory;
    process.env.BIZROUTER_API_KEY = 'mock-only-test-key';
    process.env.BIZROUTER_MODEL = 'provider/test-model';
    const quote = '부서장은 통계표를 검토한다.';
    const bytes = Buffer.from(await markdownToHwpx(`# 통계연보 작성 지침\n\n담당자는 통계자료를 수집한다.\n\n${quote}`));
    const state = createSeed(new Date('2026-11-01T04:00:00Z'));
    const task = state.tasks.find(item => item.id === 'task-data')!;
    const attachment: Attachment = { id: 'source-hwpx', taskId: task.id, name: '통계연보 지침.hwpx', size: bytes.length, mime: 'application/haansofthwpx', sha256: createHash('sha256').update(bytes).digest('hex'), storageKey: 'file-only-source.bin', storageProvider: 'local', status: 'quarantined', uploadedBy: task.primaryId, createdAt: '2026-11-01T04:00:00Z' };
    state.attachments.push(attachment);
    task.references = [{ id: 'file-only', type: 'guideline', title: '통계연보 지침', content: '', attachmentId: attachment.id }];
    const workspaceFile = path.join(directory, 'workspace.json');
    const files = path.join(directory, 'files'); await mkdir(files);
    await writeFile(path.join(files, attachment.storageKey), bytes);
    const save = () => writeFile(workspaceFile, JSON.stringify(state, null, 2));
    await save();
    const originalWorkspace = await readFile(workspaceFile, 'utf8');
    const request = (readAttachments?: boolean, userId = task.primaryId) => new NextRequest('http://127.0.0.1:3000/api/procedure-generate', { method: 'POST', headers: { 'Content-Type': 'application/json', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie: `${sessionCookie}=${signSession(userId)}` }, body: JSON.stringify({ taskId: task.id, referenceIds: ['file-only'], referencesFingerprint: procedureReferenceFingerprint(task.references!), ...(readAttachments === undefined ? {} : { readAttachments }) }) });
    globalThis.fetch = async (url, init) => {
      calls++;
      if (String(url).endsWith('/models')) return Response.json({ models: [{ id: 'provider/test-model', response_format_modes: ['json_schema'] }] });
      assert.equal(String(url), 'https://api.bizrouter.ai/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      const evidence = JSON.parse(body.messages[1].content).references;
      assert.equal(evidence.length, 1); assert.equal(evidence[0].id, 'file-only');
      assert.match(evidence[0].content, /담당자는 통계자료를 수집한다/); assert.ok(evidence[0].content.includes(quote));
      assert.equal('attachmentId' in evidence[0], false);
      return Response.json({ model: 'provider/test-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '수집한 통계자료를 부서장이 검토하는 절차입니다.', sourceSummaries: [{ referenceId: 'file-only', summary: '통계자료를 수집하고 부서장이 통계표를 검토합니다.', locator: '통계연보 작성 지침 본문', quote }], steps: [{ id: 'review', title: '통계표 검토', role: 'reviewer', description: '부서장이 수집한 통계표를 검토합니다.', output: '검토한 통계표', required: true, dependsOn: [], checklist: ['통계표 검토'], evidence: { referenceId: 'file-only', locator: '통계연보 작성 지침 본문', quote } }], warnings: [] }) } }] });
    };
    // Omitting readAttachments must use the default, so a reference containing
    // only an uploaded file can generate a validated procedure.
    let response = await POST(request());
    const generated = await response.json();
    assert.equal(response.status, 200, JSON.stringify(generated)); assert.equal(calls, 2);
    assert.equal(generated.draft.steps.length, 1); assert.equal(generated.draft.analysis.sources[0].referenceId, 'file-only'); assert.equal(generated.draft.analysis.sources[0].excerpt, quote);
    assert.equal(await readFile(workspaceFile, 'utf8'), originalWorkspace, 'analysis must not save extracted content or a new procedure automatically');

    calls = 0;
    globalThis.fetch = async () => { calls++; throw new Error('No network call is permitted for a rejected file'); };
    response = await POST(request(false)); assert.equal(response.status, 422); assert.equal((await response.json()).code, 'AI_REFERENCE_REQUIRED');
    response = await POST(request(undefined, 'u-jiho')); assert.equal(response.status, 403);
    attachment.taskId = 'another-task'; await save();
    response = await POST(request()); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'AI_ATTACHMENT_MISSING');
    attachment.taskId = task.id;
    const sha256 = attachment.sha256; attachment.sha256 = '0'.repeat(64); await save();
    response = await POST(request()); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'ATTACHMENT_CHANGED');
    attachment.sha256 = sha256;
    attachment.name = 'unsupported.bin'; await save();
    response = await POST(request()); assert.equal(response.status, 415); assert.equal((await response.json()).code, 'DOCUMENT_FORMAT_UNSUPPORTED');
    assert.equal(calls, 0, 'invalid or inaccessible files must fail before sending evidence to AI');
    attachment.name = '통계연보 지침.hwpx'; await save();
    assert.equal(await readFile(workspaceFile, 'utf8'), originalWorkspace);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ieum-ai-doc-route-'));
    await rm(directory, { recursive: true, force: true });
  }
});
