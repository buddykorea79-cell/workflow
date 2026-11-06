import type { Attachment, TaskReference } from './types';
import { extractDocument } from './document-extraction';
import { readAttachmentBytes } from './read-attachment';
import { DomainError } from './domain';
import { AI_REFERENCE_TEXT_LIMIT } from './procedure-ai-input';

export async function readProcedureDocuments(references: TaskReference[], attachments: Attachment[], read = readAttachmentBytes) {
  const warnings: string[] = []; const result: TaskReference[] = []; let total = 0;
  for (const reference of references) {
    let content = reference.content;
    if (reference.attachmentId) {
      const attachment = attachments.find(item => item.id === reference.attachmentId);
      if (!attachment) throw new DomainError(409, 'AI_ATTACHMENT_MISSING', `${reference.title}: 연결한 첨부파일을 찾을 수 없습니다.`);
      try {
        const document = await extractDocument(await read(attachment), attachment.name);
        const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
        content = !content.trim() || compact(content) === compact(document.text) ? document.text : `[첨부파일 원문]\n${document.text}\n\n[사용자가 입력한 내용 및 적용 조항]\n${content}`;
        warnings.push(...document.warnings.map(warning => `${attachment.name}: ${warning}`));
      } catch (error) {
        if (error instanceof DomainError) throw new DomainError(error.status, error.code, `${attachment.name}: ${error.message} 파일 본문 분석을 끄면 저장한 텍스트만 분석할 수 있습니다.`);
        throw error;
      }
    }
    total += content.length;
    if (total > AI_REFERENCE_TEXT_LIMIT) throw new DomainError(422, 'AI_REFERENCE_TOO_LONG', '첨부파일을 포함한 분석 본문이 6만 자를 넘었습니다. 근거를 나누어 선택하거나 파일 본문 분석을 끄고 필요한 조항만 입력해 주세요.');
    result.push({ ...reference, content });
  }
  return { references: result, warnings };
}
