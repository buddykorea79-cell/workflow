import { createHash, randomUUID } from 'node:crypto';
import { activeUser } from './domain';
import { DomainError } from './domain-error';
import { resolveAiModelSetting } from './ai-model-settings';
import type { AiModelSettingInput } from './ai-model-types';
import type { WorkspaceData } from './types';

function administrator(state: WorkspaceData, userId: string) {
  const user = activeUser(state, userId);
  if (user.role !== 'admin') throw new DomainError(403, 'ADMIN_REQUIRED', 'AI 모델 설정은 관리자만 변경할 수 있습니다.');
  return user;
}

const requestKey = (input: AiModelSettingInput) => `ai-model:${input.requestId}`;
const fingerprint = (input: AiModelSettingInput) => createHash('sha256').update(JSON.stringify({ type: 'ai-model.set', modelId: input.modelId })).digest('hex');

export function aiModelSettingForAdmin(state: WorkspaceData, userId: string) {
  administrator(state, userId);
  return resolveAiModelSetting(state);
}

/** Also called again inside the write transaction: an initial authorization is not enough. */
export function inspectAiModelSettingChange(state: WorkspaceData, userId: string, input: AiModelSettingInput) {
  administrator(state, userId);
  const prior = state.processedRequests.find(request => request.id === requestKey(input) && request.actorId === userId);
  if (prior) {
    if (prior.fingerprint !== fingerprint(input)) throw new DomainError(409, 'IDEMPOTENCY_CONFLICT', '이미 사용한 요청 번호입니다. 현재 설정을 확인한 뒤 다시 저장해 주세요.');
    return { replay: true, setting: resolveAiModelSetting(state) };
  }
  const setting = resolveAiModelSetting(state);
  if (setting.revision !== input.expectedRevision) throw new DomainError(409, 'AI_MODEL_SETTING_CONFLICT', '다른 관리자가 AI 모델 설정을 변경했습니다. 현재 설정을 확인한 뒤 다시 선택해 주세요.');
  if (setting.revision >= Number.MAX_SAFE_INTEGER) throw new DomainError(409, 'AI_MODEL_SETTING_CONFLICT', 'AI 모델 설정 버전을 확인할 수 없습니다. 관리자에게 문의해 주세요.');
  return { replay: false, setting };
}

/** The caller must validate non-null IDs against the provider catalog before entering its transaction. */
export function applyAiModelSettingChange(state: WorkspaceData, userId: string, input: AiModelSettingInput) {
  const previous = inspectAiModelSettingChange(state, userId, input);
  if (previous.replay) return previous.setting;
  const user = administrator(state, userId);
  // Keep the object on reset as well, so restoring the default cannot reset the CAS version.
  state.aiSettings = { bizrouterModel: input.modelId, revision: previous.setting.revision + 1 };
  state.revision++;
  state.processedRequests.push({ id: requestKey(input), fingerprint: fingerprint(input), actorId: userId });
  state.audit.push({
    id: `audit-${randomUUID()}`, actorId: userId, action: 'ai-model.set', targetType: 'ai-settings',
    targetId: 'bizrouter-model', title: 'AI 모델 설정 변경',
    detail: input.modelId ? `사용 모델: ${input.modelId}` : '서버 기본 모델로 복원',
    departmentId: user.departmentId, createdAt: new Date().toISOString(),
  });
  return resolveAiModelSetting(state);
}
