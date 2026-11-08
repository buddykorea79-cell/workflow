import { DomainError } from './domain-error';

export type StoreEnvironment = Record<string, string | undefined>;
export type StoreMode = 'local' | 'neon';

/** Resolve before reading or writing so an ambiguous QA setup never contacts Neon. */
export function resolveStoreMode(env: StoreEnvironment = process.env): StoreMode {
  const configured = env.IEUM_STORE?.trim();
  const database = !!env.DATABASE_URL?.trim();
  if (configured && configured !== 'local' && configured !== 'neon') {
    throw new DomainError(503, 'STORE_MODE_INVALID', 'IEUM_STORE는 local 또는 neon으로 설정해 주세요.');
  }
  if (configured === 'local') {
    if (env.VERCEL) throw new DomainError(503, 'DATABASE_NOT_CONFIGURED', '배포 환경에서는 로컬 파일 저장을 사용할 수 없습니다. IEUM_STORE=neon과 Neon 데이터베이스 연결을 설정해 주세요.');
    return 'local';
  }
  if (configured === 'neon') {
    if (!database) throw new DomainError(503, 'DATABASE_NOT_CONFIGURED', 'Neon 데이터베이스 연결이 필요합니다. DATABASE_URL을 설정해 주세요.');
    return 'neon';
  }
  if (database && env.IEUM_DATA_DIR?.trim()) {
    throw new DomainError(503, 'STORE_MODE_AMBIGUOUS', 'IEUM_DATA_DIR과 DATABASE_URL이 함께 설정되어 있습니다. 로컬 검증이면 IEUM_STORE=local을, DB 사용이면 IEUM_DATA_DIR을 지워 주세요.');
  }
  if (database) return 'neon';
  if (env.VERCEL) throw new DomainError(503, 'DATABASE_NOT_CONFIGURED', 'Neon 데이터베이스 연결이 필요합니다. 배포 환경에서는 로컬 파일 저장을 사용하지 않습니다.');
  return 'local';
}

export function resolveAttachmentStoreMode(env: StoreEnvironment = process.env): StoreMode {
  resolveStoreMode(env);
  // Explicit local QA overrides inherited remote file credentials as well as DB settings.
  if (env.IEUM_STORE?.trim() === 'local') return 'local';
  const provider = env.IEUM_STORAGE_PROVIDER?.trim() || 'local';
  if (provider !== 'local' && provider !== 'neon') throw new DomainError(503, 'STORAGE_CONFIG_INVALID', 'IEUM_STORAGE_PROVIDER는 local 또는 neon으로 설정해 주세요.');
  return provider;
}
