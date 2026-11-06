import { DomainError } from './domain';

export const DOCUMENT_TEXT_LIMIT = 200_000;
export const DOCUMENT_AI_TEXT_LIMIT = 60_000;
export interface ExtractedDocument { text: string; format: string; pageCount?: number; warnings: string[] }

/** Kordoc reads verified bytes. OCR and automatic model downloads are disabled. */
export async function extractDocument(buffer: Buffer, name: string): Promise<ExtractedDocument> {
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new DomainError(413, 'FILE_TOO_LARGE', '비어 있지 않은 10MB 이하 문서를 선택해 주세요.');
  const extension = name.split('.').pop()?.toLowerCase() || '';
  if (!['pdf', 'hwp', 'hwpx', 'docx', 'xlsx', 'xls', 'pptx', 'txt', 'csv'].includes(extension)) throw new DomainError(415, 'DOCUMENT_FORMAT_UNSUPPORTED', 'PDF, HWP, HWPX, DOCX, XLSX, XLS, PPTX, TXT, CSV 문서를 읽을 수 있습니다.');
  let text = ''; let format = extension; let pageCount: number | undefined; const warnings: string[] = [];
  if (extension === 'txt' || extension === 'csv') {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { text = new TextDecoder('euc-kr').decode(buffer); warnings.push('UTF-8이 아닌 문서를 CP949/EUC-KR로 읽었습니다. 한글을 확인해 주세요.'); }
    if (text.includes('\0')) throw new DomainError(422, 'DOCUMENT_INVALID_TEXT', '텍스트 형식이 아닙니다. 원래 문서 형식으로 올려 주세요.');
  } else {
    try {
      const { parse } = await import('kordoc');
      const parsed = await parse(buffer, { ocr: false, removeHeaderFooter: false, onProgress: (current, total) => { if (total > 150 || current > 150) throw new Error('PAGE_LIMIT'); } });
      if (!parsed.success) throw new DomainError(422, 'DOCUMENT_EXTRACTION_FAILED', `문서를 읽지 못했습니다 (${parsed.code || 'PARSE_ERROR'}). 암호·문서보안을 해제하거나 텍스트 문서로 다시 올려 주세요.`);
      if ((parsed.pageCount || 0) > 150) throw new DomainError(422, 'DOCUMENT_PAGE_LIMIT', '150쪽·섹션 이하의 문서를 선택해 주세요.');
      text = parsed.markdown; format = parsed.fileType; pageCount = parsed.pageCount;
      warnings.push(...(parsed.warnings || []).slice(0, 20).map(warning => warning.message));
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(422, 'DOCUMENT_EXTRACTION_FAILED', '문서를 읽지 못했습니다. 암호·문서보안·손상 여부와 150쪽 이하인지 확인해 주세요.');
    }
  }
  text = text.trim();
  if (!text) throw new DomainError(422, 'DOCUMENT_TEXT_EMPTY', '읽을 수 있는 본문이 없습니다. 스캔·이미지 문서는 OCR 처리 후 올리거나 본문을 직접 입력해 주세요.');
  if (text.length > DOCUMENT_TEXT_LIMIT) throw new DomainError(422, 'DOCUMENT_TEXT_LIMIT', '문서 본문이 20만 자를 넘습니다. 필요한 부분으로 나누어 올려 주세요.');
  return { text, format, pageCount, warnings };
}
