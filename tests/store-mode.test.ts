import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DomainError, getWorkspace } from '../src/lib/domain';
import { resolveAttachmentStoreMode, resolveStoreMode } from '../src/lib/store-mode';
import { transaction } from '../src/lib/store';
import { getNeonStorageConfig } from '../src/lib/attachment-storage';
import { integrationStatus, testDatabaseConnection } from '../src/lib/admin-integrations';

const errorCode = (code: string) => (error: unknown) => error instanceof DomainError && error.status === 503 && error.code === code;

test('store selection preserves automatic defaults and explicitly forces local over DB credentials', () => {
  assert.equal(resolveStoreMode({}), 'local');
  assert.equal(resolveStoreMode({ DATABASE_URL: 'postgres://private' }), 'neon');
  assert.equal(resolveStoreMode({ IEUM_STORE: 'local', DATABASE_URL: 'postgres://private' }), 'local');
  assert.equal(resolveStoreMode({ IEUM_STORE: 'neon', DATABASE_URL: 'postgres://private' }), 'neon');
  assert.equal(resolveStoreMode({ VERCEL: '1', DATABASE_URL: 'postgres://private' }), 'neon');
});

test('ambiguous and unavailable stores fail before any access', () => {
  assert.throws(() => resolveStoreMode({ IEUM_DATA_DIR: '.qa-data', DATABASE_URL: 'postgres://private' }), errorCode('STORE_MODE_AMBIGUOUS'));
  assert.throws(() => resolveStoreMode({ IEUM_STORE: 'local', VERCEL: '1', DATABASE_URL: 'postgres://private' }), errorCode('DATABASE_NOT_CONFIGURED'));
  assert.throws(() => resolveStoreMode({ IEUM_STORE: 'neon' }), errorCode('DATABASE_NOT_CONFIGURED'));
  assert.throws(() => resolveStoreMode({ VERCEL: '1' }), errorCode('DATABASE_NOT_CONFIGURED'));
  assert.throws(() => resolveStoreMode({ IEUM_STORE: 'typo' }), errorCode('STORE_MODE_INVALID'));
});

test('explicit local store also isolates inherited remote attachments and integration diagnostics', async () => {
  const env = { IEUM_STORE: 'local', DATABASE_URL: 'postgres://private', IEUM_DATA_DIR: '.qa-data', IEUM_STORAGE_PROVIDER: 'neon' };
  assert.equal(resolveAttachmentStoreMode(env), 'local');
  assert.equal(getNeonStorageConfig(env), undefined);
  const status = integrationStatus(env);
  assert.equal(status.database.mode, 'local');
  assert.equal(status.database.configured, false);
  assert.equal(status.storage.mode, 'local');
  assert.equal(status.storage.configured, false);
  let connections = 0;
  const diagnostic = await testDatabaseConnection({ env, poolFactory: () => { connections++; throw new Error('must not connect'); } });
  assert.equal(diagnostic.ok, false);
  assert.equal(connections, 0);
  assert.match(diagnostic.checks[0].detail!, /로컬 저장/);
  assert.throws(() => getNeonStorageConfig({ ...env, IEUM_STORE: undefined }), errorCode('STORE_MODE_AMBIGUOUS'));
});

test('forced local transaction persists and reports local despite a remote DATABASE_URL', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ieum-store-mode-'));
  const keys = ['IEUM_STORE', 'DATABASE_URL', 'IEUM_DATA_DIR', 'IEUM_STORAGE_PROVIDER', 'VERCEL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let networkCalls = 0;
  t.mock.method(globalThis, 'fetch', async () => { networkCalls++; throw new Error('network is forbidden in local QA'); });
  try {
    delete process.env.VERCEL;
    Object.assign(process.env, { IEUM_STORE: 'local', DATABASE_URL: 'postgres://private.invalid/do-not-connect', IEUM_DATA_DIR: directory, IEUM_STORAGE_PROVIDER: 'neon' });
    const workspace = await transaction(state => getWorkspace(state, 'u-support-member'));
    assert.equal(workspace.mode, 'local');
    assert.equal(workspace.integrations.database, '로컬 파일 저장');
    assert.equal(workspace.integrations.storage, '로컬 격리 저장');
    const file = path.join(directory, 'workspace.json');
    const stored = await readFile(file, 'utf8');
    assert.ok(JSON.parse(stored).tasks.length > 0);
    delete process.env.IEUM_STORE;
    let invoked = false;
    await assert.rejects(transaction(() => { invoked = true; }), errorCode('STORE_MODE_AMBIGUOUS'));
    assert.equal(invoked, false);
    assert.equal(await readFile(file, 'utf8'), stored);
    assert.equal(networkCalls, 0);
  } finally {
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
    await rm(directory, { recursive: true, force: true });
  }
});
