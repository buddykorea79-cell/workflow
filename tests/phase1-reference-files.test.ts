import test from 'node:test';
import assert from 'node:assert/strict';
import { referenceWithFile } from '../src/lib/task-references';
import type { TaskReference } from '../src/lib/types';

const existing: TaskReference = { id: 'law-1', type: 'guideline', title: '업무 지침', content: '개정 전 검토 절차', attachmentId: 'old-file', url: 'https://example.com/guideline' };
const newFile = { id: 'new-file', name: '개정 업무 지침.pdf' };

test('replacing a reference file uses its newly extracted content and retains reference identity', () => {
  const changed = referenceWithFile(existing, newFile, '개정 후 검토 절차');
  assert.equal(changed.content, '개정 후 검토 절차');
  assert.equal(changed.attachmentId, 'new-file');
  assert.equal(changed.id, existing.id);
  assert.equal(changed.type, existing.type);
  assert.equal(changed.url, existing.url);
  assert.equal(existing.content, '개정 전 검토 절차');
});

test('an unsupported or unreadable replacement never silently keeps the previous file text', () => {
  assert.equal(referenceWithFile(existing, newFile, '').content, '');
});

test('previous text is retained only after an explicit verified-text selection', () => {
  assert.equal(referenceWithFile(existing, newFile, '새 본문', true).content, existing.content);
});

test('a first attachment supplies an empty reference title and respects the extraction limit', () => {
  const changed = referenceWithFile({ ...existing, title: '', content: '', attachmentId: undefined }, newFile, '가'.repeat(12000));
  assert.equal(changed.title, newFile.name);
  assert.equal(changed.content.length, 10000);
});
