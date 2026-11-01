import { NextRequest } from 'next/server';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { assertSameOrigin, currentUserId, isLocalDemo } from '@/lib/auth';
import { activeUser, assertTaskWritable, canReadTask, DomainError, getWorkspace } from '@/lib/domain';
import { dataDirectory, transaction } from '@/lib/store';
import { apiError, json } from '@/lib/api';
export const runtime = 'nodejs';
const extensions = new Set(['.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg', '.webp', '.txt', '.csv', '.hwp', '.hwpx']);
export async function POST(request: NextRequest) { let filePath: string | undefined; try {
  assertSameOrigin(request); if (!isLocalDemo(request)) throw new DomainError(503, 'DIRECT_STORAGE_REQUIRED', '배포 환경은 비공개 저장소 직접 업로드 설정이 필요합니다. 파일을 API로 중계하지 않습니다.');
  const userId = await currentUserId(request); if (Number(request.headers.get('content-length') || 0) > 10 * 1024 * 1024 + 100_000) throw new DomainError(413, 'FILE_TOO_LARGE', '첨부파일은 10MB 이하만 업로드할 수 있습니다.');
  const form = await request.formData(); const file = form.get('file'); const taskId = form.get('taskId'); if (!(file instanceof File) || typeof taskId !== 'string') throw new DomainError(422, 'FILE_REQUIRED', '업무와 파일을 선택해 주세요.');
  if (!file.size || file.size > 10 * 1024 * 1024) throw new DomainError(413, 'FILE_TOO_LARGE', '빈 파일은 등록할 수 없으며 파일 한도는 10MB입니다.'); if (!extensions.has(path.extname(file.name).toLowerCase())) throw new DomainError(422, 'FILE_TYPE_DENIED', 'PDF, DOCX, XLSX, 이미지, TXT, CSV, HWP, HWPX 파일을 지원합니다.');
  const buffer = Buffer.from(await file.arrayBuffer()); const attachmentId = `attachment-${randomUUID()}`; const storageKey = `${attachmentId}.bin`; const directory = path.join(dataDirectory(), 'files');
  const workspace = await transaction(async state => { const user = activeUser(state, userId); const task = state.tasks.find(t => t.id === taskId); if (!task || !canReadTask(state, user, task)) throw new DomainError(403, 'ATTACHMENT_DENIED', '해당 업무에 파일을 첨부할 수 없습니다.'); assertTaskWritable(state, task); const now = new Date(); const assigned = [task.primaryId, ...task.supportIds].includes(user.id) || state.runs.some(r => r.taskId === taskId && r.status !== 'completed' && [r.primaryId, ...r.supportIds].includes(user.id)); const delegated = state.delegations.some(d => d.taskId === taskId && d.toId === user.id && d.actions.includes('attachment.upload') && !d.revokedAt && new Date(d.startsAt) <= now && now < new Date(d.endsAt)); if (!assigned && !delegated) throw new DomainError(403, 'ATTACHMENT_DENIED', '현재 담당자 또는 첨부 권한이 있는 대행자만 등록할 수 있습니다.');
    await mkdir(directory, { recursive: true }); filePath = path.join(directory, storageKey); await writeFile(filePath, buffer, { flag: 'wx' }); state.attachments.push({ id: attachmentId, taskId, name: path.basename(file.name), size: file.size, mime: file.type || 'application/octet-stream', sha256: createHash('sha256').update(buffer).digest('hex'), storageKey, status: 'quarantined', uploadedBy: user.id, createdAt: now.toISOString() }); state.audit.unshift({ id: randomUUID(), actorId: userId, action: 'attachment.upload', targetType: 'attachment', targetId: attachmentId, title: '첨부파일 격리 저장', detail: `${file.name} · 악성 파일 검사 대기`, departmentId: task.departmentId, createdAt: now.toISOString() }); state.revision++; return getWorkspace(state, userId);
  }); return json(workspace);
} catch (error) { if (filePath) await unlink(filePath).catch(() => undefined); return apiError(error); } }
