import { mkdir, open, readFile, rename, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSeed } from './seed';
import type { WorkspaceData } from './types';
import { DomainError } from './domain';

export const dataDirectory = () => path.resolve(process.env.IEUM_DATA_DIR || path.join(process.cwd(), '.data'));
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export async function transaction<T>(callback: (state: WorkspaceData) => T | Promise<T>): Promise<T> {
  if (process.env.DATABASE_URL) { const { neonTransaction } = await import('./neon-store'); return neonTransaction(callback); }
  if (process.env.VERCEL) throw new DomainError(503, 'DATABASE_NOT_CONFIGURED', 'Neon 데이터베이스 연결이 필요합니다. 배포 환경에서는 로컬 파일 저장을 사용하지 않습니다.');
  const directory = dataDirectory(); await mkdir(directory, { recursive: true }); const file = path.join(directory, 'workspace.json'); const lockPath = path.join(directory, '.workspace.lock');
  let lock; for (let attempt = 0; attempt < 80; attempt++) { try { lock = await open(lockPath, 'wx'); await lock.writeFile(`${process.pid}\n${new Date().toISOString()}`); break; } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; const info = await stat(lockPath).catch(() => null); if (info && Date.now() - info.mtimeMs > 120_000) { await unlink(lockPath).catch(() => undefined); } await wait(25); } }
  if (!lock) throw new DomainError(503, 'STORE_BUSY', '다른 저장 작업을 처리 중입니다. 잠시 후 다시 시도해 주세요.');
  try {
    let state: WorkspaceData; let original = '';
    try { original = await readFile(file, 'utf8'); state = JSON.parse(original); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new DomainError(503, 'STORE_READ_ERROR', '저장된 데이터를 읽을 수 없습니다. 원본 파일을 보존하고 복구를 확인해 주세요.'); state = createSeed(); }
    const result = await callback(state); const updated = JSON.stringify(state, null, 2);
    if (updated !== original) { const temporary = path.join(directory, `.workspace-${randomUUID()}.tmp`); const handle = await open(temporary, 'wx'); try { await handle.writeFile(updated, 'utf8'); await handle.sync(); } finally { await handle.close(); } await rename(temporary, file); }
    return result;
  } finally { await lock.close(); await unlink(lockPath).catch(() => undefined); }
}
