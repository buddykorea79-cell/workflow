import { NextRequest } from 'next/server';
import path from 'node:path';
import { assertSameOrigin, currentUserId, isLocalDemo } from '@/lib/auth';
import { activeUser, assertDefinitionWritable, assertTaskWritable, canReadTask, DomainError } from '@/lib/domain';
import { transaction } from '@/lib/store';
import { apiError, json } from '@/lib/api';
import { pdfEnvelopeError, PROCEDURE_PDF_LIMIT, PROCEDURE_TEXT_LIMIT, type ProcedurePage } from '@/lib/procedure-draft';

export const runtime = 'nodejs';

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
    if (!isLocalDemo(request)) throw new DomainError(503, 'LOCAL_EXTRACTION_ONLY', 'PDF 본문 추출은 로컬 시연 환경에서 지원합니다. 본문을 직접 붙여 넣어 주세요.');
    const form = await boundedForm(request); const file = form.get('file'); const taskId = form.get('taskId');
    if (!(file instanceof File) || typeof taskId !== 'string' || !taskId || taskId.length > 150) throw new DomainError(422, 'FILE_REQUIRED', '업무와 PDF 파일을 선택해 주세요.');
    if (!file.size || file.size > PROCEDURE_PDF_LIMIT) throw new DomainError(413, 'FILE_TOO_LARGE', 'PDF는 비어 있지 않은 10MB 이하 파일이어야 합니다.');
    await transaction(state => {
      const user = activeUser(state, userId); const task = state.tasks.find(item => item.id === taskId);
      if (!task || !canReadTask(state, user, task)) throw new DomainError(403, 'PROCEDURE_ACCESS_DENIED', '이 업무의 절차를 작성할 권한이 없습니다.');
      assertTaskWritable(state, task);
      if (task.status === 'archived') throw new DomainError(409, 'TASK_ARCHIVED', '보관된 업무의 절차는 변경할 수 없습니다.');
      if (user.id !== task.primaryId && user.role !== 'admin' && !(user.departmentId === task.departmentId && ['manager', 'head'].includes(user.role))) throw new DomainError(403, 'PROCEDURE_EDIT_DENIED', '담당자 또는 부서 관리자만 절차 자료를 가져올 수 있습니다.');
      assertDefinitionWritable(state, user, task.departmentId);
    });
    const bytes = new Uint8Array(await file.arrayBuffer()); const envelopeError = pdfEnvelopeError(file.name, file.type, bytes);
    if (envelopeError) throw new DomainError(415, 'PDF_REQUIRED', envelopeError);
    let loading: ReturnType<(typeof import('pdfjs-dist/legacy/build/pdf.mjs'))['getDocument']> | undefined;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // PDF.js uses its local fake-worker implementation in Node; no worker URL,
    // source URL, attachment storage or external service is involved.
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
