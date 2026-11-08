type DateValue = string | Date | null | undefined;
type DateOptions = { today?: string | Date };

const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormatter = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit' });

function validDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function instantDay(instant: Date): string | undefined {
  if (!Number.isFinite(instant.getTime())) return undefined;
  const parts = dayFormatter.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  const day = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
  return validDay(day) ? day : undefined;
}

/** Calendar dates keep their written day; instants are shown in the Korean calendar. */
function parseDate(value: DateValue): { day: string; instant?: Date } | undefined {
  if (value instanceof Date) {
    const day = instantDay(value);
    return day ? { day, instant: value } : undefined;
  }
  const text = value?.trim();
  if (!text) return undefined;
  if (validDay(text)) return { day: text };
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i.exec(text);
  if (!match || !validDay(match[1]) || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4] ?? 0) > 59) return undefined;
  const zone = match[5];
  if (zone && zone.toUpperCase() !== 'Z') {
    const offset = zone.slice(1).replace(':', '');
    if (Number(offset.slice(0, 2)) > 23 || Number(offset.slice(2)) > 59) return undefined;
  }
  // An offset-free datetime denotes Korean local time, independently of browser/server settings.
  const instant = new Date(zone ? text : `${text}+09:00`);
  const day = instantDay(instant);
  return day ? { day, instant } : undefined;
}

function displayDay(day: string, full: boolean): string {
  const [year, month, date] = day.split('-');
  return `${full ? `${year}. ` : ''}${Number(month)}. ${Number(date)}.`;
}

export function formatDate(value?: DateValue, { today = new Date() }: DateOptions = {}): string {
  const parsed = parseDate(value);
  if (!parsed) return '미지정';
  return displayDay(parsed.day, parsed.day.slice(0, 4) !== parseDate(today)?.day.slice(0, 4));
}

export function formatDateFull(value?: DateValue): string {
  const parsed = parseDate(value);
  return parsed ? displayDay(parsed.day, true) : '미지정';
}

/** Record timestamps retain their Korean local time; date-only records do not invent a time. */
export function formatDateTimeFull(value?: DateValue): string {
  const parsed = parseDate(value);
  if (!parsed) return '미지정';
  return `${displayDay(parsed.day, true)}${parsed.instant ? ` ${timeFormatter.format(parsed.instant)}` : ''}`;
}

export function isPastDate(value?: DateValue, now: Date | string = new Date()): boolean {
  const day = parseDate(value)?.day, today = parseDate(now)?.day;
  return !!day && !!today && day < today;
}
