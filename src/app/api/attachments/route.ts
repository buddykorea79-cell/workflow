import { NextRequest } from 'next/server';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { assertSameOrigin, currentUserId, isDemoSession } from '@/lib/auth';
import { DomainError, getWorkspace } from '@/lib/domain';
import { dataDirectory, transaction } from '@/lib/store';
import { apiError, json } from '@/lib/api';
import { assertAttachmentUploadAllowed } from '@/lib/attachment-upload';
import { getNeonStorageConfig } from '@/lib/attachment-storage';
export const runtime = 'nodejs';
const extensions = new Set(['.pdf', '.docx', '.xlsx', '.xls', '.pptx', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.csv', '.hwp', '.hwpx']);
export async function POST(request: NextRequest) { let filePath: string | undefined; let saved = false; try {
  assertSameOrigin(request); if (!isDemoSession(request) || process.env.VERCEL) throw new DomainError(503, 'DIRECT_STORAGE_REQUIRED', '현재 환경에서는 Neon 직접 업로드를 사용해 주세요.');
  if (getNeonStorageConfig()) throw new DomainError(503, 'DIRECT_STORAGE_REQUIRED', 'Neon 첨부파일은 직접 업로드 방식으로 등록해 주세요. 화면을 새로고침한 뒤 다시 시도해 주세요.');
  const userId = await currentUserId(request); if (Number(request.headers.get('content-length') || 0) > 10 * 1024 * 1024 + 100_000) throw new DomainError(413, 'FILE_TOO_LARGE', '첨부파일은 10MB 이하만 업로드할 수 있습니다.');
  const form = await request.formData(); const file = form.get('file'); const taskId = form.get('taskId'); if (!(file instanceof File) || typeof taskId !== 'string') throw new DomainError(422, 'FILE_REQUIRED', '업무와 파일을 선택해 주세요.');
  if (!file.size || file.size > 10 * 1024 * 1024) throw new DomainError(413, 'FILE_TOO_LARGE', '빈 파일은 등록할 수 없으며 파일 한도는 10MB입니다.'); if (!extensions.has(path.extname(file.name).toLowerCase())) throw new DomainError(422, 'FILE_TYPE_DENIED', 'PDF, DOCX, XLSX, 이미지, TXT, CSV, HWP, HWPX 파일을 지원합니다.');
  const buffer = Buffer.from(await file.arrayBuffer()); const attachmentId = `attachment-${randomUUID()}`; const storageKey = `${attachmentId}.bin`; const directory = path.join(dataDirectory(), 'files');
  const workspace = await transaction(async state => { const { user, departmentId } = assertAttachmentUploadAllowed(state, userId, taskId); const now = new Date();
    await mkdir(directory, { recursive: true }); const target = path.join(directory, storageKey); await writeFile(target, buffer, { flag: 'wx' }); filePath = target;
    state.attachments.push({ id: attachmentId, taskId, name: path.basename(file.name), size: file.size, mime: file.type || 'application/octet-stream', sha256: createHash('sha256').update(buffer).digest('hex'), storageKey, storageProvider: 'local', status: 'quarantined', uploadedBy: user.id, createdAt: now.toISOString() }); state.audit.unshift({ id: randomUUID(), actorId: userId, action: 'attachment.upload', targetType: 'attachment', targetId: attachmentId, title: '첨부파일 격리 저장', detail: `${file.name} · 개발용 출처 확인 대기`, departmentId, createdAt: now.toISOString() }); state.revision++; return getWorkspace(state, userId);
  }); saved = true; return json(workspace);
} catch (error) { if (!saved && filePath) await unlink(filePath).catch(() => undefined); return apiError(error); } }
