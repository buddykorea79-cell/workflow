export type NavigableTab<Value extends string = string> = { value: Value; disabled?: boolean };
export type TabKeyAction<Value extends string = string> = { kind: 'focus' | 'select'; value: Value };

/** Manual activation: navigation moves focus; Enter/Space alone request selection. */
export function tabKeyAction<Value extends string>(key: string, currentValue: Value, items: readonly NavigableTab<Value>[]): TabKeyAction<Value> | undefined {
  const available = items.filter(item => !item.disabled);
  if (!available.length) return;
  const current = available.findIndex(item => item.value === currentValue);
  if (key === 'Enter' || key === ' ') return current >= 0 ? { kind: 'select', value: currentValue } : undefined;
  let index: number;
  if (key === 'Home') index = 0;
  else if (key === 'End') index = available.length - 1;
  else if (key === 'ArrowRight') index = current < 0 ? 0 : (current + 1) % available.length;
  else if (key === 'ArrowLeft') index = current < 0 ? available.length - 1 : (current - 1 + available.length) % available.length;
  else return;
  return { kind: 'focus', value: available[index].value };
}

export function tabDomIds(baseId: string, value: string) {
  const suffix = encodeURIComponent(value);
  return { tab: `${baseId}-tab-${suffix}`, panel: `${baseId}-panel-${suffix}` };
}
