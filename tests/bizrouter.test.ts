import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAiProcedure, parseAiProcedure } from '../src/lib/bizrouter';
import { procedureReferenceFingerprint } from '../src/lib/procedure-ai-input';
import { DomainError } from '../src/lib/domain';
import type { TaskReference } from '../src/lib/types';

const references: TaskReference[] = [{ id: 'ref-law', type: 'law', title: '점검 지침', content: '1. 담당자는 자료를 작성한다.\n2. 검토자는 자료를 검토한다.', url: 'https://example.com/private-source' }];
const input = { title: '자료 점검', description: '점검 자료 준비와 검토', references };
const model = 'provider/allowed-model';
const valid = () => ({ summary: '담당자가 자료를 작성하고 검토자가 확인하는 점검 절차입니다.', sourceSummaries: [{ referenceId: 'ref-law', summary: '담당자의 자료 작성과 검토자의 확인을 규정합니다.', locator: '1~2항', quote: '담당자는 자료를 작성한다.' }], steps: [
  { id: 'prepare', title: '자료 작성', role: 'primary', description: '담당자가 점검 자료를 작성합니다.', output: '작성 자료', required: true, dependsOn: [], checklist: ['자료 작성 여부'], evidence: { referenceId: 'ref-law', locator: '1항', quote: '담당자는 자료를 작성한다.' } },
  { id: 'review', title: '자료 검토', role: 'reviewer', description: '작성한 자료를 검토합니다.', output: '검토 결과', required: true, dependsOn: ['prepare'], checklist: ['검토 완료 여부'], evidence: { referenceId: 'ref-law', locator: '2항', quote: '검토자는 자료를 검토한다.' } },
], warnings: [] });
const errorCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;
const catalog = () => Response.json({ models: [{ id: model, response_format_modes: ['json_schema'] }] });
const completion = (content: unknown = valid(), finish_reason = 'stop') => Response.json({ model, choices: [{ message: { content: JSON.stringify(content) }, finish_reason }] });

test('AI procedure uses validated evidence and fresh dependency IDs, preserving saved references', () => {
  const draft = parseAiProcedure(valid(), references, 'generated');
  assert.equal(draft.steps[0].id, 'generated-1');
  assert.deepEqual(draft.steps[1].dependsOn, ['generated-1']);
  assert.match(draft.steps[0].description, /점검 지침/);
  assert.match(draft.steps[0].description, /원문 인용/);
  assert.equal(draft.evidence['generated-2'].excerpt, '검토자는 자료를 검토한다.');
  assert.deepEqual(draft.references, []);
  assert.equal(draft.analysis?.summary, valid().summary);
  assert.deepEqual(draft.analysis?.sources, [{ referenceId: 'ref-law', sourceTitle: '점검 지침', summary: valid().sourceSummaries[0].summary, locator: '1~2항', excerpt: '담당자는 자료를 작성한다.' }]);
  assert.ok(draft.steps.every(step => step.done === false && !step.startDate && !step.dueDate));
});

test('AI reviews every selected reference and combines their summaries with a cited workflow', () => {
  const sources: TaskReference[] = [...references, { id: 'ref-directive', type: 'directive', title: '보완 지시', content: '지원담당자는 수집한 자료의 누락을 확인한다.' }];
  const sourceBefore = structuredClone(sources);
  const result = valid();
  result.summary = '자료 작성 후 지원담당자가 누락을 확인하고, 검토자가 결과를 확인합니다.';
  result.sourceSummaries.push({ referenceId: 'ref-directive', summary: '지원담당자의 누락 확인을 추가합니다.', locator: '본문', quote: '지원담당자는 수집한 자료의 누락을 확인한다.' });
  result.steps.splice(1, 0, { id: 'support', title: '누락 확인', role: 'support', description: '수집 자료에 누락이 있는지 확인합니다.', output: '누락 점검표', required: true, dependsOn: ['prepare'], checklist: ['누락 여부 확인'], evidence: { referenceId: 'ref-directive', locator: '본문', quote: '지원담당자는 수집한 자료의 누락을 확인한다.' } });
  result.steps[2].dependsOn = ['support'];
  const draft = parseAiProcedure(result, sources, 'multi');
  assert.deepEqual(draft.analysis?.sources.map(source => [source.referenceId, source.sourceTitle]), [['ref-law', '점검 지침'], ['ref-directive', '보완 지시']]);
  assert.equal(draft.analysis?.summary, result.summary);
  assert.deepEqual(draft.steps[2].dependsOn, ['multi-2']);
  assert.equal(draft.evidence['multi-2'].excerpt, sources[1].content);
  assert.deepEqual(sources, sourceBefore);
});

test('AI rejects missing, duplicated or unrelated source summaries and fabricated summary quotations', () => {
  const sources: TaskReference[] = [...references, { id: 'ref-extra', type: 'guideline', title: '제출 지침', content: '담당자는 검토된 자료를 제출한다.' }];
  let result = valid();
  assert.throws(() => parseAiProcedure(result, sources), errorCode('AI_INCOMPLETE_SUMMARY'));
  result.sourceSummaries.push({ ...result.sourceSummaries[0] });
  assert.throws(() => parseAiProcedure(result, sources), errorCode('AI_INCOMPLETE_SUMMARY'));
  result.sourceSummaries[1].referenceId = 'unselected-source';
  assert.throws(() => parseAiProcedure(result, sources), errorCode('AI_INCOMPLETE_SUMMARY'));
  result = valid(); result.sourceSummaries[0].quote = '등록되지 않은 문구를 원문이라고 주장합니다.';
  assert.throws(() => parseAiProcedure(result, references), errorCode('AI_UNVERIFIED_EVIDENCE'));
});

test('AI rejects invented quotations, source IDs, graph cycles and missing required reviewer', () => {
  let result = valid(); result.steps[0].evidence.quote = '제공하지 않은 법령 문구';
  assert.throws(() => parseAiProcedure(result, references), errorCode('AI_UNVERIFIED_EVIDENCE'));
  result = valid(); result.steps[0].evidence.referenceId = 'other-task-reference';
  assert.throws(() => parseAiProcedure(result, references), errorCode('AI_UNVERIFIED_EVIDENCE'));
  result = valid(); result.steps[0].dependsOn = ['review'];
  assert.throws(() => parseAiProcedure(result, references), errorCode('AI_INVALID_WORKFLOW'));
  result = valid(); result.steps[1].required = false;
  assert.throws(() => parseAiProcedure(result, references), errorCode('AI_INVALID_WORKFLOW'));
  result = valid(); result.steps[0].evidence.quote = '   ';
  assert.throws(() => parseAiProcedure(result, references), errorCode('AI_INVALID_STRUCTURE'));
});

test('BizRouter sends selected text to fixed API with server credentials and structured schema', async () => {
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => { requests.push({ url: String(url), init }); return requests.length === 1 ? catalog() : completion(); };
  const result = await generateAiProcedure(input, { apiKey: 'test-secret', model, fetcher });
  assert.equal(result.model, model); assert.equal(result.draft.steps.length, 2);
  assert.deepEqual(requests.map(request => request.url), ['https://api.bizrouter.ai/v1/models', 'https://api.bizrouter.ai/v1/chat/completions']);
  assert.equal(new Headers(requests[1].init?.headers).get('Authorization'), 'Bearer test-secret');
  assert.equal(requests[1].init?.redirect, 'error');
  const body = JSON.parse(String(requests[1].init?.body));
  assert.equal(body.model, model); assert.equal(body.stream, false);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.ok(!JSON.stringify(body).includes('test-secret'));
  assert.ok(!JSON.stringify(body).includes('https://example.com'));
  assert.equal(JSON.parse(body.messages[1].content).references[0].content, references[0].content);
});

test('BizRouter requests exactly the selected source IDs and exact summary count in its schema', async () => {
  const sources: TaskReference[] = [...references, { id: 'ref-extra', type: 'guideline', title: '제출 지침', content: '담당자는 검토된 자료를 제출한다.' }];
  const result = valid();
  result.sourceSummaries.push({ referenceId: 'ref-extra', summary: '검토 완료 후 제출하도록 정합니다.', locator: '본문', quote: sources[1].content });
  let calls = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    if (++calls === 1) return catalog();
    const schema = JSON.parse(String(init?.body)).response_format.json_schema.schema;
    const summaries = schema.properties.sourceSummaries;
    assert.equal(summaries.minItems, 2);
    assert.equal(summaries.maxItems, 2);
    assert.deepEqual(summaries.items.properties.referenceId.enum, ['ref-law', 'ref-extra']);
    return completion(result);
  };
  await generateAiProcedure({ ...input, references: sources }, { apiKey: 'test', model, fetcher });
  assert.equal(calls, 2);
});

test('BizRouter repairs omitted source summaries once without refetching the catalog or extending its deadline', async () => {
  const sources: TaskReference[] = [...references, { id: 'ref-extra', type: 'guideline', title: '제출 지침', content: '담당자는 검토된 자료를 제출한다.' }];
  const repaired = valid();
  repaired.sourceSummaries.push({ referenceId: 'ref-extra', summary: '검토된 자료를 제출합니다.', locator: '본문', quote: sources[1].content });
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (requests.length === 1) return catalog();
    return completion(requests.length === 2 ? valid() : repaired);
  };
  const result = await generateAiProcedure({ ...input, references: sources }, { apiKey: 'test', model, fetcher });
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(request => request.url), ['https://api.bizrouter.ai/v1/models', 'https://api.bizrouter.ai/v1/chat/completions', 'https://api.bizrouter.ai/v1/chat/completions']);
  assert.equal(requests[1].init?.signal, requests[2].init?.signal);
  assert.deepEqual(result.draft.analysis?.sources.map(source => source.referenceId), ['ref-law', 'ref-extra']);
  for (const request of requests.slice(1)) {
    const sent = JSON.parse(String(request.init?.body));
    assert.deepEqual(JSON.parse(sent.messages[1].content).references.map((source: { id: string }) => source.id), ['ref-law', 'ref-extra']);
  }
});

test('BizRouter repairs a truncated completion once and caps unsuccessful repair attempts', async () => {
  let calls = 0;
  const recovered = await generateAiProcedure(input, { apiKey: 'test', model, fetcher: async () => ++calls === 1 ? catalog() : completion(valid(), calls === 2 ? 'length' : 'stop') });
  assert.equal(calls, 3); assert.equal(recovered.draft.steps.length, 2);
  calls = 0;
  const invalid = valid(); invalid.steps[0].evidence.quote = '원문에 없는 인용';
  await assert.rejects(generateAiProcedure(input, { apiKey: 'test', model, fetcher: async () => ++calls === 1 ? catalog() : completion(invalid) }), errorCode('AI_UNVERIFIED_EVIDENCE'));
  assert.equal(calls, 3);
});

test('BizRouter never retries authentication, rate-limit or connection failures from a completion call', async () => {
  for (const [status, code] of [[401, 'AI_AUTH_FAILED'], [429, 'AI_RATE_LIMITED']] as const) {
    let calls = 0;
    await assert.rejects(generateAiProcedure(input, { apiKey: 'test', model, fetcher: async () => ++calls === 1 ? catalog() : new Response('private upstream detail', { status }) }), errorCode(code));
    assert.equal(calls, 2);
  }
  let calls = 0;
  await assert.rejects(generateAiProcedure(input, { apiKey: 'test', model, fetcher: async () => { if (++calls === 1) return catalog(); throw new Error('private connection details'); } }), errorCode('AI_CONNECTION_FAILED'));
  assert.equal(calls, 2);
});

test('BizRouter rejects missing configuration or text before issuing any request', async () => {
  let calls = 0; const fetcher: typeof fetch = async () => { calls++; return catalog(); };
  await assert.rejects(generateAiProcedure(input, { apiKey: '', model, fetcher }), errorCode('AI_NOT_CONFIGURED'));
  await assert.rejects(generateAiProcedure(input, { apiKey: 'test', model: '', fetcher }), errorCode('AI_NOT_CONFIGURED'));
  await assert.rejects(generateAiProcedure({ ...input, references: [] }, { apiKey: 'test', model, fetcher }), errorCode('AI_REFERENCE_REQUIRED'));
  await assert.rejects(generateAiProcedure({ ...input, references: [{ ...references[0], content: 'x'.repeat(60_001) }] }, { apiKey: 'test', model, fetcher }), errorCode('AI_REFERENCE_TOO_LONG'));
  assert.equal(calls, 0);
});

test('BizRouter checks selected model capabilities before sending source material', async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; return Response.json({ models: [{ id: model, response_format_modes: ['json_object'] }] }); };
  await assert.rejects(generateAiProcedure(input, { apiKey: 'test', model, fetcher }), errorCode('AI_MODEL_UNAVAILABLE'));
  assert.equal(calls, 1);
});

test('BizRouter accepts a realistic multi-megabyte model catalog before generating a procedure', async () => {
  const urls: string[] = [];
  const fetcher: typeof fetch = async url => {
    urls.push(String(url));
    if (urls.length === 1) return Response.json({ models: [{ id: model, response_format_modes: ['json_schema'], description: 'x'.repeat(3_400_000) }] });
    return completion();
  };
  const result = await generateAiProcedure(input, { apiKey: 'test', model, fetcher });
  assert.equal(result.draft.steps.length, 2);
  assert.deepEqual(urls, ['https://api.bizrouter.ai/v1/models', 'https://api.bizrouter.ai/v1/chat/completions']);
});

test('BizRouter bounds catalog and generated response separately and cancels oversized streams', async () => {
  for (const [kind, size, code] of [['catalog', 8 * 1024 * 1024 + 1, 'AI_CATALOG_TOO_LARGE'], ['completion', 1024 * 1024 + 1, 'AI_RESPONSE_TOO_LARGE']] as const) {
    let calls = 0; let cancelled = false;
    const oversized = new Response(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(size)); }, cancel() { cancelled = true; } }));
    const fetcher: typeof fetch = async () => { calls++; return kind === 'completion' && calls === 1 ? catalog() : oversized; };
    await assert.rejects(generateAiProcedure(input, { apiKey: 'test', model, fetcher }), errorCode(code));
    assert.equal(calls, kind === 'catalog' ? 1 : 2);
    assert.equal(cancelled, true);
    assert.equal(oversized.body?.locked, false);
  }
});

test('BizRouter gives safe errors for upstream failure, truncation, invalid JSON and cancellation', async () => {
  for (const [status, code] of [[401, 'AI_AUTH_FAILED'], [429, 'AI_RATE_LIMITED'], [500, 'AI_UPSTREAM_FAILED']] as const) {
    await assert.rejects(generateAiProcedure(input, { apiKey: 'test', model, fetcher: async () => new Response('private-upstream-error', { status }) }), errorCode(code));
  }
  let calls = 0;
  await assert.rejects(generateAiProcedure(input, { apiKey: 'test', model, fetcher: async () => ++calls === 1 ? catalog() : completion(valid(), 'length') }), errorCode('AI_INCOMPLETE_RESPONSE'));
  calls = 0;
  await assert.rejects(generateAiProcedure(input, { apiKey: 'test', model, fetcher: async () => ++calls === 1 ? catalog() : new Response('not JSON') }), errorCode('AI_INVALID_JSON'));
  await assert.rejects(generateAiProcedure(input, { apiKey: 'test', model, signal: AbortSignal.abort(), fetcher: async () => { throw new Error('aborted'); } }), errorCode('AI_TIMEOUT'));
});

test('source fingerprints include content and attachment identity for save-first protection', () => {
  assert.notEqual(procedureReferenceFingerprint(references), procedureReferenceFingerprint([{ ...references[0], content: 'changed' }]));
  assert.notEqual(procedureReferenceFingerprint(references), procedureReferenceFingerprint([{ ...references[0], attachmentId: 'attachment-changed' }]));
});
