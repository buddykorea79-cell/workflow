import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventListeners } from 'node:events';
import { NextRequest } from 'next/server';
import { aiAbortError, createAiDeadline, withAiSignal } from '../src/lib/ai-generation-operation';
import { AI_GENERATION_TIMEOUT_MS, AI_GENERATION_CLIENT_TIMEOUT_MS, AI_GENERATION_ROUTE_MAX_DURATION_SECONDS } from '../src/lib/ai-generation-policy';
import { AI_PROCEDURE_TIMEOUT_MS } from '../src/lib/procedure-ai-input';
import { generateAiProcedure, generateAiTaskDescription, type BizRouterOptions } from '../src/lib/bizrouter';
import { generateWorkRegistrationPreview } from '../src/lib/work-registration-generation';
import { POST as workRegistration, maxDuration as registrationDuration } from '../src/app/api/work-registration/route';
import { POST as taskDescription, maxDuration as descriptionDuration } from '../src/app/api/task-description/route';
import { POST as procedureGenerate, maxDuration as procedureDuration } from '../src/app/api/procedure-generate/route';
import { DomainError } from '../src/lib/domain-error';
import { sessionCookie, signSession } from '../src/lib/auth';

const isCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;
const nextTurn = () => new Promise<void>(resolve => setImmediate(resolve));
const catalog = () => Response.json({ models: [{ id: 'mock', response_format_modes: ['json_schema'] }] });
const document = { attachmentId: 'source', name: '점검.txt', text: '담당자가 자료를 점검한다.' };
const generators: [string, (options: BizRouterOptions) => Promise<unknown>][] = [
  ['registration', options => generateWorkRegistrationPreview({ description: document.text, documents: [] }, options)],
  ['description', options => generateAiTaskDescription({ title: '점검', description: '', documents: [document] }, options)],
  ['procedure', options => generateAiProcedure({ title: '점검', description: document.text, references: [], reviewRequired: false }, options)],
];

test('the actual default deadline is 180 seconds, below client and static route budgets', t => {
  assert.equal(AI_GENERATION_TIMEOUT_MS, 180_000);
  assert.equal(AI_PROCEDURE_TIMEOUT_MS, AI_GENERATION_TIMEOUT_MS);
  assert.equal(AI_GENERATION_CLIENT_TIMEOUT_MS, 190_000);
  assert.equal(AI_GENERATION_ROUTE_MAX_DURATION_SECONDS, 200);
  assert.deepEqual([registrationDuration, descriptionDuration, procedureDuration], [200, 200, 200]);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const deadline = createAiDeadline();
  t.mock.timers.tick(179_999);
  assert.equal(deadline.signal.aborted, false);
  t.mock.timers.tick(1);
  assert.equal(deadline.signal.aborted, true);
  assert.equal(aiAbortError(deadline.signal).status, 504);
  assert.equal(aiAbortError(deadline.signal).code, 'AI_TIMEOUT');
  deadline.dispose();
});

test('cancelled operations never start, ongoing operations are observed and listeners are released', async () => {
  let calls = 0;
  await assert.rejects(withAiSignal(async () => { calls++; }, AbortSignal.abort()), isCode('AI_CANCELLED'));
  assert.equal(calls, 0);
  const controller = new AbortController();
  let fail!: (reason: Error) => void;
  const waiting = withAiSignal(() => new Promise<void>((_, reject) => { calls++; fail = reject; }), controller.signal);
  controller.abort();
  await assert.rejects(waiting, error => isCode('AI_CANCELLED')(error) && (error as DomainError).status === 499);
  fail(new Error('late parser failure'));
  await nextTurn();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.equal(calls, 1);
});

test('all AI routes interrupt a stalled request body and cancel its reader at the same 180 second deadline', async t => {
  const keys = ['VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const key of keys) delete process.env[key];
    for (const [name, route] of [['work-registration', workRegistration], ['task-description', taskDescription], ['procedure-generate', procedureGenerate]] as const) {
      let cancelled = 0;
      const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel() { cancelled++; } });
      const request = new NextRequest(`http://127.0.0.1:3000/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie: `${sessionCookie}=${signSession('u-jiho')}` }, body, duplex: 'half' } as ConstructorParameters<typeof NextRequest>[1]);
      const pending = route(request);
      await nextTurn();
      t.mock.timers.tick(AI_GENERATION_TIMEOUT_MS);
      const response = await pending;
      assert.equal(response.status, 504, name);
      assert.equal((await response.json()).code, 'AI_TIMEOUT', name);
      assert.equal(cancelled, 1, name);
      assert.equal(body.locked, false, name);
    }
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});

test('all AI generators cancel stalled catalog and completion streams without a retry', async () => {
  for (const [name, generate] of generators) {
    for (const stage of ['catalog', 'completion']) {
      const controller = new AbortController();
      let calls = 0; let cancelled = 0; let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const fetcher: typeof fetch = async url => {
        calls++;
        if (stage === 'completion' && String(url).endsWith('/models')) return catalog();
        return new Response(new ReadableStream<Uint8Array>({ start() { started(); }, cancel() { cancelled++; } }));
      };
      const pending = generate({ apiKey: 'mock', model: 'mock', fetcher, signal: controller.signal });
      await ready;
      controller.abort();
      await assert.rejects(pending, isCode('AI_CANCELLED'), `${name}/${stage}`);
      assert.equal(calls, stage === 'catalog' ? 1 : 2, `${name}/${stage}`);
      assert.equal(cancelled, 1, `${name}/${stage}`);
    }
  }
});

test('one description repair shares the original deadline instead of receiving another 180 seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let completions = 0; let secondStarted!: () => void;
  const ready = new Promise<void>(resolve => { secondStarted = resolve; });
  const signals: AbortSignal[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    if (String(url).endsWith('/models')) return catalog();
    completions++;
    const signal = init!.signal!;
    signals.push(signal);
    if (completions === 1) {
      t.mock.timers.tick(70_000);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ description: '점검 업무', sources: [], warnings: [] }) } }] });
    }
    secondStarted();
    return new Promise<Response>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  const pending = generateAiTaskDescription({ title: '점검', description: '', documents: [document] }, { apiKey: 'mock', model: 'mock', fetcher });
  await ready;
  assert.equal(signals[0], signals[1]);
  t.mock.timers.tick(109_999);
  assert.equal(signals[1].aborted, false);
  t.mock.timers.tick(1);
  await assert.rejects(pending, isCode('AI_TIMEOUT'));
  assert.equal(completions, 2);
});
