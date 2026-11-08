import assert from 'node:assert/strict';
import test from 'node:test';
import { commandFailure, readCommandResponse } from '../src/lib/command-response';
import { readBoundedJson } from '../src/lib/request-json';
import { DomainError } from '../src/lib/domain-error';

test('explicit validation rejection retains outcome, fields and conflict code', async () => {
  for (const status of [401, 403, 409, 422, 429]) {
    const body = { code: 'VALIDATION', error: '마감일을 선택해 주세요.', fields: [{ path: 'units.0.tasks.0.dueDate', message: '날짜 필요' }, { path: 42 }] };
    await assert.rejects(readCommandResponse(Response.json(body, { status })), error => {
      assert.deepEqual(commandFailure(error), { outcome: 'rejected', status, code: 'VALIDATION', message: body.error, fields: [body.fields[0]] });
      return true;
    });
  }
});

test('malformed, incomplete and server error responses never prove that a write failed', async () => {
  const responses = [new Response('<html>proxy error</html>', { status: 502 }), Response.json({ error: 'server error', code: 'INTERNAL_ERROR' }, { status: 500 }), Response.json({ revision: 4 }), Response.json(null), Response.json({ error: 'unrecognized rejection' }, { status: 400 })];
  for (const response of responses) await assert.rejects(readCommandResponse(response), error => { assert.equal(commandFailure(error).outcome, 'unknown'); return true; });
  assert.equal(commandFailure(new TypeError('Failed to fetch')).outcome, 'unknown');
});

test('confirmed workspace responses pass through without changing command receipts', async () => {
  const result = { currentUser: { id: 'u' }, revision: 4, units: [], tasks: [], commandChanges: [{ kind: 'task', id: 't', before: 0, after: 1 }] };
  assert.deepEqual(await readCommandResponse(Response.json(result)), result);
});

test('a malformed account or another tab switching the session cannot complete the former account draft', async () => {
  for (const currentUser of [true, {}, { id: '' }, { id: 'another-user' }]) {
    await assert.rejects(readCommandResponse(Response.json({ revision: 4, currentUser, units: [], tasks: [] }), 'original-user'), error => { assert.equal(commandFailure(error).outcome, 'unknown'); return true; });
  }
});

function streamedRequest(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Request('http://localhost/api/commands', { method: 'POST', body: new ReadableStream({ start(controller) { chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk))); controller.close(); } }), duplex: 'half' } as RequestInit);
}

test('command body byte limit applies without content length and counts Korean UTF-8 bytes', async () => {
  await assert.rejects(readBoundedJson(streamedRequest(['{"title":"', '한'.repeat(20), '"}']), 60), error => error instanceof DomainError && error.status === 413);
  assert.deepEqual(await readBoundedJson(streamedRequest(['{"title":"', '한글', '"}']), 50), { title: '한글' });
});

test('body parser reports malformed JSON instead of a generic internal error', async () => {
  await assert.rejects(readBoundedJson(streamedRequest(['{bad']), 256_000), error => error instanceof DomainError && error.code === 'INVALID_INPUT' && error.status === 422);
  await assert.rejects(readBoundedJson(new Request('http://localhost', { method: 'POST', headers: { 'Content-Length': '300000' }, body: '{}' }), 256_000), error => error instanceof DomainError && error.status === 413);
});
