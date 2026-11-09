import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { POST as generateProcedure } from '../src/app/api/procedure-generate/route';
import { POST as generateDescription } from '../src/app/api/task-description/route';
import { POST as runIntegrationTest } from '../src/app/api/admin/integrations/route';
import { sessionCookie, signSession } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';
import { procedureOverviewFingerprint, procedureReferenceFingerprint } from '../src/lib/procedure-ai-input';
import { createWorkRegistrationProcessor } from '../src/lib/work-registration-generation';
import type { WorkspaceData } from '../src/lib/types';

const environmentModel = 'mock/environment-model';
const selectedModel = 'mock/workspace-model-a';
const replacementModel = 'mock/workspace-model-b';
const mockKey = 'mock-only-model-selection-key';
const preview = { units: [{ title: '자료 관리', description: '자료를 수집하고 검토합니다.', tasks: [{ title: '자료 검토', description: '수집한 자료를 검토합니다.' }] }] };
const generation = { action: 'generate', description: '자료를 수집하고 검토한다.', documents: [] };
const environmentKeys = ['IEUM_DATA_DIR', 'IEUM_STORE', 'BIZROUTER_API_KEY', 'BIZROUTER_MODEL', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_SESSION_SECRET', 'IEUM_API_RATE_LIMIT_PER_MINUTE'] as const;

async function withWorkspace(run: (context: { state: WorkspaceData; save: () => Promise<void>; file: string }) => Promise<void>) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-model-selection-'));
  const previous = Object.fromEntries(environmentKeys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    for (const key of environmentKeys) delete process.env[key];
    process.env.IEUM_STORE = 'local';
    process.env.IEUM_DATA_DIR = directory;
    process.env.BIZROUTER_API_KEY = mockKey;
    process.env.BIZROUTER_MODEL = environmentModel;
    process.env.IEUM_API_RATE_LIMIT_PER_MINUTE = '100';
    globalThis.fetch = async () => { assert.fail('Every external request must be intercepted by the test'); };
    const state = createSeed(new Date('2026-11-01T04:00:00Z'));
    state.aiSettings = { bizrouterModel: selectedModel, revision: 1 };
    const file = path.join(directory, 'workspace.json');
    const save = () => writeFile(file, JSON.stringify(state, null, 2));
    await save();
    await run({ state, save, file });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of environmentKeys) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ieum-model-selection-'));
    await rm(directory, { recursive: true, force: true });
  }
}

function request(route: string, userId: string, body: unknown) {
  return new NextRequest(`http://127.0.0.1:3000/api/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie: `${sessionCookie}=${signSession(userId)}` },
    body: JSON.stringify(body),
  });
}

interface CompletionBody { model: string; messages: { role: string; content: string }[]; response_format: { type: string; json_schema: { name: string; strict: boolean } } }
function mockTransport(reply: (body: CompletionBody) => unknown, catalogGate?: () => Promise<void>) {
  const sentModels: string[] = [];
  let catalogs = 0;
  globalThis.fetch = async (url, init) => {
    assert.equal(new Headers(init?.headers).get('Authorization'), `Bearer ${mockKey}`);
    if (String(url) === 'https://api.bizrouter.ai/v1/models') {
      catalogs++;
      await catalogGate?.();
      return Response.json({ models: [environmentModel, selectedModel, replacementModel].map(id => ({ id, response_format_modes: ['json_schema'] })) });
    }
    assert.equal(String(url), 'https://api.bizrouter.ai/v1/chat/completions');
    assert.equal(init?.method, 'POST');
    const body: CompletionBody = JSON.parse(String(init?.body));
    assert.equal(body.response_format.type, 'json_schema');
    assert.equal(body.response_format.json_schema.strict, true);
    sentModels.push(body.model);
    return Response.json({ model: body.model, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(reply(body)) } }] });
  };
  return { sentModels, catalogs: () => catalogs };
}

test('procedure generation route sends the workspace model, then uses the environment model after reset', async () => {
  await withWorkspace(async ({ state, save, file }) => {
    const task = state.tasks.find(item => item.id === 'task-data')!;
    task.references = [{ id: 'model-reference', type: 'law', title: '시험용 검토 지침', content: '담당자는 자료를 작성한다. 검토자는 자료를 검토한다.' }];
    await save();
    const transport = mockTransport(body => {
      const sources: { id: string; content: string }[] = JSON.parse(body.messages[1].content).sources;
      return {
        summary: '업무 개요와 시험용 검토 지침에 따른 절차입니다.',
        sourceSummaries: sources.map(source => ({ referenceId: source.id, summary: '자료 작성과 검토 범위를 확인합니다.', locator: '본문', quote: source.content.slice(0, 40) })),
        steps: [{ id: 'review', title: '자료 검토', role: 'reviewer', description: '작성된 자료를 검토합니다.', output: '검토 결과', required: true, dependsOn: [], checklist: ['검토 완료'], evidence: { referenceId: 'reference:model-reference', locator: '본문', quote: '검토자는 자료를 검토한다.' } }],
        warnings: [],
      };
    });
    const body = { taskId: task.id, overviewFingerprint: procedureOverviewFingerprint(task), referenceIds: ['model-reference'], referencesFingerprint: procedureReferenceFingerprint(task.references) };
    for (const expected of [selectedModel, environmentModel]) {
      if (expected === environmentModel) { state.aiSettings = { bizrouterModel: null, revision: 2 }; await save(); }
      const before = await readFile(file, 'utf8');
      const response = await generateProcedure(request('procedure-generate', task.primaryId, body));
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.model, expected);
      assert.equal(result.draft.steps.length, 1);
      assert.equal(await readFile(file, 'utf8'), before, 'generating a preview must not persist workspace changes');
    }
    assert.deepEqual(transport.sentModels, [selectedModel, environmentModel]);
    assert.equal(transport.catalogs(), 2);
  });
});

test('task description route sends the workspace model and preserves the server fallback after reset', async () => {
  await withWorkspace(async ({ state, save }) => {
    const task = state.tasks.find(item => item.id === 'task-data')!;
    const text = '담당자는 자료를 수집하고 검토용 목록을 작성한다.';
    state.attachments.push({ id: 'model-description-file', taskId: task.id, name: '시험용 안내.txt', size: Buffer.byteLength(text), mime: 'text/plain', sha256: 'a'.repeat(64), storageKey: 'unused-local-file.bin', storageProvider: 'local', status: 'quarantined', uploadedBy: task.primaryId, createdAt: '2026-11-01T04:00:00Z' });
    await save();
    const transport = mockTransport(body => {
      const input: { documents: { attachmentId: string; text: string }[] } = JSON.parse(body.messages[1].content);
      return { description: '자료를 수집하고 검토용 목록을 작성하는 업무입니다.', sources: input.documents.map(document => ({ attachmentId: document.attachmentId, summary: '자료 수집과 목록 작성이 필요합니다.', quote: document.text })), warnings: [] };
    });
    for (const expected of [selectedModel, environmentModel]) {
      if (expected === environmentModel) { state.aiSettings = { bizrouterModel: null, revision: 2 }; await save(); }
      const response = await generateDescription(request('task-description', task.primaryId, { action: 'generate', title: task.title, description: task.description, documents: [{ attachmentId: 'model-description-file', text }] }));
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.model, expected);
      assert.equal(result.draft.sources.length, 1);
    }
    assert.deepEqual(transport.sentModels, [selectedModel, environmentModel]);
    assert.equal(transport.catalogs(), 2);
  });
});

test('work registration keeps its captured model during a change, uses the new model next, and falls back after reset', async () => {
  await withWorkspace(async ({ state }) => {
    let announce!: () => void;
    let release!: () => void;
    const entered = new Promise<void>(resolve => { announce = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let firstCatalog = true;
    const transport = mockTransport(() => preview, async () => {
      if (!firstCatalog) return;
      firstCatalog = false;
      announce();
      await gate;
    });
    const processRegistration = createWorkRegistrationProcessor({ readState: async () => state, checkRate: () => undefined, checkSharedRate: () => undefined });
    const first = processRegistration('u-jiho', generation);
    await entered;
    state.aiSettings = { bizrouterModel: replacementModel, revision: 2 };
    release();
    const firstResult = await first;
    assert.ok('preview' in firstResult);
    assert.equal(firstResult.model, selectedModel, 'the first request must retain its model even before completion starts');
    const secondResult = await processRegistration('u-jiho', generation);
    assert.ok('preview' in secondResult);
    assert.equal(secondResult.model, replacementModel);
    delete process.env.BIZROUTER_MODEL;
    const withoutEnvironment = await processRegistration('u-jiho', generation);
    assert.ok('preview' in withoutEnvironment);
    assert.equal(withoutEnvironment.model, replacementModel, 'a saved model must work without an environment model');
    process.env.BIZROUTER_MODEL = environmentModel;
    state.aiSettings = { bizrouterModel: null, revision: 3 };
    const fallbackResult = await processRegistration('u-jiho', generation);
    assert.ok('preview' in fallbackResult);
    assert.equal(fallbackResult.model, environmentModel);
    assert.deepEqual(transport.sentModels, [selectedModel, replacementModel, replacementModel, environmentModel]);
    assert.equal(transport.catalogs(), 4);
  });
});

test('web administrator AI diagnostic uses the workspace model and restored environment model', async () => {
  await withWorkspace(async ({ state, save }) => {
    const transport = mockTransport(body => {
      assert.equal(body.response_format.json_schema.name, 'connection_test');
      assert.equal(body.messages[1].content, '연결을 확인해 주세요.');
      return { connected: true, message: '온이음 연결 확인' };
    });
    for (const expected of [selectedModel, environmentModel]) {
      if (expected === environmentModel) { state.aiSettings = { bizrouterModel: null, revision: 2 }; await save(); }
      const response = await runIntegrationTest(request('admin/integrations', 'u-admin', { action: 'ai' }));
      const result = await response.json();
      assert.equal(response.status, 200, JSON.stringify(result));
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.ok(result.checks.some((check: { detail?: string }) => check.detail === `시험 모델: ${expected}`));
    }
    assert.deepEqual(transport.sentModels, [selectedModel, environmentModel]);
    assert.equal(transport.catalogs(), 2);
  });
});
