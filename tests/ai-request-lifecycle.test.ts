import assert from 'node:assert/strict';
import test from 'node:test';
import { AiRequestLifecycle, aiElapsedTime, aiRequestError } from '../src/lib/ai-request-lifecycle';
import { AI_GENERATION_CLIENT_TIMEOUT_MS, AI_GENERATION_TIMEOUT_MS } from '../src/lib/ai-generation-policy';

test('a cancelled request cannot apply a late result or finish its replacement', () => {
  const lifecycle = new AiRequestLifecycle();
  const first = lifecycle.start()!;
  assert.equal(lifecycle.start(), null, 'double clicks are rejected before a render');
  assert.equal(lifecycle.cancel(), true); assert.equal(first.signal.aborted, true);
  const second = lifecycle.start()!;
  assert.equal(lifecycle.accepts(first), false);
  assert.equal(lifecycle.finish(first), false);
  assert.equal(lifecycle.accepts(second), true);
  assert.equal(lifecycle.isRunning(), true);
  assert.equal(lifecycle.finish(second), true);
  assert.equal(lifecycle.isRunning(), false);
});

test('a deadline aborts the browser request but keeps ownership until its error is handled', async () => {
  const lifecycle = new AiRequestLifecycle(); const request = lifecycle.start(5)!;
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(request.signal.aborted, true);
  assert.equal(lifecycle.owns(request), true);
  assert.equal(lifecycle.accepts(request), false);
  assert.equal(lifecycle.start(), null);
  assert.match(aiRequestError(request, new Error('generic abort'), 'fallback'), /대기 시간이 지났습니다/);
  lifecycle.finish(request);
  assert.ok(AI_GENERATION_CLIENT_TIMEOUT_MS > AI_GENERATION_TIMEOUT_MS, 'browser allows the server to return its own timeout');
});

test('elapsed wait remains understandable after a minute without negative clock drift', () => {
  assert.equal(aiElapsedTime(-4), '0초');
  assert.equal(aiElapsedTime(65.9), '1분 5초');
  assert.equal(aiElapsedTime(180), '3분 0초');
});
