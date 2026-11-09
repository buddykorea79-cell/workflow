import type { AiModelSetting } from './ai-model-types';
import type { WorkspaceData } from './types';

type ModelEnvironment = Record<string, string | undefined>;
type ModelState = Pick<WorkspaceData, 'aiSettings'>;

/** Capture this once at the start of generation so an in-flight request keeps its model. */
export function resolveAiModel(state: ModelState, env: ModelEnvironment = process.env): string | undefined {
  return state.aiSettings?.bizrouterModel?.trim() || env.BIZROUTER_MODEL?.trim() || undefined;
}

export function resolveAiModelSetting(state: ModelState, env: ModelEnvironment = process.env): AiModelSetting {
  const modelId = state.aiSettings?.bizrouterModel?.trim() || null;
  const environmentModel = env.BIZROUTER_MODEL?.trim() || null;
  return {
    modelId,
    effectiveModel: modelId || environmentModel,
    environmentModel,
    source: modelId ? 'workspace' : environmentModel ? 'environment' : 'unset',
    revision: state.aiSettings?.revision ?? 0,
  };
}
