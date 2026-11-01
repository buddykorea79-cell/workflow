import type { TaskReference } from './types';

export const AI_REFERENCE_LIMIT = 20;
export const AI_REFERENCE_TEXT_LIMIT = 60_000;

/** Compare exactly the source fields used by the model against the saved revision. */
export function procedureReferenceFingerprint(references: TaskReference[]): string {
  return JSON.stringify(references.map(reference => ({ id: reference.id, type: reference.type, title: reference.title, content: reference.content, url: reference.url || '', attachmentId: reference.attachmentId || '' })));
}
