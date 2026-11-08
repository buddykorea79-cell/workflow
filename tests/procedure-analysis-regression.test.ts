import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST } from '../src/app/api/procedure-generate/route';
import { generateAiProcedure, parseAiProcedure, procedureAiSources, withProcedureSignal } from '../src/lib/bizrouter';
import { procedureOverviewFingerprint, procedureReferenceFingerprint } from '../src/lib/procedure-ai-input';
import { readProcedureDocuments, readProcedureOverviewDocuments, type ProcedureDocumentOptions } from '../src/lib/procedure-documents';
import { createSeed } from '../src/lib/seed';
import { DomainError } from '../src/lib/domain';
import { sessionCookie, signSession } from '../src/lib/auth';
import type { Attachment, TaskReference } from '../src/lib/types';

const reference: TaskReference = { id: 'rule', title: '가상 규정', type: 'guideline', content: '담당자는 실적을 작성한다. 부서장은 자료를 검토한다.' };
const evidence = { referenceId: reference.id, locator: '본문', quote: '부서장은 자료를 검토한다.' };
const rawDraft = () => ({ summary: '실적을 검토합니다.', sourceSummaries: [{ ...evidence, summary: '부서장의 자료 검토를 확인했습니다.' }], steps: [{ id: 'review', title: '자료 검토', role: 'reviewer', description: '부서장이 자료를 검토합니다.', output: '', required: false, dependsOn: [], checklist: [], evidence }], warnings: [] });
const isCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;

test('AI keeps evidenced review mandatory by task policy without inventing a review or its citation', () => {
  const value = rawDraft();
  const draft = parseAiProcedure(value, [reference]);
  assert.equal(draft.steps[0].required, true);
  assert.equal(value.steps[0].required, false, 'response input must remain unchanged');
  assert.match(draft.warnings.join(' '), /검토 설정/);
  assert.equal(parseAiProcedure(value, [reference], 'optional', { reviewRequired: false }).steps[0].required, false);
  value.steps[0].role = 'primary';
  assert.throws(() => parseAiProcedure(value, [reference]), isCode('AI_INVALID_WORKFLOW'));
  assert.equal(parseAiProcedure(value, [reference], 'optional', { reviewRequired: false }).steps.length, 1);
  value.steps[0].role = 'reviewer';
  value.steps[0].evidence = { ...evidence, quote: '원문에 없는 승인 의무' };
  assert.throws(() => parseAiProcedure(value, [reference]), isCode('AI_UNVERIFIED_EVIDENCE'));
});

test('caller cancellation and deadline expiration return distinct errors without calling the model', async () => {
  let calls = 0;
  const options = { apiKey: 'mock', model: 'test', fetcher: (async () => { calls++; throw new Error('unexpected request'); }) as typeof fetch };
  const input = { title: '가상 업무', description: reference.content, references: [] };
  await assert.rejects(generateAiProcedure(input, { ...options, signal: AbortSignal.abort() }), isCode('AI_CANCELLED'));
  await assert.rejects(generateAiProcedure(input, { ...options, signal: AbortSignal.abort(new DOMException('time limit', 'TimeoutError')) }), isCode('AI_TIMEOUT'));
  assert.equal(calls, 0);
  assert.notEqual(procedureOverviewFingerprint(input), procedureOverviewFingerprint({ ...input, reviewRequired: false }));
});

test('the route deadline interrupts slow extraction as well as generation and cleans up abort listeners', async () => {
  const controller = new AbortController();
  let finish!: () => void;
  const pending = withProcedureSignal(() => new Promise<void>(resolve => { finish = resolve; }), controller.signal);
  controller.abort(new DOMException('deadline', 'TimeoutError'));
  await assert.rejects(pending, isCode('AI_TIMEOUT'));
  finish();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await withProcedureSignal(async () => 'done', new AbortController().signal), 'done');
});

test('the same overview/reference file is extracted and analyzed once while additional clauses remain', async () => {
  const bytes = Buffer.from(reference.content);
  const attachment: Attachment = { id: 'same', taskId: 'task', name: '실적계획.txt', size: bytes.length, mime: 'text/plain', sha256: createHash('sha256').update(bytes).digest('hex'), storageKey: 'same.bin', status: 'quarantined', uploadedBy: 'test', createdAt: '2026-11-08T00:00:00Z' };
  let reads = 0;
  const reader = async () => { reads++; return bytes; };
  const options: ProcedureDocumentOptions = { cache: new Map() };
  const overview = await readProcedureOverviewDocuments([attachment], reader, options);
  const prepared = await readProcedureDocuments([{ ...reference, attachmentId: attachment.id, content: '' }], [attachment], reader, { ...options, primaryDocuments: overview.documents });
  const sources = procedureAiSources({ title: '실적 제출', description: '', documents: overview.documents, references: prepared.references });
  assert.equal(reads, 1);
  assert.deepEqual(sources.map(source => source.id), ['overview:task', 'document:same']);
  const extra = await readProcedureDocuments([{ ...reference, attachmentId: attachment.id, content: '교육 수료 실적도 함께 취합합니다.' }], [attachment], reader, { ...options, primaryDocuments: overview.documents });
  assert.equal(reads, 1);
  assert.equal(extra.references[0].content, '교육 수료 실적도 함께 취합합니다.');
  assert.equal(procedureAiSources({ title: '실적 제출', description: '', documents: overview.documents, references: extra.references }).length, 3);
});

test('explicit zero overview files omits extraction; selected ownership and optional-review policy are enforced', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-analysis-selection-'));
  const keys = ['IEUM_DATA_DIR', 'IEUM_STORE', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE', 'BIZROUTER_API_KEY', 'BIZROUTER_MODEL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    for (const key of keys) delete process.env[key];
    process.env.IEUM_DATA_DIR = directory; process.env.IEUM_STORE = 'local';
    process.env.BIZROUTER_API_KEY = 'test-only'; process.env.BIZROUTER_MODEL = 'test';
    const state = createSeed(new Date('2026-11-08T00:00:00Z'));
    const task = state.tasks.find(item => item.id === 'task-data')!;
    task.reviewRequired = false; task.description = '담당자는 실적을 작성한다.'; task.completionCriteria = '실적 작성 완료';
    task.descriptionAttachmentIds = ['unreadable']; task.references = [];
    state.attachments.push({ id: 'unreadable', taskId: task.id, name: '연결만된파일.bin', mime: 'application/octet-stream', size: 9, sha256: '0'.repeat(64), storageKey: 'does-not-exist', status: 'quarantined', uploadedBy: task.primaryId, createdAt: '2026-11-08T00:00:00Z' });
    const file = path.join(directory, 'workspace.json'); await mkdir(path.join(directory, 'files'));
    const save = () => writeFile(file, JSON.stringify(state)); await save();
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      if (String(url).endsWith('/models')) return Response.json({ models: [{ id: 'test', response_format_modes: ['json_schema'] }] });
      const request = JSON.parse(String(init?.body));
      const sent = JSON.parse(request.messages[1].content);
      assert.equal(sent.task.reviewRequired, false);
      assert.deepEqual(sent.sources.map((source: { id: string }) => source.id), ['overview:task']);
      assert.equal(request.response_format.json_schema.schema.properties.steps.items.properties.required.const, true);
      const quote = '담당자는 실적을 작성한다.';
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ summary: '실적을 작성합니다.', sourceSummaries: [{ referenceId: 'overview:task', summary: '실적 작성 업무입니다.', locator: '설명', quote }], steps: [{ id: 'write', title: '실적 작성', role: 'primary', description: quote, output: '', required: true, dependsOn: [], checklist: [], evidence: { referenceId: 'overview:task', locator: '설명', quote } }], warnings: [] }) } }] });
    };
    const request = (overviewAttachmentIds: string[], fingerprint = procedureOverviewFingerprint(task)) => new NextRequest('http://127.0.0.1:3000/api/procedure-generate', { method: 'POST', headers: { 'Content-Type': 'application/json', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie: `${sessionCookie}=${signSession(task.primaryId)}` }, body: JSON.stringify({ taskId: task.id, overviewFingerprint: fingerprint, overviewAttachmentIds, referenceIds: [], referencesFingerprint: procedureReferenceFingerprint([]), readAttachments: false }) });
    const before = await readFile(file, 'utf8');
    let response = await POST(request([]));
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal(calls, 2); assert.equal(await readFile(file, 'utf8'), before);
    response = await POST(request(['foreign'])); assert.equal(response.status, 409);
    response = await POST(request(['unreadable', 'unreadable'])); assert.equal(response.status, 409);
    response = await POST(request([], procedureOverviewFingerprint({ ...task, reviewRequired: true }))); assert.equal(response.status, 409);
    assert.equal(calls, 2, 'invalid selection and stale policy must fail before extraction or AI');
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ieum-analysis-selection-'));
    await rm(directory, { recursive: true, force: true });
  }
});
