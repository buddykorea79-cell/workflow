export const DEFAULT_UNIT_IMPORTANCE = 5;

export function unitImportance(unit: { importance?: number }): number {
  return Number.isInteger(unit.importance) && unit.importance! >= 1 && unit.importance! <= 10 ? unit.importance! : DEFAULT_UNIT_IMPORTANCE;
}

/** A new array; equal importance retains the caller's existing order. */
export function sortUnitsByImportance<T extends { importance?: number }>(units: readonly T[]): T[] {
  return units.map((unit, index) => ({ unit, index })).sort((a, b) => unitImportance(b.unit) - unitImportance(a.unit) || a.index - b.index).map(item => item.unit);
}

/** Normalize only live units in a freshly read/in-memory state, never historical snapshots. */
export function normalizeUnitImportance<T extends { units: { importance?: number }[] }>(state: T): T {
  for (const unit of state.units) unit.importance = unitImportance(unit);
  return state;
}
