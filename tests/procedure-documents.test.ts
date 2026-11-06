import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHwpx } from 'kordoc';
import { readProcedureDocuments } from '../src/lib/procedure-documents';
import { DomainError } from '../src/lib/domain';
import type { Attachment, TaskReference } from '../src/lib/types';

const file = (id: string, name: string): Attachment => ({ id, name, taskId: 'task', size: 10, mime: 'application/octet-stream', sha256: 'a'.repeat(64), storageKey: id, status: 'quarantined', uploadedBy: 'owner', createdAt: '2026-11-06T00:00:00Z' });
const reference = (id: string, attachmentId?: string, content = ''): TaskReference => ({ id, type: 'guideline', title: id, attachmentId, content });
const errorCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;

test('AI preparation reads attached HWPX and TXT with Kordoc and retains manual supplementary clauses', async () => {
  const hwpx = Buffer.from(await markdownToHwpx('# 통계연보 작성 지침\n\n담당자는 통계자료를 수집한다.\n부서장은 통계표를 검토한다.'));
  const attachments = [file('hwp-file', '통계연보.hwpx'), file('txt-file', '검토 안내.txt')];
  const refs = [reference('지침', 'hwp-file'), reference('검토', 'txt-file', '추가 검토사항: 누락자료를 확인한다.')];
  const before = structuredClone(refs); const reads: string[] = [];
  const result = await readProcedureDocuments(refs, attachments, async attachment => { reads.push(attachment.id); return attachment.id === 'hwp-file' ? hwpx : Buffer.from('부서별 통계표를 취합한다.'); });
  assert.deepEqual(reads, ['hwp-file', 'txt-file']); assert.match(result.references[0].content, /담당자는 통계자료를 수집한다/); assert.match(result.references[1].content, /부서별 통계표를 취합한다/); assert.match(result.references[1].content, /누락자료를 확인한다/); assert.deepEqual(refs, before);
});
test('AI attachment preparation avoids duplicated extracted bodies and refuses missing or oversized sources', async () => {
  const attachment = file('file', '자료.txt'); const text = '검토자는 통계표를 확인한다.';
  assert.equal((await readProcedureDocuments([reference('same', 'file', text)], [attachment], async () => Buffer.from(text))).references[0].content, text);
  await assert.rejects(readProcedureDocuments([reference('missing', 'unknown')], []), errorCode('AI_ATTACHMENT_MISSING'));
  await assert.rejects(readProcedureDocuments([reference('too-long', 'file')], [attachment], async () => Buffer.from('가'.repeat(60001))), errorCode('AI_REFERENCE_TOO_LONG'));
  let reads = 0;
  const manual = [reference('manual', undefined, text)];
  assert.deepEqual((await readProcedureDocuments(manual, [], async () => { reads++; return Buffer.alloc(0); })).references, manual); assert.equal(reads, 0);
});
