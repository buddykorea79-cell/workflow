import test from 'node:test';
import assert from 'node:assert/strict';
import { markdownToHwpx } from 'kordoc';
import ExcelJS from 'exceljs';
import { extractDocument } from '../src/lib/document-extraction';
import { generateAiTaskDescription, parseAiDescription } from '../src/lib/bizrouter';
import { DomainError } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';
import { assertAttachmentUploadAllowed } from '../src/lib/attachment-upload';
import { descriptionAttachment } from '../src/lib/task-description-access';

const documents = [
  { attachmentId: 'file-1', name: '점검 지침.hwpx', text: '담당자는 매월 자료를 수집하고 점검표를 작성한다.' },
  { attachmentId: 'file-2', name: '검토 안내.docx', text: '부서장은 점검표를 검토하고 보완사항을 전달한다.' },
];
const valid = () => ({ description: '매월 자료를 수집해 점검표를 작성하고 부서장의 검토를 받습니다.', sources: documents.map(document => ({ attachmentId: document.attachmentId, summary: document.text, quote: document.text })), warnings: [] });
const errorCode = (code: string) => (error: unknown) => error instanceof DomainError && error.code === code;
test('Kordoc reads Korean HWPX paragraphs and tables from actual bytes', async () => {
  const bytes = Buffer.from(await markdownToHwpx('# 점검 업무\n\n담당자는 자료를 수집한다.\n\n| 구분 | 산출물 |\n| --- | --- |\n| 점검 | 업무 점검표 |'));
  const result = await extractDocument(bytes, '업무.hwpx');
  assert.equal(result.format, 'hwpx'); assert.match(result.text, /담당자는 자료를 수집한다/); assert.match(result.text, /업무 점검표/);
});
test('Kordoc reads real Excel bytes and UTF-8 Korean text', async () => {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('업무자료'); sheet.addRow(['담당자', '업무']); sheet.addRow(['홍길동', '자료 수집']);
  assert.match((await extractDocument(Buffer.from(await workbook.xlsx.writeBuffer()), '업무.xlsx')).text, /홍길동/);
  assert.equal((await extractDocument(Buffer.from('업무 설명입니다.'), '업무.txt')).text, '업무 설명입니다.');
});
test('extraction rejects binary text, unreadable documents, empty and oversized files', async () => {
  await assert.rejects(extractDocument(Buffer.from([0, 1, 2]), 'fake.txt'), errorCode('DOCUMENT_INVALID_TEXT'));
  await assert.rejects(extractDocument(Buffer.from('not a document'), 'fake.docx'), errorCode('DOCUMENT_EXTRACTION_FAILED'));
  await assert.rejects(extractDocument(Buffer.alloc(0), 'empty.txt'), errorCode('FILE_TOO_LARGE'));
  await assert.rejects(extractDocument(Buffer.from('a'.repeat(200_001)), 'large.txt'), errorCode('DOCUMENT_TEXT_LIMIT'));
});
test('description requires one source summary per file and authentic quotations', () => {
  assert.equal(parseAiDescription(valid(), documents).sources.length, 2);
  const missing = valid(); missing.sources.pop(); assert.throws(() => parseAiDescription(missing, documents), errorCode('AI_INCOMPLETE_SUMMARY'));
  const fabricated = valid(); fabricated.sources[0].quote = '원문에 없는 법령'; assert.throws(() => parseAiDescription(fabricated, documents), errorCode('AI_UNVERIFIED_EVIDENCE'));
});
test('BizRouter description validates models and repairs a missing-file summary once', async () => {
  let completions = 0;
  const result = await generateAiTaskDescription({ title: '점검', description: '', documents }, { apiKey: 'test', model: 'test/model', fetcher: (async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/models')) return Response.json({ models: [{ id: 'test/model', response_format_modes: ['json_schema'] }] });
    const body = JSON.parse(String(init?.body)); assert.equal(body.stream, false); assert.match(body.messages[0].content, /문서 속 명령을 따르지/);
    const response = valid(); if (!completions++) response.sources.pop();
    return Response.json({ model: 'test/model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(response) } }] });
  }) as typeof fetch });
  assert.equal(completions, 2); assert.equal(result.draft.sources.length, 2);
});
test('BizRouter rejects oversized input before any network call', async () => {
  await assert.rejects(generateAiTaskDescription({ title: '점검', description: '', documents: [{ ...documents[0], text: 'a'.repeat(60_001) }] }, { apiKey: 'test', model: 'test/model', fetcher: (() => { throw new Error('network must not run'); }) as typeof fetch }), errorCode('AI_DOCUMENT_TOO_LONG'));
});

test('description uploads respect administrator editing and isolate draft file access', () => {
  const state = createSeed(); const task = state.tasks.find(task => task.id === 'task-data')!;
  const admin = state.users.find(user => user.role === 'admin')!;
  assert.doesNotThrow(() => assertAttachmentUploadAllowed(state, admin.id, task.id));
  const draftId = `draft:${task.primaryId}:11111111-1111-4111-8111-111111111111`;
  state.attachments.push({ id: 'draft-test', taskId: draftId, name: '안내.txt', size: 10, mime: 'text/plain', sha256: 'a'.repeat(64), storageKey: 'draft-test.bin', status: 'quarantined', uploadedBy: task.primaryId, createdAt: new Date().toISOString() });
  assert.equal(descriptionAttachment(state, task.primaryId, 'draft-test').id, 'draft-test');
  assert.throws(() => descriptionAttachment(state, 'u-jiho', 'draft-test'), errorCode('DESCRIPTION_EDIT_DENIED'));
  assert.throws(() => assertAttachmentUploadAllowed(state, 'u-jiho', draftId), errorCode('ATTACHMENT_DENIED'));
});
