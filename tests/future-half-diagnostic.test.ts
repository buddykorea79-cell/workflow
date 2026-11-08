import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const script = path.resolve('scripts/check-future-half-periods.ts');
function run(args: string[], directory: string) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
    encoding: 'utf8', timeout: 15_000, windowsHide: true,
    env: { ...process.env, DATABASE_URL: 'postgres://synthetic:synthetic@unused.invalid/database', IEUM_STORE: 'neon', IEUM_DATA_DIR: directory },
  });
}
async function clean(directory: string) {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith('ieum-future-half-diagnostic-'));
  await rm(directory, { recursive: true, force: true });
}

test('future-half diagnostic reads explicit synthetic files without locks, writes or document content output', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-future-half-diagnostic-'));
  try {
    const file = path.join(directory, 'workspace.json');
    const privateText = 'synthetic-document-content-must-not-appear';
    const original = JSON.stringify({
      performances: [
        { id: 'past', period: '2026-H1', description: privateText },
        { id: 'next', period: '2026-H2', authorId: 'person', taskId: 'task', departmentId: 'department', status: 'draft', description: privateText, evidence: privateText, email: privateText },
        { id: 'later', period: '2027-H1', authorId: 'person', description: privateText },
        { id: 'legacy', period: '2026년 4분기', description: privateText },
      ],
      unitScorePlans: [{ id: 'plan', period: '2026-H2', personId: 'person', allocations: [{ unitTitle: privateText }] }],
      unitEvaluations: [{ id: 'evaluation', period: '2027-H1', personId: 'person', comment: privateText }],
    }, null, 2) + '\n';
    await writeFile(file, original);
    await writeFile(path.join(directory, '.workspace.lock'), 'synthetic active writer');
    const beforeEntries = (await readdir(directory)).sort();
    const before = run(['--file', file, '--now', '2026-06-30T14:59:59Z'], directory);
    assert.equal(before.status, 0, before.stderr);
    assert.equal(before.stdout.includes(privateText), false);
    assert.equal(before.stdout.includes('unused.invalid'), false);
    const report = JSON.parse(before.stdout);
    assert.equal(report.readOnly, true); assert.equal(report.source, 'file');
    assert.equal(report.currentHalf, '2026-H1');
    assert.deepEqual(report.counts, { performances: 2, unitScorePlans: 1, unitEvaluations: 1 });
    assert.deepEqual(report.futurePeriods, ['2026-H2', '2027-H1']);
    assert.deepEqual(report.records.performances[0], { period: '2026-H2', id: 'next', taskId: 'task', departmentId: 'department', status: 'draft', personId: 'person' });
    const after = run(['--file', file, '--now', '2026-06-30T15:00:00Z'], directory);
    assert.equal(after.status, 0, after.stderr);
    const nextHalf = JSON.parse(after.stdout);
    assert.equal(nextHalf.currentHalf, '2026-H2');
    assert.deepEqual(nextHalf.counts, { performances: 1, unitScorePlans: 0, unitEvaluations: 1 });
    assert.equal(await readFile(file, 'utf8'), original);
    assert.equal(await readFile(path.join(directory, '.workspace.lock'), 'utf8'), 'synthetic active writer');
    assert.deepEqual((await readdir(directory)).sort(), beforeEntries);
  } finally { await clean(directory); }
});

test('future-half diagnostic requires an explicit input and never initializes a missing store', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-future-half-diagnostic-'));
  try {
    const help = run([], directory);
    assert.equal(help.status, 0, help.stderr); assert.equal(JSON.parse(help.stdout).readOnly, true);
    const missing = path.join(directory, 'missing.json');
    for (const args of [ ['--file', missing], ['--neon'], ['--file', missing, '--neon'], ['--apply'], ['--file', missing, '--now', 'not-a-date'] ]) {
      const result = run(args, directory);
      assert.equal(result.status, 1, JSON.stringify(args));
      assert.equal(result.stdout, '');
      assert.equal(result.stderr.includes('unused.invalid'), false);
      assert.equal(typeof JSON.parse(result.stderr).error, 'string');
    }
    assert.deepEqual(await readdir(directory), []);
  } finally { await clean(directory); }
});
