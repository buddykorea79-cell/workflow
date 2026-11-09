import type { TaskReference } from './types';
import { AI_GENERATION_TIMEOUT_MS } from './ai-generation-policy';

export const AI_REFERENCE_LIMIT = 20;
export const AI_REFERENCE_TEXT_LIMIT = 60_000;
export const AI_DESCRIPTION_DOCUMENT_LIMIT = 10;
export const AI_PROCEDURE_SOURCE_LIMIT = AI_REFERENCE_LIMIT + AI_DESCRIPTION_DOCUMENT_LIMIT + 1;
export const AI_PROCEDURE_TIMEOUT_MS = AI_GENERATION_TIMEOUT_MS;

export interface ProcedureOverviewInput { title: string; description: string; completionCriteria?: string; descriptionAttachmentIds?: string[]; reviewRequired?: boolean }

/** Keep the primary input tied to the saved overview and its attached files. */
export function procedureOverviewFingerprint(overview: ProcedureOverviewInput): string {
  return JSON.stringify({ title: overview.title, description: overview.description, completionCriteria: overview.completionCriteria || '', descriptionAttachmentIds: overview.descriptionAttachmentIds ?? [], reviewRequired: overview.reviewRequired !== false });
}

/** Compare exactly the source fields used by the model against the saved revision. */
export function procedureReferenceFingerprint(references: TaskReference[]): string {
  return JSON.stringify(references.map(reference => ({ id: reference.id, type: reference.type, title: reference.title, content: reference.content, url: reference.url || '', attachmentId: reference.attachmentId || '' })));
}
