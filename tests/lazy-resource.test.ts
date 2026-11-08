import assert from 'node:assert/strict';
import test from 'node:test';
import { createLazyResource } from '../src/lib/lazy-resource';

test('concurrent prefetch and render share one code request and retain the resolved module', async () => {
  let calls = 0; let resolve!: (value: object) => void;
  const module = { code: 'screen' };
  const resource = createLazyResource(() => { calls++; return new Promise<object>(done => { resolve = done; }); });
  const first = resource.load(); const second = resource.load(); const prefetch = resource.preload();
  assert.equal(first, second); assert.equal(resource.state().status, 'pending');
  await Promise.resolve(); assert.equal(calls, 1);
  resolve(module); await prefetch;
  assert.equal(await first, module); assert.equal(await resource.load(), module); assert.equal(calls, 1);
  resource.resetFailure(); assert.equal(await resource.load(), module); assert.equal(calls, 1);
});

test('failed loads remain rejected until an explicit retry reset and sync exceptions follow the same path', async () => {
  let calls = 0; const failure = new Error('offline');
  const resource = createLazyResource(() => { calls++; if (calls === 1) throw failure; return Promise.resolve('loaded'); });
  await assert.rejects(resource.load(), error => error === failure);
  await assert.rejects(resource.load(), error => error === failure);
  assert.equal(resource.state().status, 'rejected'); assert.equal(calls, 1);
  resource.resetFailure(); assert.equal(await resource.load(), 'loaded'); assert.equal(calls, 2);
});

test('failed hover prefetch is consumed and does not prevent a later screen request', async () => {
  let calls = 0;
  const resource = createLazyResource(async () => { if (++calls === 1) throw new Error('offline'); return 'ready'; });
  await resource.preload(); assert.equal(resource.state().status, 'idle');
  assert.equal(await resource.load(), 'ready'); assert.equal(calls, 2);
});

test('resetting while a request is pending cannot create a second request or discard its result', async () => {
  let resolve!: (value: string) => void;
  const resource = createLazyResource(() => new Promise<string>(done => { resolve = done; }));
  const request = resource.load(); resource.resetFailure(); assert.equal(resource.load(), request);
  await Promise.resolve(); resolve('ready'); assert.equal(await request, 'ready');
});
