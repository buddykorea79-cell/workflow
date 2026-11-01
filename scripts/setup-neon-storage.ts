import { randomUUID } from 'node:crypto';
import { CreateBucketCommand, GetBucketCorsCommand, HeadBucketCommand, PutBucketCorsCommand, type CORSRule } from '@aws-sdk/client-s3';
import { createNeonStorageClient, deleteNeonFile, getNeonStorageConfig, readNeonFile, uploadNeonFile } from '../src/lib/attachment-storage';
import { isStorageMissing, mergePrototypeCors, prototypeOrigins } from '../src/lib/neon-setup';

function output(value: Record<string, unknown>) { console.log(JSON.stringify(value, null, 2)); }

async function main() {
  const extraOrigins: string[] = [];
  let test = false;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--test') { test = true; continue; }
    if (args[index] === '--origin' && args[index + 1] && !args[index + 1].startsWith('--')) { extraOrigins.push(args[++index]); continue; }
    if (args[index] === '--help') { output({ usage: 'npm run neon:storage:setup -- [--origin https://앱주소.vercel.app] [--test]', note: '버킷과 브라우저 업로드 CORS를 설정합니다. --origin은 여러 번 지정할 수 있습니다. --test는 작은 임시 객체를 업로드·읽기·삭제합니다.' }); return; }
    throw new Error('UNKNOWN_ARGUMENT');
  }
  const origins = prototypeOrigins(extraOrigins, process.env.IEUM_APP_ORIGIN);
  const config = getNeonStorageConfig();
  if (!config) { output({ error: 'NEON_STORAGE_REQUIRED', message: 'IEUM_STORAGE_PROVIDER=neon과 AWS_* 저장소 연결값을 설정해 주세요.' }); process.exitCode = 1; return; }
  const client = createNeonStorageClient(config);
  let bucketCreated = false;
  try {
    try { await client.send(new HeadBucketCommand({ Bucket: config.bucket })); }
    catch (error) {
      if (!isStorageMissing(error)) throw error;
      await client.send(new CreateBucketCommand({ Bucket: config.bucket }));
      bucketCreated = true;
    }
    let existing: CORSRule[] = [];
    try { existing = (await client.send(new GetBucketCorsCommand({ Bucket: config.bucket }))).CORSRules || []; }
    catch (error) { if (!isStorageMissing(error)) throw error; }
    const rules = mergePrototypeCors(existing, origins);
    await client.send(new PutBucketCorsCommand({ Bucket: config.bucket, CORSConfiguration: { CORSRules: rules } }));
    const verified = await client.send(new GetBucketCorsCommand({ Bucket: config.bucket }));
    const stored = verified.CORSRules?.find(rule => rule.ID === 'ieum-prototype-upload');
    if (!stored || origins.some(origin => !stored.AllowedOrigins?.includes(origin))) throw new Error('CORS_VERIFICATION_FAILED');
    output({ storage: 'configured', bucket: config.bucket, bucketCreated, allowedOrigins: stored.AllowedOrigins, corsRules: verified.CORSRules?.length || 0 });
    if (test) {
      const key = `prototype-check/${randomUUID()}.txt`;
      const bytes = Buffer.from('Onieum Neon Object Storage connection test.');
      let uploaded = false;
      let verifiedRead = false;
      try {
        await uploadNeonFile(key, bytes, 'text/plain', config.bucket); uploaded = true;
        const received = await readNeonFile(key, config.bucket);
        if (!received.equals(bytes)) throw new Error('OBJECT_VERIFICATION_FAILED');
        verifiedRead = true;
      } finally { if (uploaded) await deleteNeonFile(key, config.bucket); }
      output({ objectTest: verifiedRead ? 'upload-read-delete-passed' : 'failed', temporaryObjectRemoved: uploaded });
    }
  } finally { client.destroy(); }
}

main().catch(error => {
  const known = error instanceof Error ? error.message : '';
  if (known === 'INVALID_ORIGIN') output({ error: 'INVALID_ORIGIN', message: '--origin에는 경로·쿼리·인증정보가 없는 HTTPS 앱 주소를 넣어 주세요. 로컬은 http://localhost 또는 http://127.0.0.1을 사용할 수 있습니다.' });
  else if (known === 'UNKNOWN_ARGUMENT') output({ error: 'UNKNOWN_ARGUMENT', message: '--origin <앱 주소>, --test 또는 --help만 사용할 수 있습니다.' });
  else output({ error: 'STORAGE_SETUP_FAILED', message: '저장소 설정을 완료하지 못했습니다. endpoint·region·버킷과 storage:read·storage:write 권한을 확인해 주세요. 비밀값과 공급자 응답은 출력하지 않습니다.' });
  process.exitCode = 1;
});
