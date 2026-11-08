export type DatePart = 'year' | 'month' | 'day';
export interface DateParts { year: string; month: string; day: string }
export const datePartLength: Record<DatePart, number> = { year: 4, month: 2, day: 2 };

export function splitDateInput(value: string): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? { year: match[1], month: match[2], day: match[3] } : { year: '', month: '', day: '' };
}

export function dateInputValue(parts: DateParts): string {
  if (!/^\d{4}$/.test(parts.year) || !/^\d{1,2}$/.test(parts.month) || !/^\d{1,2}$/.test(parts.day) || Number(parts.year) < 1) return '';
  const value = `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value ? value : '';
}

export function dateInputError(parts: DateParts, { required = false, min, max }: { required?: boolean; min?: string; max?: string } = {}): string {
  if (!parts.year && !parts.month && !parts.day) return required ? '날짜를 입력해 주세요.' : '';
  if (parts.year.length !== 4 || !parts.month || !parts.day) return '연도 4자리와 월, 일을 모두 입력해 주세요.';
  const value = dateInputValue(parts);
  if (!value) return '실제 존재하는 날짜를 입력해 주세요.';
  if (min && value < min) return `${min} 이후의 날짜를 입력해 주세요.`;
  if (max && value > max) return `${max} 이전의 날짜를 입력해 주세요.`;
  return '';
}

/** Paste a whole ISO or compact date without allowing six-digit years. */
export function pastedDateInput(value: string): DateParts | undefined {
  const match = /^(\d{4})[-./]?(\d{2})[-./]?(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const parts = { year: match[1], month: match[2], day: match[3] };
  return dateInputValue(parts) ? parts : undefined;
}

export function changedDatePart(part: DatePart, value: string) {
  let text = value.replace(/\D/g, '').slice(0, datePartLength[part]);
  const unambiguous = text.length === 1 && (part === 'month' ? Number(text) > 1 : part === 'day' ? Number(text) > 3 : false);
  if (unambiguous) text = text.padStart(2, '0');
  return { text, advance: text.length === datePartLength[part] };
}
