import { NextRequest } from 'next/server';
import { currentUserId } from '@/lib/auth';
import { activeUser, DomainError } from '@/lib/domain';
import { readState } from '@/lib/store';
import { apiError, json } from '@/lib/api';
import { organizationDivisionProcedureForUser } from '@/lib/organization-division-procedure';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const userId = await currentUserId(request);
    const values = request.nextUrl.searchParams.getAll('taskId');
    const taskId = values[0]?.trim();
    if (values.length !== 1 || !taskId || taskId.length > 150) throw new DomainError(422, 'DIVISION_PROCEDURE_TASK', '절차도를 조회할 세부업무를 선택해 주세요.');
    const state = await readState();
    const now = new Date();
    const user = activeUser(state, userId, now);
    return json(organizationDivisionProcedureForUser(state, user, taskId, now));
  } catch (error) { return apiError(error); }
}
