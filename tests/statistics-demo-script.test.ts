import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createSeed } from '../src/lib/seed';
import { STATISTICS_DEMO_IDS as ids, STATISTICS_DEMO_MARKER } from '../src/lib/statistics-demo';

const exec = promisify(execFile);
test('statistics setup CLI previews without changes and requires explicit database workspace confirmation', async () => {
  const qaRoot = path.resolve(process.cwd(), '.qa-data'); await mkdir(qaRoot, { recursive: true });
  const directory = await mkdtemp(path.join(qaRoot, 'statistics-script-'));
  const source = path.join(directory, 'workspace.json'); const state = createSeed(new Date('2026-11-06T03:00:00Z'));
  state.units = state.units.filter(unit => !unit.id.startsWith('statistics-demo-')); state.tasks = state.tasks.filter(task => task.id !== ids.task);
  state.commonTasks = state.commonTasks.filter(common => common.id !== ids.common); state.notifications = state.notifications.filter(notification => notification.id !== ids.notification);
  state.audit = state.audit.filter(event => event.targetId !== STATISTICS_DEMO_MARKER);
  await writeFile(source, JSON.stringify(state, null, 2));
  const before = await readFile(source, 'utf8');
  const args = ['--import', 'tsx', 'scripts/setup-statistics-demo.ts'];
  const env = { ...process.env, DATABASE_URL: '', VERCEL: '', IEUM_DATA_DIR: directory, IEUM_WORKSPACE_ID: 'statistics-cli-test' };
  try {
    const preview = await exec(process.execPath, args, { cwd: process.cwd(), env }); const plan = JSON.parse(preview.stdout);
    assert.equal(plan.mode, 'preview'); assert.equal(plan.addedTasks, 1); assert.equal(plan.addedCommonTasks, 1); assert.equal(await readFile(source, 'utf8'), before);
    assert.deepEqual((await readdir(directory)).sort(), ['workspace.json']);
    await assert.rejects(exec(process.execPath, [...args, '--apply', '--expect-workspace', 'wrong'], { cwd: process.cwd(), env: { ...env, IEUM_STORE: 'neon', DATABASE_URL: 'not-a-real-connection-string' } }), error => {
      const failure = error as { stderr?: string }; assert.match(failure.stderr || '', /expect-workspace/); assert.equal(failure.stderr?.includes('not-a-real-connection-string'), false); return true;
    });
    assert.equal(await readFile(source, 'utf8'), before);
    const localPreview = await exec(process.execPath, args, { cwd: process.cwd(), env: { ...env, IEUM_STORE: 'local', DATABASE_URL: 'not-a-real-connection-string' } });
    assert.equal(JSON.parse(localPreview.stdout).storage, 'local');
    assert.equal(await readFile(source, 'utf8'), before);
  } finally {
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(qaRoot + path.sep) && path.basename(resolved).startsWith('statistics-script-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
