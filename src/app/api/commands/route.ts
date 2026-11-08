import { NextRequest } from 'next/server';
import { assertSameOrigin, currentUserId } from '@/lib/auth';
import { activeUser, denialEvent, DomainError, executeCommand, getWorkspace, reconcileDueHandovers } from '@/lib/domain';
import { transaction } from '@/lib/store';
import { apiError, json } from '@/lib/api';
import { readBoundedJson } from '@/lib/request-json';
export const runtime = 'nodejs';
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const userId = await currentUserId(request); const command = await readBoundedJson(request, 256_000); const result = await transaction(state => { activeUser(state, userId); reconcileDueHandovers(state); const candidate = structuredClone(state); try { const commandChanges = executeCommand(candidate, userId, command); Object.assign(state, candidate); return { workspace: { ...getWorkspace(state, userId), commandChanges } }; } catch (error) { if (error instanceof DomainError) { denialEvent(state, userId, command, error); return { error }; } throw error; } }); if (result.error) return apiError(result.error); return json(result.workspace); } catch (error) { return apiError(error); } }
