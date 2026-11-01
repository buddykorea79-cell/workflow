import type { TaskReference } from './types';

/** Empty form rows are placeholders and must not become stored references. */
export function hasReferenceContent(reference: TaskReference) {
  return !!(reference.title.trim() || reference.content.trim() || reference.url?.trim() || reference.attachmentId);
}

export function referencesForSave(references: TaskReference[]) {
  return references.filter(hasReferenceContent);
}
