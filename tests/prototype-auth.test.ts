import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { assertSameOrigin, currentUserId, isDemoSession, secureSessionCookie, sessionCookie, signSession, verifySession } from '../src/lib/auth';

const keys = ['VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_PROTOTYPE_MODE', 'IEUM_SESSION_SECRET', 'IEUM_APP_ORIGIN'] as const;
async function environment(settings: Record<string, string>, check: () => void | Promise<void>) {
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  keys.forEach(key => { delete process.env[key]; });
  Object.assign(process.env, settings);
  try { await check(); } finally { keys.forEach(key => { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }); }
}

test('local role login stays available; hosted role login requires explicit prototype configuration', async () => {
  await environment({}, () => {
    assert.equal(isDemoSession(new NextRequest('http://127.0.0.1:3000')), true);
    assert.equal(isDemoSession(new NextRequest('https://example.vercel.app')), false);
  });
  await environment({ VERCEL: '1', IEUM_PROTOTYPE_MODE: 'true' }, () => {
    assert.throws(() => isDemoSession(new NextRequest('https://example.vercel.app')), /IEUM_SESSION_SECRET/);
  });
});

test('configured hosted prototype uses the signed role session without Neon Auth', async () => {
  await environment({ VERCEL: '1', IEUM_PROTOTYPE_MODE: 'true', IEUM_SESSION_SECRET: 'prototype-test-secret-with-at-least-32-characters' }, async () => {
    const token = signSession('u-support-member');
    const request = new NextRequest('https://example.vercel.app', { headers: { cookie: `${sessionCookie}=${token}` } });
    assert.equal(isDemoSession(request), true);
    assert.equal(await currentUserId(request), 'u-support-member');
    assert.equal(secureSessionCookie(request), true);
    assert.equal(verifySession(`${token}extra`), null);
    assert.equal(verifySession('u-support-member.NaN.' + 'a'.repeat(64)), null);
    assert.equal(verifySession('u-support-member.9999999999999.' + '한'.repeat(64)), null);
  });
});

test('prototype opt-in preserves same-origin checks', async () => {
  await environment({ VERCEL: '1', IEUM_PROTOTYPE_MODE: 'true', IEUM_APP_ORIGIN: 'https://example.vercel.app' }, () => {
    assert.doesNotThrow(() => assertSameOrigin(new NextRequest('https://example.vercel.app/api/commands', { headers: { origin: 'https://example.vercel.app' } })));
    assert.throws(() => assertSameOrigin(new NextRequest('https://example.vercel.app/api/commands', { headers: { origin: 'https://other.example' } })), /다른 사이트/);
  });
});
