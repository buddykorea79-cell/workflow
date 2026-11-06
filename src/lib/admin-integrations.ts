import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { DomainError } from './domain';
import { dataDirectory } from './store';
import { createNeonDownloadUrl, createNeonUploadUrl, deleteNeonFile, getNeonStorageConfig, readNeonFile, uploadNeonFile } from './attachment-storage';
import type { DiagnosticCheck, DiagnosticResult, IntegrationService, IntegrationStatus, IntegrationVariable, PreparedStorageProbe } from './admin-integration-types';

type Environment = Record<string, string | undefined>;
const aiOrigin = 'https://api.bizrouter.ai/v1';
export const DIAGNOSTIC_FILE_LIMIT = 1024 * 1024;
const fileInput = z.object({ name: z.string().min(1).max(255), size: z.number().int().min(1).max(DIAGNOSTIC_FILE_LIMIT), mime: z.string().max(150), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const manifestSchema = fileInput.extend({ id: z.uuid(), userId: z.string().min(1).max(150), provider: z.enum(['local', 'neon']), bucket: z.string().max(63), expiresAt: z.number().int().positive() }).strict();
export type DiagnosticFileManifest = z.infer<typeof manifestSchema>;

function variables(env: Environment, definitions: [string, boolean, string][]): IntegrationVariable[] { return definitions.map(([name, required, purpose]) => ({ name, required, purpose, configured: !!env[name]?.trim() })); }
export function integrationStatus(env: Environment = process.env): IntegrationStatus {
  const ai = variables(env, [['BIZROUTER_API_KEY', true, 'AI API 인증'], ['BIZROUTER_MODEL', true, '분석 모델 ID']]);
  const database = variables(env, [['DATABASE_URL', true, 'Neon PostgreSQL 연결 문자열'], ['IEUM_WORKSPACE_ID', false, '기본값 development']]);
  const storage = variables(env, [['IEUM_STORAGE_PROVIDER', true, 'Neon 사용 시 neon'], ['AWS_ENDPOINT_URL_S3', true, 'Neon Storage endpoint'], ['AWS_REGION', true, '저장소 리전'], ['AWS_ACCESS_KEY_ID', true, '저장소 접근 키'], ['AWS_SECRET_ACCESS_KEY', true, '저장소 비밀 키'], ['IEUM_STORAGE_BUCKET', false, '기본값 ieum-attachments'], ['IEUM_SESSION_SECRET', true, '서명된 업로드 확인용 · 32자 이상']]);
  return { checkedAt: new Date().toISOString(), ai: { configured: ai.every(item => item.configured), variables: ai }, database: { configured: !!env.DATABASE_URL?.trim(), mode: env.DATABASE_URL?.trim() ? 'neon' : 'local', variables: database }, storage: { configured: env.IEUM_STORAGE_PROVIDER === 'neon' && storage.filter(item => item.required).every(item => item.configured) && (env.IEUM_SESSION_SECRET?.trim().length || 0) >= 32, mode: env.IEUM_STORAGE_PROVIDER === 'neon' ? 'neon' : 'local', variables: storage } };
}
function finish(service: IntegrationService, started: number, checks: DiagnosticCheck[], message: string): DiagnosticResult { return { service, ok: checks.length > 0 && checks.every(check => check.ok), checkedAt: new Date().toISOString(), durationMs: Date.now() - started, checks, message }; }
function aiFailure(status: number): never {
  if ([401, 403].includes(status)) throw new DomainError(503, 'AI_AUTH_FAILED', 'API 키와 모델 접근 권한을 확인해 주세요.');
  if (status === 429) throw new DomainError(429, 'AI_RATE_LIMITED', 'BizRouter 사용 한도에 도달했습니다. 잠시 후 다시 확인해 주세요.');
  throw new DomainError(502, 'AI_RESPONSE_FAILED', 'BizRouter가 요청을 처리하지 못했습니다. 서비스 상태를 확인해 주세요.');
}
async function boundedJson(response: Response, limit: number) {
  const reader = response.body?.getReader(); if (!reader) throw new Error('EMPTY_RESPONSE'); let size = 0; let text = ''; const decoder = new TextDecoder();
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > limit) { await reader.cancel(); throw new Error('RESPONSE_LIMIT'); } text += decoder.decode(chunk.value, { stream: true }); } return JSON.parse(text + decoder.decode()); } finally { reader.releaseLock(); }
}
export async function testAiConnection(options: { env?: Environment; fetcher?: typeof fetch; signal?: AbortSignal } = {}): Promise<DiagnosticResult> {
  const started = Date.now(); const checks: DiagnosticCheck[] = []; const env = options.env ?? process.env; const fetcher = options.fetcher ?? fetch;
  let stage = '서버 환경변수'; const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(55_000)]) : AbortSignal.timeout(55_000);
  try {
    if (!env.BIZROUTER_API_KEY?.trim() || !env.BIZROUTER_MODEL?.trim()) throw new DomainError(503, 'AI_NOT_CONFIGURED', 'BIZROUTER_API_KEY와 BIZROUTER_MODEL을 서버에 설정해 주세요.');
    checks.push({ label: stage, ok: true }); stage = '인증·모델 접근';
    const headers = { Authorization: `Bearer ${env.BIZROUTER_API_KEY}`, 'Content-Type': 'application/json' };
    const catalogResponse = await fetcher(`${aiOrigin}/models`, { headers, signal, redirect: 'error', cache: 'no-store' }); if (!catalogResponse.ok) aiFailure(catalogResponse.status);
    const catalog = z.object({ models: z.array(z.object({ id: z.string(), response_format_modes: z.array(z.string()).optional() })) }).safeParse(await boundedJson(catalogResponse, 8 * 1024 * 1024));
    if (!catalog.success || !catalog.data.models.some(model => model.id === env.BIZROUTER_MODEL && model.response_format_modes?.includes('json_schema'))) throw new DomainError(503, 'AI_MODEL_UNAVAILABLE', '설정한 모델이 허용 목록에 없거나 JSON 구조화 응답을 지원하지 않습니다.');
    checks.push({ label: stage, ok: true }); stage = '실제 AI 응답';
    const schema = { type: 'object', properties: { connected: { type: 'boolean', const: true }, message: { type: 'string', const: '온이음 연결 확인' } }, required: ['connected', 'message'], additionalProperties: false };
    const response = await fetcher(`${aiOrigin}/chat/completions`, { method: 'POST', headers, signal, redirect: 'error', cache: 'no-store', body: JSON.stringify({ model: env.BIZROUTER_MODEL, stream: false, max_tokens: 512, response_format: { type: 'json_schema', json_schema: { name: 'connection_test', strict: true, schema } }, messages: [{ role: 'system', content: '연결 시험입니다. connected는 true, message는 온이음 연결 확인인 JSON만 반환하세요.' }, { role: 'user', content: '연결을 확인해 주세요.' }] }) });
    if (!response.ok) aiFailure(response.status);
    const envelope = z.object({ choices: z.array(z.object({ finish_reason: z.string(), message: z.object({ content: z.string() }) })).min(1) }).safeParse(await boundedJson(response, 64 * 1024));
    if (!envelope.success || envelope.data.choices[0].finish_reason !== 'stop') throw new DomainError(502, 'AI_TEST_INCOMPLETE', 'AI 시험 응답이 완료되지 않았습니다. 모델 설정을 확인하거나 다시 시험해 주세요.');
    const result = z.object({ connected: z.literal(true), message: z.literal('온이음 연결 확인') }).strict().safeParse(JSON.parse(envelope.data.choices[0].message.content));
    if (!result.success) throw new DomainError(502, 'AI_TEST_INVALID', '모델의 구조화 응답을 확인하지 못했습니다.');
    checks.push({ label: stage, ok: true, detail: '온이음 연결 확인' }); return finish('ai', started, checks, 'BizRouter 인증·모델 접근·실제 응답을 확인했습니다.');
  } catch (error) { checks.push({ label: stage, ok: false, detail: error instanceof DomainError ? error.message : signal.aborted ? '응답 시간이 초과되었습니다.' : '연결 또는 응답 형식을 확인하지 못했습니다. 서버 설정과 네트워크를 확인해 주세요.' }); return finish('ai', started, checks, 'AI 연결 시험을 완료하지 못했습니다.'); }
}

export interface ProbeDatabaseClient { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>; release: () => void }
export interface ProbeDatabasePool { connect: () => Promise<ProbeDatabaseClient>; end: () => Promise<void> }
export async function testDatabaseConnection(options: { env?: Environment; poolFactory?: () => ProbeDatabasePool } = {}): Promise<DiagnosticResult> {
  const started = Date.now(); const checks: DiagnosticCheck[] = []; const env = options.env ?? process.env; let pool: ProbeDatabasePool | undefined; let client: ProbeDatabaseClient | undefined; let began = false; let stage = 'DB 환경변수';
  try {
    if (!env.DATABASE_URL?.trim()) throw new DomainError(503, 'DATABASE_NOT_CONFIGURED', '현재 로컬 저장을 사용합니다. Neon을 시험하려면 DATABASE_URL을 설정해 주세요.');
    checks.push({ label: stage, ok: true }); stage = 'DB 연결·조회';
    if (options.poolFactory) pool = options.poolFactory();
    else { const { Pool, neonConfig } = await import('@neondatabase/serverless'); const { default: ws } = await import('ws'); neonConfig.webSocketConstructor = ws; pool = new Pool({ connectionString: env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15_000, query_timeout: 10_000 }) as unknown as ProbeDatabasePool; }
    client = await pool.connect(); await client.query('SELECT 1 AS connected'); checks.push({ label: stage, ok: true });
    stage = '워크스페이스 읽기'; await client.query('BEGIN'); began = true; await client.query("SET LOCAL statement_timeout = '10s'");
    const workspaceId = env.IEUM_WORKSPACE_ID?.trim() || 'development';
    const rows = await client.query('SELECT revision FROM ieum_workspaces WHERE id = $1', [workspaceId]);
    if (!rows.rows.length) throw new DomainError(503, 'DATABASE_NOT_INITIALIZED', '워크스페이스 데이터가 없습니다. IEUM_WORKSPACE_ID와 초기 데이터 이관을 확인해 주세요.');
    checks.push({ label: stage, ok: true }); stage = '쓰기 권한·롤백';
    const updated = await client.query('UPDATE ieum_workspaces SET revision = revision WHERE id = $1 RETURNING revision', [workspaceId]);
    if (!updated.rows.length) throw new Error('WRITE_CHECK_FAILED');
    await client.query('ROLLBACK'); began = false; checks.push({ label: stage, ok: true, detail: '동일 값 쓰기 시험 후 롤백 · 업무 데이터 유지' });
    return finish('database', started, checks, 'Neon DB 연결·조회·쓰기 권한과 롤백을 확인했습니다.');
  } catch (error) { const timedOut = error instanceof Error && /timeout|timed out/i.test(error.message); checks.push({ label: stage, ok: false, detail: error instanceof DomainError ? error.message : timedOut ? 'DB 연결 또는 응답 시간이 초과되었습니다. 잠시 후 다시 시험하고 계속되면 Neon 상태와 네트워크를 확인해 주세요.' : 'DB 연결·테이블·계정 권한을 확인해 주세요. 연결 문자열과 공급자 오류는 표시하지 않습니다.' }); return finish('database', started, checks, 'DB 연결 시험을 완료하지 못했습니다.'); }
  finally { if (client && began) await client.query('ROLLBACK').catch(() => undefined); client?.release(); await pool?.end().catch(() => undefined); }
}

function probeSecret(env: Environment = process.env) { const secret = env.IEUM_SESSION_SECRET; if (secret && secret.length >= 32) return secret; if (!env.VERCEL && !env.DATABASE_URL) return 'ieum-local-diagnostic-files-only-secret'; throw new DomainError(503, 'DIAGNOSTIC_SIGNING_REQUIRED', 'IEUM_SESSION_SECRET을 32자 이상으로 설정해 주세요.'); }
export function signDiagnosticManifest(manifest: DiagnosticFileManifest) { const body = Buffer.from(JSON.stringify(manifest)).toString('base64url'); return `${body}.${createHmac('sha256', probeSecret()).update(`admin-diagnostic:${body}`).digest('hex')}`; }
export function verifyDiagnosticManifest(token: unknown, userId: string, cleanup = false, now = Date.now()): DiagnosticFileManifest {
  if (typeof token !== 'string' || token.length > 5000) throw new DomainError(422, 'DIAGNOSTIC_TOKEN_INVALID', '파일 시험을 다시 시작해 주세요.');
  const [body, signature, extra] = token.split('.'); const expected = createHmac('sha256', probeSecret()).update(`admin-diagnostic:${body}`).digest('hex');
  if (extra || !body || !/^[a-f0-9]{64}$/.test(signature || '') || !timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) throw new DomainError(403, 'DIAGNOSTIC_TOKEN_INVALID', '파일 시험 정보가 변경되었습니다.');
  let raw: unknown; try { raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new DomainError(422, 'DIAGNOSTIC_TOKEN_INVALID', '파일 시험 정보가 올바르지 않습니다.'); }
  const parsed = manifestSchema.safeParse(raw); if (!parsed.success) throw new DomainError(422, 'DIAGNOSTIC_TOKEN_INVALID', '파일 시험 정보가 올바르지 않습니다.');
  if (parsed.data.userId !== userId) throw new DomainError(403, 'DIAGNOSTIC_OWNER_MISMATCH', '시험을 시작한 관리자 계정으로 진행해 주세요.');
  if (parsed.data.expiresAt + (cleanup ? 24 * 60 * 60_000 : 0) <= now) throw new DomainError(410, 'DIAGNOSTIC_EXPIRED', '시험 정보가 만료되었습니다. 파일 시험을 다시 시작해 주세요.');
  if (parsed.data.provider === 'neon' && parsed.data.bucket !== getNeonStorageConfig()?.bucket) throw new DomainError(409, 'STORAGE_CHANGED', '저장소 설정이 바뀌었습니다. 원래 버킷의 임시 시험 파일을 확인해 주세요.');
  return parsed.data;
}
const objectKey = (manifest: DiagnosticFileManifest) => `admin-diagnostics/${manifest.id}.bin`;
const localFile = (manifest: DiagnosticFileManifest) => path.join(dataDirectory(), 'diagnostics', `${manifest.id}.bin`);
export function validateDiagnosticBytes(manifest: DiagnosticFileManifest, bytes: Buffer) { if (bytes.length !== manifest.size || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new DomainError(409, 'DIAGNOSTIC_FILE_MISMATCH', '올린 파일과 읽은 파일의 크기·SHA256이 일치하지 않습니다.'); }
export async function prepareStorageProbe(userId: string, raw: unknown): Promise<PreparedStorageProbe> {
  const input = fileInput.safeParse(raw); if (!input.success) throw new DomainError(422, 'DIAGNOSTIC_FILE_INVALID', '1MB 이하 파일의 이름·크기·SHA256을 확인해 주세요.');
  const name = input.data.name.replaceAll('\\', '/').split('/').pop()?.trim();
  if (!name || name === '.' || name === '..') throw new DomainError(422, 'DIAGNOSTIC_FILE_INVALID', '시험 파일의 이름을 확인해 주세요.');
  const storage = getNeonStorageConfig(); if (!storage && process.env.VERCEL) throw new DomainError(503, 'STORAGE_NOT_CONFIGURED', 'Vercel 파일 시험에는 Neon 저장소 설정이 필요합니다.');
  const manifest: DiagnosticFileManifest = { ...input.data, name, mime: input.data.mime || 'application/octet-stream', id: randomUUID(), userId, provider: storage ? 'neon' : 'local', bucket: storage?.bucket || '', expiresAt: Date.now() + 10 * 60_000 };
  const token = signDiagnosticManifest(manifest); const uploadUrl = storage ? await createNeonUploadUrl(objectKey(manifest), manifest.mime, manifest.bucket) : `/api/admin/integrations/file?token=${encodeURIComponent(token)}`;
  return { provider: manifest.provider, token, uploadUrl, contentType: manifest.mime };
}
export async function putLocalDiagnosticFile(manifest: DiagnosticFileManifest, bytes: Buffer) { if (manifest.provider !== 'local' || process.env.VERCEL || getNeonStorageConfig()) throw new DomainError(409, 'STORAGE_CHANGED', '직접 업로드 주소로 파일을 올려 주세요.'); validateDiagnosticBytes(manifest, bytes); await mkdir(path.dirname(localFile(manifest)), { recursive: true }); await writeFile(localFile(manifest), bytes, { flag: 'wx' }); }
export async function readDiagnosticFile(manifest: DiagnosticFileManifest) { const bytes = manifest.provider === 'neon' ? await readNeonFile(objectKey(manifest), manifest.bucket) : await readFile(localFile(manifest)); validateDiagnosticBytes(manifest, bytes); return bytes; }
export async function completeStorageProbe(manifest: DiagnosticFileManifest, token: string) { await readDiagnosticFile(manifest); return { downloadUrl: manifest.provider === 'neon' ? await createNeonDownloadUrl(objectKey(manifest), manifest.name, manifest.bucket) : `/api/admin/integrations/file?token=${encodeURIComponent(token)}` }; }
export async function cleanupStorageProbe(manifest: DiagnosticFileManifest) { if (manifest.provider === 'neon') await deleteNeonFile(objectKey(manifest), manifest.bucket); else await unlink(localFile(manifest)).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }); }

export async function testStorageConnection(): Promise<DiagnosticResult> {
  const started = Date.now(); const checks: DiagnosticCheck[] = []; let manifest: DiagnosticFileManifest | undefined; let stage = '파일 저장소 설정'; let message = '파일 저장소 시험을 완료하지 못했습니다.';
  try {
    const storage = getNeonStorageConfig(); if (!storage && process.env.VERCEL) throw new DomainError(503, 'STORAGE_NOT_CONFIGURED', 'Vercel에서 파일을 저장하려면 Neon 저장소를 설정해 주세요.');
    checks.push({ label: stage, ok: true, detail: storage ? 'Neon Object Storage' : '로컬 파일 저장소' });
    const bytes = Buffer.from(`온이음 파일 저장소 연결 시험 ${randomUUID()}`);
    manifest = { id: randomUUID(), userId: 'server-probe', name: '연결시험.txt', size: bytes.length, mime: 'text/plain', sha256: createHash('sha256').update(bytes).digest('hex'), provider: storage ? 'neon' : 'local', bucket: storage?.bucket || '', expiresAt: Date.now() + 60_000 };
    stage = '임시 파일 업로드'; if (storage) await uploadNeonFile(objectKey(manifest), bytes, manifest.mime, storage.bucket); else await putLocalDiagnosticFile(manifest, bytes); checks.push({ label: stage, ok: true });
    stage = '읽기·내용 일치'; await readDiagnosticFile(manifest); checks.push({ label: stage, ok: true, detail: '크기·SHA256 일치' }); message = '서버에서 파일 쓰기·읽기·내용 일치를 확인했습니다.';
  } catch (error) { checks.push({ label: stage, ok: false, detail: error instanceof DomainError ? error.message : '파일 저장소의 연결·권한·읽기 상태를 확인해 주세요.' }); }
  finally { if (manifest) { try { await cleanupStorageProbe(manifest); checks.push({ label: '임시 파일 정리', ok: true }); } catch { checks.push({ label: '임시 파일 정리', ok: false, detail: `시험 파일 정리에 실패했습니다. 저장소의 ${objectKey(manifest)}만 확인해 주세요.` }); } } }
  return finish('storage', started, checks, message);
}
