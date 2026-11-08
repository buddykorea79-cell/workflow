import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { measureClientBundle } from '../scripts/measure-client-bundle.mjs';

test('bundle measurement counts actual initial scripts once, separates polyfills/async files and scans all client chunks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ieum-bundle-measure-'));
  const write = (relative: string, content: string) => { const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
  try {
    write('BUILD_ID', 'synthetic-build');
    write('build-manifest.json', JSON.stringify({ rootMainFiles: ['static/chunks/runtime.js'] }));
    write('server/app/index.html', '<link rel="preload" href="/_next/static/chunks/async.js" as="script"><script src="/_next/static/chunks/runtime.js"></script><script src="/_next/static/chunks/app/page-fixture.js?v=1"></script><script src="/_next/static/chunks/shared.js"></script><script src="/_next/static/chunks/shared.js"></script><script src="/_next/static/chunks/polyfill.js" noModule=""></script><script src="https://elsewhere.invalid/script.js"></script>');
    const files = { 'runtime.js': 'runtime()', 'app/page-fixture.js': 'page()', 'shared.js': 'shared()', 'polyfill.js': 'legacy()', 'async.js': 'pdfkit marker only' };
    for (const [name, code] of Object.entries(files)) write(`static/chunks/${name}`, code);
    const report = measureClientBundle(root);
    assert.equal(report.buildId, 'synthetic-build'); assert.equal(report.initial.files, 3);
    assert.equal(report.initial.bytes, 'runtime()page()shared()'.length);
    assert.equal(report.initial.gzipBytes, ['runtime()', 'page()', 'shared()'].reduce((sum, value) => sum + gzipSync(value, { level: 9 }).length, 0));
    assert.equal(report.page.bytes, 'page()'.length); assert.equal(report.initialShared.files, 1);
    assert.equal(report.legacyPolyfill.files, 1); assert.equal(report.nonInitial.files, 1);
    assert.deepEqual(report.packageMarkerScan.matches, [{ package: 'pdfkit', file: 'static/chunks/async.js', markers: ['pdfkit'] }]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
