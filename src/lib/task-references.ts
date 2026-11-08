import type { TaskReference } from './types';

/** Empty form rows are placeholders and must not become stored references. */
export function hasReferenceContent(reference: TaskReference) {
  return !!(reference.title.trim() || reference.content.trim() || reference.url?.trim() || reference.attachmentId);
}

export function referencesForSave(references: TaskReference[]) {
  return references.filter(hasReferenceContent);
}

/** Changing a file must never silently carry the previous file's extracted text. */
export function referenceWithFile(reference: TaskReference, file: { id: string; name: string }, extractedText: string, keepVerifiedText = false): TaskReference {
  return { ...reference, title: reference.title.trim() || file.name.slice(0, 300), attachmentId: file.id, content: keepVerifiedText ? reference.content : extractedText.slice(0, 200000) };
}

export const referenceDocumentFile = (name: string) => /\.(pdf|hwp|hwpx|docx|xlsx|xls|pptx|txt|csv)$/i.test(name);

/** Reuse the permission-checked stored-file extraction route for both file pickers. */
export async function extractReferenceFile(taskId: string, file: { id: string; name: string }, fetcher: typeof fetch = fetch) {
  if (!referenceDocumentFile(file.name)) return { text: '', warnings: [] as string[], notice: '이미지는 OCR 처리한 문서로 올리거나 주요 내용을 직접 입력해 주세요.' };
  const response = await fetcher('/api/procedure-extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId, attachmentId: file.id }) });
  const body = await response.json() as { text?: unknown; error?: unknown; warnings?: unknown };
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : '문서 본문을 읽지 못했습니다.');
  if (typeof body.text !== 'string' || !body.text.trim()) throw new Error('문서에서 본문을 읽지 못했습니다. 파일을 확인하거나 주요 내용을 직접 입력해 주세요.');
  if (body.text.length > 200000) throw new Error('추출 본문이 20만 자를 넘었습니다. 필요한 부분으로 나누어 주세요.');
  return { text: body.text, warnings: Array.isArray(body.warnings) ? body.warnings.filter((warning): warning is string => typeof warning === 'string') : [], notice: '' };
}
