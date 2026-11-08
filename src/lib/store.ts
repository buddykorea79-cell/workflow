import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSeed } from './seed';
import type { WorkspaceData } from './types';
import { DomainError } from './domain-error';
import { resolveStoreMode } from './store-mode';

export const dataDirectory = () => path.resolve(process.env.IEUM_DATA_DIR || path.join(process.cwd(), '.data'));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
let storageLogged = false;
function logStorageMode(mode: 'local' | 'neon') {
  if (!storageLogged) {
    // Next sets NEXT_RUNTIME for its server bundle. Standalone CLI tools keep
    // stdout machine-readable JSON and send the same diagnostic to stderr.
    const log = process.env.NEXT_RUNTIME ? console.info : console.error;
    log(mode === 'local' ? `[ieum] 저장소: 로컬 파일 (${dataDirectory()})` : `[ieum] 저장소: Neon (${process.env.IEUM_WORKSPACE_ID?.trim() || 'development'})`);
    storageLogged = true;
  }
}

/** Read the last atomically committed snapshot without joining the writer queue. */
export async function readState(): Promise<WorkspaceData> {
  const mode = resolveStoreMode();
  logStorageMode(mode);
  if (mode === 'neon') { const { neonReadState } = await import('./neon-store'); return neonReadState(); }
  try { return JSON.parse(await readFile(path.join(dataDirectory(), 'workspace.json'), 'utf8')) as WorkspaceData; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new DomainError(503, 'STORE_READ_ERROR', '저장된 데이터를 읽을 수 없습니다. 원본 파일을 보존하고 복구를 확인해 주세요.');
    // The first read is the only initialization exception: create and persist one
    // shared seed under the normal lock, so dates and period IDs remain stable.
    return transaction(state => JSON.parse(JSON.stringify(state)) as WorkspaceData);
  }
}

export async function transaction<T>(callback: (state: WorkspaceData) => T | Promise<T>): Promise<T> {
  const mode = resolveStoreMode();
  logStorageMode(mode);
  if (mode === 'neon') { const { neonTransaction } = await import('./neon-store'); return neonTransaction(callback); }
  const directory = dataDirectory(); await mkdir(directory, { recursive: true }); const file = path.join(directory, 'workspace.json'); const lockPath = path.join(directory, '.workspace.lock');
  let lock; let transientPermissionRetries = 0;
  for (let attempt = 0; attempt < 80; attempt++) {
    let candidate;
    try { candidate = await open(lockPath, 'wx'); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // Windows can report a brief EPERM while another handle releases this path.
      // Retry only exclusive-open acquisition, at most three times. Never unlink
      // someone else's lock for this error; persistent permission errors still fail.
      if (process.platform === 'win32' && code === 'EPERM' && transientPermissionRetries < 3) {
        transientPermissionRetries++; await wait(25); continue;
      }
      if (code !== 'EEXIST') throw error;
      const info = await stat(lockPath).catch(() => null);
      if (info && Date.now() - info.mtimeMs > 120_000) await unlink(lockPath).catch(() => undefined);
      await wait(25); continue;
    }
    try { await candidate.writeFile(`${process.pid}\n${new Date().toISOString()}`); }
    catch (error) {
      // We own this newly created lock, but initialization failed before the
      // transaction's finally block could take responsibility for its handle.
      await candidate.close(); await unlink(lockPath).catch(() => undefined); throw error;
    }
    lock = candidate; break;
  }
  if (!lock) throw new DomainError(503, 'STORE_BUSY', '다른 저장 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
  try {
    let state: WorkspaceData; let original = '';
    try { original = await readFile(file, 'utf8'); state = JSON.parse(original); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new DomainError(503, 'STORE_READ_ERROR', '저장된 데이터를 읽을 수 없습니다. 원본 파일을 보존하고 복구를 확인해 주세요.'); state = createSeed(); }
    const result = await callback(state); const updated = JSON.stringify(state, null, 2);
    if (updated !== original) { const temporary = path.join(directory, `.workspace-${randomUUID()}.tmp`); const handle = await open(temporary, 'wx'); try { await handle.writeFile(updated, 'utf8'); await handle.sync(); } finally { await handle.close(); } await rename(temporary, file); }
    return result;
  } finally { await lock.close(); await unlink(lockPath).catch(() => undefined); }
}
