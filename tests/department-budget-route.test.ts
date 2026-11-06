import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/budgets/department/route';
import { sessionCookie, signSession } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';

test('department aggregate endpoint enforces session, department, input and origin boundaries without changing stored data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-department-budget-'));
  const keys = ['IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key]; process.env.IEUM_DATA_DIR = directory;
    const state = createSeed(new Date('2026-11-06T03:00:00Z')); const file = path.join(directory, 'workspace.json');
    const original = JSON.stringify(state, null, 2); await writeFile(file, original);
    const query = (userId: string | null, params: Record<string, string> = {}, origin = 'http://127.0.0.1:3000') => new NextRequest(`http://127.0.0.1:3000/api/budgets/department?${new URLSearchParams(params)}`, { headers: { host: '127.0.0.1:3000', origin, ...(userId ? { cookie: `${sessionCookie}=${signSession(userId)}` } : {}) } });
    assert.equal((await GET(query(null))).status, 401);
    assert.equal((await GET(query('u-support-member'))).status, 403);
    assert.equal((await GET(query('u-support-lead'))).status, 403);
    assert.equal((await GET(query('u-doyun', { departmentId: 'dept-plan' }))).status, 403);
    assert.equal((await GET(query('u-doyun', {}, 'https://outside.example'))).status, 403);
    assert.equal((await GET(query('u-doyun', { year: '2026.5' }))).status, 422);
    assert.equal((await GET(query('u-doyun', { export: 'true' }))).status, 422);
    assert.equal((await GET(query('u-admin', { departmentId: 'missing' }))).status, 404);
    for (const user of ['u-doyun', 'u-support-head', 'u-admin']) {
      const response = await GET(query(user, { year: '2026', departmentId: 'dept-support' }));
      assert.equal(response.status, 200); assert.match(response.headers.get('cache-control')!, /no-store, private/);
      const body = await response.json(); assert.equal(body.department.id, 'dept-support'); assert.equal(body.year, 2026);
      assert.ok(Array.isArray(body.groups)); assert.equal('tasks' in body, false); assert.equal('users' in body, false);
    }
    state.users.find(user => user.id === 'u-doyun')!.active = false; const inactiveState = JSON.stringify(state, null, 2); await writeFile(file, inactiveState);
    assert.equal((await GET(query('u-doyun'))).status, 401);
    assert.equal(await readFile(file, 'utf8'), inactiveState);
    await writeFile(file, original); await GET(query('u-admin', { year: '2026' }));
    assert.equal(await readFile(file, 'utf8'), original);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await rm(directory, { recursive: true, force: true });
  }
});
