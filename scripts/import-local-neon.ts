import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';
import { getNeonStorageConfig, uploadNeonFile, readNeonFile, deleteNeonFile } from '../src/lib/attachment-storage';
import { canonicalJson, importAction, importCounts, NeonImportError, readLocalImportAttachment, validateImportWorkspace, verifyAttachmentBytes, workspaceFingerprint } from '../src/lib/neon-import';
import type { WorkspaceData } from '../src/lib/types';

const args = new Set(process.argv.slice(2));
const validArgs = new Set(['--apply', '--replace', '--help']);
function output(value: Record<string, unknown>) { console.log(JSON.stringify(value, null, 2)); }
async function readRemote(pool: Pool, workspaceId: string): Promise<WorkspaceData | undefined> {
  const table = await pool.query("SELECT to_regclass('public.ieum_workspaces') AS name");
  if (!table.rows[0]?.name) return undefined;
  const result = await pool.query('SELECT revision, data FROM ieum_workspaces WHERE id = $1', [workspaceId]);
  if (!result.rows[0]) return undefined;
  const state = validateImportWorkspace(result.rows[0].data);
  if (state.revision !== result.rows[0].revision) throw new NeonImportError('REMOTE_REVISION_MISMATCH', 'DB 행과 워크스페이스의 revision이 다릅니다. 기존 DB 상태를 먼저 확인해 주세요.');
  return state;
}

async function main() {
  if ([...args].some(arg => !validArgs.has(arg))) throw new NeonImportError('UNKNOWN_ARGUMENT', '--apply, --replace, --help만 사용할 수 있습니다.');
  if (args.has('--help')) { output({ usage: 'npm run neon:import -- [--apply] [--replace]', default: '로컬 원본 검증과 DB 비교만 수행합니다.', apply: '--apply: 현재 로컬 워크스페이스와 첨부를 Neon에 복사합니다.', replace: '--replace: 다른 원격 데이터가 있으면 로컬 백업 후 교체합니다. --apply와 함께 사용합니다.' }); return; }
  const apply = args.has('--apply');
  const replace = args.has('--replace');
  if (replace && !apply) throw new NeonImportError('APPLY_REQUIRED', '--replace는 --apply와 함께 사용해 주세요.');
  const directory = path.resolve(process.env.IEUM_DATA_DIR || path.join(process.cwd(), '.data'));
  const file = path.join(directory, 'workspace.json');
  let raw: string;
  try { raw = await readFile(file, 'utf8'); } catch { throw new NeonImportError('LOCAL_WORKSPACE_MISSING', '현재 데이터 폴더에서 workspace.json을 읽을 수 없습니다. IEUM_DATA_DIR 설정을 확인해 주세요.'); }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new NeonImportError('INVALID_JSON', '로컬 workspace.json의 JSON 형식을 확인해 주세요.'); }
  const local = validateImportWorkspace(parsed);
  const localHash = createHash('sha256').update(raw).digest('hex');
  const workspaceId = process.env.IEUM_WORKSPACE_ID?.trim() || 'development';
  const localFiles = new Map<string, Buffer>();
  for (const attachment of local.attachments) {
    if (attachment.storageProvider !== 'neon') localFiles.set(attachment.id, await readLocalImportAttachment(directory, attachment));
  }
  output({ mode: apply ? 'apply' : 'dry-run', source: file, workspaceId, revision: local.revision, counts: importCounts(local), localFiles: localFiles.size });
  if (!process.env.DATABASE_URL) {
    if (apply) throw new NeonImportError('DATABASE_URL_REQUIRED', 'DATABASE_URL을 .env.local 또는 현재 프로세스 환경에 설정해 주세요.');
    output({ result: 'local-validated', database: 'not-configured', next: 'DATABASE_URL 설정 후 다시 검사하고 --apply로 복사합니다. 현재 원본은 변경하지 않았습니다.' });
    return;
  }
  const storage = local.attachments.length ? getNeonStorageConfig() : undefined;
  if (local.attachments.length && !storage) throw new NeonImportError('NEON_STORAGE_REQUIRED', '첨부파일도 이관하려면 IEUM_STORAGE_PROVIDER=neon과 Object Storage 연결값을 설정해 주세요.');
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15_000 });
  const uploaded: { key: string; bucket: string }[] = [];
  let committed = false;
  let commitAttempted = false;
  try {
    const remote = await readRemote(pool, workspaceId);
    const action = importAction(local, remote, replace);
    output({ action, existingRevision: remote?.revision ?? null, existingCounts: remote ? importCounts(remote) : null });
    if (!apply) { output({ result: 'ready', next: '원본은 변경하지 않았습니다. 실제 이관은 --apply로 실행합니다.' }); return; }
    if (action === 'unchanged') {
      for (const attachment of remote!.attachments) if (attachment.storageProvider === 'neon') verifyAttachmentBytes(attachment, await readNeonFile(attachment.storageKey, attachment.storageBucket));
      output({ result: 'unchanged', message: '같은 데이터가 이미 DB에 있습니다. 중복 등록하지 않았습니다.' });
      return;
    }
    const migrationId = randomUUID();
    const target = structuredClone(local);
    const backupDirectory = path.join(directory, 'backups', 'neon-import');
    await mkdir(backupDirectory, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(':', '-');
    const localBackup = path.join(backupDirectory, `${stamp}-${migrationId}-local.json`);
    await writeFile(localBackup, raw, { flag: 'wx' });
    for (const attachment of target.attachments) {
      const previouslyImported = action === 'migrate-files' ? remote?.attachments.find(item => item.id === attachment.id && item.storageProvider === 'neon') : undefined;
      if (previouslyImported) { Object.assign(attachment, { storageKey: previouslyImported.storageKey, storageProvider: 'neon', storageBucket: previouslyImported.storageBucket }); }
      if (attachment.storageProvider === 'neon') { verifyAttachmentBytes(attachment, await readNeonFile(attachment.storageKey, attachment.storageBucket)); continue; }
      const bytes = localFiles.get(attachment.id)!;
      const key = `${encodeURIComponent(workspaceId)}/imports/${migrationId}/${encodeURIComponent(attachment.id)}/${attachment.sha256.toLowerCase()}.bin`;
      await uploadNeonFile(key, bytes, attachment.mime, storage!.bucket);
      uploaded.push({ key, bucket: storage!.bucket });
      verifyAttachmentBytes(attachment, await readNeonFile(key, storage!.bucket));
      attachment.storageKey = key;
      attachment.storageProvider = 'neon';
      attachment.storageBucket = storage!.bucket;
    }
    const client = await pool.connect();
    let remoteBackup: string | undefined;
    try {
      await client.query('BEGIN');
      await client.query(await readFile(path.join(process.cwd(), 'drizzle/0001_workspace.sql'), 'utf8'));
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`ieum-import:${workspaceId}`]);
      const locked = await client.query('SELECT revision, data FROM ieum_workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);
      const current = locked.rows[0]?.data as WorkspaceData | undefined;
      if ((current ? workspaceFingerprint(current) : null) !== (remote ? workspaceFingerprint(remote) : null) || (current && current.revision !== locked.rows[0].revision)) throw new NeonImportError('REMOTE_CHANGED', '검사 이후 DB 데이터가 변경되어 이관을 중단했습니다. 다시 검사해 주세요.');
      const latestRaw = await readFile(file, 'utf8');
      if (createHash('sha256').update(latestRaw).digest('hex') !== localHash) throw new NeonImportError('LOCAL_CHANGED', '검사 이후 로컬 데이터가 변경되어 이관을 중단했습니다. 입력을 마친 뒤 다시 실행해 주세요.');
      if (current) {
        remoteBackup = path.join(backupDirectory, `${stamp}-${migrationId}-remote.json`);
        await writeFile(remoteBackup, JSON.stringify({ workspaceId, revision: locked.rows[0].revision, data: current }, null, 2), { flag: 'wx' });
        await client.query('UPDATE ieum_workspaces SET revision = $2, data = $3, updated_at = now() WHERE id = $1', [workspaceId, target.revision, JSON.stringify(target)]);
      } else {
        await client.query('INSERT INTO ieum_workspaces (id, revision, data) VALUES ($1, $2, $3)', [workspaceId, target.revision, JSON.stringify(target)]);
      }
      const verified = await client.query('SELECT revision, data FROM ieum_workspaces WHERE id = $1', [workspaceId]);
      if (verified.rows[0]?.revision !== target.revision || canonicalJson(verified.rows[0]?.data) !== canonicalJson(target)) throw new NeonImportError('DB_VERIFICATION_FAILED', 'DB에 기록된 데이터가 원본과 일치하지 않아 되돌렸습니다.');
      commitAttempted = true;
      await client.query('COMMIT');
      committed = true;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
    const after = await readRemote(pool, workspaceId);
    output({ result: 'imported', verification: after && workspaceFingerprint(after) === workspaceFingerprint(target) ? 'verified' : 'changed-after-import', workspaceId, revision: target.revision, counts: importCounts(target), uploadedFiles: uploaded.length, localBackup, ...(remoteBackup ? { remoteBackup } : {}), sourcePreserved: true });
  } catch (error) {
    // A lost COMMIT response can mean the DB committed successfully. Keep its
    // objects until a subsequent check determines the actual state.
    if (!commitAttempted) {
      let cleanupFailures = 0;
      for (const item of uploaded) { try { await deleteNeonFile(item.key, item.bucket); } catch { cleanupFailures++; } }
      if (cleanupFailures) output({ cleanup: 'incomplete', orphanedObjects: cleanupFailures, message: '이번 이관의 일부 객체 정리가 실패했습니다. DB와 로컬 원본은 보존했습니다.' });
    }
    if (commitAttempted && !committed) throw new NeonImportError('COMMIT_STATUS_UNKNOWN', 'DB 반영 응답을 확인하지 못했습니다. 첨부 원본과 새 객체를 보존했습니다. 다시 검사해 실제 DB 반영 여부를 확인해 주세요.');
    if (committed) throw new NeonImportError('POST_IMPORT_CHECK_FAILED', 'DB 반영은 완료했지만 마지막 조회에 실패했습니다. 다시 검사해 저장 상태를 확인해 주세요.');
    throw error;
  } finally { await pool.end(); }
}

main().catch(error => {
  if (error instanceof NeonImportError) output({ error: error.code, message: error.message });
  else output({ error: 'IMPORT_FAILED', message: '이관을 완료하지 못했습니다. DB 연결, Object Storage 설정과 네트워크를 확인해 주세요. 연결 문자열과 공급자 응답은 출력하지 않습니다.' });
  process.exitCode = 1;
});
