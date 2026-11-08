'use client';

import { useEffect, useRef, useState } from 'react';
import './notification-focus.css';

type FocusElement = Pick<HTMLElement, 'focus' | 'scrollIntoView'>;
type FocusRuntime = {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  setTimer: (callback: () => void, milliseconds: number) => number;
  clearTimer: (id: number) => void;
  reducedMotion: boolean;
};

/** Filter updates must commit before their newly visible card can be focused. */
export function scheduleNotificationFocus(find: () => FocusElement | undefined, highlight: (active: boolean) => void, runtime: FocusRuntime) {
  let stopped = false;
  let frame = 0;
  let timer: number | undefined;
  let attempts = 0;
  const focus = () => {
    if (stopped) return;
    const element = find();
    if (!element) {
      if (++attempts < 10) frame = runtime.requestFrame(focus);
      return;
    }
    element.scrollIntoView({ behavior: runtime.reducedMotion ? 'auto' : 'smooth', block: 'start' });
    element.focus({ preventScroll: true });
    highlight(true);
    timer = runtime.setTimer(() => { if (!stopped) highlight(false); }, 2000);
  };
  frame = runtime.requestFrame(focus);
  return () => {
    stopped = true;
    runtime.cancelFrame(frame);
    if (timer !== undefined) runtime.clearTimer(timer);
  };
}

/** The workspace has already confirmed leaving any dirty editor before changing focus. */
export function useNotificationFocus(focusId: string | undefined, focusToken: number | undefined, prepare: (id: string) => string | undefined) {
  const targets = useRef(new Map<string, HTMLElement>());
  const prepareRef = useRef(prepare); prepareRef.current = prepare;
  const [highlighted, setHighlighted] = useState<string>();
  useEffect(() => {
    setHighlighted(undefined);
    if (!focusId) return;
    const targetId = prepareRef.current(focusId);
    if (!targetId) return;
    return scheduleNotificationFocus(() => targets.current.get(targetId), active => setHighlighted(active ? targetId : undefined), {
      requestFrame: callback => window.requestAnimationFrame(callback),
      cancelFrame: id => window.cancelAnimationFrame(id),
      setTimer: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
      clearTimer: id => window.clearTimeout(id),
      reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    });
  }, [focusId, focusToken]);
  return (id: string) => ({
    ref: (element: HTMLElement | null) => { if (element) targets.current.set(id, element); else targets.current.delete(id); },
    tabIndex: -1,
    'data-notification-focus-target': true,
    'data-notification-focused': highlighted === id ? true : undefined,
  });
}
