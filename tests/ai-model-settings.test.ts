import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET, PUT } from '../src/app/api/admin/integrations/ai-model/route';
import { GET as catalogGet } from '../src/app/api/admin/integrations/ai-models/route';
import { resolveAiModel, resolveAiModelSetting } from '../src/lib/ai-model-settings';
import { aiModelSettingForAdmin, applyAiModelSettingChange, inspectAiModelSettingChange } from '../src/lib/admin-ai-model-settings';
import { DomainError } from '../src/lib/domain-error';
import { createSeed } from '../src/lib/seed';
import { sessionCookie, signSession } from '../src/lib/auth';
import type { WorkspaceData } from '../src/lib/types';

const firstModel = 'provider/first-model';
const secondModel = 'provider/second-model';
const errorCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;

test('old workspaces resolve the environment fallback without modifying their document', () => {
  const state = createSeed(); const before = JSON.stringify(state);
  assert.equal(resolveAiModel(state, {}), undefined);
  assert.deepEqual(resolveAiModelSetting(state, { BIZROUTER_MODEL: ` ${firstModel} ` }), { modelId: null, effectiveModel: firstModel, environmentModel: firstModel, source: 'environment', revision: 0 });
  assert.equal(JSON.stringify(state), before);
  assert.equal(resolveAiModel(state, { BIZROUTER_MODEL: '  ' }), undefined);
});

test('saved selection overrides the environment and reset preserves its own revision', () => {
  const state = createSeed(); state.aiSettings = { bizrouterModel: secondModel, revision: 5 };
  assert.equal(resolveAiModel(state, { BIZROUTER_MODEL: firstModel }), secondModel);
  assert.deepEqual(resolveAiModelSetting(state, {}), { modelId: secondModel, effectiveModel: secondModel, environmentModel: null, source: 'workspace', revision: 5 });
  state.aiSettings = { bizrouterModel: null, revision: 6 };
  assert.deepEqual(resolveAiModelSetting(state, {}), { modelId: null, effectiveModel: null, environmentModel: null, source: 'unset', revision: 6 });
  assert.equal(resolveAiModel(state, { BIZROUTER_MODEL: firstModel }), firstModel);
});

test('model changes have independent CAS, idempotent retries, an audit and a persistent reset version', () => {
  const state = createSeed(); const initialRevision = state.revision; const auditCount = state.audit.length;
  const input = { modelId: firstModel, expectedRevision: 0, requestId: 'one' };
  const saved = applyAiModelSettingChange(state, 'u-admin', input);
  assert.equal(saved.modelId, firstModel); assert.equal(saved.revision, 1); assert.equal(state.revision, initialRevision + 1);
  assert.equal(state.audit.length, auditCount + 1); assert.equal(state.audit.at(-1)?.action, 'ai-model.set');
  const afterSave = JSON.stringify(state);
  applyAiModelSettingChange(state, 'u-admin', input); assert.equal(JSON.stringify(state), afterSave);
  assert.throws(() => applyAiModelSettingChange(state, 'u-admin', { ...input, modelId: secondModel }), errorCode('IDEMPOTENCY_CONFLICT'));
  assert.throws(() => applyAiModelSettingChange(state, 'u-admin', { ...input, requestId: 'stale' }), errorCode('AI_MODEL_SETTING_CONFLICT'));
  state.revision += 10; // Unrelated user work must not invalidate a model setting form.
  const reset = applyAiModelSettingChange(state, 'u-admin', { modelId: null, expectedRevision: 1, requestId: 'reset' });
  assert.equal(reset.revision, 2); assert.deepEqual(state.aiSettings, { bizrouterModel: null, revision: 2 });
  assert.throws(() => inspectAiModelSettingChange(state, 'u-admin', { modelId: secondModel, expectedRevision: 0, requestId: 'old-first-form' }), errorCode('AI_MODEL_SETTING_CONFLICT'));
});

test('both new mutations and idempotent retries recheck the active administrator', () => {
  const state = createSeed(); const input = { modelId: firstModel, expectedRevision: 0, requestId: 'one' };
  for (const user of state.users.filter(user => user.role !== 'admin')) {
    assert.throws(() => aiModelSettingForAdmin(state, user.id), errorCode('ADMIN_REQUIRED'));
    assert.throws(() => applyAiModelSettingChange(state, user.id, input), errorCode('ADMIN_REQUIRED'));
  }
  applyAiModelSettingChange(state, 'u-admin', input);
  state.users.find(user => user.id === 'u-admin')!.active = false;
  assert.throws(() => applyAiModelSettingChange(state, 'u-admin', input), errorCode('ACCOUNT_INACTIVE'));
});

test('model request IDs cannot collide with normal command idempotency records', () => {
  const state = createSeed(); state.processedRequests.push({ id: 'one', actorId: 'u-admin', fingerprint: 'unrelated-command' });
  applyAiModelSettingChange(state, 'u-admin', { modelId: firstModel, expectedRevision: 0, requestId: 'one' });
  assert.equal(state.processedRequests.at(-1)?.id, 'ai-model:one');
});

test('administrator model API preserves authorization, storage and catalog-only validation boundaries', async context => {
  const baseDirectory = path.resolve('.qa/test-tmp'); await mkdir(baseDirectory, { recursive: true });
  const directory = await mkdtemp(path.join(baseDirectory, 'ai-model-settings-'));
  const stateFile = path.join(directory, 'workspace.json');
  const keys = ['IEUM_STORE', 'IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE', 'IEUM_SESSION_SECRET', 'BIZROUTER_API_KEY', 'BIZROUTER_MODEL'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let provider: () => Promise<Response> = async () => Response.json({ models: [{ id: firstModel, response_format_modes: ['json_schema'] }, { id: secondModel, response_format_modes: ['json_schema'] }, { id: 'provider/text-only', response_format_modes: ['text'] }] });
  const reset = async (state = createSeed()) => { await writeFile(stateFile, JSON.stringify(state)); calls = 0; };
  const stored = async () => JSON.parse(await readFile(stateFile, 'utf8')) as WorkspaceData;
  const request = (userId: string | null = 'u-admin', body?: unknown, origin = 'http://127.0.0.1:3000', signal?: AbortSignal) => new NextRequest('http://127.0.0.1:3000/api/admin/integrations/ai-model', {
    method: body === undefined ? 'GET' : 'PUT', signal,
    headers: { host: '127.0.0.1:3000', origin, ...(userId ? { cookie: `${sessionCookie}=${signSession(userId)}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, { IEUM_STORE: 'local', IEUM_DATA_DIR: directory, IEUM_SESSION_SECRET: 'isolated-model-api-session-secret', BIZROUTER_API_KEY: 'test-only-private-key', BIZROUTER_MODEL: firstModel });
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://api.bizrouter.ai/v1/models', 'A model change must never start a paid completion.');
      assert.equal(init?.cache, 'no-store'); assert.equal(init?.redirect, 'error'); calls++;
      return provider();
    };

    await context.test('GET reads the committed settings without joining a writer or fetching the catalog', async () => {
      await reset(); const bytes = await readFile(stateFile, 'utf8'); const lock = path.join(directory, '.workspace.lock');
      await writeFile(lock, 'fixture-writer');
      try {
        const response = await GET(request()); assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store/);
        const body = await response.json(); assert.equal(body.source, 'environment'); assert.equal(body.environmentModel, firstModel); assert.equal(body.revision, 0);
        assert.equal(JSON.stringify(body).includes('test-only-private-key'), false); assert.equal(calls, 0);
        assert.equal(await readFile(stateFile, 'utf8'), bytes); assert.equal(await readFile(lock, 'utf8'), 'fixture-writer');
      } finally { await rm(lock); }
    });

    await context.test('unauthenticated, every non-admin role and foreign-origin writes are rejected before catalog or payload validation', async () => {
      await reset(); const bytes = await readFile(stateFile, 'utf8');
      assert.equal((await GET(request(null))).status, 401); assert.equal((await catalogGet(request(null))).status, 401);
      for (const user of createSeed().users.filter(user => user.role !== 'admin')) {
        assert.equal((await GET(request(user.id))).status, 403);
        assert.equal((await catalogGet(request(user.id))).status, 403);
        assert.equal((await PUT(request(user.id, { oversized: 'x'.repeat(3000) }))).status, 403);
      }
      assert.equal((await PUT(request('u-admin', {}, 'https://foreign.example'))).status, 403);
      const crossSite = request('u-admin', {}); crossSite.headers.set('sec-fetch-site', 'cross-site'); assert.equal((await PUT(crossSite)).status, 403);
      assert.equal(calls, 0); assert.equal(await readFile(stateFile, 'utf8'), bytes);
    });

    await context.test('catalog projects model capabilities without credentials and without storing anything', async () => {
      await reset(); const bytes = await readFile(stateFile, 'utf8'); const response = await catalogGet(request());
      assert.equal(response.status, 200); const body = await response.json();
      assert.equal(body.models.find((model: { id: string }) => model.id === firstModel).structuredOutput, true);
      assert.equal(body.models.find((model: { id: string }) => model.id === 'provider/text-only').structuredOutput, false);
      assert.equal(JSON.stringify(body).includes('test-only-private-key'), false); assert.equal(calls, 1); assert.equal(await readFile(stateFile, 'utf8'), bytes);
    });

    await context.test('saving an accessible structured model persists only the setting and audit, with replay and CAS', async () => {
      await reset(); const before = await stored(); const input = { modelId: secondModel, expectedRevision: 0, requestId: 'save' };
      let response = await PUT(request('u-admin', input)); assert.equal(response.status, 200); const body = await response.json();
      assert.deepEqual(body, { modelId: secondModel, effectiveModel: secondModel, environmentModel: firstModel, source: 'workspace', revision: 1 });
      const after = await stored(); assert.deepEqual(after.aiSettings, { bizrouterModel: secondModel, revision: 1 }); assert.deepEqual(after.tasks, before.tasks); assert.deepEqual(after.units, before.units); assert.deepEqual(after.users, before.users);
      assert.equal(after.revision, before.revision + 1); assert.equal(after.audit.length, before.audit.length + 1);
      assert.equal(JSON.stringify(after).includes('test-only-private-key'), false);
      const bytes = await readFile(stateFile, 'utf8'); const afterCalls = calls;
      response = await PUT(request('u-admin', input)); assert.equal(response.status, 200); assert.equal(calls, afterCalls); assert.equal(await readFile(stateFile, 'utf8'), bytes);
      response = await PUT(request('u-admin', { ...input, modelId: firstModel })); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'IDEMPOTENCY_CONFLICT');
      response = await PUT(request('u-admin', { ...input, requestId: 'stale' })); assert.equal(response.status, 409); assert.equal((await response.json()).code, 'AI_MODEL_SETTING_CONFLICT');
      assert.equal(await readFile(stateFile, 'utf8'), bytes);
    });

    await context.test('unsupported, unknown and malformed choices leave the workspace unchanged', async () => {
      await reset(); const bytes = await readFile(stateFile, 'utf8');
      for (const modelId of ['provider/text-only', 'provider/not-listed']) {
        const response = await PUT(request('u-admin', { modelId, expectedRevision: 0, requestId: modelId }));
        assert.equal(response.status, 503); assert.equal((await response.json()).code, 'AI_MODEL_UNAVAILABLE');
      }
      for (const body of [{ modelId: '', expectedRevision: 0, requestId: 'empty' }, { modelId: firstModel, expectedRevision: -1, requestId: 'negative' }, { modelId: firstModel, expectedRevision: 0, requestId: 'unknown-field', apiKey: 'must-not-save' }]) {
        assert.equal((await PUT(request('u-admin', body))).status, 422);
      }
      assert.equal((await PUT(request('u-admin', { huge: 'x'.repeat(3000) }))).status, 413);
      assert.equal(await readFile(stateFile, 'utf8'), bytes);
    });

    await context.test('catalog outage does not prevent reading settings, resetting or replaying an already successful change', async () => {
      await reset(); const input = { modelId: secondModel, expectedRevision: 0, requestId: 'before-outage' };
      assert.equal((await PUT(request('u-admin', input))).status, 200);
      const normal = provider; provider = async () => Response.json({ error: 'private-provider-message' }, { status: 502 });
      try {
        assert.equal((await GET(request())).status, 200);
        let response = await catalogGet(request()); assert.equal(response.status, 502); assert.equal((await response.text()).includes('private-provider-message'), false);
        assert.equal((await PUT(request('u-admin', input))).status, 200);
        const beforeCalls = calls;
        response = await PUT(request('u-admin', { modelId: null, expectedRevision: 1, requestId: 'restore' }));
        assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.source, 'environment'); assert.equal(body.revision, 2); assert.equal(calls, beforeCalls);
        delete process.env.BIZROUTER_MODEL;
        response = await PUT(request('u-admin', { modelId: null, expectedRevision: 2, requestId: 'restore-unset' }));
        assert.equal(response.status, 200); assert.equal((await response.json()).source, 'unset'); assert.equal(calls, beforeCalls);
      } finally { provider = normal; process.env.BIZROUTER_MODEL = firstModel; }
    });

    await context.test('concurrent administrators get one successful update and one setting conflict', async () => {
      await reset(); const responses = await Promise.all([
        PUT(request('u-admin', { modelId: firstModel, expectedRevision: 0, requestId: 'parallel-a' })),
        PUT(request('u-admin', { modelId: secondModel, expectedRevision: 0, requestId: 'parallel-b' })),
      ]);
      assert.deepEqual(responses.map(response => response.status).sort(), [200, 409]);
      assert.equal((await stored()).aiSettings?.revision, 1);
    });

    await context.test('administrator revocation during catalog lookup is rechecked before persistence', async () => {
      await reset(); const normal = provider;
      provider = async () => {
        const state = await stored(); state.users.find(user => user.id === 'u-admin')!.role = 'member'; await writeFile(stateFile, JSON.stringify(state));
        return normal();
      };
      try {
        const response = await PUT(request('u-admin', { modelId: secondModel, expectedRevision: 0, requestId: 'revoked' }));
        assert.equal(response.status, 403); assert.equal((await response.json()).code, 'ADMIN_REQUIRED'); assert.equal((await stored()).aiSettings, undefined);
      } finally { provider = normal; }
    });

    await context.test('cancelled catalog completion cannot persist a model selection', async () => {
      await reset(); const normal = provider; const aborter = new AbortController();
      provider = async () => { aborter.abort(); return normal(); };
      try {
        const response = await PUT(request('u-admin', { modelId: secondModel, expectedRevision: 0, requestId: 'cancelled' }, undefined, aborter.signal));
        assert.notEqual(response.status, 200); assert.equal((await stored()).aiSettings, undefined);
      } finally { provider = normal; }
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.ok(path.resolve(directory).startsWith(baseDirectory + path.sep));
    await rm(directory, { recursive: true, force: true });
  }
});
