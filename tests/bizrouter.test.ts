import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAiProcedure, parseAiProcedure, procedureAiSources, type ProcedureAiInput } from '../src/lib/bizrouter';
import { procedureOverviewFingerprint, procedureReferenceFingerprint } from '../src/lib/procedure-ai-input';
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
const rawCompletion = (content: unknown, finish_reason = 'stop') => Response.json({ model, choices: [{ message: { content: JSON.stringify(content) }, finish_reason }] });
const completion = (content = valid(), finish_reason = 'stop') => {
  const mapped = structuredClone(content);
  mapped.sourceSummaries = [{ referenceId: 'overview:task', summary: '자료 준비와 검토를 수행하는 업무입니다.', locator: '업무 설명', quote: input.description }, ...mapped.sourceSummaries.map(source => ({ ...source, referenceId: `reference:${source.referenceId}` }))];
  mapped.steps = mapped.steps.map(step => ({ ...step, evidence: { ...step.evidence, referenceId: `reference:${step.evidence.referenceId}` } }));
  return rawCompletion(mapped, finish_reason);
};

test('AI procedure uses validated evidence and fresh dependency IDs, preserving saved references', () => {
  const draft = parseAiProcedure(valid(), references, 'generated');
  assert.equal(draft.steps[0].id, 'generated-1');
  assert.deepEqual(draft.steps[1].dependsOn, ['generated-1']);
  assert.equal(draft.steps[0].description, '담당자가 점검 자료를 작성합니다.\n결과: 작성 자료\n확인할 내용: 자료 작성 여부');
  assert.ok(draft.steps.every(step => step.output === '' && step.checklist.length === 0));
  assert.equal(draft.evidence['generated-1'].sourceTitle, '점검 지침');
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
  const draft = parseAiProcedure(result, sources, 'multi', { hasSupport: true });
  assert.deepEqual(draft.analysis?.sources.map(source => [source.referenceId, source.sourceTitle]), [['ref-law', '점검 지침'], ['ref-directive', '보완 지시']]);
  assert.equal(draft.analysis?.summary, result.summary);
  assert.deepEqual(draft.steps[2].dependsOn, ['multi-2']);
  assert.equal(draft.evidence['multi-2'].excerpt, sources[1].content);
  assert.equal(draft.steps[1].role, 'support');
  assert.equal(parseAiProcedure(result, sources, 'solo').steps[1].role, 'primary');
  assert.deepEqual(sources, sourceBefore);
});

test('AI requests simple methods with no hidden checks and only assigned performer roles', async () => {
  for (const hasSupport of [false, true]) {
    let calls = 0;
    const result = valid();
    result.steps[0].role = 'support';
    result.steps.forEach(step => { step.output = ''; step.checklist = []; });
    const generated = await generateAiProcedure({ ...input, hasSupport }, { apiKey: 'test', model, fetcher: async (_url, init) => {
      if (++calls === 1) return catalog();
      const body = JSON.parse(String(init?.body));
      const properties = body.response_format.json_schema.schema.properties.steps.items.properties;
      assert.deepEqual(properties.role.enum, hasSupport ? ['primary', 'support', 'reviewer'] : ['primary', 'reviewer']);
      assert.equal(properties.output.const, '');
      assert.equal(properties.checklist.maxItems, 0);
      assert.equal(JSON.parse(body.messages[1].content).task.hasSupport, hasSupport);
      return completion(result);
    } });
    assert.equal(generated.draft.steps[0].role, hasSupport ? 'support' : 'primary');
    assert.equal(generated.draft.steps[0].description, result.steps[0].description);
    assert.ok(generated.draft.steps.every(step => step.output === '' && step.checklist.length === 0));
  }
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
  const sent = JSON.parse(body.messages[1].content);
  assert.deepEqual(sent.sources.map((source: { id: string; priority: string }) => [source.id, source.priority]), [['overview:task', 'primary'], ['reference:ref-law', 'supporting']]);
  assert.equal(sent.sources[1].content, references[0].content);
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
    assert.equal(summaries.minItems, 3);
    assert.equal(summaries.maxItems, 3);
    assert.deepEqual(summaries.items.properties.referenceId.enum, ['overview:task', 'reference:ref-law', 'reference:ref-extra']);
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
  assert.deepEqual(result.draft.analysis?.sources.map(source => source.referenceId), ['overview:task', 'reference:ref-law', 'reference:ref-extra']);
  for (const request of requests.slice(1)) {
    const sent = JSON.parse(String(request.init?.body));
    assert.deepEqual(JSON.parse(sent.messages[1].content).sources.map((source: { id: string }) => source.id), ['overview:task', 'reference:ref-law', 'reference:ref-extra']);
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
  await assert.rejects(generateAiProcedure({ ...input, description: '', references: [] }, { apiKey: 'test', model, fetcher }), errorCode('AI_SOURCE_REQUIRED'));
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

test('overview and task files are primary sources while references are separate supporting evidence', async () => {
  const procedure: ProcedureAiInput = { ...input, completionCriteria: '검토를 완료한 자료를 제출한다.', documents: [{ attachmentId: 'file-1', name: '업무처리 안내.txt', text: '담당자는 자료를 작성한다. 검토자는 자료를 검토한다.' }], references: [{ ...references[0], id: 'overview:task' }] };
  const before = structuredClone(procedure);
  const sources = procedureAiSources(procedure);
  assert.deepEqual(sources.map(source => [source.id, source.sourceKind, source.priority]), [
    ['overview:task', 'overview', 'primary'], ['document:file-1', 'attachment', 'primary'], ['reference:overview:task', 'reference', 'supporting'],
  ]);
  assert.match(sources[0].content, /완료 기준:\n검토를 완료한 자료를 제출한다\./);
  assert.equal(sources[1].title, '업무 첨부 · 업무처리 안내.txt');
  assert.deepEqual(procedure, before);
  const result = valid();
  result.sourceSummaries = sources.map(source => ({ referenceId: source.id, summary: '이 자료가 안내하는 업무 범위를 검토했습니다.', locator: '본문', quote: source.content }));
  result.steps.forEach(step => { step.evidence.referenceId = 'document:file-1'; });
  let calls = 0;
  const generated = await generateAiProcedure(procedure, { apiKey: 'test', model, fetcher: async (_url, init) => {
    if (++calls === 1) return catalog();
    const body = JSON.parse(String(init?.body));
    assert.match(body.messages[0].content, /1순위 업무 개요/);
    assert.match(body.messages[0].content, /법령상 의무보다 업무 설명을 우선하라는 뜻이 아닙니다/);
    assert.deepEqual(JSON.parse(body.messages[1].content).sources, sources);
    assert.ok(!JSON.stringify(body).includes('private-source'));
    return rawCompletion(result);
  } });
  assert.equal(calls, 2);
  assert.equal(generated.draft.analysis?.sources.length, 3);
  assert.equal(generated.draft.evidence[generated.draft.steps[0].id].sourceTitle, '업무 첨부 · 업무처리 안내.txt');
});

test('a saved overview can generate procedures without requiring supporting references', async () => {
  const procedure: ProcedureAiInput = { title: '자료 점검', description: references[0].content, completionCriteria: '검토 결과 작성', references: [] };
  const result = valid();
  result.sourceSummaries = [{ referenceId: 'overview:task', summary: '개요에서 자료 작성과 검토를 확인합니다.', locator: '업무 설명', quote: '담당자는 자료를 작성한다.' }];
  result.steps.forEach(step => { step.evidence.referenceId = 'overview:task'; });
  let calls = 0;
  const generated = await generateAiProcedure(procedure, { apiKey: 'test', model, fetcher: async (_url, init) => {
    if (++calls === 1) return catalog();
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.json_schema.schema.properties.sourceSummaries.minItems, 1);
    assert.equal(JSON.parse(body.messages[1].content).sources[0].id, 'overview:task');
    return rawCompletion(result);
  } });
  assert.equal(generated.draft.steps.length, 2);
  assert.equal(generated.draft.analysis?.sources[0].sourceTitle, '업무 개요');
  assert.deepEqual(generated.draft.references, []);
});

test('task files can supply the procedure when the overview description and supporting references are absent', async () => {
  const procedure: ProcedureAiInput = { title: '자료 점검', description: '', references: [], documents: [{ attachmentId: 'file-only', name: '작성검토.txt', text: references[0].content }] };
  const result = valid();
  result.sourceSummaries = [{ referenceId: 'overview:task', summary: '자료 점검 업무이며 상세 내용은 첨부파일을 확인합니다.', locator: '업무명', quote: procedure.title }, { referenceId: 'document:file-only', summary: '자료 작성과 검토를 안내합니다.', locator: '본문', quote: '담당자는 자료를 작성한다.' }];
  result.steps.forEach(step => { step.evidence.referenceId = 'document:file-only'; });
  let calls = 0;
  const generated = await generateAiProcedure(procedure, { apiKey: 'test', model, fetcher: async () => ++calls === 1 ? catalog() : rawCompletion(result) });
  assert.equal(generated.draft.steps.length, 2);
  assert.equal(generated.draft.analysis?.sources[1].sourceTitle, '업무 첨부 · 작성검토.txt');
  result.steps[0].evidence.quote = '파일에 없는 법적 의무'; calls = 0;
  await assert.rejects(generateAiProcedure(procedure, { apiKey: 'test', model, fetcher: async () => ++calls === 1 ? catalog() : rawCompletion(result) }), errorCode('AI_UNVERIFIED_EVIDENCE'));
  assert.equal(calls, 3);
});

test('combined overview, task files and references share the input budget and retain every reviewed source', () => {
  const procedure: ProcedureAiInput = { title: '자료 점검', description: '담당자는 자료를 작성한다.', references: Array.from({ length: 20 }, (_, index) => ({ ...references[0], id: `ref-${index}` })), documents: Array.from({ length: 10 }, (_, index) => ({ attachmentId: `file-${index}`, name: `첨부${index}.txt`, text: references[0].content })) };
  const sources = procedureAiSources(procedure);
  assert.equal(sources.length, 31);
  const result = valid();
  result.sourceSummaries = sources.map(source => ({ referenceId: source.id, summary: '업무 내용을 검토했습니다.', locator: '본문', quote: source.content }));
  result.steps.forEach(step => { step.evidence.referenceId = 'document:file-0'; });
  assert.equal(parseAiProcedure(result, sources).analysis?.sources.length, 31);
  result.sourceSummaries = result.sourceSummaries.filter(source => source.referenceId !== 'document:file-9');
  assert.throws(() => parseAiProcedure(result, sources), errorCode('AI_INCOMPLETE_SUMMARY'));
  assert.throws(() => procedureAiSources({ ...procedure, description: 'x'.repeat(30_000), documents: [{ attachmentId: 'file-large', name: 'large.txt', text: 'y'.repeat(30_000) }] }), errorCode('AI_REFERENCE_TOO_LONG'));
  assert.throws(() => procedureAiSources({ ...procedure, documents: [...procedure.documents!, procedure.documents![0]] }), errorCode('AI_DOCUMENT_REQUIRED'));
  assert.throws(() => procedureAiSources({ ...procedure, documents: [{ attachmentId: 'empty', name: 'empty.txt', text: ' ' }] }), errorCode('AI_DOCUMENT_REQUIRED'));
  assert.throws(() => procedureAiSources({ ...procedure, references: [references[0], references[0]] }), errorCode('AI_REFERENCE_REQUIRED'));
});

test('overview save-first fingerprint tracks every primary input field and linked document', () => {
  const overview = { title: '자료 점검', description: '자료 작성 및 검토', completionCriteria: '검토 완료', descriptionAttachmentIds: ['file-a', 'file-b'] };
  for (const changed of [{ title: '다른 업무' }, { description: '변경된 내용' }, { completionCriteria: '다른 완료 조건' }, { descriptionAttachmentIds: ['file-c'] }]) {
    assert.notEqual(procedureOverviewFingerprint(overview), procedureOverviewFingerprint({ ...overview, ...changed }));
  }
  assert.equal(procedureOverviewFingerprint({ title: overview.title, description: overview.description }), procedureOverviewFingerprint({ title: overview.title, description: overview.description, completionCriteria: '', descriptionAttachmentIds: [] }));
});

test('maximum-length saved reference and attachment IDs remain valid after source namespacing', () => {
  const savedId = 'r'.repeat(150); const attachmentId = 'f'.repeat(150);
  const sources = procedureAiSources({ ...input, references: [{ ...references[0], id: savedId }], documents: [{ attachmentId, name: '첨부.txt', text: references[0].content }] });
  const result = valid();
  result.sourceSummaries = sources.map(source => ({ referenceId: source.id, summary: '자료 작성과 검토에 필요한 내용입니다.', locator: '본문', quote: source.content }));
  result.steps[0].evidence.referenceId = `document:${attachmentId}`;
  result.steps[1].evidence.referenceId = `reference:${savedId}`;
  const draft = parseAiProcedure(result, sources);
  assert.equal(draft.steps.length, 2);
  assert.deepEqual(draft.analysis?.sources.map(source => source.referenceId.length), [13, 159, 160]);
});
