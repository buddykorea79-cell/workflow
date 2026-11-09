/** Only a non-secret model identifier and its own concurrency version are persisted. */
export interface AiModelSettings {
  bizrouterModel: string | null;
  revision: number;
}

export interface AiModelSetting {
  modelId: string | null;
  effectiveModel: string | null;
  environmentModel: string | null;
  source: 'workspace' | 'environment' | 'unset';
  revision: number;
}

export interface AiModelSettingInput {
  modelId: string | null;
  /** The model setting revision, not the revision of unrelated workspace work. */
  expectedRevision: number;
  requestId: string;
}
