import { Pool, neonConfig } from '@neondatabase/serverless';
import { GetBucketCorsCommand, HeadBucketCommand } from '@aws-sdk/client-s3';
import ws from 'ws';
import { createNeonStorageClient, getNeonStorageConfig } from '../src/lib/attachment-storage';
import { importCounts, validateImportWorkspace } from '../src/lib/neon-import';
import { isStorageMissing } from '../src/lib/neon-setup';

const names = ['DATABASE_URL', 'IEUM_WORKSPACE_ID', 'IEUM_STORAGE_PROVIDER', 'IEUM_STORAGE_BUCKET', 'AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'BIZROUTER_API_KEY', 'BIZROUTER_MODEL'] as const;
function output(value: Record<string, unknown>) { console.log(JSON.stringify(value, null, 2)); }

async function main() {
  if (process.argv.length > 2) { output({ error: 'UNKNOWN_ARGUMENT', message: 'neon:check는 인자 없이 실행해 주세요.' }); process.exitCode = 1; return; }
  output({ environment: Object.fromEntries(names.map(name => [name, process.env[name]?.trim() ? 'configured' : 'empty'])), message: '설정값과 비밀키는 출력하지 않습니다.' });
  if (!process.env.DATABASE_URL?.trim()) {
    output({ database: 'not-configured', message: '.env.local에 DATABASE_URL을 설정해 주세요. Vercel에서 연결했다면 프로젝트 Settings → Environment Variables의 값을 로컬에도 설정합니다.' });
    process.exitCode = 1;
  } else {
    neonConfig.webSocketConstructor = ws;
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 15_000 });
    try {
      const tables = await pool.query("SELECT to_regclass('public.ieum_workspaces') AS name");
      if (!tables.rows[0]?.name) {
        output({ database: 'connected', workspace: 'table-missing', next: 'npm run neon:import로 검사한 뒤 npm run neon:import -- --apply로 이관해 주세요.' });
        process.exitCode = 1;
      } else {
        const rows = await pool.query('SELECT revision, data FROM ieum_workspaces WHERE id = $1', [process.env.IEUM_WORKSPACE_ID?.trim() || 'development']);
        if (!rows.rows[0]) {
          output({ database: 'connected', workspace: 'row-missing', next: 'IEUM_WORKSPACE_ID를 확인한 뒤 현재 로컬 데이터를 이관해 주세요.' });
          process.exitCode = 1;
        } else {
          const state = validateImportWorkspace(rows.rows[0].data);
          if (rows.rows[0].revision !== state.revision) throw new Error('REVISION_MISMATCH');
          output({ database: 'connected', workspace: 'ready', revision: state.revision, counts: importCounts(state) });
        }
      }
    } catch { output({ database: 'check-failed', message: 'DB 연결·권한·워크스페이스 형식을 확인해 주세요. 연결 문자열과 공급자 오류 내용은 출력하지 않습니다.' }); process.exitCode = 1; }
    finally { await pool.end(); }
  }
  let storage;
  try { storage = getNeonStorageConfig(); }
  catch { output({ storage: 'configuration-incomplete', message: 'IEUM_STORAGE_PROVIDER, IEUM_STORAGE_BUCKET과 AWS_* 저장소 연결값을 확인해 주세요.' }); process.exitCode = 1; return; }
  if (!storage) { output({ storage: 'local', next: 'Neon 파일 저장을 사용하려면 IEUM_STORAGE_PROVIDER=neon과 AWS_* 값을 설정해 주세요.' }); return; }
  const client = createNeonStorageClient(storage);
  try {
    await client.send(new HeadBucketCommand({ Bucket: storage.bucket }));
    try {
      const cors = await client.send(new GetBucketCorsCommand({ Bucket: storage.bucket }));
      output({ storage: 'connected', bucket: 'ready', corsRules: cors.CORSRules?.length || 0, objectWrites: 'not-tested' });
      if (!cors.CORSRules?.length) output({ next: '브라우저 업로드를 위해 npm run neon:storage:setup -- --origin <앱 주소>를 실행해 주세요.' });
    } catch (error) {
      if (!isStorageMissing(error)) throw error;
      output({ storage: 'connected', bucket: 'ready', corsRules: 0, next: '브라우저 업로드를 위해 npm run neon:storage:setup -- --origin <앱 주소>를 실행해 주세요.' });
    }
  } catch (error) {
    output({ storage: isStorageMissing(error) ? 'bucket-missing' : 'check-failed', message: isStorageMissing(error) ? 'npm run neon:storage:setup으로 버킷과 CORS를 준비해 주세요.' : 'Neon 저장소 endpoint·region·자격증명과 읽기 권한을 확인해 주세요.' });
    process.exitCode = 1;
  } finally { client.destroy(); }
}

main().catch(() => { output({ error: 'CHECK_FAILED', message: '설정 검사를 완료하지 못했습니다. .env.local과 네트워크 연결을 확인해 주세요.' }); process.exitCode = 1; });
