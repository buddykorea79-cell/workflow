import { NextRequest, NextResponse } from 'next/server';
import { assertSameOrigin } from '@/lib/auth';
import { apiError, json } from '@/lib/api';
import { DomainError } from '@/lib/domain';
import { requireIntegrationAdmin } from '@/lib/admin-integrations-auth';
import { DIAGNOSTIC_FILE_LIMIT, putLocalDiagnosticFile, readDiagnosticFile, verifyDiagnosticManifest } from '@/lib/admin-integrations';

export const runtime = 'nodejs';
export const maxDuration = 30;
export async function PUT(request: NextRequest) {
  try {
    assertSameOrigin(request); const userId = await requireIntegrationAdmin(request); const manifest = verifyDiagnosticManifest(request.nextUrl.searchParams.get('token'), userId);
    if (manifest.provider !== 'local') throw new DomainError(422, 'DIRECT_UPLOAD_REQUIRED', '서명된 파일 저장소 주소로 업로드해 주세요.');
    const reader = request.body?.getReader(); if (!reader) throw new DomainError(422, 'FILE_REQUIRED', '시험 파일을 선택해 주세요.'); const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; if (size > DIAGNOSTIC_FILE_LIMIT || size > manifest.size) { await reader.cancel(); throw new DomainError(413, 'FILE_TOO_LARGE', '시험 파일은 1MB 이하로 선택해 주세요.'); } chunks.push(chunk.value); } } finally { reader.releaseLock(); }
    await putLocalDiagnosticFile(manifest, Buffer.concat(chunks)); return json({ uploaded: true });
  } catch (error) { return apiError(error); }
}
export async function GET(request: NextRequest) {
  try {
    const userId = await requireIntegrationAdmin(request); const manifest = verifyDiagnosticManifest(request.nextUrl.searchParams.get('token'), userId); const bytes = await readDiagnosticFile(manifest);
    return new NextResponse(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(manifest.name)}`, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { return apiError(error); }
}
