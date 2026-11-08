import assert from 'node:assert/strict';
import test from 'node:test';
import { sendResponse } from 'next/dist/server/send-response';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { securityHeaderRoutes } from '../next.config';
import { securityHeaders, type SecurityHeaderEnvironment } from '../src/lib/security-headers';

function values(env: SecurityHeaderEnvironment = {}) {
  return Object.fromEntries(securityHeaders(env).map(header => [header.key, header.value]));
}

function directives(env: SecurityHeaderEnvironment = {}) {
  return Object.fromEntries(values(env)['Content-Security-Policy-Report-Only'].split('; ').map(directive => {
    const [name, ...sources] = directive.split(' ');
    return [name, sources];
  }));
}

async function serializeRouteHeaders(configured: Map<string, string>, status = 302) {
  const headers = new Map(configured);
  let ended = false;
  const response = {
    getHeader: (name: string) => headers.get(name.toLowerCase()),
    appendHeader: (name: string, value: string) => { headers.set(name.toLowerCase(), value); },
    originalResponse: { end: () => { ended = true; } },
  };
  await sendResponse(
    { method: 'HEAD' } as Parameters<typeof sendResponse>[0],
    response as unknown as Parameters<typeof sendResponse>[1],
    new Response(null, { status, headers: {
      'Referrer-Policy': 'no-referrer', 'Location': 'https://storage.example.test/file',
      'Cache-Control': 'no-store, private', 'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="fixture.txt"',
    } }),
  );
  assert.equal(ended, true);
  return headers;
}

test('installed Next keeps an existing configured header instead of replacing it with a route redirect header', async () => {
  const global = new Map(securityHeaders({ NODE_ENV: 'production' }).map(header => [header.key.toLowerCase(), header.value]));
  const response = await serializeRouteHeaders(global);
  assert.equal(response.get('referrer-policy'), 'strict-origin-when-cross-origin', 'the route no-referrer alone cannot override a configured default');
  assert.equal(response.get('cache-control'), 'no-store, private');
});

test('attachment paths keep no-referrer through Next serialization while other paths retain the global policy', async () => {
  const rules = securityHeaderRoutes({ NODE_ENV: 'production', AWS_ENDPOINT_URL_S3: 'https://storage.example.test' });
  const headersAt = (pathname: string) => {
    const headers = new Map<string, string>();
    for (const rule of rules) if (getPathMatch(rule.source)(pathname)) {
      for (const header of rule.headers) headers.set(header.key.toLowerCase(), header.value);
    }
    return headers;
  };
  for (const pathname of ['/api/attachments', '/api/attachments/file-1', '/api/attachments/file-1/']) {
    const configured = headersAt(pathname);
    assert.equal(configured.get('referrer-policy'), 'no-referrer', pathname);
    assert.equal(configured.get('x-content-type-options'), 'nosniff');
    assert.ok(configured.has('content-security-policy-report-only'));
    for (const status of [200, 302]) {
      const response = await serializeRouteHeaders(configured, status);
      assert.equal(response.get('referrer-policy'), 'no-referrer');
      assert.equal(response.get('cache-control'), 'no-store, private');
      assert.equal(response.get('content-type'), 'application/octet-stream');
      assert.equal(response.get('content-disposition'), 'attachment; filename="fixture.txt"');
    }
  }
  for (const pathname of ['/', '/api/workspace', '/api/organization-division/export', '/api/attachments-other/file-1']) {
    assert.equal(headersAt(pathname).get('referrer-policy'), 'strict-origin-when-cross-origin', pathname);
  }
});

test('the initial policy observes CSP without enabling enforcement and sets the required browser protections', () => {
  const headers = values({ NODE_ENV: 'production' }), csp = directives({ NODE_ENV: 'production' });
  assert.equal(headers['Content-Security-Policy'], undefined);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['Permissions-Policy'], 'camera=(), microphone=(), geolocation=(), payment=()');
  assert.deepEqual(csp['default-src'], ["'self'"]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['base-uri'], ["'self'"]);
  assert.deepEqual(csp['form-action'], ["'self'"]);
  assert.equal(csp['upgrade-insecure-requests'], undefined);
});

test('production preserves the static Next shell, React inline styles, local fonts, and blob resources without eval or websocket exceptions', () => {
  const csp = directives({ NODE_ENV: 'production' });
  assert.deepEqual(csp['script-src'], ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(csp['style-src'], ["'self'", "'unsafe-inline'"]);
  assert.deepEqual(csp['font-src'], ["'self'"]);
  assert.deepEqual(csp['worker-src'], ["'self'", 'blob:']);
  assert.deepEqual(csp['img-src'], ["'self'", 'data:', 'blob:']);
  assert.deepEqual(csp['connect-src'], ["'self'"]);
  assert.equal(values({ NODE_ENV: 'production' })['Strict-Transport-Security'], undefined, 'local next start remains HTTP-compatible');
});

test('only development enables React eval and HMR websocket connections', () => {
  const development = directives({ NODE_ENV: 'development', AWS_ENDPOINT_URL_S3: 'https://storage.example.test' });
  assert.deepEqual(development['script-src'], ["'self'", "'unsafe-inline'", "'unsafe-eval'"]);
  assert.deepEqual(development['connect-src'], ["'self'", 'https://storage.example.test', 'ws:', 'wss:']);
  for (const NODE_ENV of [undefined, '', 'test', 'production']) {
    const csp = directives({ NODE_ENV });
    assert.ok(!csp['script-src'].includes("'unsafe-eval'"));
    assert.deepEqual(csp['connect-src'], ["'self'"]);
  }
});

test('HSTS is limited to production Vercel and does not assume HTTPS for every subdomain or request preload registration', () => {
  assert.equal(values({ NODE_ENV: 'production', VERCEL: '1' })['Strict-Transport-Security'], 'max-age=31536000');
  for (const env of [
    { NODE_ENV: 'development', VERCEL: '1' },
    { NODE_ENV: 'test', VERCEL: '1' },
    { VERCEL: '1' },
    { NODE_ENV: 'production' },
    { NODE_ENV: 'production', VERCEL: '0' },
    { NODE_ENV: 'production', VERCEL: '' },
  ]) assert.equal(values(env)['Strict-Transport-Security'], undefined);
});

test('signed upload and diagnostic download connections allow only the normalized configured storage origin', () => {
  for (const [input, expected] of [
    ['https://storage.example.test', 'https://storage.example.test'],
    [' https://STORAGE.example.test/ ', 'https://storage.example.test'],
    ['https://storage.example.test:443/', 'https://storage.example.test'],
    ['https://storage.example.test:8443/', 'https://storage.example.test:8443'],
  ]) assert.deepEqual(directives({ AWS_ENDPOINT_URL_S3: input })['connect-src'], ["'self'", expected]);
});

test('invalid or injected storage settings cannot add CSP sources, directives, credentials, or URL parameters', () => {
  for (const input of [
    '', ' ', 'not a URL', '*', 'https:', '//storage.example.test', 'http://storage.example.test',
    'javascript:alert(1)', 'data:text/plain,test', 'https://user:secret@storage.example.test',
    'https://storage.example.test/bucket', 'https://storage.example.test/?token=secret',
    'https://storage.example.test/#fragment', "https://storage.example.test;script-src *",
    "https://storage.example.test/ 'unsafe-eval'", 'https://storage.example.test\r\nX-Injected: yes',
    '\nhttps://storage.example.test', 'https://storage.exa\tmple.test', 'https://storage.example.test\u007f',
  ]) assert.deepEqual(directives({ AWS_ENDPOINT_URL_S3: input })['connect-src'], ["'self'"], input);
});

test('server-only services never enter the browser policy and endpoint cache/download headers are left to their routes', () => {
  const env = {
    NODE_ENV: 'production', AWS_ENDPOINT_URL_S3: 'https://storage.example.test',
    DATABASE_URL: 'postgresql://private-database.invalid', NEON_AUTH_BASE_URL: 'https://private-auth.invalid',
    BIZROUTER_API_KEY: 'test-only-not-a-key', LAW_API_OC: 'test-only-not-a-key',
  };
  const before = { ...env }, first = securityHeaders(env), headers = values(env);
  assert.deepEqual(directives(env)['connect-src'], ["'self'", 'https://storage.example.test']);
  assert.ok(!JSON.stringify(first).includes('private-'));
  assert.ok(!JSON.stringify(first).includes('test-only-not-a-key'));
  assert.equal(headers['Cache-Control'], undefined);
  assert.equal(headers['Content-Type'], undefined);
  assert.equal(headers['Content-Disposition'], undefined);
  assert.equal(new Set(first.map(header => header.key.toLowerCase())).size, first.length);
  first[0].value = 'caller change';
  assert.equal(values(env)['X-Content-Type-Options'], 'nosniff');
  assert.deepEqual(env, before);
});
