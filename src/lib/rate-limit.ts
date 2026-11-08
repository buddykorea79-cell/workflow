import { isIP } from 'node:net';
import type { NextRequest } from 'next/server';
import { DomainError } from './domain-error';

export type RateWindow = { count: number; resetsAt: number };
/** Pure fixed-window decision; callers supply time so boundary tests never sleep. */
export function rateLimitDecision(previous: RateWindow | undefined, now: number, limit: number, windowMs = 60_000) {
  const current = previous && previous.resetsAt > now ? previous : { count: 0, resetsAt: now + windowMs };
  const allowed = current.count < limit;
  return { allowed, window: { ...current, count: current.count + (allowed ? 1 : 0) }, retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((current.resetsAt - now) / 1000)) };
}

export function createRateLimiter(maxEntries = 10_000) {
  const windows = new Map<string, RateWindow>();
  return (key: string, limit: number, now = Date.now()) => {
    for (const [id, window] of windows) if (window.resetsAt <= now) windows.delete(id);
    // Do not evict live buckets: rotating arbitrary keys must not reset another user's quota.
    if (!windows.has(key) && windows.size >= maxEntries) throw new DomainError(429, 'RATE_LIMITED', '잠시 후 다시 시도해 주세요.');
    const decision = rateLimitDecision(windows.get(key), now, limit);
    windows.set(key, decision.window);
    if (!decision.allowed) throw new DomainError(429, 'RATE_LIMITED', '잠시 후 다시 시도해 주세요.');
  };
}

const userRequests = createRateLimiter();
const accessAttempts = createRateLimiter();
export function assertUserRateLimit(userId: string) {
  const configured = Number(process.env.IEUM_API_RATE_LIMIT_PER_MINUTE || 10);
  const limit = Number.isSafeInteger(configured) && configured > 0 ? configured : 10;
  userRequests(userId, limit);
}
export function assertAccessAttemptLimit(request: NextRequest) {
  // Only trust the platform-controlled IP header on Vercel. Other hosts share a
  // conservative bucket until their trusted reverse proxy is explicitly integrated.
  const forwarded = process.env.VERCEL ? request.headers.get('x-vercel-forwarded-for')?.trim() : undefined;
  const key = forwarded && isIP(forwarded) ? forwarded : 'unverified-origin';
  accessAttempts(key, 5);
}
