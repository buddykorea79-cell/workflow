import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/session/route';
import { sessionCookie, signSession } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';

test('the prototype directory supports demo switching without widening the ordinary department directory', async () => {
  const qaRoot = path.resolve(process.cwd(), '.qa-data'); await mkdir(qaRoot, { recursive: true });
  const directory = await mkdtemp(path.join(qaRoot, 'session-directory-test-'));
  const keys = ['DATABASE_URL', 'NEON_AUTH_BASE_URL', 'VERCEL', 'IEUM_DATA_DIR', 'IEUM_SESSION_SECRET', 'IEUM_PROTOTYPE_MODE'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  process.env.DATABASE_URL = ''; process.env.NEON_AUTH_BASE_URL = ''; process.env.VERCEL = ''; process.env.IEUM_DATA_DIR = directory;
  process.env.IEUM_SESSION_SECRET = 'isolated-session-directory-test-secret'; process.env.IEUM_PROTOTYPE_MODE = 'true';
  try {
    const state = createSeed();
    const sender = state.users.find(user => user.id === 'u-support-member')!;
    const recipient = state.users.find(user => user.id === 'u-innovation-member')!;
    sender.email = 'private-session-directory@example.invalid'; sender.phone = '010-9999-8888';
    state.users.push({ ...recipient, id: 'inactive-demo-directory-user', active: false });
    const file = path.join(directory, 'workspace.json');
    const original = JSON.stringify(state, null, 2); await writeFile(file, original, 'utf8');
    const request = (scope = '', userId?: string) => new NextRequest(`https://prototype.example/api/session${scope ? `?scope=${scope}` : ''}`, { headers: userId ? { cookie: `${sessionCookie}=${signSession(userId)}` } : {} });
    const allowedUserKeys = new Set(['id', 'name', 'initials', 'departmentId', 'team', 'role', 'title', 'color', 'active', 'endsAt']);
    const allActiveIds = state.users.filter(user => user.active).map(user => user.id).sort();
    const allDepartmentIds = state.departments.map(department => department.id).sort();
    for (const user of [sender, recipient]) {
      for (const scope of ['', 'unknown']) {
        const response = await GET(request(scope, user.id)); assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(body.departments.map((item: { id: string }) => item.id), [user.departmentId]);
        assert.deepEqual(body.users.map((item: { id: string }) => item.id).sort(), state.users.filter(person => person.active && person.departmentId === user.departmentId).map(person => person.id).sort());
      }
      const response = await GET(request('demo', user.id)); assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store, private');
      const body = await response.json();
      assert.deepEqual(Object.keys(body).sort(), ['departments', 'users']);
      assert.deepEqual(body.users.map((item: { id: string }) => item.id).sort(), allActiveIds);
      assert.deepEqual(body.departments.map((item: { id: string }) => item.id).sort(), allDepartmentIds);
      for (const person of body.users) for (const key of Object.keys(person)) assert.ok(allowedUserKeys.has(key), `Unexpected public directory field: ${key}`);
      for (const department of body.departments) assert.deepEqual(Object.keys(department).sort(), ['id', 'name', 'shortName']);
      const serialized = JSON.stringify(body);
      const privateValues: string[] = [sender.email!, sender.phone!, '통계 간행물 발간', '행정안전 통계연보 발간'];
      for (const value of privateValues) assert.equal(serialized.includes(value), false);
    }
    const anonymous = await GET(request('demo')); assert.equal(anonymous.status, 200);
    assert.deepEqual((await anonymous.json()).users.map((item: { id: string }) => item.id).sort(), allActiveIds);
    const administrator = state.users.find(user => user.active && user.role === 'admin')!;
    const adminResponse = await GET(request('', administrator.id)); assert.equal(adminResponse.status, 200);
    assert.deepEqual((await adminResponse.json()).users.map((item: { id: string }) => item.id).sort(), allActiveIds);
    process.env.IEUM_PROTOTYPE_MODE = 'false';
    for (const scope of ['', 'demo']) {
      const response = await GET(request(scope, sender.id)); assert.equal(response.status, 403); assert.equal((await response.json()).code, 'DEMO_DISABLED');
    }
    assert.equal(await readFile(file, 'utf8'), original, 'Directory lookup must not alter business data.');
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.ok(path.resolve(directory).startsWith(qaRoot + path.sep));
    assert.ok(path.basename(directory).startsWith('session-directory-test-'));
    await rm(directory, { recursive: true, force: true });
  }
});
