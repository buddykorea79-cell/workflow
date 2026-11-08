export interface SecurityHeaderEnvironment {
  NODE_ENV?: string;
  VERCEL?: string;
  AWS_ENDPOINT_URL_S3?: string;
}

export interface SecurityHeader { key: string; value: string }

function storageOrigin(value?: string): string | undefined {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) return undefined;
    return url.origin;
  } catch { return undefined; }
}

/** Build only from explicitly supplied settings; tests never need live environment values. */
export function securityHeaders(env: SecurityHeaderEnvironment): SecurityHeader[] {
  const development = env.NODE_ENV === 'development';
  const storage = storageOrigin(env.AWS_ENDPOINT_URL_S3);
  const connectSources = ["'self'", ...(storage ? [storage] : []), ...(development ? ['ws:', 'wss:'] : [])];
  // The static Next shell and ReactFlow still need inline scripts/styles. Observe before enforcing.
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src ${connectSources.join(' ')}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const headers: SecurityHeader[] = [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    { key: 'Content-Security-Policy-Report-Only', value: policy },
  ];
  // Local `next start` is production too. Only the HTTPS Vercel deployment gets HSTS.
  if (env.NODE_ENV === 'production' && env.VERCEL === '1') headers.push({ key: 'Strict-Transport-Security', value: 'max-age=31536000' });
  return headers;
}
