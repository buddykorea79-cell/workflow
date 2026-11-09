import { NextRequest } from 'next/server';
import { z } from 'zod';
import { apiError, json } from '@/lib/api';
import { assertSameOrigin } from '@/lib/auth';
import { requireIntegrationAdmin } from '@/lib/admin-integrations-auth';
import { aiModelSettingForAdmin, applyAiModelSettingChange, inspectAiModelSettingChange } from '@/lib/admin-ai-model-settings';
import { assertBizRouterModel, fetchBizRouterModels } from '@/lib/bizrouter-models';
import { DomainError } from '@/lib/domain-error';
import { readBoundedJson } from '@/lib/request-json';
import { readState, transaction } from '@/lib/store';

export const runtime = 'nodejs';
export const maxDuration = 40;

const inputSchema = z.object({
  modelId: z.string().trim().min(1).max(200).nullable(),
  expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  requestId: z.string().trim().min(1).max(150),
}).strict();

export async function GET(request: NextRequest) {
  try {
    const userId = await requireIntegrationAdmin(request);
    return json(aiModelSettingForAdmin(await readState(), userId));
  } catch (error) { return apiError(error); }
}

export async function PUT(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const userId = await requireIntegrationAdmin(request);
    const parsed = inputSchema.safeParse(await readBoundedJson(request, 2048, request.signal));
    if (!parsed.success) throw new DomainError(422, 'INVALID_INPUT', 'AI 모델과 설정 버전, 요청 번호를 확인해 주세요.');
    const input = parsed.data;
    const inspected = inspectAiModelSettingChange(await readState(), userId, input);
    if (inspected.replay) return json(inspected.setting);
    if (input.modelId !== null) {
      const models = await fetchBizRouterModels({ signal: request.signal });
      assertBizRouterModel(models, input.modelId);
    }
    request.signal.throwIfAborted();
    const result = await transaction(state => {
      request.signal.throwIfAborted();
      return applyAiModelSettingChange(state, userId, input);
    });
    return json(result);
  } catch (error) { return apiError(error); }
}
