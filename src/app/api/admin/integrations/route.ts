import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin } from '@/lib/auth';
import { apiError, json } from '@/lib/api';
import { DomainError } from '@/lib/domain';
import { requireIntegrationAdmin } from '@/lib/admin-integrations-auth';
import { cleanupStorageProbe, completeStorageProbe, integrationStatus, prepareStorageProbe, testAiConnection, testDatabaseConnection, testStorageConnection, verifyDiagnosticManifest } from '@/lib/admin-integrations';

export const runtime = 'nodejs';
export const maxDuration = 70;
const requests = new Set<string>();
const bodySchema = z.object({ action: z.enum(['ai', 'database', 'storage', 'storage.prepare', 'storage.complete', 'storage.cleanup']), file: z.unknown().optional(), token: z.string().max(5000).optional() }).strict();
async function boundedBody(request: NextRequest) {
  const reader = request.body?.getReader(); if (!reader) throw new DomainError(422, 'INVALID_INPUT', '시험 항목을 선택해 주세요.'); let size = 0; let text = ''; const decoder = new TextDecoder();
  try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 7000) { await reader.cancel(); throw new DomainError(413, 'REQUEST_TOO_LARGE', '시험 요청이 너무 큽니다.'); } text += decoder.decode(chunk.value, { stream: true }); } try { return JSON.parse(text + decoder.decode()); } catch { throw new DomainError(422, 'INVALID_INPUT', '시험 요청 형식을 확인해 주세요.'); } } finally { reader.releaseLock(); }
}
export async function GET(request: NextRequest) { try { await requireIntegrationAdmin(request); return json(integrationStatus()); } catch (error) { return apiError(error); } }
export async function POST(request: NextRequest) {
  let key: string | undefined;
  try {
    assertSameOrigin(request); const userId = await requireIntegrationAdmin(request); const parsed = bodySchema.safeParse(await boundedBody(request));
    if (!parsed.success) throw new DomainError(422, 'INVALID_INPUT', '시험 항목과 요청을 확인해 주세요.'); const input = parsed.data;
    if (requests.has(userId)) throw new DomainError(429, 'DIAGNOSTIC_RUNNING', '진행 중인 연결 시험이 끝난 뒤 다시 실행해 주세요.'); requests.add(userId); key = userId;
    if (input.action === 'ai') return json(await testAiConnection({ signal: request.signal }));
    if (input.action === 'database') return json(await testDatabaseConnection());
    if (input.action === 'storage') return json(await testStorageConnection());
    if (input.action === 'storage.prepare') return json(await prepareStorageProbe(userId, input.file));
    const manifest = verifyDiagnosticManifest(input.token, userId, input.action === 'storage.cleanup');
    if (input.action === 'storage.complete') return json(await completeStorageProbe(manifest, input.token!));
    await cleanupStorageProbe(manifest); return json({ cleaned: true });
  } catch (error) { return apiError(error); } finally { if (key) requests.delete(key); }
}
