import type { NextRequest } from 'next/server';
import { currentUserId } from './auth';
import { activeUser, DomainError } from './domain';
import { readState } from './store';

export async function requireIntegrationAdmin(request: NextRequest) {
  const userId = await currentUserId(request);
  if (activeUser(await readState(), userId).role !== 'admin') throw new DomainError(403, 'ADMIN_REQUIRED', '연결 설정과 시험은 관리자만 실행할 수 있습니다.');
  return userId;
}
