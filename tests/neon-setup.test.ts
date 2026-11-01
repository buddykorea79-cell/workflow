import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePrototypeCors, prototypeOrigins } from '../src/lib/neon-setup';

test('prototype CORS allows explicit app origins, normalizes trailing slash and rejects credential/path inputs', () => {
  assert.deepEqual(prototypeOrigins(['https://example.vercel.app/', 'https://example.vercel.app']), ['http://127.0.0.1:3000', 'http://localhost:3000', 'https://example.vercel.app']);
  assert.ok(prototypeOrigins([], 'https://prototype.example').includes('https://prototype.example'));
  for (const value of ['https://user:password@example.com', 'https://example.com/path', 'https://example.com/?key=value', 'http://external.example', '*']) assert.throws(() => prototypeOrigins([value]), /INVALID_ORIGIN/);
});

test('prototype CORS update preserves unrelated rules and previously configured app origins', () => {
  const externalRule = { ID: 'external-viewer', AllowedOrigins: ['https://viewer.example'], AllowedMethods: ['GET'] };
  const ownRule = { ID: 'ieum-prototype-upload', AllowedOrigins: ['https://old.vercel.app'], AllowedMethods: ['PUT'] };
  const previous = [externalRule, ownRule];
  const merged = mergePrototypeCors(previous, ['http://127.0.0.1:3000', 'https://new.vercel.app']);
  assert.equal(merged[0], externalRule);
  assert.deepEqual(merged[1].AllowedOrigins, ['https://old.vercel.app', 'http://127.0.0.1:3000', 'https://new.vercel.app']);
  assert.deepEqual(merged[1].AllowedMethods, ['PUT', 'GET', 'HEAD']);
  assert.deepEqual(merged[1].AllowedHeaders, ['*']);
  assert.equal(previous[1], ownRule);
  assert.deepEqual(mergePrototypeCors(merged, ['https://new.vercel.app']), merged);
});
