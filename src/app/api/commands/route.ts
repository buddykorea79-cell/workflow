import { NextRequest } from 'next/server';
import { assertSameOrigin, currentUserId } from '@/lib/auth';
import { activeUser, denialEvent, DomainError, executeCommand, getWorkspace, reconcileDueHandovers } from '@/lib/domain';
import { transaction } from '@/lib/store';
import { apiError, json } from '@/lib/api';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) { try { assertSameOrigin(request); if (Number(request.headers.get('content-length') || 0) > 256_000) throw new DomainError(413, 'BODY_TOO_LARGE', '요청 데이터가 너무 큽니다.'); const userId = await currentUserId(request); const command = await request.json(); const result = await transaction(state => { activeUser(state, userId); reconcileDueHandovers(state); const candidate = structuredClone(state); try { executeCommand(candidate, userId, command); Object.assign(state, candidate); return { workspace: getWorkspace(state, userId) }; } catch (error) { if (error instanceof DomainError) { denialEvent(state, userId, command, error); return { error }; } throw error; } }); if (result.error) return apiError(result.error); return json(result.workspace); } catch (error) { return apiError(error); } }
