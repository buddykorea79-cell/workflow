import test from 'node:test';
import assert from 'node:assert/strict';
import { generateAiProcedure, parseAiProcedure } from '../src/lib/bizrouter';
import { procedureReferenceFingerprint } from '../src/lib/procedure-ai-input';
import { DomainError } from '../src/lib/domain';
import type { TaskReference } from '../src/lib/types';

const references: TaskReference[] = [{ id: 'ref-law', type: 'law', title: '점검 지침', content: '1. 담당자는 자료를 작성한다.\n2. 검토자는 자료를 검토한다.', url: 'https://example.com/private-source' }];
const input = { title: '자료 점검', description: '점검 자료 준비와 검토', references };
const model = 'provider/allowed-model';
const valid = () => ({ steps: [
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
  assert.ok(draft.steps.every(step => step.done === false && !step.startDate && !step.dueDate));
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
