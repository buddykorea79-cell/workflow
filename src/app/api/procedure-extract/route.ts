import { NextRequest } from 'next/server';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assertSameOrigin, currentUserId, isDemoSession } from '@/lib/auth';
import { activeUser, assertDefinitionWritable, assertTaskWritable, canReadTask, DomainError } from '@/lib/domain';
import { dataDirectory, transaction } from '@/lib/store';
import { readNeonFile } from '@/lib/attachment-storage';
import { apiError, json } from '@/lib/api';
import { pdfEnvelopeError, PROCEDURE_PDF_LIMIT, PROCEDURE_TEXT_LIMIT, type ProcedurePage } from '@/lib/procedure-draft';

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
  if (Number(request.headers.get('content-length') || 0) > limit) throw new DomainError(413, 'FILE_TOO_LARGE', 'PDF는 10MB 이하로 선택해 주세요.');
  if (!request.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new DomainError(415, 'FORM_REQUIRED', 'PDF 파일 업로드 형식을 확인해 주세요.');
  const reader = request.body?.getReader(); if (!reader) throw new DomainError(422, 'FILE_REQUIRED', 'PDF 파일을 선택해 주세요.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      size += item.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new DomainError(413, 'FILE_TOO_LARGE', 'PDF는 10MB 이하로 선택해 주세요.'); }
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
    if (!isDemoSession(request)) throw new DomainError(503, 'PROTOTYPE_EXTRACTION_ONLY', 'PDF 본문 추출은 프로토타입 모드에서 지원합니다.');
    let taskId: string; let attachmentId: string | undefined; let file: File | undefined;
    if (request.headers.get('content-type')?.startsWith('application/json')) {
      const bodyText = await attachmentRequestText(request);
      let body: { taskId?: unknown; attachmentId?: unknown };
      try { body = JSON.parse(bodyText); } catch { throw new DomainError(422, 'FILE_REQUIRED', '업무와 첨부파일을 선택해 주세요.'); }
      if (!body || typeof body.taskId !== 'string' || typeof body.attachmentId !== 'string' || !body.attachmentId || body.attachmentId.length > 150) throw new DomainError(422, 'FILE_REQUIRED', '업무와 첨부파일을 선택해 주세요.');
      taskId = body.taskId; attachmentId = body.attachmentId;
    } else {
      const form = await boundedForm(request); const selected = form.get('file'); const id = form.get('taskId');
      if (!(selected instanceof File) || typeof id !== 'string') throw new DomainError(422, 'FILE_REQUIRED', '업무와 PDF 파일을 선택해 주세요.');
      file = selected; taskId = id;
      if (!file.size || file.size > PROCEDURE_PDF_LIMIT) throw new DomainError(413, 'FILE_TOO_LARGE', 'PDF는 비어 있지 않은 10MB 이하 파일이어야 합니다.');
    }
    if (!taskId || taskId.length > 150) throw new DomainError(422, 'FILE_REQUIRED', '업무와 PDF 파일을 선택해 주세요.');
    const attachment = await transaction(state => {
      const user = activeUser(state, userId); const task = state.tasks.find(item => item.id === taskId);
      if (!task || !canReadTask(state, user, task)) throw new DomainError(403, 'PROCEDURE_ACCESS_DENIED', '이 업무의 절차를 작성할 권한이 없습니다.');
      assertTaskWritable(state, task);
      if (task.status === 'archived') throw new DomainError(409, 'TASK_ARCHIVED', '보관된 업무의 절차는 변경할 수 없습니다.');
      if (user.id !== task.primaryId && user.role !== 'admin' && !(user.departmentId === task.departmentId && ['manager', 'head'].includes(user.role))) throw new DomainError(403, 'PROCEDURE_EDIT_DENIED', '담당자 또는 부서 관리자만 절차 자료를 가져올 수 있습니다.');
      assertDefinitionWritable(state, user, task.departmentId);
      if (!attachmentId) return undefined;
      const attachment = state.attachments.find(item => item.id === attachmentId && item.taskId === taskId);
      if (!attachment) throw new DomainError(404, 'ATTACHMENT_NOT_FOUND', '이 업무의 첨부파일을 찾을 수 없습니다.');
      if (!attachment.size || attachment.size > PROCEDURE_PDF_LIMIT) throw new DomainError(413, 'FILE_TOO_LARGE', 'PDF는 비어 있지 않은 10MB 이하 파일이어야 합니다.');
      return attachment;
    });
    const buffer = attachment
      ? attachment.storageProvider === 'neon' ? await readNeonFile(attachment.storageKey, attachment.storageBucket) : await readFile(path.join(dataDirectory(), 'files', path.basename(attachment.storageKey)))
      : Buffer.from(await file!.arrayBuffer());
    if (attachment && (buffer.length !== attachment.size || createHash('sha256').update(buffer).digest('hex') !== attachment.sha256)) throw new DomainError(409, 'ATTACHMENT_CHANGED', '저장된 첨부파일의 크기나 내용이 다릅니다. 파일을 다시 등록해 주세요.');
    const bytes = new Uint8Array(buffer); const envelopeError = pdfEnvelopeError(attachment ? attachment.name : file!.name, attachment ? attachment.mime : file!.type, bytes);
    if (envelopeError) throw new DomainError(415, 'PDF_REQUIRED', envelopeError);
    let loading: ReturnType<(typeof import('pdfjs-dist/legacy/build/pdf.mjs'))['getDocument']> | undefined;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // PDF.js parses the verified bytes inside Node; it does not fetch source URLs
    // or send document contents to an external extraction service.
    // @ts-expect-error PDF.js ships runtime worker exports without declarations.
    const worker = await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    (globalThis as typeof globalThis & { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    const assetDirectory = (name: string) => path.join(process.cwd(), 'node_modules/pdfjs-dist', name).replaceAll('\\', '/') + '/';
    loading = pdfjs.getDocument({ data: bytes, useWorkerFetch: false, useWasm: false, disableFontFace: true, useSystemFonts: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false, cMapUrl: assetDirectory('cmaps'), standardFontDataUrl: assetDirectory('standard_fonts'), stopAtErrors: true, verbosity: 0 });
    timer = setTimeout(() => { timedOut = true; void loading?.destroy().catch(() => undefined); }, 20_000);
      const document = await loading.promise;
      if (document.numPages > 150) throw new DomainError(422, 'PDF_PAGE_LIMIT', '150쪽 이하의 관련 부분만 선택해 주세요.');
      const pages: ProcedurePage[] = []; let total = 0;
      for (let number = 1; number <= document.numPages; number++) {
        if (timedOut || request.signal.aborted) throw new DomainError(408, 'PDF_TIMEOUT', '본문 추출 시간이 길어졌습니다. 관련 부분을 나누거나 본문을 붙여 넣어 주세요.');
        const page = await document.getPage(number); const content = await page.getTextContent();
        const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
        total += text.length;
        if (total > PROCEDURE_TEXT_LIMIT) throw new DomainError(422, 'PDF_TEXT_LIMIT', '추출 본문이 20만 자를 넘었습니다. 필요한 쪽만 나누어 선택해 주세요.');
        pages.push({ page: number, text }); page.cleanup();
      }
      if (!pages.some(page => page.text.trim())) throw new DomainError(422, 'PDF_TEXT_EMPTY', '텍스트를 찾지 못했습니다. 스캔 PDF의 OCR은 지원하지 않습니다. 읽을 수 있는 본문을 직접 붙여 넣어 주세요.');
      return json({ pages, text: pages.map(page => page.text).join('\n\n'), pageCount: document.numPages, warnings: pages.some(page => !page.text.trim()) ? ['일부 쪽에는 추출 가능한 텍스트가 없습니다. 스캔·이미지 부분은 본문을 직접 보완해 주세요.'] : [] });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      if (timedOut) throw new DomainError(408, 'PDF_TIMEOUT', 'PDF 추출 시간이 초과되었습니다. 본문을 직접 붙여 넣어 주세요.');
      throw new DomainError(422, 'PDF_EXTRACTION_FAILED', error instanceof Error && error.name === 'PasswordException' ? '암호가 걸린 PDF입니다. 암호를 해제한 파일을 선택하거나 본문을 붙여 넣어 주세요.' : 'PDF 본문을 읽을 수 없습니다. 텍스트 PDF를 확인하거나 본문을 직접 붙여 넣어 주세요.');
    } finally { clearTimeout(timer); await loading?.destroy().catch(() => undefined); }
  } catch (error) { return apiError(error); }
}
