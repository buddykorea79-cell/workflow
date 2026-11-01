import type { Frequency } from './types';

export function currentPeriod(frequency: Frequency, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-');
  const year = parts[0]; const month = Number(parts[1]);
  if (frequency === 'monthly') return `${year}년 ${month}월`;
  if (frequency === 'quarterly') return `${year}년 ${Math.ceil(month / 3)}분기`;
  if (frequency === 'half_yearly') return `${year}년 ${month <= 6 ? '상' : '하'}반기`;
  if (frequency === 'yearly') return `${year}년`;
  return parts.join('-');
}
export function normalizePeriod(frequency: Frequency, input?: string, now = new Date()): string | null {
  if (!input?.trim()) return currentPeriod(frequency, now);
  const value = input.trim(); const compact = value.replace(/\s+/g, '');
  if (frequency === 'once') return value;
  if (frequency === 'monthly') { const match = compact.match(/^(\d{4})(?:년|[-/])(\d{1,2})월?$/); if (!match || +match[2] < 1 || +match[2] > 12) return null; return `${match[1]}년 ${+match[2]}월`; }
  if (frequency === 'quarterly') { const match = compact.match(/^(\d{4})(?:년|[-/]?Q)([1-4])분기?$/i) || compact.match(/^(\d{4})[-/]?Q([1-4])$/i) || compact.match(/^(\d{4})년([1-4])분기$/); if (!match) return null; return `${match[1]}년 ${match[2]}분기`; }
  if (frequency === 'half_yearly') { const match = compact.match(/^(\d{4})년([상하])반기$/); if (match) return `${match[1]}년 ${match[2]}반기`; const numeric = compact.match(/^(\d{4})[-/]?H([12])$/i); return numeric ? `${numeric[1]}년 ${numeric[2] === '1' ? '상' : '하'}반기` : null; }
  const match = compact.match(/^(\d{4})년?$/); return match ? `${match[1]}년` : null;
}
/** Calendar recurrence: preserve template month-position/day and clamp invalid
 * month days to that month's final day. Holiday movement is deliberately absent. */
export function dueDateForPeriod(frequency: Frequency, canonicalPeriod: string, templateDueDate: string): string {
  if (frequency === 'once') return templateDueDate;
  const [templateYear, templateMonth, templateDay] = templateDueDate.split('-').map(Number);
  const year = Number(canonicalPeriod.slice(0, 4)) || templateYear;
  let month = templateMonth;
  if (frequency === 'monthly') month = Number(canonicalPeriod.match(/년 (\d+)월/)?.[1] ?? templateMonth);
  if (frequency === 'quarterly') month = (Number(canonicalPeriod.match(/년 ([1-4])분기/)?.[1] ?? 1) - 1) * 3 + ((templateMonth - 1) % 3) + 1;
  if (frequency === 'half_yearly') month = (canonicalPeriod.includes('하반기') ? 6 : 0) + ((templateMonth - 1) % 6) + 1;
  const day = Math.min(templateDay, new Date(Date.UTC(year, month, 0)).getUTCDate());
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
