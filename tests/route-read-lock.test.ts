import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { GET as sessionGet } from '../src/app/api/session/route';
import { GET as budgetsGet } from '../src/app/api/budgets/route';
import { GET as departmentBudgetGet } from '../src/app/api/budgets/department/route';
import { GET as lawGet } from '../src/app/api/law/route';
import { GET as divisionExportGet } from '../src/app/api/organization-division/export/route';
import { GET as attachmentGet } from '../src/app/api/attachments/[id]/route';
import { GET as integrationsGet } from '../src/app/api/admin/integrations/route';
import { requireIntegrationAdmin } from '../src/lib/admin-integrations-auth';
import { sessionCookie, signSession } from '../src/lib/auth';
import { DomainError } from '../src/lib/domain';
import { createSeed } from '../src/lib/seed';

test('read-only routes use the committed local snapshot while a writer holds the lock', async context => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-route-read-lock-'));
  const keys = ['IEUM_STORE', 'IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE', 'IEUM_SESSION_SECRET', 'LAW_API_OC'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  try {
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, {
      IEUM_STORE: 'local', IEUM_DATA_DIR: directory,
      IEUM_SESSION_SECRET: 'isolated-route-read-lock-test-secret', LAW_API_OC: 'local-test-law',
    });
    const state = createSeed();
    const task = state.tasks.find(item => item.id === 'task-data')!;
    const admin = state.users.find(user => user.active && user.role === 'admin')!;
    const member = state.users.find(user => user.id === task.primaryId)!;
    const bytes = Buffer.from('local read-only attachment fixture');
    const attachment = {
      id: 'read-lock-attachment', taskId: task.id, name: 'reference.txt', size: bytes.length,
      mime: 'text/plain', sha256: createHash('sha256').update(bytes).digest('hex'),
      storageKey: 'reference.txt', storageProvider: 'local' as const, status: 'test_allowed' as const,
      uploadedBy: member.id, createdAt: new Date().toISOString(),
    };
    state.attachments.push(attachment, { ...attachment, id: 'read-lock-quarantined', status: 'quarantined' });
    await mkdir(path.join(directory, 'files'));
    await writeFile(path.join(directory, 'files', attachment.storageKey), bytes);
    const stateFile = path.join(directory, 'workspace.json');
    const originalState = JSON.stringify(state, null, 2) + '\n';
    await writeFile(stateFile, originalState);
    const lockFile = path.join(directory, '.workspace.lock');
    const writerLock = `synthetic writer\n${new Date().toISOString()}`;
    await writeFile(lockFile, writerLock, { flag: 'wx' });
    const originalEntries = (await readdir(directory)).sort();
    let providerCalls = 0;
    globalThis.fetch = async input => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      assert.equal(url.origin, 'https://www.law.go.kr', 'Only the mocked law lookup may use fetch.');
      providerCalls++;
      return Response.json({ LawSearch: { totalCnt: '1', law: [{ 법령ID: '001234', 법령명한글: '조회 시험법', 소관부처명: '시험부', 시행일자: '20260101' }] } });
    };
    const request = (route: string, userId: string = member.id) => new NextRequest(`http://127.0.0.1:3000${route}`, {
      headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', cookie: `${sessionCookie}=${signSession(userId)}` },
    });
    const unchanged = async () => {
      assert.equal(await readFile(stateFile, 'utf8'), originalState, 'A read must preserve the committed document byte for byte.');
      assert.equal(await readFile(lockFile, 'utf8'), writerLock, 'A read must leave the active writer lock untouched.');
      assert.deepEqual((await readdir(directory)).sort(), originalEntries, 'A read must not create temporary documents.');
    };

    await context.test('session directory stays department scoped', async () => {
      const response = await sessionGet(request('/api/session'));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.deepEqual(body.departments.map((item: { id: string }) => item.id), [member.departmentId]);
      assert.ok(body.users.every((user: { departmentId: string }) => user.departmentId === member.departmentId));
      await unchanged();
    });
    await context.test('budget lookup and administrator export do not join the writer queue', async () => {
      const response = await budgetsGet(request('/api/budgets'));
      assert.equal(response.status, 200); assert.ok(Array.isArray((await response.json()).items));
      const exported = await budgetsGet(request('/api/budgets?export=true', admin.id));
      assert.equal(exported.status, 200); assert.match(exported.headers.get('content-disposition') || '', /attachment/);
      assert.equal((await budgetsGet(request('/api/budgets?export=true'))).status, 403);
      await unchanged();
    });
    await context.test('department aggregate retains role and department restrictions', async () => {
      const response = await departmentBudgetGet(request(`/api/budgets/department?departmentId=${member.departmentId}`, admin.id));
      assert.equal(response.status, 200); assert.equal((await response.json()).department.id, member.departmentId);
      assert.equal((await departmentBudgetGet(request('/api/budgets/department', 'u-support-member'))).status, 403);
      await unchanged();
    });
    await context.test('law authorization reads without changing the task', async () => {
      const response = await lawGet(request(`/api/law?taskId=${task.id}&action=search&kind=law&query=조회`));
      assert.equal(response.status, 200); assert.equal((await response.json()).items[0].title, '조회 시험법');
      assert.equal(providerCalls, 1);
      await unchanged();
    });
    await context.test('organization export renders from the snapshot and retains department access', async () => {
      const response = await divisionExportGet(request('/api/organization-division/export?format=xlsx'));
      assert.equal(response.status, 200); assert.ok((await response.arrayBuffer()).byteLength > 0);
      const foreign = state.departments.find(department => department.id !== member.departmentId)!;
      assert.equal((await divisionExportGet(request(`/api/organization-division/export?format=xlsx&departmentId=${foreign.id}`))).status, 403);
      await unchanged();
    });
    await context.test('attachment download keeps file quarantine checks before reading bytes', async () => {
      const response = await attachmentGet(request(`/api/attachments/${attachment.id}`), { params: Promise.resolve({ id: attachment.id }) });
      assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      const quarantined = await attachmentGet(request('/api/attachments/read-lock-quarantined'), { params: Promise.resolve({ id: 'read-lock-quarantined' }) });
      assert.equal(quarantined.status, 409); assert.equal((await quarantined.json()).code, 'FILE_QUARANTINED');
      await unchanged();
    });
    await context.test('integration administrator authorization never waits for a writer', async () => {
      const adminRequest = request('/api/admin/integrations', admin.id);
      assert.equal(await requireIntegrationAdmin(adminRequest), admin.id);
      assert.equal((await integrationsGet(adminRequest)).status, 200);
      await assert.rejects(requireIntegrationAdmin(request('/api/admin/integrations')), error => error instanceof DomainError && error.code === 'ADMIN_REQUIRED');
      await unchanged();
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ieum-route-read-lock-'));
    await rm(directory, { recursive: true, force: true });
  }
});
