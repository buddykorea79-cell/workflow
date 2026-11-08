import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { DomainError } from '../src/lib/domain-error';
import { createSeed } from '../src/lib/seed';
import { readState, transaction } from '../src/lib/store';

const now = new Date('2026-11-07T03:00:00Z');
const persistedSeed = () => JSON.parse(JSON.stringify(createSeed(now))) as ReturnType<typeof createSeed>;
const envKeys = ['IEUM_STORE', 'IEUM_DATA_DIR', 'DATABASE_URL', 'IEUM_WORKSPACE_ID', 'VERCEL'] as const;
function preserveEnvironment(t: TestContext) {
  const before = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of envKeys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } });
}
async function localFixture(t: TestContext) {
  preserveEnvironment(t);
  const root = path.resolve('.data'); await mkdir(root, { recursive: true });
  const directory = await mkdtemp(path.join(root, 'read-state-test-'));
  t.after(async () => { assert.equal(path.dirname(path.resolve(directory)), root); await rm(directory, { recursive: true, force: true }); });
  delete process.env.VERCEL;
  Object.assign(process.env, { IEUM_STORE: 'local', IEUM_DATA_DIR: directory, DATABASE_URL: 'postgresql://fake:fake@never-connect.invalid/fake' });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Real network access is forbidden in read-state tests.'); });
  return { directory, file: path.join(directory, 'workspace.json'), lock: path.join(directory, '.workspace.lock') };
}

test('readState reads an existing snapshot without taking or altering the writer lock', async t => {
  const { directory, file, lock } = await localFixture(t);
  const state = persistedSeed(), bytes = JSON.stringify(state, null, 2);
  await writeFile(file, bytes); await writeFile(lock, 'another writer owns this lock');
  const before = await stat(file), lockBefore = await stat(lock);
  const read = await readState();
  assert.deepEqual(read, state);
  read.tasks[0].title = '읽기 결과에서만 변경';
  assert.deepEqual(await readState(), state);
  assert.equal(await readFile(file, 'utf8'), bytes);
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs);
  assert.equal((await stat(lock)).mtimeMs, lockBefore.mtimeMs);
  assert.equal(await readFile(lock, 'utf8'), 'another writer owns this lock');
  assert.deepEqual((await readdir(directory)).sort(), ['.workspace.lock', 'workspace.json']);
});

test('readState initializes one persisted seed for simultaneous first readers and returns isolated snapshots', async t => {
  const { directory, file } = await localFixture(t);
  // Wait for every reader even after a failure so fixture cleanup cannot race
  // readers that are still acquiring the initialization lock.
  const settled = await Promise.allSettled(Array.from({ length: 8 }, () => readState()));
  const results = settled.map(result => { if (result.status === 'rejected') throw result.reason; return result.value; });
  const bytes = await readFile(file, 'utf8'), saved = JSON.parse(bytes);
  for (const result of results) assert.deepEqual(result, saved);
  results[0].tasks[0].title = '다른 조회와 공유되지 않는 변경';
  assert.notEqual(results[1].tasks[0].title, results[0].tasks[0].title);
  assert.deepEqual(await readState(), saved);
  assert.deepEqual(await readdir(directory), ['workspace.json']);
  assert.equal(await readFile(file, 'utf8'), bytes);
});

test('readState sees the last committed snapshot while a writer waits, then the complete new snapshot', async t => {
  const { file, lock } = await localFixture(t);
  const state = persistedSeed(); await writeFile(file, JSON.stringify(state));
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { release = resolve; });
  const writing = transaction(async current => { current.tasks[0].title = '원자적으로 저장한 변경'; current.revision++; started(); await held; });
  try {
    await entered; await stat(lock);
    assert.deepEqual(await readState(), state);
  } finally { release(); await writing; }
  const saved = await readState();
  assert.equal(saved.tasks[0].title, '원자적으로 저장한 변경'); assert.equal(saved.revision, state.revision + 1);
  await assert.rejects(stat(lock), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
});

test('readState preserves a corrupt file and reports a read error without creating a lock', async t => {
  const { directory, file } = await localFixture(t);
  await writeFile(file, '{broken json');
  await assert.rejects(readState(), error => error instanceof DomainError && error.code === 'STORE_READ_ERROR' && error.status === 503);
  assert.equal(await readFile(file, 'utf8'), '{broken json');
  assert.deepEqual(await readdir(directory), ['workspace.json']);
});

test('Windows lock acquisition retries a transient EPERM without weakening exclusive creation', { skip: process.platform !== 'win32' }, async t => {
  const { directory, lock } = await localFixture(t);
  const originalOpen = fsPromises.open;
  let attempts = 0;
  t.mock.method(fsPromises, 'open', async (...args: Parameters<typeof fsPromises.open>) => {
    if (args[0] === lock && args[1] === 'wx' && ++attempts <= 2) throw Object.assign(new Error('brief Windows lock release race'), { code: 'EPERM', syscall: 'open' });
    return originalOpen(...args);
  });
  const state = await readState();
  assert.ok(state.tasks.length > 0); assert.equal(attempts, 3);
  assert.deepEqual(await readdir(directory), ['workspace.json']);
});

test('Windows lock acquisition preserves persistent EPERM and never removes an unowned lock', { skip: process.platform !== 'win32' }, async t => {
  const { directory, lock } = await localFixture(t);
  await writeFile(lock, 'owned by another writer');
  const originalOpen = fsPromises.open;
  const denied = Object.assign(new Error('persistent access denial'), { code: 'EPERM', syscall: 'open' });
  let attempts = 0, invoked = false;
  t.mock.method(fsPromises, 'open', async (...args: Parameters<typeof fsPromises.open>) => {
    if (args[0] === lock && args[1] === 'wx') { attempts++; throw denied; }
    return originalOpen(...args);
  });
  await assert.rejects(transaction(() => { invoked = true; }), error => error === denied);
  assert.equal(invoked, false); assert.equal(attempts, 4);
  assert.equal(await readFile(lock, 'utf8'), 'owned by another writer');
  assert.deepEqual(await readdir(directory), ['.workspace.lock']);
});

test('failed lock metadata writes close the acquired handle and remove only the owned lock', async t => {
  const { directory, lock } = await localFixture(t);
  const originalOpen = fsPromises.open;
  const denied = Object.assign(new Error('cannot write lock metadata'), { code: 'EPERM', syscall: 'write' });
  let attempts = 0, closed = 0, invoked = false;
  t.mock.method(fsPromises, 'open', async (...args: Parameters<typeof fsPromises.open>) => {
    const handle = await originalOpen(...args);
    if (args[0] === lock && args[1] === 'wx') {
      attempts++; const close = handle.close.bind(handle);
      t.mock.method(handle, 'close', async () => { closed++; await close(); });
      t.mock.method(handle, 'writeFile', async () => { throw denied; });
    }
    return handle;
  });
  await assert.rejects(transaction(() => { invoked = true; }), error => error === denied);
  assert.equal(invoked, false); assert.equal(attempts, 1); assert.equal(closed, 1);
  assert.deepEqual(await readdir(directory), []);
});

test('readState uses a parameterized Neon HTTP SELECT with no row lock or WebSocket pool', async t => {
  preserveEnvironment(t);
  Object.assign(process.env, { IEUM_STORE: 'neon', DATABASE_URL: 'postgresql://fake:fake@never-connect.invalid/fake', IEUM_WORKSPACE_ID: "qa' OR '1'='1" });
  const originalFetch = neonConfig.fetchFunction;
  t.after(() => { neonConfig.fetchFunction = originalFetch; });
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Real fetch is forbidden.'); });
  let pools = 0;
  t.mock.method(Pool.prototype, 'connect', () => { pools++; throw new Error('Read-only HTTP queries must not open a Pool.'); });
  const state = persistedSeed(), requests: { query: string; params: unknown[] }[] = [];
  let missing = false;
  neonConfig.fetchFunction = async (_url: unknown, options?: RequestInit) => {
    requests.push(JSON.parse(String(options?.body)));
    return new Response(JSON.stringify({ fields: [{ name: 'data', dataTypeID: 3802 }], rows: missing ? [] : [[JSON.stringify(state)]], command: 'SELECT', rowCount: missing ? 0 : 1 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  assert.deepEqual(await readState(), state);
  assert.equal(requests.length, 1); assert.match(requests[0].query, /^SELECT data FROM ieum_workspaces WHERE id = \$1$/);
  assert.ok(!/FOR\s+UPDATE|INSERT|UPDATE|DELETE/i.test(requests[0].query));
  assert.deepEqual(requests[0].params, [process.env.IEUM_WORKSPACE_ID]); assert.equal(pools, 0);
  missing = true;
  await assert.rejects(readState(), error => error instanceof DomainError && error.code === 'DATABASE_NOT_INITIALIZED');
  assert.equal(requests.length, 2); assert.equal(pools, 0);
});
