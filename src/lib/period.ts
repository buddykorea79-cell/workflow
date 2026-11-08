import { koreaDate } from './seed-helpers';

const validHalf = (period: string) => /^20\d{2}-H[12]$/.test(period);

export function currentHalf(now = new Date()): string {
  const day = koreaDate(now);
  return `${day.slice(0, 4)}-H${day.slice(5, 7) <= '06' ? '1' : '2'}`;
}

/** Invalid values are left to input validation, never treated as a valid future half. */
export function isFutureHalf(period: string, now = new Date()): boolean {
  return validHalf(period) && period > currentHalf(now);
}

/** Recent elapsed halves plus all valid stored periods, including read-only future records. */
export function halfYearOptions(now = new Date(), existingPeriods: readonly (string | undefined | null)[] = []): string[] {
  const current = currentHalf(now), year = Number(current.slice(0, 4));
  const periods = new Set(existingPeriods.filter((period): period is string => typeof period === 'string' && validHalf(period)));
  for (let candidateYear = Math.max(2000, year - 2); candidateYear <= year; candidateYear++) {
    for (const half of ['H1', 'H2']) {
      const period = `${candidateYear}-${half}`;
      if (period <= current) periods.add(period);
    }
  }
  return [...periods].sort().reverse();
}
