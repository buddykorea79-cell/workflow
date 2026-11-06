import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Attachment } from './types';
import { readNeonFile } from './attachment-storage';
import { dataDirectory } from './store';
import { DomainError } from './domain';

/** Call only after checking the caller's access to the owning task. */
export async function readAttachmentBytes(attachment: Attachment): Promise<Buffer> {
  const bytes = attachment.storageProvider === 'neon'
    ? await readNeonFile(attachment.storageKey, attachment.storageBucket)
    : await readFile(path.join(dataDirectory(), 'files', path.basename(attachment.storageKey)));
  if (bytes.length !== attachment.size || createHash('sha256').update(bytes).digest('hex') !== attachment.sha256) throw new DomainError(409, 'ATTACHMENT_CHANGED', '저장된 첨부파일이 변경되었습니다. 다시 올려 주세요.');
  return bytes;
}
