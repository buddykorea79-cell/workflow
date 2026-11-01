import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Attachment, WorkspaceData } from './types';

export class NeonImportError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'NeonImportError'; }
}

const requiredCollections = ['users', 'departments', 'units', 'tasks', 'runs', 'handovers', 'commonTasks', 'sources', 'performances', 'delegations', 'audit', 'notifications', 'attachments', 'processedRequests'] as const;
const optionalCollections = ['releases', 'departmentWorkPlans', 'unitScorePlans', 'unitEvaluations'] as const;

/** Validate the envelope without dropping newer or historical fields. */
export function validateImportWorkspace(value: unknown): WorkspaceData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NeonImportError('INVALID_WORKSPACE', '워크스페이스 JSON 객체가 필요합니다.');
  const record = value as Record<string, unknown>;
  if (!Number.isSafeInteger(record.revision) || (record.revision as number) < 0) throw new NeonImportError('INVALID_REVISION', '워크스페이스 revision은 0 이상의 정수여야 합니다.');
  for (const key of [...requiredCollections, ...optionalCollections]) {
    if (optionalCollections.includes(key as typeof optionalCollections[number]) && record[key] === undefined) continue;
    const items = record[key];
    if (!Array.isArray(items)) throw new NeonImportError('INVALID_COLLECTION', `${key} 목록이 없거나 형식이 잘못되었습니다.`);
    const ids = new Set<string>();
    for (const item of items) {
      const idKey = key === 'departmentWorkPlans' ? 'departmentId' : 'id';
      if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item[idKey] !== 'string' || !item[idKey].trim()) throw new NeonImportError('INVALID_ID', `${key} 목록의 ID를 확인해 주세요.`);
      if (ids.has(item[idKey])) throw new NeonImportError('DUPLICATE_ID', `${key} 목록에 중복 ID가 있습니다.`);
      ids.add(item[idKey]);
    }
  }
  for (const attachment of record.attachments as Attachment[]) {
    if (!Number.isSafeInteger(attachment.size) || attachment.size <= 0 || typeof attachment.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(attachment.sha256) || typeof attachment.storageKey !== 'string' || !attachment.storageKey || typeof attachment.mime !== 'string') throw new NeonImportError('INVALID_ATTACHMENT', '첨부파일 크기·해시·저장 경로 정보를 확인해 주세요.');
    if (attachment.storageProvider !== undefined && attachment.storageProvider !== 'local' && attachment.storageProvider !== 'neon') throw new NeonImportError('INVALID_STORAGE_PROVIDER', '지원하지 않는 첨부파일 저장소입니다.');
  }
  return value as WorkspaceData;
}

/** JSONB changes object key order, so compare values rather than serialization order. */
export function canonicalJson(value: unknown): string {
  function sort(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(sort);
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, sort(child)]));
    return item;
  }
  return JSON.stringify(sort(value));
}

export function workspaceFingerprint(value: WorkspaceData): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function importCounts(state: WorkspaceData): Record<string, number> {
  return Object.fromEntries(Object.entries(state).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, (value as unknown[]).length]));
}

/** A completed import changes only the location of formerly local files. */
export function sameImportedWorkspace(local: WorkspaceData, remote: WorkspaceData): boolean {
  const comparable = structuredClone(remote);
  for (const attachment of comparable.attachments) {
    const original = local.attachments.find(item => item.id === attachment.id);
    if (original && original.storageProvider !== 'neon' && attachment.storageProvider === 'neon') {
      attachment.storageKey = original.storageKey;
      if (original.storageProvider === undefined) delete attachment.storageProvider; else attachment.storageProvider = original.storageProvider;
      if (original.storageBucket === undefined) delete attachment.storageBucket; else attachment.storageBucket = original.storageBucket;
    }
  }
  return workspaceFingerprint(local) === workspaceFingerprint(comparable);
}

export function importAction(local: WorkspaceData, remote: WorkspaceData | undefined, replace: boolean): 'create' | 'unchanged' | 'migrate-files' | 'replace' {
  if (!remote) return 'create';
  if (sameImportedWorkspace(local, remote)) return remote.attachments.some(item => item.storageProvider !== 'neon') ? 'migrate-files' : 'unchanged';
  if (!replace) throw new NeonImportError('REMOTE_DATA_EXISTS', 'DB에 다른 데이터가 있습니다. 내용을 먼저 확인한 뒤 --replace로 실행하면 기존 DB 데이터를 로컬 백업한 후 교체합니다.');
  return 'replace';
}

export function verifyAttachmentBytes(attachment: Attachment, bytes: Buffer): void {
  if (bytes.length !== attachment.size || createHash('sha256').update(bytes).digest('hex') !== attachment.sha256.toLowerCase()) throw new NeonImportError('ATTACHMENT_MISMATCH', '첨부파일의 실제 크기 또는 SHA-256이 메타데이터와 다릅니다. 원본 파일을 확인해 주세요.');
}

export async function readLocalImportAttachment(dataDirectory: string, attachment: Attachment): Promise<Buffer> {
  if (attachment.storageProvider === 'neon') throw new NeonImportError('REMOTE_ATTACHMENT', '이미 Neon에 있는 첨부파일은 로컬 경로로 읽을 수 없습니다.');
  if (!attachment.storageKey || attachment.storageKey === '.' || attachment.storageKey === '..' || /[\\/\0]/.test(attachment.storageKey)) throw new NeonImportError('INVALID_FILE_PATH', '로컬 첨부파일의 저장 경로가 올바르지 않습니다.');
  let bytes: Buffer;
  try { bytes = await readFile(path.join(dataDirectory, 'files', attachment.storageKey)); }
  catch { throw new NeonImportError('ATTACHMENT_FILE_MISSING', '로컬 첨부파일을 읽을 수 없습니다. 파일을 복구한 뒤 다시 실행해 주세요.'); }
  verifyAttachmentBytes(attachment, bytes);
  return bytes;
}
