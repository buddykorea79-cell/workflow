import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, currentUserId } from '@/lib/auth';
import { activeUser, assertDefinitionWritable, assertTaskWritable, canReadTask, DomainError } from '@/lib/domain';
import { transaction } from '@/lib/store';
import { apiError, json } from '@/lib/api';
import { readProcedureDocuments } from '@/lib/procedure-documents';
import { generateAiProcedure } from '@/lib/bizrouter';
import { AI_REFERENCE_LIMIT, procedureReferenceFingerprint } from '@/lib/procedure-ai-input';

export const runtime = 'nodejs';
export const maxDuration = 70;
const bodySchema = z.object({ taskId: z.string().min(1).max(150), referenceIds: z.array(z.string().min(1).max(150)).min(1).max(AI_REFERENCE_LIMIT), referencesFingerprint: z.string().max(4_100_000), readAttachments: z.boolean().default(true) }).strict();
const activeRequests = new Set<string>();

async function boundedJson(request: NextRequest) {
  const limit = 4_300_000;
  if (Number(request.headers.get('content-length') || 0) > limit) throw new DomainError(413, 'REQUEST_TOO_LARGE', '분석할 근거 범위를 줄여 주세요.');
  const reader = request.body?.getReader(); if (!reader) throw new DomainError(422, 'AI_REFERENCE_REQUIRED', '분석할 근거를 선택해 주세요.');
  const decoder = new TextDecoder(); let text = ''; let size = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new DomainError(413, 'REQUEST_TOO_LARGE', '분석할 근거 범위를 줄여 주세요.'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    try { return JSON.parse(text); } catch { throw new DomainError(422, 'INVALID_INPUT', '분석 요청 형식을 확인해 주세요.'); }
  } finally { reader.releaseLock(); }
}

export async function POST(request: NextRequest) {
  let requestKey: string | undefined;
  try {
    assertSameOrigin(request);
    const userId = await currentUserId(request);
    const parsed = bodySchema.safeParse(await boundedJson(request));
    if (!parsed.success) throw new DomainError(422, 'INVALID_INPUT', '업무와 분석할 관련 근거를 다시 선택해 주세요.');
    const input = parsed.data;
    const source = await transaction(state => {
      const user = activeUser(state, userId); const task = state.tasks.find(item => item.id === input.taskId);
      if (!task || !canReadTask(state, user, task)) throw new DomainError(403, 'PROCEDURE_ACCESS_DENIED', '이 업무의 관련 근거를 분석할 권한이 없습니다.');
      assertTaskWritable(state, task);
      if (task.status === 'archived') throw new DomainError(409, 'TASK_ARCHIVED', '보관된 업무의 절차는 변경할 수 없습니다.');
      if (user.id !== task.primaryId && user.role !== 'admin' && !(user.departmentId === task.departmentId && ['manager', 'head'].includes(user.role))) throw new DomainError(403, 'PROCEDURE_EDIT_DENIED', '담당자 또는 부서 관리자만 절차를 분석할 수 있습니다.');
      assertDefinitionWritable(state, user, task.departmentId);
      const references = input.referenceIds.map(id => task.references?.find(reference => reference.id === id));
      if (new Set(input.referenceIds).size !== input.referenceIds.length || references.some(reference => !reference)) throw new DomainError(409, 'AI_REFERENCES_CHANGED', '관련 근거를 먼저 저장한 뒤 AI 분석을 실행해 주세요.');
      const saved = references.filter(reference => reference !== undefined);
      if (procedureReferenceFingerprint(saved) !== input.referencesFingerprint) throw new DomainError(409, 'AI_REFERENCES_CHANGED', '관련 근거가 저장된 내용과 다릅니다. 변경사항을 먼저 저장하고 다시 분석해 주세요.');
      const attachments = saved.flatMap(reference => {
        if (!reference.attachmentId) return [];
        const file = state.attachments.find(file => file.id === reference.attachmentId && file.taskId === task.id);
        if (!file) throw new DomainError(409, 'AI_ATTACHMENT_MISSING', '이 업무의 첨부파일 연결을 확인해 주세요.');
        return [file];
      });
      return structuredClone({ title: task.title, description: task.description, references: saved, attachments, requiredStepTitles: state.commonTasks.find(common => common.id === task.commonId)?.requiredSteps });
    });
    if (activeRequests.has(userId)) throw new DomainError(429, 'AI_ALREADY_RUNNING', '진행 중인 AI 분석이 끝난 뒤 다시 요청해 주세요.');
    activeRequests.add(userId); requestKey = userId;
    const prepared = input.readAttachments ? await readProcedureDocuments(source.references, source.attachments) : { references: source.references, warnings: [] };
    const result = await generateAiProcedure({ title: source.title, description: source.description, references: prepared.references, requiredStepTitles: source.requiredStepTitles }, { signal: request.signal });
    result.draft.warnings.push(...prepared.warnings);
    return json(result);
  } catch (error) { return apiError(error); }
  finally { if (requestKey) activeRequests.delete(requestKey); }
}
