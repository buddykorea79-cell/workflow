import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const serverPackageMarkers = {
  pdfkit: ['pdfkit', 'PDFDocument'],
  exceljs: ['exceljs', 'WorksheetReader'],
  kordoc: ['kordoc'],
  'pdfjs-dist': ['pdfjs-dist', 'pdfjsVersion', 'PDFWorker'],
  '@aws-sdk': ['@aws-sdk', 'AWS SDK for JavaScript', 'SmithyException'],
};

function filesBelow(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory() ? filesBelow(path.join(directory, item.name)) : [path.join(directory, item.name)]);
}

/** Read production artifacts only: never starts Next, loads .env, or connects to an API. */
export function measureClientBundle(buildDirectory) {
  const root = path.resolve(buildDirectory);
  const buildId = fs.readFileSync(path.join(root, 'BUILD_ID'), 'utf8').trim();
  const html = fs.readFileSync(path.join(root, 'server/app/index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'build-manifest.json'), 'utf8'));
  const initial = new Set(); const legacy = new Set();
  for (const match of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)) {
    const url = new URL(match[1].replaceAll('&amp;', '&'), 'https://build.invalid');
    if (url.origin !== 'https://build.invalid' || !url.pathname.startsWith('/_next/')) continue;
    const relative = decodeURIComponent(url.pathname.slice('/_next/'.length));
    if (!relative.endsWith('.js') || relative.includes('..') || path.isAbsolute(relative)) throw new Error('Unexpected client script path');
    (/\bnomodule(?:\s|=|>)/i.test(match[0]) ? legacy : initial).add(relative);
  }
  const entryFiles = fs.readdirSync(path.join(root, 'static/chunks/app')).filter(file => /^page-[^/]+\.js$/.test(file)).map(file => `static/chunks/app/${file}`);
  const runtime = new Set(manifest.rootMainFiles || []);
  const chunkFiles = filesBelow(path.join(root, 'static/chunks')).filter(file => file.endsWith('.js'));
  const packageMarkers = [];
  const rows = chunkFiles.map(absolute => {
    const file = path.relative(root, absolute).split(path.sep).join('/');
    const bytes = fs.readFileSync(absolute); const code = bytes.toString('utf8');
    for (const [name, markers] of Object.entries(serverPackageMarkers)) {
      const found = markers.filter(marker => code.includes(marker));
      if (found.length) packageMarkers.push({ package: name, file, markers: found });
    }
    return { file, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length,
      group: initial.has(file) ? entryFiles.includes(file) ? 'page' : runtime.has(file) ? 'runtime' : 'initial-shared' : legacy.has(file) ? 'legacy-polyfill' : 'non-initial',
    };
  }).sort((a, b) => b.bytes - a.bytes || a.file.localeCompare(b.file));
  for (const file of [...initial, ...legacy]) if (!rows.some(row => row.file === file)) throw new Error(`Initial script missing from chunks: ${file}`);
  const totals = predicate => rows.filter(predicate).reduce((total, row) => ({ files: total.files + 1, bytes: total.bytes + row.bytes, gzipBytes: total.gzipBytes + row.gzipBytes }), { files: 0, bytes: 0, gzipBytes: 0 });
  return {
    generatedAt: new Date().toISOString(), buildId, buildDirectory: root, gzipLevel: 9,
    measurement: 'Modern initial scripts come from prerendered index.html. Non-initial files include other routes and async chunks; they are not all required by this page. Gzip sizes sum per-file compression, excluding HTTP headers.',
    page: totals(row => entryFiles.includes(row.file)),
    initial: totals(row => initial.has(row.file)),
    initialShared: totals(row => row.group === 'initial-shared'),
    runtime: totals(row => row.group === 'runtime'),
    legacyPolyfill: totals(row => row.group === 'legacy-polyfill'),
    nonInitial: totals(row => row.group === 'non-initial'),
    packageMarkerScan: { matches: packageMarkers, limitation: 'A string scan is an indicator, not proof of package absence after minification. Review source import reachability alongside these artifacts.' },
    files: rows,
  };
}

function main(args) {
  let buildDirectory = '.next'; let output;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--build-dir' && args[i + 1]) buildDirectory = args[++i];
    else if (args[i] === '--out' && args[i + 1]) output = args[++i];
    else throw new Error('Usage: node scripts/measure-client-bundle.mjs [--build-dir .next] [--out report.json]');
  }
  const report = measureClientBundle(buildDirectory);
  const json = JSON.stringify(report, null, 2) + '\n';
  if (output) { fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true }); fs.writeFileSync(output, json); }
  console.log(JSON.stringify({ buildId: report.buildId, page: report.page, initial: report.initial, initialShared: report.initialShared, runtime: report.runtime, packageMarkerMatches: report.packageMarkerScan.matches.length, ...(output ? { output: path.resolve(output) } : {}) }, null, 2));
  if (!output) console.log(json);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
