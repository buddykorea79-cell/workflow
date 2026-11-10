'use client';

import { useId, useRef, type ReactNode } from 'react';
import { tabDomIds, tabKeyAction } from '@/lib/tab-navigation';
import './accessible-tabs.css';

export type TabItem<Value extends string = string> = { value: Value; label: ReactNode; disabled?: boolean; ariaLabel?: string; accent?: boolean };
export type TabPanelAttrs = { id: string; role: 'tabpanel'; 'aria-labelledby': string; hidden: boolean; tabIndex: 0 };
export type TabsControls<Value extends string = string> = {
  value: Value;
  items: readonly TabItem<Value>[];
  onChange: (value: Value) => void;
  tabId: (value: Value) => string;
  panelAttrs: (value: Value) => TabPanelAttrs;
};

/** The caller owns selection and existing dirty guards; this hook never changes content by itself. */
export function useTabs<Value extends string>({ value, onChange, items }: { value: Value; onChange: (value: Value) => void; items: readonly TabItem<Value>[] }): TabsControls<Value> {
  const baseId = useId();
  return {
    value, items, onChange,
    tabId: item => tabDomIds(baseId, item).tab,
    panelAttrs: item => ({ id: tabDomIds(baseId, item).panel, role: 'tabpanel', 'aria-labelledby': tabDomIds(baseId, item).tab, hidden: value !== item, tabIndex: 0 }),
  };
}

export function Tabs<Value extends string>({ tabs, label, className = '' }: { tabs: TabsControls<Value>; label: string; className?: string }) {
  const buttons = useRef(new Map<Value, HTMLButtonElement>());
  const entry = tabs.items.find(item => item.value === tabs.value && !item.disabled)?.value ?? tabs.items.find(item => !item.disabled)?.value;
  const select = (value: Value) => { if (value !== tabs.value && tabs.items.some(item => item.value === value && !item.disabled)) tabs.onChange(value); };
  return <div role="tablist" aria-label={label} aria-orientation="horizontal" className={`accessible-tabs ${className}`}>
    {tabs.items.map(item => <button key={item.value} ref={element => { if (element) buttons.current.set(item.value, element); else buttons.current.delete(item.value); }}
      type="button" role="tab" id={tabs.tabId(item.value)} aria-selected={tabs.value === item.value} aria-controls={tabs.panelAttrs(item.value).id} aria-label={item.ariaLabel}
      tabIndex={entry === item.value ? 0 : -1} disabled={item.disabled} className={tabs.value === item.value ? 'active' : ''} data-accent={item.accent || undefined}
      onClick={() => select(item.value)} onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey) return;
        const action = tabKeyAction(event.key, item.value, tabs.items);
        if (!action) return;
        event.preventDefault();
        if (action.kind === 'focus') buttons.current.get(action.value)?.focus();
        else select(action.value);
      }}>{item.label}</button>)}
  </div>;
}
