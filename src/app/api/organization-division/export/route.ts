import { NextRequest } from 'next/server';
import { currentUserId } from '@/lib/auth';
import { activeUser, DomainError } from '@/lib/domain';
import { readState } from '@/lib/store';
import { apiError } from '@/lib/api';
import { organizationDivisionForUser, filterOrganizationDivision } from '@/lib/organization-division';
import { exportOrganizationDivisionPdf, exportOrganizationDivisionXlsx } from '@/lib/organization-division-export';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  try {
    const userId = await currentUserId(request);
    const params = request.nextUrl.searchParams;
    const format = params.get('format');
    if (format !== 'xlsx' && format !== 'pdf') throw new DomainError(422, 'EXPORT_FORMAT', 'Excel 또는 PDF 형식을 선택해 주세요.');
    const filters = { departmentId: params.get('departmentId') || '', team: params.get('team') || 'all', name: (params.get('name') || '').trim() };
    if (Object.values(filters).some(value => value.length > 100)) throw new DomainError(422, 'EXPORT_FILTER', '검색 조건은 100자 이내로 입력해 주세요.');
    const state = await readState();
    const now = new Date(); const user = activeUser(state, userId, now);
    // Every role starts with its own department; colleagues can explicitly select another.
    if (!filters.departmentId || user.role !== 'admin' && filters.departmentId === 'all') filters.departmentId = user.departmentId;
    if (filters.departmentId !== 'all' && !state.departments.some(item => item.id === filters.departmentId)) throw new DomainError(422, 'EXPORT_DEPARTMENT', '조회할 부서를 확인해 주세요.');
    const model = filterOrganizationDivision(organizationDivisionForUser(state, user, now), filters);
    const buffer = format === 'xlsx' ? await exportOrganizationDivisionXlsx(model, filters) : await exportOrganizationDivisionPdf(model, filters);
    const filename = `온이음_업무분장표_${model.generatedAt.slice(0, 10)}.${format}`;
    return new Response(new Uint8Array(buffer), { headers: {
      'Content-Type': format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'application/pdf',
      'Content-Disposition': `attachment; filename="organization-division.${format}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(buffer.length), 'Cache-Control': 'no-store, private', 'X-Content-Type-Options': 'nosniff',
    } });
  } catch (error) { return apiError(error); }
}
