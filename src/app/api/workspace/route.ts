import { NextRequest } from 'next/server';
import { currentUserId } from '@/lib/auth';
import { activeUser, getWorkspace, hasDueHandovers, reconcileDueHandovers } from '@/lib/domain';
import { readState, transaction } from '@/lib/store';
import { apiError, json } from '@/lib/api';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  try {
    const userId = await currentUserId(request);
    const state = await readState();
    const now = new Date();
    activeUser(state, userId, now);
    if (!hasDueHandovers(state, now)) return json(getWorkspace(state, userId, now));
    // Only a due personnel change needs the existing serialized write path.
    return json(await transaction(latest => {
      // A writer may have held the lock past a user's employment end time.
      const checkedAt = new Date();
      activeUser(latest, userId, checkedAt);
      reconcileDueHandovers(latest, checkedAt);
      return getWorkspace(latest, userId, checkedAt);
    }));
  } catch (error) { return apiError(error); }
}
