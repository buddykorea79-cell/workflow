import { NextRequest } from 'next/server';
import { currentUserId } from '@/lib/auth';
import { activeUser, getWorkspace, reconcileDueHandovers } from '@/lib/domain';
import { transaction } from '@/lib/store';
import { apiError, json } from '@/lib/api';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) { try { const userId = await currentUserId(request); return json(await transaction(state => { activeUser(state, userId); reconcileDueHandovers(state); return getWorkspace(state, userId); })); } catch (error) { return apiError(error); } }
