import { NextRequest, NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { currentUserId } from '@/lib/auth';
import { activeUser, canReadTask, DomainError } from '@/lib/domain';
import { dataDirectory, transaction } from '@/lib/store';
import { apiError } from '@/lib/api';
import { createNeonDownloadUrl } from '@/lib/attachment-storage';
export const runtime = 'nodejs';
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) { try { const userId = await currentUserId(request); const { id } = await context.params; const attachment = await transaction(state => { const user = activeUser(state, userId); const attachment = state.attachments.find(a => a.id === id); const task = state.tasks.find(t => t.id === attachment?.taskId); if (!attachment || !task || !canReadTask(state, user, task)) throw new DomainError(403, 'DOWNLOAD_DENIED', '현재 파일 열람 권한이 없습니다.'); if (attachment.status !== 'test_allowed') throw new DomainError(409, 'FILE_QUARANTINED', '격리된 파일입니다. 관리자의 개발용 출처 확인 전에는 다운로드할 수 없습니다.'); return attachment; });
  if (attachment.storageProvider === 'neon') { const url = await createNeonDownloadUrl(attachment.storageKey, attachment.name, attachment.storageBucket); return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'no-store, private', 'Referrer-Policy': 'no-referrer' } }); }
  const filePath = path.join(dataDirectory(), 'files', path.basename(attachment.storageKey)); const buffer = await readFile(filePath); return new NextResponse(buffer, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`, 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff' } }); } catch (error) { return apiError(error); } }
