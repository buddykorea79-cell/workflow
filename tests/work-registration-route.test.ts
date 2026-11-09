import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { NextRequest } from 'next/server';
import { markdownToHwpx } from 'kordoc';
import { POST } from '../src/app/api/work-registration/route';
import { sessionCookie, signSession } from '../src/lib/auth';
import { createSeed } from '../src/lib/seed';

test('work registration route enforces bounded JSON/auth/draft ownership and runs real extraction with mocked AI only', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-work-registration-'));
  const environment = ['IEUM_DATA_DIR', 'IEUM_STORE', 'BIZROUTER_API_KEY', 'BIZROUTER_MODEL', 'DATABASE_URL', 'VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_MODE', 'IEUM_API_RATE_LIMIT_PER_MINUTE'] as const;
  const previous = Object.fromEntries(environment.map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch; let calls = 0;
  try {
    for (const key of environment) delete process.env[key];
    process.env.IEUM_DATA_DIR = directory; process.env.IEUM_STORE = 'local';
    process.env.BIZROUTER_API_KEY = 'mock-only-test-key'; process.env.BIZROUTER_MODEL = 'mock-model';
    globalThis.fetch = async () => { calls++; throw new Error('No live network is permitted'); };
    const state = createSeed(new Date('2026-11-01T00:00:00Z'));
    const documentBytes = Buffer.from(await markdownToHwpx('# 업무 점검\n\n현황 자료를 모으고 분기별 점검 결과를 정리합니다.'));
    const attachment = { id: 'attachment-ai-private', taskId: 'draft:u-jiho:00000000-0000-4000-8000-000000000001', name: '업무 점검.hwpx', size: documentBytes.length, mime: 'application/octet-stream', sha256: createHash('sha256').update(documentBytes).digest('hex'), uploadedBy: 'u-jiho', storageKey: 'private.bin', storageProvider: 'local' as const, status: 'quarantined' as const, createdAt: '2026-11-01T00:00:00Z' };
    state.attachments.push(attachment);
    const file = path.join(directory, 'workspace.json'); const save = () => writeFile(file, JSON.stringify(state));
    await mkdir(path.join(directory, 'files')); await writeFile(path.join(directory, 'files', attachment.storageKey), documentBytes); await save();
    const generate = { action: 'generate', description: '현황 자료를 점검한다.', documents: [] };
    const request = (value: unknown = generate, actor: string | null = 'u-jiho', extra: Record<string, string> = {}) => new NextRequest('http://127.0.0.1:3000/api/work-registration', { method: 'POST', headers: { 'Content-Type': 'application/json', host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', ...(actor ? { cookie: `${sessionCookie}=${signSession(actor)}` } : {}), ...extra }, body: JSON.stringify(value) });
    assert.equal((await POST(request(generate, null))).status, 401);
    assert.equal((await POST(request(generate, 'u-head'))).status, 403);
    assert.equal((await POST(request(generate, 'u-jiho', { origin: 'https://foreign.invalid' }))).status, 403);
    assert.equal((await POST(request(generate, 'u-jiho', { 'Content-Type': 'text/plain' }))).status, 415);
    assert.equal((await POST(request({ action: 'extract', attachmentId: attachment.id }, 'u-admin'))).status, 403);
    assert.equal((await POST(request({ action: 'extract', attachmentId: 'task-attached-file' }))).status, 403);
    const oversized = ' '.repeat(350_001);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode(oversized)); controller.close(); } });
    const chunked = new NextRequest('http://127.0.0.1:3000/api/work-registration', { method: 'POST', headers: { 'Content-Type': 'application/json', cookie: `${sessionCookie}=${signSession('u-jiho')}`, 'content-length': '1' }, body: stream, duplex: 'half' } as ConstructorParameters<typeof NextRequest>[1] & { duplex: 'half' });
    const tooLarge = await POST(chunked); assert.equal(tooLarge.status, 413); assert.equal((await tooLarge.json()).code, 'BODY_TOO_LARGE');
    assert.equal(calls, 0);

    const extracted = await POST(request({ action: 'extract', attachmentId: attachment.id }));
    assert.equal(extracted.status, 200); const extractedBody = await extracted.json();
    assert.equal(extractedBody.document.attachmentId, attachment.id); assert.match(extractedBody.document.text, /현황 자료/); assert.equal(extractedBody.document.format, 'hwpx');
    assert.equal(calls, 0); assert.match(extracted.headers.get('cache-control')!, /no-store/);
    const output = { units: Array.from({ length: 5 }, (_, index) => ({ title: `현황 관리 ${index + 1}`, description: `대상 ${index + 1}의 현황을 관리합니다.`, tasks: [{ title: '자료 점검', description: `대상 ${index + 1}의 자료를 점검합니다.` }] })) };
    let aiOutput: unknown = output;
    globalThis.fetch = async (url, init) => {
      calls++;
      if (String(url).endsWith('/models')) return Response.json({ models: [{ id: 'mock-model', response_format_modes: ['json_schema'] }] });
      const body = JSON.parse(String(init?.body));
      assert.equal(body.response_format.json_schema.schema.properties.units.maxItems, 5);
      const input = JSON.parse(body.messages[1].content);
      assert.deepEqual(input.documents, [{ name: attachment.name, text: '수정한 점검 본문' }]);
      assert.equal(input.description, generate.description);
      return Response.json({ model: 'mock-model', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(aiOutput) } }] });
    };
    const before = await readFile(file, 'utf8');
    const response = await POST(request({ ...generate, documents: [{ attachmentId: attachment.id, text: '수정한 점검 본문' }] }));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), { preview: output, model: 'mock-model' }); assert.equal(calls, 2);
    assert.equal(await readFile(file, 'utf8'), before, 'analysis must not create tasks, connect files or revise the workspace');
    aiOutput = { units: [...output.units, { ...output.units[0], title: '초과 단위업무' }] };
    const tooMany = await POST(request({ ...generate, documents: [{ attachmentId: attachment.id, text: '수정한 점검 본문' }] }));
    assert.equal(tooMany.status, 502); assert.equal((await tooMany.json()).code, 'AI_INVALID_STRUCTURE'); assert.equal(calls, 4);
    assert.equal(await readFile(file, 'utf8'), before, 'rejecting six generated units must not silently register a truncated preview');
    aiOutput = { units: [{ ...output.units[0], tasks: [{ ...output.units[0].tasks[0], dueDate: '2026-12-31', frequency: 'yearly' }] }] };
    const aiSchedule = await POST(request({ ...generate, documents: [{ attachmentId: attachment.id, text: '수정한 점검 본문' }] }));
    assert.equal(aiSchedule.status, 502); assert.equal((await aiSchedule.json()).code, 'AI_INVALID_STRUCTURE'); assert.equal(calls, 6);
    assert.equal(await readFile(file, 'utf8'), before, 'schedule defaults belong to the reviewed registration form, not guessed AI fields');
    state.departmentWorkPlans = [{ departmentId: 'dept-plan', status: 'confirmed', version: 1 }]; await save();
    const locked = await POST(request()); assert.equal(locked.status, 409); assert.equal((await locked.json()).code, 'DEPARTMENT_CONFIRMED'); assert.equal(calls, 6);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of environment) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir())); assert.ok(path.basename(directory).startsWith('ieum-work-registration-'));
    await rm(directory, { recursive: true, force: true });
  }
});
