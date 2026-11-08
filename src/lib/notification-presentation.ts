import { formatDateTimeFull } from './date-format';

type NotificationTime = string | null | undefined;

/** Creation times require an ISO instant. Missing legacy times must not acquire an invented age. */
function timestamp(value: NotificationTime): number | undefined {
  const text = value?.trim();
  if (!text || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i.test(text) || formatDateTimeFull(text) === '미지정') return undefined;
  const instant = Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text) ? text : `${text}+09:00`);
  return Number.isFinite(instant) ? instant : undefined;
}

export function sortNotifications<T extends { read: boolean; createdAt?: string }>(items: readonly T[]): T[] {
  return items.map((item, index) => ({ item, index, time: timestamp(item.createdAt) }))
    .sort((a, b) => Number(a.item.read) - Number(b.item.read)
      || (a.time === undefined ? b.time === undefined ? 0 : 1 : b.time === undefined ? -1 : b.time - a.time)
      || a.index - b.index)
    .map(({ item }) => item);
}

export function notificationRelativeTime(createdAt: NotificationTime, now: Date | string = new Date()): string {
  const created = timestamp(createdAt);
  const current = now instanceof Date ? now.getTime() : timestamp(now);
  if (created === undefined || current === undefined || !Number.isFinite(current)) return '이전 알림';
  // A server/client clock difference must never show a negative elapsed time.
  const elapsed = Math.max(0, current - created);
  if (elapsed < 60_000) return '방금 전';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}분 전`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}시간 전`;
  return `${Math.floor(elapsed / 86_400_000)}일 전`;
}

export function notificationTimeTitle(createdAt: NotificationTime): string | undefined {
  return timestamp(createdAt) === undefined ? undefined : formatDateTimeFull(createdAt);
}
