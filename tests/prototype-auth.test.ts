import test from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { accessCookie, accessDurationSeconds, assertSameOrigin, currentUserId, isDemoSession, matchesAccessCode, secureSessionCookie, sessionCookie, signAccess, signSession, verifyAccess, verifySession } from '../src/lib/auth';
import { POST as access } from '../src/app/api/session/access/route';
import { DELETE as logout, GET as directory, POST as login } from '../src/app/api/session/route';
import { createSeed } from '../src/lib/seed';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const keys = ['VERCEL', 'NEON_AUTH_BASE_URL', 'IEUM_PROTOTYPE_MODE', 'IEUM_SESSION_SECRET', 'IEUM_APP_ORIGIN', 'IEUM_PROTOTYPE_ACCESS_CODE', 'DATABASE_URL', 'IEUM_DATA_DIR', 'IEUM_STORE'] as const;
const configured = { IEUM_PROTOTYPE_MODE: 'true', IEUM_SESSION_SECRET: 'synthetic-prototype-session-secret-at-least-32-characters', IEUM_PROTOTYPE_ACCESS_CODE: 'synthetic-access-code-for-tests' };
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
  for (const code of ['', 'short']) await environment({ ...configured, IEUM_PROTOTYPE_ACCESS_CODE: code }, async () => {
    const response = await directory(new NextRequest('https://prototype.example/api/session'));
    assert.equal(response.status, 503); assert.equal((await response.json()).code, 'PROTOTYPE_ACCESS_CODE_REQUIRED');
    assert.equal(isDemoSession(new NextRequest('http://localhost:3000')), true);
  });
});

test('configured hosted prototype uses the signed role session without Neon Auth', async () => {
  await environment({ ...configured, VERCEL: '1' }, async () => {
    const token = signSession('u-support-member');
    const request = new NextRequest('https://example.vercel.app', { headers: { cookie: `${sessionCookie}=${token}; ${accessCookie}=${signAccess()}` } });
    assert.equal(isDemoSession(request), true);
    assert.equal(await currentUserId(request), 'u-support-member');
    assert.equal(secureSessionCookie(request), true);
    assert.equal(verifySession(`${token}extra`), null);
    assert.equal(verifySession('u-support-member.NaN.' + 'a'.repeat(64)), null);
    assert.equal(verifySession('u-support-member.9999999999999.' + '한'.repeat(64)), null);
  });
});

test('access signature expires at twelve hours, rejects tampering and is revoked by code rotation', async () => {
  await environment(configured, () => {
    const now = 1_000_000; const value = signAccess(now);
    assert.equal(verifyAccess(value, now), true);
    assert.equal(verifyAccess(value, now + accessDurationSeconds * 1000 - 1), true);
    assert.equal(verifyAccess(value, now + accessDurationSeconds * 1000), false);
    assert.equal(verifyAccess(`${value}x`, now), false);
    assert.equal(verifyAccess(value.replace('v1.', 'v2.'), now), false);
    assert.equal(verifyAccess('v1.NaN.' + 'a'.repeat(64), now), false);
    assert.equal(verifyAccess('v1.9999999999999.' + '한'.repeat(64), now), false);
    assert.equal(matchesAccessCode(configured.IEUM_PROTOTYPE_ACCESS_CODE), true);
    assert.equal(matchesAccessCode('wrong'), false);
    process.env.IEUM_PROTOTYPE_ACCESS_CODE = 'synthetic-rotated-access-code';
    assert.equal(verifyAccess(value, now), false);
  });
});

test('remote directory and role login require access even for existing role sessions; local remains exempt', async () => {
  const qaRoot = path.resolve('.qa-data'); await mkdir(qaRoot, { recursive: true });
  const dataDir = await mkdtemp(path.join(qaRoot, 'prototype-access-test-'));
  try {
    await environment({ ...configured, IEUM_STORE: 'local', IEUM_DATA_DIR: dataDir }, async () => {
      await writeFile(path.join(dataDir, 'workspace.json'), JSON.stringify(createSeed()));
      const userId = 'u-support-member';
      const request = (route: string, method = 'GET', body?: unknown, cookie = '') => new NextRequest(`https://prototype.example/api/${route}`, { method, headers: { origin: 'https://prototype.example', 'Content-Type': 'application/json', cookie }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const oldRole = `${sessionCookie}=${signSession(userId)}`;
      for (const cookie of ['', oldRole, `${accessCookie}=invalid; ${oldRole}`, `${accessCookie}=${signAccess(Date.now() - 13 * 60 * 60 * 1000)}; ${oldRole}`]) {
        const denied = await directory(request('session', 'GET', undefined, cookie));
        assert.equal(denied.status, 401); assert.equal((await denied.json()).code, 'ACCESS_REQUIRED');
        const deniedLogin = await login(request('session', 'POST', { userId }, cookie));
        assert.equal(deniedLogin.status, 401); assert.equal((await deniedLogin.json()).code, 'ACCESS_REQUIRED');
        await assert.rejects(currentUserId(request('workspace', 'GET', undefined, cookie)), { code: 'ACCESS_REQUIRED' });
      }
      const wrong = await access(request('session/access', 'POST', { code: 'incorrect-access-code' }));
      assert.equal(wrong.status, 401); assert.equal((await wrong.json()).code, 'ACCESS_CODE_INVALID');
      assert.equal(wrong.cookies.has(accessCookie), false);
      const accepted = await access(request('session/access', 'POST', { code: configured.IEUM_PROTOTYPE_ACCESS_CODE }));
      assert.equal(accepted.status, 200);
      const cookie = accepted.cookies.get(accessCookie)!;
      assert.equal(cookie.httpOnly, true); assert.equal(cookie.secure, true); assert.equal(cookie.sameSite, 'lax'); assert.equal(cookie.maxAge, accessDurationSeconds);
      assert.equal(verifyAccess(cookie.value), true); assert.equal(cookie.value.includes(configured.IEUM_PROTOTYPE_ACCESS_CODE), false);
      const approved = `${accessCookie}=${cookie.value}`;
      assert.equal((await directory(request('session', 'GET', undefined, approved))).status, 200);
      const signedIn = await login(request('session', 'POST', { userId }, approved));
      assert.equal(signedIn.status, 200);
      const session = signedIn.cookies.get(sessionCookie)!;
      assert.equal(await currentUserId(request('workspace', 'GET', undefined, `${approved}; ${sessionCookie}=${session.value}`)), userId);
      const signedOut = await logout(request('session', 'DELETE', undefined, approved));
      assert.equal(signedOut.cookies.get(accessCookie)?.maxAge, 0); assert.equal(signedOut.cookies.get(sessionCookie)?.maxAge, 0);
      const local = new NextRequest('http://127.0.0.1:3000/api/session');
      assert.equal((await directory(local)).status, 200);
      const localLogin = await login(new NextRequest(local.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) }));
      assert.equal(localLogin.status, 200);
      assert.equal(await currentUserId(new NextRequest('http://localhost:3000/api/workspace', { headers: { cookie: oldRole } })), userId);
      const exempt = await access(new NextRequest('http://localhost:3000/api/session/access', { method: 'POST' }));
      assert.equal(exempt.status, 200); assert.equal(exempt.cookies.has(accessCookie), false);
    });
  } finally {
    assert.equal(path.dirname(path.resolve(dataDir)), qaRoot); assert.ok(path.basename(dataDir).startsWith('prototype-access-test-'));
    await rm(dataDir, { recursive: true, force: true });
  }
});

test('remote access attempts are capped per trusted IP and preserve origin checks', async () => {
  await environment({ ...configured, VERCEL: '1' }, async () => {
    const request = (ip: string, origin = 'https://prototype.example', code = 'wrong-access-code') => new NextRequest('https://prototype.example/api/session/access', { method: 'POST', headers: { origin, 'Content-Type': 'application/json', 'x-vercel-forwarded-for': ip }, body: JSON.stringify({ code }) });
    assert.equal((await access(request('192.0.2.10', 'https://other.example'))).status, 403);
    for (let attempt = 0; attempt < 5; attempt++) assert.equal((await access(request('192.0.2.10'))).status, 401);
    const limited = await access(request('192.0.2.10', undefined, configured.IEUM_PROTOTYPE_ACCESS_CODE));
    assert.equal(limited.status, 429); assert.equal((await limited.json()).error, '잠시 후 다시 시도해 주세요.');
    assert.equal((await access(request('192.0.2.11', undefined, configured.IEUM_PROTOTYPE_ACCESS_CODE))).status, 200);
  });
});

test('prototype opt-in preserves same-origin checks', async () => {
  await environment({ VERCEL: '1', IEUM_PROTOTYPE_MODE: 'true', IEUM_APP_ORIGIN: 'https://example.vercel.app' }, () => {
    assert.doesNotThrow(() => assertSameOrigin(new NextRequest('https://example.vercel.app/api/commands', { headers: { origin: 'https://example.vercel.app' } })));
    assert.throws(() => assertSameOrigin(new NextRequest('https://example.vercel.app/api/commands', { headers: { origin: 'https://other.example' } })), /다른 사이트/);
  });
});
