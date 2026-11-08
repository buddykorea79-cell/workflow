import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
if (process.env.VERCEL) throw new Error('배포 환경에서는 로컬 QA 서버를 실행할 수 없습니다.');
const port = process.env.IEUM_QA_PORT || '3001';
if (!/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw new Error('IEUM_QA_PORT를 1024~65535 사이의 포트로 설정해 주세요.');
const directory = path.resolve(projectDirectory, process.env.IEUM_QA_DATA_DIR || '.qa-data');
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', port], {
  cwd: projectDirectory,
  stdio: 'inherit',
  // Next reads process.env first. Do not depend on deleting DATABASE_URL, which
  // would allow .env.local to load it again in PowerShell or the child process.
  env: { ...process.env, IEUM_STORE: 'local', IEUM_DATA_DIR: directory, IEUM_STORAGE_PROVIDER: 'local', IEUM_APP_ORIGIN: `http://127.0.0.1:${port}`, NEON_AUTH_BASE_URL: '', BIZROUTER_API_KEY: '', IEUM_PROTOTYPE_MODE: 'false' },
});
console.info(`[ieum] 로컬 QA: http://127.0.0.1:${port} · ${directory}`);
child.on('error', () => { console.error('[ieum] QA 서버를 실행하지 못했습니다. npm run build를 먼저 실행해 주세요.'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
