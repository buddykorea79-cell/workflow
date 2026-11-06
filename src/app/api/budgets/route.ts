import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, currentUserId } from '@/lib/auth';
import { activeUser, denialEvent, DomainError, executeCommand, getWorkspace } from '@/lib/domain';
import { getBudgetCatalog, searchBudgets } from '@/lib/budget-catalog';
import { apiError, json } from '@/lib/api';
import { transaction } from '@/lib/store';

export const runtime = 'nodejs';
const inputSchema = z.object({
  query: z.string().trim().max(200).default(''),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  includeInactive: z.enum(['true', 'false']).default('false'),
  export: z.enum(['true', 'false']).default('false'),
}).strict();

export async function GET(request: NextRequest) {
  try {
    assertSameOrigin(request); const userId = await currentUserId(request);
    const parsed = inputSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new DomainError(422, 'BUDGET_INVALID_INPUT', '예산 검색어와 연도, 페이지를 확인해 주세요.');
    const input = parsed.data;
    const result = await transaction(state => {
      const user = activeUser(state, userId);
      if (user.role !== 'admin' && (input.includeInactive === 'true' || input.export === 'true')) throw new DomainError(403, 'BUDGET_ADMIN_REQUIRED', '전체 예산 자료 관리와 JSON 내려받기는 관리자만 사용할 수 있습니다.');
      return input.export === 'true' ? structuredClone(getBudgetCatalog(state)) : searchBudgets(state, { query: input.query, year: input.year, page: input.page, includeInactive: input.includeInactive === 'true' });
    });
    const response = json(result);
    if (input.export === 'true') response.headers.set('Content-Disposition', 'attachment; filename="ieum-budget-catalog.json"');
    return response;
  } catch (error) { return apiError(error); }
}

async function readCommand(request: NextRequest): Promise<unknown> {
  const limit = 3_000_000;
  if (Number(request.headers.get('content-length') || 0) > limit) throw new DomainError(413, 'BUDGET_BODY_TOO_LARGE', '예산 JSON은 3MB 이하로 올려 주세요.');
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError(400, 'BUDGET_INVALID_JSON', '예산 JSON 요청 본문이 필요합니다.');
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new DomainError(413, 'BUDGET_BODY_TOO_LARGE', '예산 JSON은 3MB 이하로 올려 주세요.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new DomainError(400, 'BUDGET_INVALID_JSON', '올바른 JSON 파일인지 확인해 주세요.'); }
}

/** Dedicated import endpoint allows a bounded catalog without enlarging ordinary command requests. */
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request); const userId = await currentUserId(request);
    await transaction(state => { if (activeUser(state, userId).role !== 'admin') throw new DomainError(403, 'BUDGET_ADMIN_REQUIRED', '예산 기준 자료는 관리자만 변경할 수 있습니다.'); });
    const command = await readCommand(request);
    if (!command || typeof command !== 'object' || !('type' in command) || !['budget.upsert', 'budget.setActive', 'budget.import'].includes(String(command.type))) throw new DomainError(422, 'BUDGET_INVALID_COMMAND', '예산 관리 요청만 처리할 수 있습니다.');
    const result = await transaction(state => {
      activeUser(state, userId);
      const candidate = structuredClone(state);
      try {
        executeCommand(candidate, userId, command);
        Object.assign(state, candidate);
        return { workspace: getWorkspace(state, userId) };
      } catch (error) {
        if (error instanceof DomainError) { denialEvent(state, userId, command, error); return { error }; }
        throw error;
      }
    });
    return result.error ? apiError(result.error) : json(result.workspace);
  } catch (error) { return apiError(error); }
}
