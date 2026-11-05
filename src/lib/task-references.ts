import type { TaskReference } from './types';

/** Empty form rows are placeholders and must not become stored references. */
export function hasReferenceContent(reference: TaskReference) {
  return !!(reference.title.trim() || reference.content.trim() || reference.url?.trim() || reference.attachmentId);
}

export function referencesForSave(references: TaskReference[]) {
  return references.filter(hasReferenceContent);
}

/** Changing a file must never silently carry the previous file's extracted text. */
export function referenceWithFile(reference: TaskReference, file: { id: string; name: string }, extractedText: string, keepVerifiedText = false): TaskReference {
  return { ...reference, title: reference.title.trim() || file.name.slice(0, 300), attachmentId: file.id, content: keepVerifiedText ? reference.content : extractedText.slice(0, 10000) };
}
