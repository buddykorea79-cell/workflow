import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

// These describe a future personnel date or an old planned deliverable, rather
// than the execution status of a task. Every exception is narrow and explicit.
const allowedContexts: Record<string, string[]> = {
  'delegation-work.tsx': ['승인 · 시작 예정'],
  'personnel-handover.tsx': ["scheduled: '예정'"],
  'work-cycles.tsx': ['예정 결과물:'],
};

test('components use the shared task status terminology', async () => {
  const directory = path.resolve('src/components');
  const failures: string[] = [];
  for (const filename of await readdir(directory)) {
    if (!filename.endsWith('.tsx')) continue;
    let source = await readFile(path.join(directory, filename), 'utf8');
    for (const allowed of allowedContexts[filename] ?? []) source = source.replaceAll(allowed, '');
    // Definition-review language is intentionally different from execution review.
    source = source.replaceAll('기준 검토 중', '');
    for (const word of ['배부', '보류', '검토 중', '예정']) {
      if (source.includes(word)) failures.push(`${filename}: ${word}`);
    }
  }
  assert.deepEqual(failures, []);
});
