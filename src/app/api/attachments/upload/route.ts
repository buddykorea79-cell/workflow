import { NextRequest } from 'next/server';
import { createHash, randomUUID } from 'node:crypto';
import { assertSameOrigin, currentUserId, isDemoSession } from '@/lib/auth';
import { DomainError, getWorkspace } from '@/lib/domain';
import { transaction } from '@/lib/store';
import { createNeonUploadUrl, deleteNeonFile, getNeonStorageConfig, readNeonFile, uploadNeonFile } from '@/lib/attachment-storage';
import { assertAttachmentUploadAllowed, parseUploadDescriptor, recordNeonAttachment, signUploadManifest, verifyUploadManifest, type UploadManifest } from '@/lib/attachment-upload';
import { apiError, json } from '@/lib/api';

export const runtime = 'nodejs';
export const maxDuration = 70;

function verifyFile(buffer: Buffer, manifest: UploadManifest) {
  if (buffer.length !== manifest.size || createHash('sha256').update(buffer).digest('hex') !== manifest.sha256) throw new DomainError(409, 'FILE_INTEGRITY_ERROR', '업로드된 파일의 크기 또는 SHA256이 일치하지 않습니다. 다시 업로드해 주세요.');
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    if (!isDemoSession(request)) throw new DomainError(403, 'PROTOTYPE_REQUIRED', '첨부 업로드는 설정된 프로토타입 계정으로 이용해 주세요.');
    const userId = await currentUserId(request);
    if (Number(request.headers.get('content-length') || 0) > 15_000) throw new DomainError(413, 'REQUEST_TOO_LARGE', '파일 업로드 확인 정보가 너무 큽니다.');
    const raw = await request.text();
    if (raw.length > 15_000) throw new DomainError(413, 'REQUEST_TOO_LARGE', '파일 업로드 확인 정보가 너무 큽니다.');
    let body: { action?: unknown; token?: unknown; file?: unknown };
    try { body = JSON.parse(raw); } catch { throw new DomainError(422, 'UPLOAD_REQUEST_INVALID', '파일 업로드 요청 형식을 확인해 주세요.'); }
    if (!body || typeof body !== 'object') throw new DomainError(422, 'UPLOAD_REQUEST_INVALID', '파일 업로드 요청 형식을 확인해 주세요.');
    const storage = getNeonStorageConfig();
    if (body.action === 'prepare') {
      const file = parseUploadDescriptor(body.file);
      await transaction(state => { assertAttachmentUploadAllowed(state, userId, file.taskId, file.performanceId); });
      if (!storage) {
        if (process.env.VERCEL) throw new DomainError(503, 'STORAGE_NOT_CONFIGURED', 'Vercel에서 파일을 올리려면 IEUM_STORAGE_PROVIDER=neon과 Neon 저장소 연결값을 설정해 주세요.');
        return json({ provider: 'local' });
      }
      const id = `attachment-${randomUUID()}`;
      const prefix = `workspaces/${encodeURIComponent(process.env.IEUM_WORKSPACE_ID?.trim() || 'development')}`;
      const manifest: UploadManifest = { ...file, id, userId, bucket: storage.bucket, uploadKey: `${prefix}/pending/${id}.bin`, storageKey: `${prefix}/attachments/${id}.bin`, expiresAt: Date.now() + 10 * 60_000 };
      const token = signUploadManifest(manifest);
      const uploadUrl = await createNeonUploadUrl(manifest.uploadKey, manifest.mime, manifest.bucket);
      return json({ provider: 'neon', uploadUrl, token, contentType: manifest.mime });
    }
    if (body.action !== 'complete') throw new DomainError(422, 'UPLOAD_REQUEST_INVALID', '파일 업로드 단계를 확인해 주세요.');
    if (!storage) throw new DomainError(503, 'STORAGE_NOT_CONFIGURED', 'Neon 파일 저장소 설정을 확인해 주세요.');
    const manifest = verifyUploadManifest(body.token, userId);
    if (manifest.bucket !== storage.bucket) throw new DomainError(409, 'STORAGE_CHANGED', '파일 저장소 설정이 바뀌었습니다. 파일을 다시 선택해 주세요.');
    const existing = await transaction(state => {
      assertAttachmentUploadAllowed(state, userId, manifest.taskId, manifest.performanceId);
      if (!state.attachments.some(item => item.id === manifest.id)) return null;
      recordNeonAttachment(state, manifest);
      return getWorkspace(state, userId);
    });
    if (existing) return json(existing);
    const buffer = await readNeonFile(manifest.uploadKey, manifest.bucket);
    verifyFile(buffer, manifest);
    const workspace = await transaction(async state => {
      assertAttachmentUploadAllowed(state, userId, manifest.taskId, manifest.performanceId);
      if (!state.attachments.some(item => item.id === manifest.id)) {
        try { await uploadNeonFile(manifest.storageKey, buffer, manifest.mime, manifest.bucket); }
        catch (error) {
          if (!(error instanceof DomainError) || error.code !== 'STORAGE_KEY_EXISTS') throw error;
          // A previous attempt may have stored bytes before its DB transaction failed.
          // Reuse only the exact signed file; never overwrite an existing object.
          verifyFile(await readNeonFile(manifest.storageKey, manifest.bucket), manifest);
        }
      }
      recordNeonAttachment(state, manifest);
      return getWorkspace(state, userId);
    });
    await deleteNeonFile(manifest.uploadKey, manifest.bucket).catch(() => undefined);
    return json(workspace);
  } catch (error) { return apiError(error); }
}
