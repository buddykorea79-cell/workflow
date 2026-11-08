import test from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, rateLimitDecision, type RateWindow } from '../src/lib/rate-limit';

test('ten requests share a fixed minute and the exact expiry starts a fresh window without sleeping', () => {
  let window: RateWindow | undefined;
  for (let count = 1; count <= 10; count++) {
    const decision = rateLimitDecision(window, 1000 + count, 10);
    assert.equal(decision.allowed, true); assert.equal(decision.window.count, count); window = decision.window;
  }
  const denied = rateLimitDecision(window, 2000, 10);
  assert.equal(denied.allowed, false); assert.equal(denied.window.count, 10); assert.equal(denied.retryAfterSeconds, 60);
  assert.equal(rateLimitDecision(window, 61_000, 10).allowed, false);
  const reset = rateLimitDecision(window, 61_001, 10);
  assert.equal(reset.allowed, true); assert.equal(reset.window.count, 1); assert.equal(reset.window.resetsAt, 121_001);
});

test('limiter isolates users, honors the configured count and expires bounded storage', () => {
  const limit = createRateLimiter(2);
  limit('one', 2, 1000); limit('one', 2, 1001);
  assert.throws(() => limit('one', 2, 1002), { status: 429, code: 'RATE_LIMITED' });
  limit('two', 2, 1002);
  assert.throws(() => limit('three', 2, 1003), { status: 429 });
  assert.throws(() => limit('one', 2, 1004), { status: 429 });
  assert.doesNotThrow(() => limit('three', 2, 61_003));
  assert.doesNotThrow(() => limit('one', 2, 61_003));
});
