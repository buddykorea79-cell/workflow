'use client';

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createUnsavedChangesRegistry } from '@/lib/unsaved-changes';
import { ConfirmDialog } from './ui';

type Navigation = () => void;
type UnsavedContext = {
  register: (id: string, dirty: boolean, label: string) => void;
  draftIds: () => string[];
  clearDraft: (id: string) => void;
  clearDrafts: (ids: readonly string[]) => void;
  confirmDiscard: (preservedIds?: readonly string[]) => Promise<boolean>;
  requestNavigation: (action: Navigation, onCancel?: Navigation, preservedIds?: readonly string[]) => void;
};
const Context = createContext<UnsavedContext>({ register: () => undefined, draftIds: () => [], clearDraft: () => undefined, clearDrafts: () => undefined, confirmDiscard: async () => true, requestNavigation: action => action() });
const PreservedContext = createContext<readonly string[]>([]);
type PendingNavigation = { action: Navigation; onCancel?: Navigation; labels: string[] };

/** Keep drafts in their mounted forms until the user explicitly chooses to leave. */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createUnsavedChangesRegistry);
  const dirty = useSyncExternalStore(registry.subscribe, registry.hasChanges, () => false);
  const [pending, setPending] = useState<PendingNavigation | null>(null);
  const pendingRef = useRef<PendingNavigation | null>(null);
  const requestNavigation = useCallback((action: Navigation, onCancel?: Navigation, preservedIds: readonly string[] = []) => {
    // Keep the first requested destination while its confirmation is open.
    if (pendingRef.current) { onCancel?.(); return; }
    const labels = registry.labels(preservedIds);
    if (!labels.length) { action(); return; }
    const request = { action, onCancel, labels };
    pendingRef.current = request; setPending(request);
  }, [registry]);
  const confirmDiscard = useCallback((preservedIds: readonly string[] = []) => new Promise<boolean>(resolve => {
    requestNavigation(() => resolve(true), () => resolve(false), preservedIds);
  }), [requestNavigation]);
  useEffect(() => {
    if (!dirty) return;
    const protect = (event: BeforeUnloadEvent) => {
      if (!registry.hasChanges()) return;
      event.preventDefault(); event.returnValue = '';
    };
    window.addEventListener('beforeunload', protect);
    return () => window.removeEventListener('beforeunload', protect);
  }, [dirty, registry]);
  useEffect(() => () => { pendingRef.current?.onCancel?.(); pendingRef.current = null; }, []);
  const value = useMemo(() => ({ register: registry.register, clearDraft: registry.clearDraft, clearDrafts: registry.clearDrafts, draftIds: registry.draftIds, requestNavigation, confirmDiscard }), [registry, requestNavigation, confirmDiscard]);
  const finish = (discard: boolean) => {
    const request = pendingRef.current;
    pendingRef.current = null; setPending(null);
    if (discard) request?.action(); else request?.onCancel?.();
  };
  return <Context.Provider value={value}>{children}{pending && <ConfirmDialog onCancel={() => finish(false)} onConfirm={() => finish(true)}><p>{pending.labels.join(' · ')}</p></ConfirmDialog>}</Context.Provider>;
}

/** Opening task details keeps the page behind the dialog mounted and its drafts intact. */
export function UnsavedChangesBoundary({ children }: { children: ReactNode }) {
  const { draftIds } = useContext(Context);
  const [preservedIds] = useState(draftIds);
  return <PreservedContext.Provider value={preservedIds}>{children}</PreservedContext.Provider>;
}

export function useUnsavedChanges(dirty: boolean, label = '작성 중인 내용') {
  const id = useId();
  const { register } = useContext(Context);
  useEffect(() => { register(id, dirty, label); return () => register(id, false, label); }, [id, dirty, label, register]);
  return id;
}

export function useUnsavedNavigation() {
  const { requestNavigation, confirmDiscard, clearDraft, clearDrafts } = useContext(Context);
  const inheritedIds = useContext(PreservedContext);
  const requestScopedNavigation = useCallback((action: Navigation, onCancel?: Navigation, preservedIds: readonly string[] = []) => requestNavigation(action, onCancel, [...inheritedIds, ...preservedIds]), [inheritedIds, requestNavigation]);
  const confirmScopedDiscard = useCallback((preservedIds: readonly string[] = []) => confirmDiscard([...inheritedIds, ...preservedIds]), [inheritedIds, confirmDiscard]);
  return { requestNavigation: requestScopedNavigation, requestWorkspaceNavigation: requestNavigation, confirmDiscard: confirmScopedDiscard, clearDraft, clearDrafts };
}
