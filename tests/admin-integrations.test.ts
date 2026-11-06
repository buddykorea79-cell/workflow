import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NextRequest } from 'next/server';
import { GET, POST } from '../src/app/api/admin/integrations/route';
import { GET as fileGet, PUT as filePut } from '../src/app/api/admin/integrations/file/route';
import { cleanupStorageProbe, integrationStatus, prepareStorageProbe, signDiagnosticManifest, testAiConnection, testDatabaseConnection, testStorageConnection, verifyDiagnosticManifest, type DiagnosticFileManifest, type ProbeDatabaseClient } from '../src/lib/admin-integrations';
import { DomainError } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import { sessionCookie, signSession } from '../src/lib/auth';

const errorCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;
const model = 'provider/test';
test('integration status shows variable presence and never returns credentials or connection strings', () => {
  const env = { DATABASE_URL: 'postgres://private-password@example/db', BIZROUTER_API_KEY: 'private-api-key', BIZROUTER_MODEL: model, IEUM_STORAGE_PROVIDER: 'neon', AWS_ENDPOINT_URL_S3: 'https://private-endpoint.example', AWS_REGION: 'private-region', AWS_ACCESS_KEY_ID: 'private-access-key', AWS_SECRET_ACCESS_KEY: 'private-secret-key', IEUM_SESSION_SECRET: 's'.repeat(32) };
  const status = integrationStatus(env); assert.equal(status.ai.configured, true); assert.equal(status.database.configured, true); assert.equal(status.storage.configured, true);
  const encoded = JSON.stringify(status); for (const value of Object.values(env)) { if (value !== 'neon') assert.equal(encoded.includes(value), false); }
  assert.equal(integrationStatus({}).database.mode, 'local'); assert.equal(integrationStatus({}).ai.configured, false);
});

test('AI diagnostics checks model capabilities and validates a real structured completion without business data', async () => {
  const calls: string[] = [];
  const result = await testAiConnection({ env: { BIZROUTER_API_KEY: 'test-only', BIZROUTER_MODEL: model }, fetcher: (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push(String(url));
    if (String(url).endsWith('/models')) return Response.json({ models: [{ id: model, response_format_modes: ['json_schema'] }] });
    const body = JSON.parse(String(init?.body)); assert.equal(body.stream, false); assert.equal(body.model, model); assert.equal(body.response_format.type, 'json_schema'); assert.equal(body.messages.length, 2); assert.match(body.messages[0].content, /연결 시험/);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ connected: true, message: '온이음 연결 확인' }) } }] });
  }) as typeof fetch });
  assert.equal(result.ok, true); assert.equal(result.checks.length, 3); assert.deepEqual(calls, ['https://api.bizrouter.ai/v1/models', 'https://api.bizrouter.ai/v1/chat/completions']);
});
test('AI diagnostics safely reports missing configuration, denied models and failed responses', async () => {
  let calls = 0; const fetcher = (async () => { calls++; return Response.json({ error: 'private-secret-from-vendor' }, { status: 401 }); }) as typeof fetch;
  let result = await testAiConnection({ env: {}, fetcher }); assert.equal(result.ok, false); assert.equal(calls, 0);
  result = await testAiConnection({ env: { BIZROUTER_API_KEY: 'secret', BIZROUTER_MODEL: model }, fetcher }); assert.equal(result.ok, false); assert.equal(calls, 1); assert.equal(JSON.stringify(result).includes('private-secret-from-vendor'), false);
  result = await testAiConnection({ env: { BIZROUTER_API_KEY: 'secret', BIZROUTER_MODEL: model }, fetcher: (async () => Response.json({ models: [{ id: model, response_format_modes: [] }] })) as typeof fetch }); assert.equal(result.ok, false); assert.match(result.checks.at(-1)!.detail!, /JSON 구조화/);
});

test('DB diagnostics uses a parameterized same-value update and rolls back without committing', async () => {
  const sql: string[] = []; const params: unknown[][] = []; let released = false, ended = false;
  const client: ProbeDatabaseClient = { query: async (query, values) => { sql.push(query); params.push(values || []); return { rows: query.includes('revision') ? [{ revision: 7 }] : [{ connected: 1 }] }; }, release: () => { released = true; } };
  const result = await testDatabaseConnection({ env: { DATABASE_URL: 'private-url', IEUM_WORKSPACE_ID: 'custom-workspace' }, poolFactory: () => ({ connect: async () => client, end: async () => { ended = true; } }) });
  assert.equal(result.ok, true); assert.ok(sql.includes('BEGIN')); assert.equal(sql.at(-1), 'ROLLBACK'); assert.equal(sql.some(query => /COMMIT|DELETE|INSERT/.test(query)), false); assert.ok(sql.includes('UPDATE ieum_workspaces SET revision = revision WHERE id = $1 RETURNING revision')); assert.deepEqual(params.filter(item => item.length), [['custom-workspace'], ['custom-workspace']]); assert.ok(released && ended); assert.equal(JSON.stringify(result).includes('private-url'), false);
});
test('DB diagnostics rolls back on write failure and never exposes provider error text', async () => {
  const sql: string[] = []; let ended = false;
  const result = await testDatabaseConnection({ env: { DATABASE_URL: 'private-url' }, poolFactory: () => ({ connect: async () => ({ query: async query => { sql.push(query); if (query.startsWith('UPDATE')) throw new Error('password=private-url'); return { rows: [{ revision: 2 }] }; }, release: () => undefined }), end: async () => { ended = true; } }) });
  assert.equal(result.ok, false); assert.equal(sql.at(-1), 'ROLLBACK'); assert.ok(ended); assert.equal(JSON.stringify(result).includes('private-url'), false);
});

test('DB diagnostics distinguishes a transient connection timeout without exposing its details', async () => {
  let ended = false;
  const result = await testDatabaseConnection({ env: { DATABASE_URL: 'private-url' }, poolFactory: () => ({ connect: async () => { throw new Error('Connection timeout: private-url'); }, end: async () => { ended = true; } }) });
  assert.equal(result.ok, false); assert.match(result.checks.at(-1)!.detail!, /시간이 초과/); assert.equal(JSON.stringify(result).includes('private-url'), false); assert.equal(ended, true);
});

test('diagnostic tokens bind owner, expiry and file identity while allowing bounded cleanup retries', () => {
  const previous = process.env.IEUM_SESSION_SECRET; process.env.IEUM_SESSION_SECRET = 'diagnostic-test-secret-32-characters-long';
  try {
    const manifest: DiagnosticFileManifest = { id: '11111111-1111-4111-8111-111111111111', userId: 'admin', provider: 'local', bucket: '', name: 'sample.txt', size: 4, sha256: 'a'.repeat(64), mime: 'text/plain', expiresAt: 2000 };
    const token = signDiagnosticManifest(manifest); assert.deepEqual(verifyDiagnosticManifest(token, 'admin', false, 1000), manifest);
    assert.throws(() => verifyDiagnosticManifest(token, 'another', false, 1000), errorCode('DIAGNOSTIC_OWNER_MISMATCH'));
    assert.throws(() => verifyDiagnosticManifest(token + 'x', 'admin', false, 1000), errorCode('DIAGNOSTIC_TOKEN_INVALID'));
    assert.throws(() => verifyDiagnosticManifest(token, 'admin', false, 3000), errorCode('DIAGNOSTIC_EXPIRED'));
    assert.deepEqual(verifyDiagnosticManifest(token, 'admin', true, 3000), manifest);
  } finally { if (previous === undefined) delete process.env.IEUM_SESSION_SECRET; else process.env.IEUM_SESSION_SECRET = previous; }
});

test('admin routes reject unauthorized callers and complete a real local browser file round trip without workspace changes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-admin-diagnostics-'));
  const keys = ['IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_STORAGE_PROVIDER', 'BIZROUTER_API_KEY', 'BIZROUTER_MODEL', 'IEUM_SESSION_SECRET'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key]; process.env.IEUM_DATA_DIR = directory; process.env.IEUM_SESSION_SECRET = 'diagnostic-test-secret-32-characters-long';
    const state = createSeed(); const admin = state.users.find(user => user.role === 'admin')!.id; const member = state.users.find(user => user.role === 'member')!.id;
    const file = path.join(directory, 'workspace.json'); await writeFile(file, JSON.stringify(state, null, 2)); const original = await readFile(file, 'utf8');
    const request = (userId: string | null, body?: object, origin = 'http://127.0.0.1:3000') => new NextRequest('http://127.0.0.1:3000/api/admin/integrations', { method: body ? 'POST' : 'GET', headers: { origin, host: '127.0.0.1:3000', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(userId ? { cookie: `${sessionCookie}=${signSession(userId)}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    assert.equal((await GET(request(null))).status, 401); assert.equal((await GET(request(member))).status, 403); assert.equal((await POST(request(member, { action: 'ai' }))).status, 403); assert.equal((await POST(request(admin, { action: 'storage' }, 'https://foreign.example'))).status, 403);
    assert.equal((await GET(request(admin))).status, 200);
    const bytes = Buffer.from('한글 파일 연결 시험'); const input = { name: '시험.txt', size: bytes.length, mime: 'text/plain', sha256: createHash('sha256').update(bytes).digest('hex') };
    let response = await POST(request(admin, { action: 'storage.prepare', file: input })); assert.equal(response.status, 200); const prepared = await response.json(); assert.equal(prepared.provider, 'local');
    const put = (userId: string, buffer: Buffer) => new NextRequest('http://127.0.0.1:3000' + prepared.uploadUrl, { method: 'PUT', headers: { origin: 'http://127.0.0.1:3000', host: '127.0.0.1:3000', cookie: `${sessionCookie}=${signSession(userId)}` }, body: new Uint8Array(buffer) });
    assert.equal((await filePut(put(member, bytes))).status, 403); assert.equal((await filePut(put(admin, Buffer.from('wrong')))).status, 409); assert.equal((await filePut(put(admin, bytes))).status, 200);
    response = await POST(request(admin, { action: 'storage.complete', token: prepared.token })); assert.equal(response.status, 200); const completed = await response.json();
    response = await fileGet(new NextRequest('http://127.0.0.1:3000' + completed.downloadUrl, { headers: { cookie: `${sessionCookie}=${signSession(admin)}` } })); assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition')!, /attachment/); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal((await POST(request(admin, { action: 'storage.cleanup', token: prepared.token }))).status, 200); assert.deepEqual(await readdir(path.join(directory, 'diagnostics')), []);
    const server = await testStorageConnection(); assert.equal(server.ok, true); assert.deepEqual(await readdir(path.join(directory, 'diagnostics')), []);
    assert.equal(await readFile(file, 'utf8'), original);
    const missing = await testDatabaseConnection({ env: {} }); assert.equal(missing.ok, false); assert.match(missing.checks[0].detail!, /로컬 저장/);
    await assert.rejects(prepareStorageProbe(admin, { ...input, size: 1024 * 1024 + 1 }), errorCode('DIAGNOSTIC_FILE_INVALID'));
    for (const name of ['directory/', 'directory\\', 'directory/   ', '.', '..']) await assert.rejects(prepareStorageProbe(admin, { ...input, name }), errorCode('DIAGNOSTIC_FILE_INVALID'));
    const named = await prepareStorageProbe(admin, { ...input, name: 'directory/시험.txt' }); assert.equal(verifyDiagnosticManifest(named.token, admin).name, '시험.txt');
  } finally { for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } await rm(directory, { recursive: true, force: true }); }
});
