import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { neonConfig, Pool } from '@neondatabase/serverless';
import { createSeed } from '../src/lib/seed';
import { readState, transaction } from '../src/lib/store';
import { neonTransaction } from '../src/lib/neon-store';
import type { WorkspaceData } from '../src/lib/types';

const keys = ['IEUM_STORE', 'IEUM_DATA_DIR', 'DATABASE_URL', 'IEUM_WORKSPACE_ID', 'VERCEL'] as const;
function environment(t: TestContext) {
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => { for (const key of keys) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } });
  delete process.env.VERCEL;
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('Live network is forbidden'); });
}
function legacy() {
  const state = createSeed(new Date('2026-11-08T03:00:00Z'));
  state.units.forEach(unit => { delete unit.importance; });
  state.units[0].importance = 9;
  state.departmentWorkPlans = [{ departmentId: state.units[1].departmentId, status: 'draft', version: 1, snapshot: { units: [structuredClone(state.units[1])], tasks: [], members: [] } }];
  return JSON.parse(JSON.stringify(state)) as WorkspaceData;
}

test('legacy local reads and no-op transactions only normalize in memory; the next real write persists live defaults', async t => {
  environment(t);
  const root = path.resolve('.data'); await mkdir(root, { recursive: true }); const directory = await mkdtemp(path.join(root, 'importance-migration-'));
  t.after(async () => { assert.equal(path.dirname(path.resolve(directory)), root); await rm(directory, { recursive: true, force: true }); });
  Object.assign(process.env, { IEUM_STORE: 'local', IEUM_DATA_DIR: directory, DATABASE_URL: 'postgresql://fake:fake@never-connect.invalid/fake' });
  const state = legacy(), source = JSON.stringify(state), file = path.join(directory, 'workspace.json'); await writeFile(file, source);
  const read = await readState();
  assert.equal(read.units[0].importance, 9); assert.ok(read.units.slice(1).every(unit => unit.importance === 5));
  assert.equal(await readFile(file, 'utf8'), source); assert.deepEqual(await readdir(directory), ['workspace.json']);
  assert.deepEqual(read.departmentWorkPlans, state.departmentWorkPlans);
  await transaction(current => { assert.equal(current.units[1].importance, 5); });
  assert.equal(await readFile(file, 'utf8'), source, 'a read-only transaction must not persist normalization or reformat the JSON');
  await assert.rejects(transaction(current => { current.tasks[0].description = '실패한 변경'; throw new Error('mock failure'); }), /mock failure/);
  assert.equal(await readFile(file, 'utf8'), source);
  await transaction(current => { current.tasks[0].description = '성공한 실제 변경'; current.revision++; });
  const persisted = JSON.parse(await readFile(file, 'utf8')) as WorkspaceData;
  assert.equal(persisted.units[0].importance, 9); assert.ok(persisted.units.slice(1).every(unit => unit.importance === 5));
  assert.deepEqual(persisted.departmentWorkPlans, state.departmentWorkPlans);
  assert.deepEqual(persisted.units.map(unit => unit.rev), state.units.map(unit => unit.rev), 'display-equivalent defaults do not create entity edits');
  assert.equal(persisted.revision, state.revision + 1);
});

test('legacy Neon HTTP reads normalize live units without update statements or a WebSocket pool', async t => {
  environment(t);
  Object.assign(process.env, { IEUM_STORE: 'neon', DATABASE_URL: 'postgresql://fake:fake@never-connect.invalid/fake', IEUM_WORKSPACE_ID: 'mock-importance' });
  const previous = neonConfig.fetchFunction; t.after(() => { neonConfig.fetchFunction = previous; });
  t.mock.method(Pool.prototype, 'connect', () => { throw new Error('Read must not acquire a Pool'); });
  const state = legacy(), before = structuredClone(state); const queries: string[] = [];
  neonConfig.fetchFunction = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)); queries.push(body.query);
    return Response.json({ fields: [{ name: 'data', dataTypeID: 3802 }], rows: [[JSON.stringify(state)]], command: 'SELECT', rowCount: 1 });
  };
  const read = await readState();
  assert.equal(read.units[0].importance, 9); assert.ok(read.units.slice(1).every(unit => unit.importance === 5));
  assert.deepEqual(read.departmentWorkPlans, before.departmentWorkPlans); assert.deepEqual(state, before);
  assert.equal(queries.length, 1); assert.ok(queries.every(query => /^SELECT /i.test(query) && !/FOR\s+UPDATE|INSERT|DELETE/i.test(query)));
});

test('Neon transaction normalizes before its change baseline and writes defaults only alongside a real mutation', async t => {
  environment(t);
  Object.assign(process.env, { DATABASE_URL: 'postgresql://fake:fake@never-connect.invalid/fake', IEUM_WORKSPACE_ID: 'mock-importance' });
  const state = legacy(); const writes: WorkspaceData[] = []; let releases = 0; let closes = 0;
  const client = {
    query: async (config: string | { text: string }, params?: unknown[]) => {
      const sql = typeof config === 'string' ? config : config.text;
      if (/^select /i.test(sql)) return { rows: [['mock-importance', state.revision, structuredClone(state), '2026-11-08T03:00:00Z']] };
      if (/^update /i.test(sql)) writes.push(JSON.parse(String(params![1])));
      else assert.match(sql, /^(begin|commit|rollback)/i);
      return { rows: [], rowCount: 1 };
    },
    release: () => { releases++; },
  };
  t.mock.method(Pool.prototype, 'connect', (async () => client) as unknown as typeof Pool.prototype.connect);
  t.mock.method(Pool.prototype, 'end', (async () => { closes++; }) as typeof Pool.prototype.end);
  await neonTransaction(current => { assert.equal(current.units[1].importance, 5); });
  assert.equal(writes.length, 0);
  await neonTransaction(current => { current.tasks[0].description = '실제 업무 변경'; current.revision++; });
  assert.equal(writes.length, 1); assert.equal(writes[0].units[0].importance, 9); assert.ok(writes[0].units.slice(1).every(unit => unit.importance === 5));
  assert.deepEqual(writes[0].departmentWorkPlans, state.departmentWorkPlans);
  assert.equal(releases, 2); assert.equal(closes, 2); assert.equal(state.units[1].importance, undefined);
});
