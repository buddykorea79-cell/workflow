import { NextRequest } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { assertSameOrigin, currentUserId } from '@/lib/auth';
import { DomainError } from '@/lib/domain';
import { descriptionAttachment } from '@/lib/task-description-access';
import { readNeonFile } from '@/lib/attachment-storage';
import { dataDirectory, transaction } from '@/lib/store';
import { apiError, json } from '@/lib/api';
import { extractDocument } from '@/lib/document-extraction';
import { generateAiTaskDescription } from '@/lib/bizrouter';

export const runtime = 'nodejs';
export const maxDuration = 70;
const extractSchema = z.object({ action: z.literal('extract'), attachmentId: z.string().min(1).max(150) }).strict();
const generateSchema = z.object({ action: z.literal('generate'), title: z.string().trim().min(1).max(150), description: z.string().max(20_000), documents: z.array(z.object({ attachmentId: z.string().min(1).max(150), text: z.string().trim().min(1).max(60_000) }).strict()).min(1).max(10) }).strict();
const inputSchema = z.discriminatedUnion('action', [extractSchema, generateSchema]);
const requests = new Set<string>();


async function requestBody(request: NextRequest) {
  const limit = 350_000; const reader = request.body?.getReader();
  if (!reader) throw new DomainError(422, 'INVALID_INPUT', '분석할 문서를 선택해 주세요.');
  let size = 0; let text = ''; const decoder = new TextDecoder();
  try {
    while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > limit) { await reader.cancel(); throw new DomainError(413, 'REQUEST_TOO_LARGE', '분석 본문은 합계 6만 자까지 지원합니다.'); } text += decoder.decode(item.value, { stream: true }); }
    try { return JSON.parse(text + decoder.decode()); } catch { throw new DomainError(422, 'INVALID_INPUT', '문서 분석 요청 형식을 확인해 주세요.'); }
  } finally { reader.releaseLock(); }
}

export async function POST(request: NextRequest) {
  let key: string | undefined;
  try {
    assertSameOrigin(request); const userId = await currentUserId(request);
    const parsed = inputSchema.safeParse(await requestBody(request));
    if (!parsed.success) throw new DomainError(422, 'INVALID_INPUT', '업무명과 분석할 문서 본문을 확인해 주세요.');
    const input = parsed.data;
    if (requests.has(userId)) throw new DomainError(429, 'ANALYSIS_RUNNING', '진행 중인 문서 읽기·분석이 끝난 뒤 다시 요청해 주세요.');
    requests.add(userId); key = userId;
    if (input.action === 'extract') {
      const attachment = await transaction(state => descriptionAttachment(state, userId, input.attachmentId));
      const buffer = attachment.storageProvider === 'neon' ? await readNeonFile(attachment.storageKey, attachment.storageBucket) : await readFile(path.join(dataDirectory(), 'files', path.basename(attachment.storageKey)));
      if (buffer.length !== attachment.size || createHash('sha256').update(buffer).digest('hex') !== attachment.sha256) throw new DomainError(409, 'ATTACHMENT_CHANGED', '저장된 파일의 크기나 내용이 다릅니다. 다시 올려 주세요.');
      return json({ attachmentId: attachment.id, name: attachment.name, ...await extractDocument(buffer, attachment.name) });
    }
    const documents = await transaction(state => input.documents.map(document => ({ ...document, name: descriptionAttachment(state, userId, document.attachmentId).name })));
    return json(await generateAiTaskDescription({ title: input.title, description: input.description, documents }, { signal: request.signal }));
  } catch (error) { return apiError(error); }
  finally { if (key) requests.delete(key); }
}
