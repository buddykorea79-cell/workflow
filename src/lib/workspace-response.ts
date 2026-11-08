type Snapshot = { revision: number; currentUser: { id: string } };

/** Late reads/uploads must never roll back a save or restore a previous account. */
export function canApplyWorkspaceResponse(current: Snapshot | null, incoming: Snapshot, requestGeneration: number, activeGeneration: number) {
  return requestGeneration === activeGeneration && (!current || (
    incoming.currentUser.id === current.currentUser.id && incoming.revision >= current.revision
  ));
}
