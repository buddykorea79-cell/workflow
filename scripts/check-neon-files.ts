import { randomUUID } from 'node:crypto';
import { createNeonDownloadUrl, createNeonUploadUrl, deleteNeonFile, getNeonStorageConfig, readNeonFile } from '../src/lib/attachment-storage';
import { prototypeOrigins } from '../src/lib/neon-setup';

/** Probe only a fresh temporary object; never modify workspace data or existing files. */
async function main() {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--origin')) throw new Error('ARGUMENTS');
  const requestedOrigin = args[1] || process.env.IEUM_APP_ORIGIN || 'http://127.0.0.1:3000';
  prototypeOrigins([requestedOrigin]); // Validate, without choosing an unrelated default origin.
  const origin = new URL(requestedOrigin).origin;
  const config = getNeonStorageConfig();
  if (!config) throw new Error('CONFIGURATION');
  const key = `prototype-check/${randomUUID()}.txt`;
  const bytes = Buffer.from('Onieum temporary upload and download check.');
  let attemptedUpload = false;
  let stage = 'cors';
  try {
    const url = await createNeonUploadUrl(key, 'text/plain', config.bucket);
    const preflight = await fetch(url, { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' }, signal: AbortSignal.timeout(30_000) });
    const allowedHeaders = (preflight.headers.get('access-control-allow-headers') || '').toLowerCase().split(',').map(value => value.trim());
    if (!preflight.ok || ![origin, '*'].includes(preflight.headers.get('access-control-allow-origin') || '') || !preflight.headers.get('access-control-allow-methods')?.includes('PUT') || !allowedHeaders.some(value => ['*', 'content-type'].includes(value))) throw new Error('PREFLIGHT');
    stage = 'upload'; attemptedUpload = true;
    const upload = await fetch(url, { method: 'PUT', headers: { Origin: origin, 'Content-Type': 'text/plain' }, body: bytes, signal: AbortSignal.timeout(30_000) });
    if (!upload.ok || ![origin, '*'].includes(upload.headers.get('access-control-allow-origin') || '')) throw new Error('UPLOAD');
    stage = 'read';
    if (!(await readNeonFile(key, config.bucket)).equals(bytes)) throw new Error('CONTENT');
    stage = 'download';
    const download = await fetch(await createNeonDownloadUrl(key, '연결 확인.txt', config.bucket), { signal: AbortSignal.timeout(30_000) });
    if (!download.ok || !Buffer.from(await download.arrayBuffer()).equals(bytes) || !download.headers.get('content-disposition')?.includes('attachment')) throw new Error('DOWNLOAD');
    console.log(JSON.stringify({ origin, cors: 'passed', signedUpload: 'passed', storedBytes: 'matched', signedDownload: 'passed', workspaceRecords: 'unchanged' }));
  } catch {
    console.error(JSON.stringify({ fileTest: 'failed', stage, message: '연결·권한·CORS 설정을 확인해 주세요. 비밀값과 서명 URL은 출력하지 않습니다.' }));
    process.exitCode = 1;
  } finally {
    if (attemptedUpload) {
      try { await deleteNeonFile(key, config.bucket); console.log(JSON.stringify({ temporaryObject: 'removed' })); }
      catch { console.error(JSON.stringify({ temporaryObject: 'cleanup-failed', key, message: '이 시험에서 만든 임시 객체만 삭제를 다시 시도해 주세요.' })); process.exitCode = 1; }
    }
  }
}
main().catch(() => { console.error('파일 연결 검사 설정을 확인해 주세요. 사용법: npm run neon:files:check -- --origin https://앱주소'); process.exitCode = 1; });
