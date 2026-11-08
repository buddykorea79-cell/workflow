import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import filesystem from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/workspace/route';
import { sessionCookie, signSession } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';

test('workspace GET reads through a writer lock and reconciles only authorized due handovers', async t => {
  const root = path.resolve('.data'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'workspace-read-route-'));
  const keys = ['IEUM_STORE', 'IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE', 'IEUM_SESSION_SECRET'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(async () => {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(directory), root); await rm(directory, { recursive: true, force: true });
  });
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { IEUM_STORE: 'local', IEUM_DATA_DIR: directory, IEUM_SESSION_SECRET: 'local-workspace-read-route-test-secret' });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('This test cannot contact a real service.'); });
  const file = path.join(directory, 'workspace.json'), lock = path.join(directory, '.workspace.lock');
  const request = (id?: string) => new NextRequest('http://127.0.0.1:3000/api/workspace', { headers: { host: '127.0.0.1:3000', ...(id ? { cookie: `${sessionCookie}=${signSession(id)}` } : {}) } });
  const state = createSeed();
  state.handovers = [];
  const original = JSON.stringify(state);
  await writeFile(file, original); await writeFile(lock, 'held by a synthetic writer', { flag: 'wx' });
  assert.equal((await GET(request('u-admin'))).status, 200);
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal(await readFile(lock, 'utf8'), 'held by a synthetic writer');
  assert.equal((await GET(request())).status, 401);
  assert.equal(await readFile(file, 'utf8'), original);
  await unlink(lock);

  const due = createSeed();
  const handover = due.handovers.find(item => item.status === 'scheduled')!;
  assert.ok(handover);
  handover.effectiveAt = new Date(Date.now() - 60_000).toISOString();
  due.users.find(user => user.id === 'u-support-member')!.active = false;
  const before = JSON.stringify(due);
  await writeFile(file, before);
  assert.equal((await GET(request('u-support-member'))).status, 401);
  assert.equal(await readFile(file, 'utf8'), before, 'An inactive user cannot trigger a scheduled transfer.');
  const response = await GET(request('u-admin'));
  assert.equal(response.status, 200);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.handovers.find((item: { id: string }) => item.id === handover.id).status, 'completed');
  assert.ok(saved.revision > due.revision);
  const committed = JSON.stringify(saved);
  assert.equal((await GET(request('u-admin'))).status, 200);
  assert.equal(JSON.stringify(JSON.parse(await readFile(file, 'utf8'))), committed, 'Completed transfers are not applied twice.');
});

test('workspace GET rechecks employment deadlines at the time it acquires the writer lock', async t => {
  const root = path.resolve('.data'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'workspace-read-time-'));
  const keys = ['IEUM_STORE', 'IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE', 'IEUM_SESSION_SECRET'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(async () => {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(directory), root); await rm(directory, { recursive: true, force: true });
  });
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { IEUM_STORE: 'local', IEUM_DATA_DIR: directory, IEUM_SESSION_SECRET: 'local-workspace-clock-test-secret' });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('This test cannot contact a real service.'); });
  const before = Date.parse('2026-11-07T03:00:00Z'), after = before + 2_000;
  t.mock.timers.enable({ apis: ['Date'], now: before });
  const originalOpen = filesystem.open;
  let lockAttempts = 0;
  const openMock = t.mock.method(filesystem, 'open', async (...args: Parameters<typeof filesystem.open>) => {
    if (String(args[0]) === path.join(directory, '.workspace.lock')) {
      lockAttempts++;
      // Simulate elapsed lock acquisition without a real sleep or timing race.
      t.mock.timers.setTime(after);
    }
    return originalOpen(...args);
  });
  syncBuiltinESMExports();
  t.after(() => { openMock.mock.restore(); syncBuiltinESMExports(); });
  const file = path.join(directory, 'workspace.json');
  for (const expires of ['requester', 'recipient'] as const) {
    t.mock.timers.setTime(before);
    const state = createSeed(new Date(before));
    const handover = state.handovers.find(item => item.status === 'scheduled')!;
    assert.ok(handover);
    handover.effectiveAt = new Date(before - 60_000).toISOString();
    state.users.find(user => user.id === (expires === 'requester' ? 'u-admin' : handover.toId))!.endsAt = new Date(before + 1_000).toISOString();
    const original = JSON.stringify(state);
    await writeFile(file, original);
    const request = new NextRequest('http://127.0.0.1:3000/api/workspace', { headers: { host: '127.0.0.1:3000', cookie: `${sessionCookie}=${signSession('u-admin')}` } });
    const previousAttempts = lockAttempts;
    const response = await GET(request);
    assert.equal(lockAttempts, previousAttempts + 1, 'The deadline passes after the first snapshot check, when the write path starts.');
    assert.equal(response.status, expires === 'requester' ? 401 : 200);
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.handovers.find((item: { id: string }) => item.id === handover.id).status, 'scheduled', 'An expired requester or recipient must not apply a transfer.');
    if (expires === 'requester') {
      assert.equal((await response.json()).code, 'ACCOUNT_INACTIVE');
      assert.equal(await readFile(file, 'utf8'), original, 'Authorization failure must not change the committed snapshot.');
    }
  }
});
