import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { markdownToHwpx } from 'kordoc';
import { readProcedureDocuments, readProcedureOverviewDocuments } from '../src/lib/procedure-documents';
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

test('procedure overview reads every attached HWPX and TXT as a primary document without changing attachment metadata', async () => {
  const hwpx = Buffer.from(await markdownToHwpx('# 업무 개요 붙임\n\n담당자는 오류 목록을 작성한다.\n\n부서장은 정비 결과를 검토한다.'));
  const attachments = [file('overview-hwpx', '업무 처리 계획.hwpx'), file('overview-txt', '제출 안내.txt')];
  const before = structuredClone(attachments); const reads: string[] = [];
  const result = await readProcedureOverviewDocuments(attachments, async attachment => { reads.push(attachment.id); return attachment.id === 'overview-hwpx' ? hwpx : Buffer.from('담당자는 승인된 결과를 제출한다.'); });
  assert.deepEqual(reads, ['overview-hwpx', 'overview-txt']);
  assert.deepEqual(result.documents.map(document => ({ attachmentId: document.attachmentId, name: document.name })), attachments.map(attachment => ({ attachmentId: attachment.id, name: attachment.name })));
  assert.match(result.documents[0].text, /담당자는 오류 목록을 작성한다/);
  assert.match(result.documents[0].text, /부서장은 정비 결과를 검토한다/);
  assert.equal(result.documents[1].text, '담당자는 승인된 결과를 제출한다.');
  assert.deepEqual(attachments, before);
});

test('procedure overview validates file counts and duplicate IDs before any read, and allows an overview without files', async () => {
  let reads = 0; const read = async () => { reads++; return Buffer.from('담당자는 결과를 작성한다.'); };
  assert.deepEqual(await readProcedureOverviewDocuments([], read), { documents: [], warnings: [] });
  await assert.rejects(readProcedureOverviewDocuments([file('same', '하나.txt'), file('same', '둘.txt')], read), errorCode('AI_OVERVIEW_ATTACHMENTS_INVALID'));
  await assert.rejects(readProcedureOverviewDocuments(Array.from({ length: 11 }, (_, index) => file(`file-${index}`, `붙임${index}.txt`)), read), errorCode('AI_OVERVIEW_ATTACHMENTS_INVALID'));
  assert.equal(reads, 0);
});

test('procedure overview refuses unreadable, empty, or oversized documents and identifies the file that failed', async () => {
  const attachment = file('overview', '업무 개요.txt');
  await assert.rejects(readProcedureOverviewDocuments([attachment], async () => Buffer.from(' \n ')), (error: unknown) => errorCode('DOCUMENT_TEXT_EMPTY')(error) && (error as Error).message.startsWith('업무 개요.txt:'));
  await assert.rejects(readProcedureOverviewDocuments([attachment], async () => { throw new Error('filesystem failure with private path'); }), (error: unknown) => errorCode('AI_OVERVIEW_ATTACHMENT_READ_FAILED')(error) && (error as Error).message.startsWith('업무 개요.txt:') && !(error as Error).message.includes('private path'));
  await assert.rejects(readProcedureOverviewDocuments([attachment, file('second', '추가 자료.txt')], async () => Buffer.from('가'.repeat(30_001))), (error: unknown) => errorCode('AI_DOCUMENT_TOO_LONG')(error) && (error as Error).message.startsWith('추가 자료.txt:'));
  await assert.rejects(readProcedureOverviewDocuments([file('bad', '자료.bin')], async () => Buffer.from('invalid')), (error: unknown) => errorCode('DOCUMENT_FORMAT_UNSUPPORTED')(error) && (error as Error).message.startsWith('자료.bin:'));
});

test('procedure overview uses the default reader integrity checks before sending a stored document for extraction', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-overview-documents-'));
  const previousDataDirectory = process.env.IEUM_DATA_DIR;
  try {
    process.env.IEUM_DATA_DIR = directory;
    await mkdir(path.join(directory, 'files'));
    const bytes = Buffer.from('부서장은 검토한 결과를 승인한다.');
    const attachment: Attachment = { ...file('integrity', '검토 자료.txt'), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), storageProvider: 'local' };
    await writeFile(path.join(directory, 'files', attachment.storageKey), bytes);
    assert.equal((await readProcedureOverviewDocuments([attachment])).documents[0].text, bytes.toString('utf8'));
    await assert.rejects(readProcedureOverviewDocuments([{ ...attachment, sha256: '0'.repeat(64) }]), (error: unknown) => errorCode('ATTACHMENT_CHANGED')(error) && (error as Error).message.startsWith('검토 자료.txt:'));
    await assert.rejects(readProcedureOverviewDocuments([{ ...attachment, size: bytes.length + 1 }]), errorCode('ATTACHMENT_CHANGED'));
  } finally {
    if (previousDataDirectory === undefined) delete process.env.IEUM_DATA_DIR; else process.env.IEUM_DATA_DIR = previousDataDirectory;
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ieum-overview-documents-'));
    await rm(directory, { recursive: true, force: true });
  }
});
