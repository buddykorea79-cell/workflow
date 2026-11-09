import { NextRequest } from 'next/server';
import { apiError, json } from '@/lib/api';
import { requireIntegrationAdmin } from '@/lib/admin-integrations-auth';
import { fetchBizRouterModels } from '@/lib/bizrouter-models';

export const runtime = 'nodejs';
export const maxDuration = 40;

export async function GET(request: NextRequest) {
  try {
    await requireIntegrationAdmin(request);
    const models = await fetchBizRouterModels({ signal: request.signal });
    return json({ models, checkedAt: new Date().toISOString() });
  } catch (error) { return apiError(error); }
}
