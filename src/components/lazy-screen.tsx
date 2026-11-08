'use client';

import { Component, Suspense, lazy, useState, type ComponentType, type ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import { useUnsavedNavigation } from './unsaved-changes';
import { createLazyResource } from '@/lib/lazy-resource';
import './lazy-screen.css';

type ScreenOptions = { label: string; kind?: 'page' | 'section' };
type LazyModule<Props extends object> = { default: ComponentType<Props> };

export function ScreenSkeleton({ label, kind = 'page' }: ScreenOptions) {
  return <section className={`lazy-screen lazy-screen-${kind}`} aria-busy="true" role="status" aria-label={`${label} 불러오는 중`}>
    <p>{label} 화면을 불러오고 있습니다.</p>
    <div className="lazy-screen-skeleton" aria-hidden="true"><i/><i/><div><i/><i/><i/></div></div>
  </section>;
}

export function ScreenLoadError({ label, kind = 'page', onRetry }: ScreenOptions & { onRetry: () => void }) {
  const { requestWorkspaceNavigation } = useUnsavedNavigation();
  return <section className={`lazy-screen lazy-screen-${kind} lazy-screen-error`} role="alert">
    <AlertCircle size={24} aria-hidden="true"/><h3>{label} 화면을 불러오지 못했습니다.</h3>
    <p>연결 상태를 확인한 뒤 다시 불러와 주세요.</p>
    <div className="lazy-screen-actions"><button type="button" className="btn btn-secondary" onClick={onRetry}><RotateCcw size={16} aria-hidden="true"/>다시 불러오기</button><button type="button" className="btn btn-ghost" onClick={() => requestWorkspaceNavigation(() => window.location.reload())}>페이지 새로고침</button></div>
  </section>;
}

class ScreenBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Call once at module scope with a literal import path, never during another component's render. */
export function createLazyScreen<Props extends object>(loader: () => Promise<ComponentType<Props> | LazyModule<Props>>, options: ScreenOptions): { Component: ComponentType<Props>; preload: () => Promise<void> } {
  const resource = createLazyResource(async (): Promise<LazyModule<Props>> => {
    const module = await loader();
    return typeof module === 'object' && module !== null && 'default' in module ? module : { default: module as ComponentType<Props> };
  });
  let currentComponent = lazy(resource.load);
  function LazyScreen(props: Props) {
    const [attempt, setAttempt] = useState(() => ({ number: 0, Component: currentComponent }));
    const Loaded = attempt.Component;
    const retry = () => {
      resource.resetFailure();
      // React.lazy remembers rejections. A new lazy type is required for an explicit retry.
      // New mounts also use the recovered type; already-mounted instances keep their own state.
      const retryComponent = lazy(resource.load);
      currentComponent = retryComponent;
      setAttempt(previous => ({ number: previous.number + 1, Component: retryComponent }));
    };
    return <ScreenBoundary key={attempt.number} fallback={<ScreenLoadError {...options} onRetry={retry}/>}>
      <Suspense fallback={<ScreenSkeleton {...options}/>}><Loaded {...props}/></Suspense>
    </ScreenBoundary>;
  }
  LazyScreen.displayName = `LazyScreen(${options.label})`;
  return { Component: LazyScreen, preload: resource.preload };
}
