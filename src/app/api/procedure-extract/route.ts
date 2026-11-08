import { NextRequest } from 'next/server';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assertSameOrigin, currentUserId, isDemoSession } from '@/lib/auth';
import { DomainError } from '@/lib/domain';
import { dataDirectory, transaction } from '@/lib/store';
import { readNeonFile } from '@/lib/attachment-storage';
import { apiError, json } from '@/lib/api';
import { PROCEDURE_PDF_LIMIT } from '@/lib/procedure-draft';
import { extractDocument } from '@/lib/document-extraction';
import { authorizeProcedureExtraction } from '@/lib/procedure-extraction-access';
import { assertUserRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 60;

async function attachmentRequestText(request: NextRequest) {
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError(422, 'FILE_REQUIRED', '업무와 첨부파일을 선택해 주세요.');
  const decoder = new TextDecoder(); let text = ''; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 2000) { await reader.cancel(); throw new DomainError(413, 'REQUEST_TOO_LARGE', '첨부파일 식별정보만 전송해 주세요.'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function boundedForm(request: NextRequest) {
  const limit = PROCEDURE_PDF_LIMIT + 100_000;
  if (Number(request.headers.get('content-length') || 0) > limit) throw new DomainError(413, 'FILE_TOO_LARGE', '문서는 10MB 이하로 선택해 주세요.');
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new DomainError(415, 'FORM_REQUIRED', '문서 파일 업로드 형식을 확인해 주세요.');
  const reader = request.body?.getReader(); if (!reader) throw new DomainError(422, 'FILE_REQUIRED', '문서 파일을 선택해 주세요.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new DomainError(413, 'FILE_TOO_LARGE', '문서는 10MB 이하로 선택해 주세요.'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  try { return await new Response(body, { headers: { 'Content-Type': request.headers.get('content-type')! } }).formData(); }
  catch { throw new DomainError(422, 'FORM_INVALID', '파일 업로드 내용을 읽을 수 없습니다. 다시 선택해 주세요.'); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const userId = await currentUserId(request);
    if (!isDemoSession(request)) throw new DomainError(503, 'PROTOTYPE_EXTRACTION_ONLY', '문서 본문 추출은 프로토타입 모드에서 지원합니다.');
    let taskId: string; let attachmentId: string | undefined; let file: File | undefined;
    if (request.headers.get('content-type')?.startsWith('application/json')) {
      const bodyText = await attachmentRequestText(request);
      let body: { taskId?: unknown; attachmentId?: unknown };
      try { body = JSON.parse(bodyText); } catch { throw new DomainError(422, 'FILE_REQUIRED', '업무와 첨부파일을 선택해 주세요.'); }
      if (!body || typeof body.taskId !== 'string' || typeof body.attachmentId !== 'string' || !body.attachmentId || body.attachmentId.length > 150) throw new DomainError(422, 'FILE_REQUIRED', '업무와 첨부파일을 선택해 주세요.');
      taskId = body.taskId; attachmentId = body.attachmentId;
    } else {
      const form = await boundedForm(request); const selected = form.get('file'); const id = form.get('taskId');
      if (!(selected instanceof File) || typeof id !== 'string') throw new DomainError(422, 'FILE_REQUIRED', '업무와 문서 파일을 선택해 주세요.');
      file = selected; taskId = id;
      if (!file.size || file.size > PROCEDURE_PDF_LIMIT) throw new DomainError(413, 'FILE_TOO_LARGE', '문서는 비어 있지 않은 10MB 이하 파일이어야 합니다.');
    }
    if (!taskId || taskId.length > 150) throw new DomainError(422, 'FILE_REQUIRED', '업무와 문서 파일을 선택해 주세요.');
    const attachment = await transaction(state => authorizeProcedureExtraction(state, userId, taskId, attachmentId));
    assertUserRateLimit(userId);
    const buffer = attachment
      ? attachment.storageProvider === 'neon' ? await readNeonFile(attachment.storageKey, attachment.storageBucket) : await readFile(path.join(dataDirectory(), 'files', path.basename(attachment.storageKey)))
      : Buffer.from(await file!.arrayBuffer());
    if (attachment && (buffer.length !== attachment.size || createHash('sha256').update(buffer).digest('hex') !== attachment.sha256)) throw new DomainError(409, 'ATTACHMENT_CHANGED', '저장된 첨부파일의 크기나 내용이 다릅니다. 파일을 다시 등록해 주세요.');
    return json(await extractDocument(buffer, attachment ? attachment.name : file!.name));
  } catch (error) { return apiError(error); }
}
