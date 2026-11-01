import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DomainError } from './domain';

export interface NeonStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export const ATTACHMENT_SIZE_LIMIT = 10 * 1024 * 1024;

export function getNeonStorageConfig(env: Record<string, string | undefined> = process.env): NeonStorageConfig | undefined {
  const provider = env.IEUM_STORAGE_PROVIDER?.trim() || 'local';
  if (provider === 'local') return undefined;
  if (provider !== 'neon') throw new DomainError(503, 'STORAGE_CONFIG_INVALID', 'IEUM_STORAGE_PROVIDER는 local 또는 neon으로 설정해 주세요.');
  const names = ['AWS_ENDPOINT_URL_S3', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'] as const;
  const missing = names.filter(name => !env[name]?.trim());
  if (missing.length) throw new DomainError(503, 'STORAGE_NOT_CONFIGURED', `Neon 파일 저장 설정이 필요합니다: ${missing.join(', ')}`);
  let endpoint: URL;
  try { endpoint = new URL(env.AWS_ENDPOINT_URL_S3!.trim()); }
  catch { throw new DomainError(503, 'STORAGE_CONFIG_INVALID', 'AWS_ENDPOINT_URL_S3에 Neon 브랜치의 HTTPS 저장소 주소를 입력해 주세요.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !['', '/'].includes(endpoint.pathname)) {
    throw new DomainError(503, 'STORAGE_CONFIG_INVALID', 'AWS_ENDPOINT_URL_S3에는 경로·인증정보가 없는 Neon 브랜치의 HTTPS 저장소 주소를 입력해 주세요.');
  }
  const bucket = env.IEUM_STORAGE_BUCKET?.trim() || 'ieum-attachments';
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new DomainError(503, 'STORAGE_CONFIG_INVALID', 'IEUM_STORAGE_BUCKET에 생성한 버킷 이름을 입력해 주세요.');
  return { endpoint: endpoint.origin, region: env.AWS_REGION!.trim(), accessKeyId: env.AWS_ACCESS_KEY_ID!.trim(), secretAccessKey: env.AWS_SECRET_ACCESS_KEY!.trim(), bucket };
}

function requireStorageConfig() {
  const config = getNeonStorageConfig();
  if (!config) throw new DomainError(503, 'STORAGE_NOT_CONFIGURED', 'Neon 파일 저장소를 사용하려면 IEUM_STORAGE_PROVIDER=neon과 AWS 저장소 연결값을 설정해 주세요.');
  return config;
}

export function createNeonStorageClient(config: NeonStorageConfig): S3Client {
  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2,
    requestHandler: { connectionTimeout: 10_000, requestTimeout: 30_000 },
  });
}

function isMissingObject(error: unknown) {
  const item = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return item?.$metadata?.httpStatusCode === 404 || item?.name === 'NotFound' || item?.name === 'NoSuchKey';
}

function storageError(error: unknown, operation: 'read' | 'write' | 'delete'): never {
  if (error instanceof DomainError) throw error;
  const item = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  if (item?.$metadata?.httpStatusCode === 403 || item?.name === 'AccessDenied') throw new DomainError(503, 'STORAGE_ACCESS_DENIED', 'Neon 저장소 자격증명과 storage:read·storage:write 권한을 확인해 주세요.');
  if (operation === 'read' && isMissingObject(error)) throw new DomainError(404, 'STORAGE_FILE_NOT_FOUND', 'Neon 저장소에서 첨부파일을 찾을 수 없습니다. 연결한 브랜치와 버킷을 확인해 주세요.');
  throw new DomainError(503, 'STORAGE_UNAVAILABLE', 'Neon 파일 저장소에 연결하지 못했습니다. 저장소 주소·리전·버킷 설정과 연결 상태를 확인해 주세요.');
}

export async function uploadNeonFile(key: string, body: Buffer, contentType: string, bucket?: string): Promise<void> {
  if (!body.length || body.length > ATTACHMENT_SIZE_LIMIT) throw new DomainError(413, 'FILE_TOO_LARGE', '첨부파일은 비어 있지 않은 10MB 이하 파일이어야 합니다.');
  const config = requireStorageConfig(); const client = createNeonStorageClient(config); const Bucket = bucket || config.bucket;
  try {
    // Callers use fresh UUID keys. The probe also protects accidental key reuse;
    // Neon does not document conditional PutObject support as an atomic guarantee.
    try {
      await client.send(new HeadObjectCommand({ Bucket, Key: key }));
      throw new DomainError(409, 'STORAGE_KEY_EXISTS', '동일한 저장 키의 파일이 이미 있습니다. 새 저장 키로 다시 등록해 주세요.');
    } catch (error) { if (!isMissingObject(error)) throw error; }
    await client.send(new PutObjectCommand({ Bucket, Key: key, Body: body, ContentType: contentType, ContentLength: body.length }));
  } catch (error) { storageError(error, 'write'); }
  finally { client.destroy(); }
}

export async function createNeonUploadUrl(key: string, contentType: string, bucket?: string): Promise<string> {
  const config = requireStorageConfig(); const client = createNeonStorageClient(config);
  try { return await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket || config.bucket, Key: key, ContentType: contentType }), { expiresIn: 300 }); }
  catch (error) { return storageError(error, 'write'); }
  finally { client.destroy(); }
}

export async function createNeonDownloadUrl(key: string, name: string, bucket?: string): Promise<string> {
  const config = requireStorageConfig(); const client = createNeonStorageClient(config);
  try { return await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket || config.bucket, Key: key, ResponseContentType: 'application/octet-stream', ResponseContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(name)}` }), { expiresIn: 60 }); }
  catch (error) { return storageError(error, 'read'); }
  finally { client.destroy(); }
}

export async function readNeonFile(key: string, bucket?: string): Promise<Buffer> {
  const config = requireStorageConfig(); const client = createNeonStorageClient(config);
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket || config.bucket, Key: key }));
    if (!result.Body) throw new DomainError(404, 'STORAGE_FILE_NOT_FOUND', 'Neon 저장소의 파일 내용을 읽을 수 없습니다.');
    if (result.ContentLength && result.ContentLength > ATTACHMENT_SIZE_LIMIT) throw new DomainError(413, 'FILE_TOO_LARGE', '첨부파일은 10MB 이하만 읽을 수 있습니다.');
    const buffer = Buffer.from(await result.Body.transformToByteArray());
    if (buffer.length > ATTACHMENT_SIZE_LIMIT) throw new DomainError(413, 'FILE_TOO_LARGE', '첨부파일은 10MB 이하만 읽을 수 있습니다.');
    return buffer;
  } catch (error) { return storageError(error, 'read'); }
  finally { client.destroy(); }
}

export async function deleteNeonFile(key: string, bucket?: string): Promise<void> {
  const config = requireStorageConfig(); const client = createNeonStorageClient(config);
  try { await client.send(new DeleteObjectCommand({ Bucket: bucket || config.bucket, Key: key })); }
  catch (error) { storageError(error, 'delete'); }
  finally { client.destroy(); }
}
