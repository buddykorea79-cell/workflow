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
import { procedureOverviewFingerprint, procedureReferenceFingerprint } from '../src/lib/procedure-ai-input';
import type { Attachment } from '../src/lib/types';

interface ModelSource { id: string; title: string; content: string; sourceKind: string; priority: string }
function completion(sources: ModelSource[], evidenceSourceId: string, quote: string) {
  return Response.json({ model: 'provider/test-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '업무 개요와 붙임을 우선 분석하고 관련 근거를 검토한 절차입니다.', sourceSummaries: sources.map(source => ({ referenceId: source.id, summary: `${source.title}의 업무 내용을 검토했습니다.`, locator: '본문', quote: source.id === evidenceSourceId ? quote : source.content.slice(0, 60) })), steps: [{ id: 'review', title: '통계표 검토', role: 'reviewer', description: '부서장이 수집한 통계표를 검토합니다.', output: '검토한 통계표', required: true, dependsOn: [], checklist: ['통계표 검토'], evidence: { referenceId: evidenceSourceId, locator: '본문', quote } }], warnings: [] }) } }] });
}

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
    const request = (readAttachments?: boolean, userId = task.primaryId) => new NextRequest('http://127.0.0.1:3000/api/procedure-generate', { method: 'POST', headers: { 'Content-Type': 'application/json', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie: `${sessionCookie}=${signSession(userId)}` }, body: JSON.stringify({ taskId: task.id, overviewFingerprint: procedureOverviewFingerprint(task), referenceIds: ['file-only'], referencesFingerprint: procedureReferenceFingerprint(task.references!), ...(readAttachments === undefined ? {} : { readAttachments }) }) });
    globalThis.fetch = async (url, init) => {
      calls++;
      if (String(url).endsWith('/models')) return Response.json({ models: [{ id: 'provider/test-model', response_format_modes: ['json_schema'] }] });
      assert.equal(String(url), 'https://api.bizrouter.ai/v1/chat/completions');
      const body = JSON.parse(String(init?.body));
      const sources: ModelSource[] = JSON.parse(body.messages[1].content).sources;
      assert.equal(sources.length, 2); assert.equal(sources[0].id, 'overview:task'); assert.equal(sources[0].priority, 'primary');
      const evidence = sources.find(source => source.id === 'reference:file-only')!;
      assert.equal(evidence.priority, 'supporting');
      assert.match(evidence.content, /담당자는 통계자료를 수집한다/); assert.ok(evidence.content.includes(quote));
      assert.equal('attachmentId' in evidence, false);
      return completion(sources, evidence.id, quote);
    };
    // Omitting readAttachments must use the default, so a reference containing
    // only an uploaded file can generate a validated procedure.
    let response = await POST(request());
    const generated = await response.json();
    assert.equal(response.status, 200, JSON.stringify(generated)); assert.equal(calls, 2);
    assert.equal(generated.draft.steps.length, 1); assert.equal(generated.draft.analysis.sources.length, 2); assert.equal(generated.draft.analysis.sources[1].referenceId, 'reference:file-only'); assert.equal(generated.draft.analysis.sources[1].excerpt, quote);
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

test('procedure route always reads saved overview HWPX and TXT files, supports zero references, and rejects changed or foreign primary files', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-ai-overview-route-'));
  const keys = ['IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE', 'BIZROUTER_API_KEY', 'BIZROUTER_MODEL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch; let calls = 0; let includeReference = true;
  try {
    for (const key of keys) delete process.env[key];
    process.env.IEUM_DATA_DIR = directory; process.env.BIZROUTER_API_KEY = 'mock-only-test-key'; process.env.BIZROUTER_MODEL = 'provider/test-model';
    const quote = '부서장은 통계표를 검토한다.';
    const overviewHwpx = Buffer.from(await markdownToHwpx(`# 통계연보 발간 업무계획\n\n담당자는 통계자료를 수집한다.\n\n${quote}`));
    const overviewText = Buffer.from('담당자는 승인된 통계표로 간행물을 발간한다.');
    const state = createSeed(new Date('2026-11-01T04:00:00Z'));
    const task = state.tasks.find(item => item.id === 'task-data')!;
    task.title = '통계연보 발간'; task.description = '업무계획에 따라 통계자료를 수집하고 검토 후 간행물을 발간한다.';
    const attachment = (id: string, name: string, bytes: Buffer): Attachment => ({ id, taskId: task.id, name, size: bytes.length, mime: 'application/octet-stream', sha256: createHash('sha256').update(bytes).digest('hex'), storageKey: `${id}.bin`, storageProvider: 'local', status: 'quarantined', uploadedBy: task.primaryId, createdAt: '2026-11-01T04:00:00Z' });
    const primary = attachment('overview-hwpx', '통계연보 발간 업무계획.hwpx', overviewHwpx);
    const secondaryPrimary = attachment('overview-txt', '발간 절차.txt', overviewText);
    // Its inline clause is usable while readAttachments=false. The deliberately unsupported
    // and absent reference file proves that this switch applies only to supporting files.
    const supporting = attachment('reference-bin', '부가 자료.bin', Buffer.from('not read'));
    state.attachments.push(primary, secondaryPrimary, supporting);
    task.descriptionAttachmentIds = [primary.id, secondaryPrimary.id];
    task.references = [{ id: 'publication-rule', type: 'guideline', title: '간행물 발간 지침', content: '승인한 통계표를 발간 자료로 사용한다.', attachmentId: supporting.id }];
    const workspaceFile = path.join(directory, 'workspace.json');
    const files = path.join(directory, 'files'); await mkdir(files);
    await writeFile(path.join(files, primary.storageKey), overviewHwpx); await writeFile(path.join(files, secondaryPrimary.storageKey), overviewText);
    const save = () => writeFile(workspaceFile, JSON.stringify(state, null, 2)); await save();
    const originalWorkspace = await readFile(workspaceFile, 'utf8');
    const request = (overviewFingerprint = procedureOverviewFingerprint(task)) => new NextRequest('http://127.0.0.1:3000/api/procedure-generate', { method: 'POST', headers: { 'Content-Type': 'application/json', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie: `${sessionCookie}=${signSession(task.primaryId)}` }, body: JSON.stringify({ taskId: task.id, overviewFingerprint, referenceIds: includeReference ? ['publication-rule'] : [], referencesFingerprint: procedureReferenceFingerprint(includeReference ? task.references! : []), readAttachments: false }) });
    globalThis.fetch = async (url, init) => {
      calls++;
      if (String(url).endsWith('/models')) return Response.json({ models: [{ id: 'provider/test-model', response_format_modes: ['json_schema'] }] });
      assert.equal(String(url), 'https://api.bizrouter.ai/v1/chat/completions');
      const payload = JSON.parse(JSON.parse(String(init?.body)).messages[1].content);
      const sources: ModelSource[] = payload.sources;
      assert.deepEqual(sources.map(source => source.id), ['overview:task', 'document:overview-hwpx', 'document:overview-txt', ...(includeReference ? ['reference:publication-rule'] : [])]);
      assert.deepEqual(sources.slice(0, 3).map(source => source.priority), ['primary', 'primary', 'primary']);
      assert.deepEqual(sources.slice(0, 3).map(source => source.sourceKind), ['overview', 'attachment', 'attachment']);
      assert.ok(sources[0].content.includes(task.description)); assert.ok(sources[0].content.includes(task.completionCriteria));
      assert.match(sources[1].content, /담당자는 통계자료를 수집한다/); assert.ok(sources[1].content.includes(quote));
      assert.equal(sources[2].content, overviewText.toString());
      if (includeReference) { assert.equal(sources[3].priority, 'supporting'); assert.equal(sources[3].content, task.references![0].content); }
      assert.ok(sources.every(source => !('attachmentId' in source) && !('storageKey' in source) && !('url' in source)));
      return completion(sources, 'document:overview-hwpx', quote);
    };
    let response = await POST(request()); let generated = await response.json();
    assert.equal(response.status, 200, JSON.stringify(generated)); assert.equal(calls, 2);
    assert.equal(generated.draft.analysis.sources.length, 4); assert.match(generated.draft.steps[0].description, /업무 첨부 · 통계연보 발간 업무계획.hwpx/);
    includeReference = false;
    response = await POST(request()); generated = await response.json();
    assert.equal(response.status, 200, JSON.stringify(generated)); assert.equal(calls, 4); assert.equal(generated.draft.analysis.sources.length, 3);
    assert.equal(await readFile(workspaceFile, 'utf8'), originalWorkspace, 'generating an overview-based procedure must not change saved data');

    calls = 0; globalThis.fetch = async () => { calls++; throw new Error('Invalid primary input must fail before any AI request'); };
    const fingerprint = procedureOverviewFingerprint(task);
    task.descriptionAttachmentIds = [secondaryPrimary.id]; await save();
    response = await POST(request(fingerprint)); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'AI_OVERVIEW_CHANGED');
    task.descriptionAttachmentIds = [primary.id, secondaryPrimary.id];
    primary.taskId = 'another-task'; await save();
    response = await POST(request()); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'AI_ATTACHMENT_MISSING');
    primary.taskId = task.id;
    const sha256 = primary.sha256; primary.sha256 = '0'.repeat(64); await save();
    response = await POST(request()); const changed = await response.json(); assert.equal(response.status, 409); assert.equal(changed.code, 'ATTACHMENT_CHANGED'); assert.match(changed.error, /통계연보 발간 업무계획.hwpx/);
    primary.sha256 = sha256; await save();
    assert.equal(calls, 0, 'stale, inaccessible, and tampered primary documents must not reach AI');
    assert.equal(await readFile(workspaceFile, 'utf8'), originalWorkspace);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ieum-ai-overview-route-'));
    await rm(directory, { recursive: true, force: true });
  }
});
