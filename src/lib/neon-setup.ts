import type { CORSRule } from '@aws-sdk/client-s3';

export const prototypeCorsRuleId = 'ieum-prototype-upload';

export function prototypeOrigins(extra: string[], appOrigin?: string): string[] {
  const candidates = ['http://127.0.0.1:3000', 'http://localhost:3000', ...(appOrigin?.trim() ? [appOrigin.trim()] : []), ...extra];
  return [...new Set(candidates.map(value => {
    let url: URL;
    try { url = new URL(value); } catch { throw new Error('INVALID_ORIGIN'); }
    if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname) || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))) throw new Error('INVALID_ORIGIN');
    return url.origin;
  }))];
}

export function mergePrototypeCors(existing: CORSRule[], origins: string[]): CORSRule[] {
  const previous = existing.find(rule => rule.ID === prototypeCorsRuleId);
  const preservedOrigins = (previous?.AllowedOrigins || []).filter(value => value !== '*');
  const rule: CORSRule = {
    ID: prototypeCorsRuleId,
    AllowedOrigins: [...new Set([...preservedOrigins, ...origins])],
    AllowedMethods: ['PUT', 'GET', 'HEAD'],
    AllowedHeaders: ['*'],
    ExposeHeaders: ['ETag'],
    MaxAgeSeconds: 3600,
  };
  return [...existing.filter(item => item.ID !== prototypeCorsRuleId), rule];
}

export function isStorageMissing(error: unknown): boolean {
  const item = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return item?.$metadata?.httpStatusCode === 404 || ['NotFound', 'NoSuchBucket', 'NoSuchCORSConfiguration'].includes(item?.name || '');
}
