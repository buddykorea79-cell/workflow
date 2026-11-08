import test from 'node:test';
import assert from 'node:assert/strict';
import { extractReferenceFile, referenceWithFile } from '../src/lib/task-references';

test('an existing document uses stored attachment extraction and fills its reference without uploading again', async () => {
  const file = { id: 'stored-plan', name: '내부계획.hwpx' };
  let requests = 0;
  const extracted = await extractReferenceFile('task-1', file, async (url, init) => {
    requests++;
    assert.equal(url, '/api/procedure-extract'); assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), { taskId: 'task-1', attachmentId: 'stored-plan' });
    return Response.json({ text: '담당자는 교육 실적을 취합한다.', warnings: ['원문 확인', null] });
  });
  assert.equal(requests, 1); assert.deepEqual(extracted.warnings, ['원문 확인']);
  const result = referenceWithFile({ id: 'ref-1', type: 'guideline', title: '', content: '' }, file, extracted.text);
  assert.equal(result.content, '담당자는 교육 실적을 취합한다.'); assert.equal(result.attachmentId, file.id);
});

test('stored-file extraction preserves authorization and size errors instead of substituting empty text', async () => {
  const file = { id: 'stored-plan', name: '내부계획.txt' };
  await assert.rejects(extractReferenceFile('task-1', file, async () => Response.json({ error: '이 업무의 문서 본문을 읽을 권한이 없습니다.' }, { status: 403 })), /권한/);
  await assert.rejects(extractReferenceFile('task-1', file, async () => Response.json({ text: '가'.repeat(200001) })), /20만 자/);
  await assert.rejects(extractReferenceFile('task-1', file, async () => Response.json({ text: ' ' })), /본문을 읽지 못/);
});

test('an image remains a file-only reference and does not make an unsupported extraction request', async () => {
  const result = await extractReferenceFile('task-1', { id: 'image', name: '증빙.png' }, async () => { throw new Error('must not fetch'); });
  assert.equal(result.text, ''); assert.match(result.notice, /OCR/);
});
