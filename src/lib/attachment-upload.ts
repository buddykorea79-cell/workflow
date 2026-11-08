import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { activeUser, assertTaskWritable, canReadTask, DomainError } from './domain';
import type { WorkspaceData } from './types';
import { canActAsDeputy } from './delegations';
import { currentPersonPerformances, getUnitEvaluation, getUnitScorePlan } from './unit-evaluation';
import { isFutureHalf } from './period';

export const attachmentExtensions = new Set(['pdf', 'docx', 'xlsx', 'xls', 'pptx', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'csv', 'hwp', 'hwpx']);
export function isOwnDraftAttachment(taskId: string, userId: string) {
  return taskId.startsWith(`draft:${userId}:`) && /^[a-f0-9-]{36}$/i.test(taskId.slice(`draft:${userId}:`.length));
}
const descriptor = z.object({ taskId: z.string().min(1).max(150), performanceId: z.string().min(1).max(150).optional(), name: z.string().min(1).max(255), size: z.number().int().positive().max(10 * 1024 * 1024), mime: z.string().max(200), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const manifestSchema = descriptor.extend({ id: z.string().min(1).max(150), userId: z.string().min(1).max(150), bucket: z.string().min(1).max(63), uploadKey: z.string().min(1).max(1000), storageKey: z.string().min(1).max(1000), expiresAt: z.number().int().positive() }).strict();
export type UploadManifest = z.infer<typeof manifestSchema>;

export function parseUploadDescriptor(value: unknown) {
  const parsed = descriptor.safeParse(value);
  if (!parsed.success) throw new DomainError(422, 'FILE_INVALID', '업무와 파일 이름·크기·형식·SHA256 정보를 확인해 주세요. 파일 한도는 10MB입니다.');
  const name = parsed.data.name.replaceAll('\\', '/').split('/').pop() || '';
  if (!name || !attachmentExtensions.has(name.split('.').pop()!.toLowerCase())) throw new DomainError(422, 'FILE_TYPE_DENIED', 'PDF, DOCX, XLSX, 이미지, TXT, CSV, HWP, HWPX 파일을 지원합니다.');
  return { ...parsed.data, name, mime: parsed.data.mime || 'application/octet-stream' };
}

export function assertAttachmentUploadAllowed(state: WorkspaceData, userId: string, taskId: string, performanceId?: string, now = new Date()) {
  const user = activeUser(state, userId, now); const task = state.tasks.find(item => item.id === taskId);
  if (performanceId !== undefined) {
    const record = state.performances.find(item => item.id === performanceId && item.taskId === taskId && item.authorId === user.id);
    if (!record?.period || !currentPersonPerformances(state, user.id, record.period).some(item => item.id === record.id)) throw new DomainError(403, 'PERFORMANCE_ATTACHMENT_DENIED', '본인이 작성한 기존 반기 성과에만 참고 파일을 추가할 수 있습니다.');
    if (isFutureHalf(record.period, now)) throw new DomainError(422, 'PERIOD_NOT_STARTED', '아직 시작하지 않은 반기의 성과는 입력할 수 없습니다.');
    if (!['draft', 'changes_requested'].includes(record.status) || getUnitEvaluation(state, user.id, record.period) || getUnitScorePlan(state, user.id, record.period)?.submittedAt) throw new DomainError(409, 'PERFORMANCE_ATTACHMENT_LOCKED', '제출하거나 평가가 확정된 성과에는 파일을 추가할 수 없습니다.');
    return { user, task, departmentId: record.departmentId };
  }
  if (isOwnDraftAttachment(taskId, userId) && user.role !== 'head') return { user, task: undefined, departmentId: user.departmentId };
  if (!task || !canReadTask(state, user, task, now)) throw new DomainError(403, 'ATTACHMENT_DENIED', '해당 업무에 파일을 첨부할 수 없습니다.');
  assertTaskWritable(state, task);
  const assigned = user.role === 'admin' || [task.primaryId, ...task.supportIds].includes(user.id) || state.runs.some(run => run.taskId === taskId && run.status !== 'completed' && [run.primaryId, ...run.supportIds].includes(user.id));
  const delegated = canActAsDeputy(state, user, task, 'attachment.upload', now);
  if (!assigned && !delegated) throw new DomainError(403, 'ATTACHMENT_DENIED', '현재 담당자 또는 첨부 권한이 있는 대행자만 등록할 수 있습니다.');
  return { user, task, departmentId: task.departmentId };
}

function uploadSecret() {
  const secret = process.env.IEUM_SESSION_SECRET;
  if (!secret || secret.length < 32) throw new DomainError(503, 'UPLOAD_SIGNING_NOT_CONFIGURED', 'Neon 직접 업로드를 위해 IEUM_SESSION_SECRET을 32자 이상의 임의 문자열로 설정해 주세요.');
  return secret;
}

export function signUploadManifest(value: UploadManifest) {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${body}.${createHmac('sha256', uploadSecret()).update(`attachment-upload:${body}`).digest('hex')}`;
}

export function verifyUploadManifest(token: unknown, userId: string, now = Date.now()): UploadManifest {
  if (typeof token !== 'string' || token.length > 10_000) throw new DomainError(422, 'UPLOAD_TOKEN_INVALID', '파일 업로드 확인 정보를 다시 발급해 주세요.');
  const parts = token.split('.'); const [body, signature] = parts;
  if (parts.length !== 2 || !body || !/^[a-f0-9]{64}$/.test(signature || '')) throw new DomainError(422, 'UPLOAD_TOKEN_INVALID', '파일 업로드 확인 정보가 올바르지 않습니다.');
  const expected = createHmac('sha256', uploadSecret()).update(`attachment-upload:${body}`).digest('hex');
  if (!timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new DomainError(403, 'UPLOAD_TOKEN_INVALID', '파일 업로드 확인 정보가 변경되었습니다. 다시 업로드해 주세요.');
  let value: unknown;
  try { value = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { throw new DomainError(422, 'UPLOAD_TOKEN_INVALID', '파일 업로드 확인 정보를 읽을 수 없습니다.'); }
  const parsed = manifestSchema.safeParse(value);
  if (!parsed.success) throw new DomainError(422, 'UPLOAD_TOKEN_INVALID', '파일 업로드 확인 정보가 올바르지 않습니다.');
  if (parsed.data.userId !== userId) throw new DomainError(403, 'UPLOAD_OWNER_MISMATCH', '파일 업로드를 시작한 계정으로 완료해 주세요.');
  if (parsed.data.expiresAt <= now) throw new DomainError(410, 'UPLOAD_EXPIRED', '파일 업로드 확인 시간이 지났습니다. 파일을 다시 선택해 주세요.');
  return parsed.data;
}

export function recordNeonAttachment(state: WorkspaceData, manifest: UploadManifest) {
  const { departmentId } = assertAttachmentUploadAllowed(state, manifest.userId, manifest.taskId, manifest.performanceId);
  const existing = state.attachments.find(item => item.id === manifest.id);
  if (existing) {
    if (existing.taskId !== manifest.taskId || existing.performanceId !== manifest.performanceId || existing.uploadedBy !== manifest.userId || existing.sha256 !== manifest.sha256 || existing.size !== manifest.size || existing.storageKey !== manifest.storageKey || existing.storageBucket !== manifest.bucket || existing.storageProvider !== 'neon') throw new DomainError(409, 'UPLOAD_CONFLICT', '다른 첨부파일 기록과 충돌합니다. 첨부 목록을 새로 확인해 주세요.');
    return false;
  }
  const now = new Date().toISOString();
  state.attachments.push({ id: manifest.id, taskId: manifest.taskId, ...(manifest.performanceId ? { performanceId: manifest.performanceId } : {}), name: manifest.name, size: manifest.size, mime: manifest.mime, sha256: manifest.sha256, storageKey: manifest.storageKey, storageProvider: 'neon', storageBucket: manifest.bucket, status: 'quarantined', uploadedBy: manifest.userId, createdAt: now });
  state.audit.unshift({ id: randomUUID(), actorId: manifest.userId, action: 'attachment.upload', targetType: 'attachment', targetId: manifest.id, title: '첨부파일 격리 저장', detail: `${manifest.name} · Neon 저장소 · 개발용 출처 확인 대기`, departmentId, createdAt: now });
  state.revision++;
  return true;
}
