import { NextRequest } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, currentUserId } from '@/lib/auth';
import { DomainError } from '@/lib/domain';
import { departmentBudgetForUser } from '@/lib/department-budget';
import { apiError, json } from '@/lib/api';
import { readState } from '@/lib/store';

export const runtime = 'nodejs';
const inputSchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
  departmentId: z.string().trim().min(1).max(200).optional(),
}).strict();

export async function GET(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const userId = await currentUserId(request);
    const parsed = inputSchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) throw new DomainError(422, 'DEPARTMENT_BUDGET_INVALID_INPUT', '조회할 부서와 회계연도를 확인해 주세요.');
    const result = departmentBudgetForUser(await readState(), userId, parsed.data);
    return json(result);
  } catch (error) { return apiError(error); }
}
