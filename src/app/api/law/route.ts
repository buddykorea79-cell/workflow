import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, currentUserId } from '@/lib/auth';
import { activeUser, assertDefinitionWritable, assertTaskWritable, canReadTask, DomainError } from '@/lib/domain';
import { readState } from '@/lib/store';
import { apiError, json } from '@/lib/api';
import { getLawDetail, searchLaw } from '@/lib/law-api';
import { assertUserRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const maxDuration = 35;

const common = { taskId: z.string().min(1).max(150), kind: z.enum(['law', 'admrul']) };
const inputSchema = z.discriminatedUnion('action', [
  z.object({ ...common, action: z.literal('search'), query: z.string().trim().min(1).max(100), scope: z.enum(['title', 'content']).default('title'), page: z.coerce.number().int().min(1).max(1000).default(1) }).strict(),
  z.object({ ...common, action: z.literal('detail'), id: z.string().regex(/^\d{1,30}$/) }).strict(),
]);
const activeRequests = new Set<string>();

/** Search returns public source text only. Importing it remains an explicit, ordinary task edit. */
export async function GET(request: NextRequest) {
  let requestKey: string | undefined;
  try {
    assertSameOrigin(request);
    const userId = await currentUserId(request);
    if (request.nextUrl.search.length > 4000) throw new DomainError(413, 'LAW_REQUEST_TOO_LARGE', '검색어를 줄여 다시 검색해 주세요.');
    const parsed = inputSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new DomainError(422, 'LAW_INVALID_INPUT', '법령 종류와 검색어 또는 조회할 항목을 확인해 주세요.');
    const input = parsed.data;
    const state = await readState();
    const user = activeUser(state, userId); const task = state.tasks.find(item => item.id === input.taskId);
    if (!task || !canReadTask(state, user, task)) throw new DomainError(403, 'LAW_ACCESS_DENIED', '이 업무의 관련 근거를 가져올 권한이 없습니다.');
    assertTaskWritable(state, task);
    if (task.status === 'archived') throw new DomainError(409, 'TASK_ARCHIVED', '보관된 업무의 관련 근거는 수정할 수 없습니다.');
    if (user.id !== task.primaryId && user.role !== 'admin' && !(user.departmentId === task.departmentId && user.role === 'manager')) throw new DomainError(403, 'LAW_EDIT_DENIED', '업무 담당자 또는 부서 담당자만 관련 근거를 가져올 수 있습니다.');
    assertDefinitionWritable(state, user, task.departmentId);
    if (activeRequests.has(userId)) throw new DomainError(429, 'LAW_ALREADY_RUNNING', '진행 중인 법령 조회가 끝난 뒤 다시 시도해 주세요.');
    assertUserRateLimit(userId);
    activeRequests.add(userId); requestKey = userId;
    return json(input.action === 'search'
      ? await searchLaw({ kind: input.kind, query: input.query, scope: input.scope, page: input.page }, { signal: request.signal })
      : await getLawDetail({ kind: input.kind, id: input.id }, { signal: request.signal }));
  } catch (error) { return apiError(error); }
  finally { if (requestKey) activeRequests.delete(requestKey); }
}
