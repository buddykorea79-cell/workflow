import type { Workspace } from './types';

/** Compare the submitted values, not loading flags or a refreshed server revision. */
export function sameDraft(current: unknown, submitted: unknown) { return JSON.stringify(current) === JSON.stringify(submitted); }

/** Successful command responses put the command's audit entry before any earlier entries. */
export function savedCommandTarget(workspace: Workspace, action: string, actorId: string) {
  return workspace.audit.find(event => event.action === action && event.actorId === actorId)?.targetId;
}
