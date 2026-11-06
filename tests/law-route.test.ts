import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NextRequest } from 'next/server';
import { GET } from '../src/app/api/law/route';
import { sessionCookie, signSession } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';

test('law routes authorize definition editors, validate requests and return public sources without saving task data', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-law-route-'));
  const keys = ['IEUM_DATA_DIR', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE', 'LAW_API_OC'] as const;
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]])); const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    for (const key of keys) delete process.env[key];
    process.env.IEUM_DATA_DIR = directory; process.env.LAW_API_OC = 'private-law-route-key';
    const state = createSeed(new Date()); const task = state.tasks.find(item => item.id === 'task-data')!; const originalStatus = task.status;
    const file = path.join(directory, 'workspace.json'); const save = () => writeFile(file, JSON.stringify(state)); await save();
    const input = { taskId: task.id, action: 'search', kind: 'law', query: '통계', scope: 'title', page: '1' };
    const request = (userId: string | null = task.primaryId, query: Record<string, string> = input, origin = 'http://127.0.0.1:3000') => new NextRequest(`http://127.0.0.1:3000/api/law?${new URLSearchParams(query)}`, { headers: { host: '127.0.0.1:3000', origin, ...(userId ? { cookie: `${sessionCookie}=${signSession(userId)}` } : {}) } });
    globalThis.fetch = async () => { calls++; throw new Error('Unauthorized calls must not reach the provider'); };
    assert.equal((await GET(request(null))).status, 401);
    assert.equal((await GET(request('u-jiho'))).status, 403);
    assert.equal((await GET(request(task.reviewerId))).status, 403);
    assert.equal((await GET(request(task.primaryId, input, 'https://other.example'))).status, 403);
    assert.equal((await GET(request(task.primaryId, { ...input, query: '' }))).status, 422);
    assert.equal((await GET(request(task.primaryId, { ...input, page: '0' }))).status, 422);
    assert.equal((await GET(request(task.primaryId, { ...input, url: 'https://other.example' }))).status, 422);
    assert.equal((await GET(request(task.primaryId, { taskId: task.id, action: 'detail', kind: 'law', id: '../secret' }))).status, 422);
    state.departmentWorkPlans = [{ departmentId: task.departmentId, status: 'confirmed', version: 1 }]; await save();
    assert.equal((await GET(request())).status, 409);
    state.departmentWorkPlans = []; task.status = 'archived'; await save(); assert.equal((await GET(request())).status, 409);
    task.status = originalStatus; await save();
    delete process.env.LAW_API_OC;
    const unconfigured = await GET(request()); assert.equal(unconfigured.status, 503); assert.equal((await unconfigured.json()).code, 'LAW_NOT_CONFIGURED');
    assert.equal(calls, 0);
    process.env.LAW_API_OC = 'private-law-route-key';
    const originalWorkspace = await readFile(file, 'utf8');
    globalThis.fetch = async url => {
      calls++; const upstream = new URL(String(url)); assert.equal(upstream.origin, 'https://www.law.go.kr');
      assert.equal(upstream.searchParams.get('OC'), 'private-law-route-key');
      const basic = { 법령ID: '001234', 법령명한글: '시연 통계법', 소관부처명: '시연부', 시행일자: '20260101' };
      return upstream.pathname.endsWith('lawSearch.do') ? Response.json({ LawSearch: { totalCnt: '1', law: [basic] } }) : Response.json({ 법령: { 기본정보: basic, 조문: { 조문단위: { 조문번호: '1', 조문제목: '자료 검토', 조문내용: '제1조(자료 검토) 담당자는 자료를 검토한다. <개정 2026. 1. 1.>', 항: { 항내용: '① 검토 결과를 기록한다.' } } } } });
    };
    const search = await GET(request()); assert.equal(search.status, 200); assert.match(search.headers.get('cache-control') || '', /no-store/);
    const found = await search.json(); assert.equal(found.items[0].title, '시연 통계법'); assert.equal(JSON.stringify(found).includes('private-law-route-key'), false);
    const detail = await GET(request(task.primaryId, { taskId: task.id, action: 'detail', kind: 'law', id: found.items[0].id }));
    assert.equal(detail.status, 200); const body = await detail.json(); assert.equal(body.articles.length, 1); assert.match(body.articles[0].content, /① 검토 결과/); assert.match(body.articles[0].content, /<개정 2026/);
    assert.equal(calls, 2); assert.equal(await readFile(file, 'utf8'), originalWorkspace);
    globalThis.fetch = async () => Response.json({ result: '사용자 정보 검증에 실패하였습니다.', msg: 'IP주소와 도메인주소를 등록해 주세요. private-law-route-key' });
    const denied = await GET(request()); assert.equal(denied.status, 503); const denial = await denied.json(); assert.equal(denial.code, 'LAW_AUTH_FAILED'); assert.equal(JSON.stringify(denial).includes('private-law-route-key'), false);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('ieum-law-route-'));
    await rm(directory, { recursive: true, force: true });
  }
});
