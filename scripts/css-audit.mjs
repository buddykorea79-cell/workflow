import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const postcss = require('postcss');
const valueParser = require('next/dist/compiled/postcss-value-parser');
const ts = require('typescript');
const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputFile = path.join(projectDirectory, 'docs/design/css-audit.md');
const mapKeys = ['hex', 'fontSize', 'fontPx', 'radius', 'radiusPx', 'shadow', 'zIndex', 'lineHeight', 'px', 'variables', 'colorFunctions'];
const filePattern = /\.(?:css|tsx?|jsx?)$/i;
const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx'];
const entryPattern = /(?:^|\/)(?:page|layout|template|loading|error|global-error|not-found|global-not-found|default)\.(?:tsx?|jsx?)$/;
const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const relative = (base, file) => path.relative(base, file).replaceAll('\\', '/');
const sum = frequencies => Object.values(frequencies).reduce((total, count) => total + count, 0);
const count = (frequencies, value) => { frequencies[value] = (frequencies[value] ?? 0) + 1; };
const canonicalHex = value => {
  const hex = value.toLowerCase();
  return hex.length === 4 || hex.length === 5 ? `#${hex.slice(1).split('').map(character => character + character).join('')}` : hex;
};
const isHex = value => /^#(?:[a-f\d]{3}|[a-f\d]{4}|[a-f\d]{6}|[a-f\d]{8})$/i.test(value);

function emptyMetrics() {
  return { files: 0, bytes: 0, rules: 0, declarations: 0, important: 0, ...Object.fromEntries(mapKeys.map(key => [key, Object.create(null)])) };
}

function withoutComments(nodes) {
  return nodes.filter(node => node.type !== 'comment').map(node => node.nodes ? { ...node, nodes: withoutComments(node.nodes) } : node);
}

function declarationValue(nodes) {
  // Preserve case-sensitive custom property names; do not normalize --Foo into --foo.
  return valueParser.stringify(withoutComments(nodes)).trim().replace(/\s+/g, ' ');
}

export function analyzeCss(source, file = 'fixture.css') {
  const root = postcss.parse(source, { from: file }), metrics = emptyMetrics();
  metrics.files = 1; metrics.bytes = Buffer.byteLength(source);
  root.walkRules(() => { metrics.rules++; });
  root.walkDecls(declaration => {
    metrics.declarations++;
    if (declaration.important) metrics.important++;
    const property = declaration.prop.toLowerCase(), parsed = valueParser(declaration.value);
    const value = declarationValue(parsed.nodes);
    const radius = /^border(?:-(?:top|bottom)-(?:left|right)|-(?:start|end)-(?:start|end))?-radius$/.test(property);
    if (property === 'font-size') count(metrics.fontSize, value);
    if (property === 'line-height') count(metrics.lineHeight, value);
    if (radius) count(metrics.radius, value);
    if (property === 'box-shadow' || property === 'text-shadow') count(metrics.shadow, value);
    if (property === 'z-index') count(metrics.zIndex, value);
    parsed.walk(node => {
      if (node.type === 'function') {
        const name = node.value.toLowerCase();
        if (name === 'url') return false;
        if (name === 'var') {
          const variable = node.nodes.find(child => child.type === 'word');
          if (variable) count(metrics.variables, variable.value);
        }
        if (['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'color-mix'].includes(name)) count(metrics.colorFunctions, declarationValue([node]));
      }
      if (node.type !== 'word') return;
      if (isHex(node.value)) count(metrics.hex, canonicalHex(node.value));
      const unit = valueParser.unit(node.value);
      if (unit && unit.unit.toLowerCase() === 'px' && Number.isFinite(Number(unit.number))) {
        const pixels = `${Number(unit.number)}px`;
        count(metrics.px, pixels);
        if (property === 'font-size') count(metrics.fontPx, pixels);
        if (radius) count(metrics.radiusPx, pixels);
      }
    });
  });
  return metrics;
}

function sourceReferences(source, file) {
  const references = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      const onlyTypes = clause?.isTypeOnly || !clause?.name && bindings && ts.isNamedImports(bindings) && bindings.elements.length > 0 && bindings.elements.every(element => element.isTypeOnly);
      if (!onlyTypes) references.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.exportClause;
      const onlyTypes = node.isTypeOnly || clause && ts.isNamedExports(clause) && clause.elements.length > 0 && clause.elements.every(element => element.isTypeOnly);
      if (!onlyTypes) references.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword || ts.isIdentifier(node.expression) && node.expression.text === 'require')) {
      references.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return references;
}

function cssReferences(source, file) {
  const references = [];
  postcss.parse(source, { from: file }).walkAtRules('import', rule => {
    const first = valueParser(rule.params).nodes.find(node => node.type !== 'space' && node.type !== 'comment');
    if (first?.type === 'string') references.push(first.value);
    if (first?.type === 'function' && first.value.toLowerCase() === 'url') {
      const value = first.nodes.find(node => node.type === 'string' || node.type === 'word');
      if (value) references.push(value.value);
    }
  });
  return references;
}

function resolveReference(base, file, specifier, files) {
  const css = file.endsWith('.css');
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/|\/)/i.test(specifier)) return undefined;
  if (!specifier.startsWith('.') && !specifier.startsWith('@/') && !css) return undefined;
  const stem = specifier.startsWith('@/') ? path.join(base, 'src', specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
  const candidates = css ? [stem, `${stem}.css`] : [stem, ...sourceExtensions.map(extension => stem + extension), ...sourceExtensions.map(extension => path.join(stem, `index${extension}`))];
  return candidates.find(candidate => files.has(candidate));
}

export function referenceGraph(base, files) {
  const edges = new Map(), externalCss = new Map(), unresolved = new Map();
  for (const [file, source] of files) {
    const references = file.endsWith('.css') ? cssReferences(source, file) : sourceReferences(source, file);
    const targets = [];
    for (const reference of references) {
      const target = resolveReference(base, file, reference, files);
      if (target) targets.push(target);
      else if (reference.endsWith('.css')) {
        const key = `${relative(base, file)} → ${reference}`;
        if (!reference.startsWith('.') && !reference.startsWith('@/')) externalCss.set(key, file);
        else unresolved.set(key, file);
      }
    }
    edges.set(file, targets);
  }
  const entries = [...files.keys()].filter(file => relative(base, file).startsWith('src/app/') && entryPattern.test(relative(base, file))).sort(compare);
  const reachable = new Set();
  function follow(file) {
    if (reachable.has(file)) return;
    reachable.add(file);
    for (const target of edges.get(file) ?? []) follow(target);
  }
  entries.forEach(follow);
  return {
    entries, reachable,
    externalCss: [...externalCss].filter(([, file]) => reachable.has(file)).map(([reference]) => reference).sort(compare),
    unresolved: [...unresolved].filter(([, file]) => reachable.has(file)).map(([reference]) => reference).sort(compare),
  };
}

async function sourceFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    // Do not follow symbolic links out of the source tree.
    if (entry.isDirectory()) paths.push(...await sourceFiles(file));
    else if (entry.isFile() && filePattern.test(entry.name)) paths.push(file);
  }
  return paths.sort(compare);
}

function mergeMetrics(target, source) {
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'number') target[key] += value;
    else for (const [name, count] of Object.entries(value)) target[key][name] = (target[key][name] ?? 0) + count;
  }
}

export async function auditProject(base) {
  const files = new Map(await Promise.all((await sourceFiles(path.join(base, 'src'))).map(async file => [file, await readFile(file, 'utf8')])));
  const graph = referenceGraph(base, files), total = emptyMetrics(), referenced = emptyMetrics(), rows = [];
  const cssHash = createHash('sha256'), sourceHash = createHash('sha256');
  for (const [file, source] of files) {
    sourceHash.update(`${relative(base, file)}\n`).update(source);
    if (!file.endsWith('.css')) continue;
    cssHash.update(`${relative(base, file)}\n`).update(source);
    const metrics = analyzeCss(source, file), included = graph.reachable.has(file);
    mergeMetrics(total, metrics);
    if (included) mergeMetrics(referenced, metrics);
    rows.push({ file: relative(base, file), referenced: included, metrics });
  }
  return {
    parser: { postcss: require('postcss/package.json').version, typescript: ts.version, valueParser: 'next/dist/compiled/postcss-value-parser' },
    cssSha256: cssHash.digest('hex'), sourceSha256: sourceHash.digest('hex'),
    entries: graph.entries.map(file => relative(base, file)), externalCss: graph.externalCss, unresolved: graph.unresolved,
    total, referenced, rows,
  };
}

const number = value => value.toLocaleString('en-US');
const inline = value => `\`${String(value).replaceAll('`', '&#96;').replaceAll('|', '&#124;').replaceAll('\n', ' ')}\``;
function topValues(frequencies, limit = 8) {
  return Object.entries(frequencies).sort((left, right) => right[1] - left[1] || compare(left[0], right[0])).slice(0, limit).map(([value, count]) => `${inline(value)} × ${number(count)}`).join(' · ') || '없음';
}
const metricRows = [
  ['hex 색', 'hex'], ['font-size 전체 값', 'fontSize'], ['font-size 내부 px', 'fontPx'],
  ['radius 전체 값', 'radius'], ['radius 내부 px', 'radiusPx'], ['box/text-shadow', 'shadow'], ['z-index', 'zIndex'],
];

export function markdownReport(audit) {
  const lines = [
    '# D1 1단계 CSS 감사 기준선', '',
    '이 파일은 `node scripts/css-audit.mjs`로 생성한다. 제품 CSS·토큰·패키지를 변경하지 않는 감사 도구이며 D1 2~5단계 또는 C1 완료를 의미하지 않는다. 독립 커밋은 아직 생성하지 않았다.', '',
    '## 재현 방법', '',
    '```text', 'node scripts/css-audit.mjs', 'node scripts/css-audit.mjs --check', 'node scripts/css-audit.mjs --self-test', '```', '',
    '`--check`는 현재 소스로 다시 계산한 보고서와 이 파일이 같은지 확인하며 파일을 쓰지 않는다. `--self-test`는 주석·문자열·URL 오인과 import 도달 판정의 고정 사례를 검사하며 파일을 쓰지 않는다. `--json`은 같은 감사 데이터의 전체 빈도표를 표준 출력으로 제공한다. 추가 패키지 설치나 환경 파일 읽기, 네트워크 접속은 필요하지 않다.', '',
    `- CSS 원본 SHA-256: ${inline(audit.cssSha256)}`,
    `- 참조 분석에 사용한 src CSS·TS/TSX·JS/JSX 원본 SHA-256: ${inline(audit.sourceSha256)}`,
    `- 파서: PostCSS ${audit.parser.postcss}, TypeScript ${audit.parser.typescript}, ${inline(audit.parser.valueParser)}`,
    '- 생성 시각을 출력에 넣지 않아 같은 원본·도구에서는 반복 실행 결과가 같다. 값 빈도가 같으면 문자 코드 순으로 정렬한다.', '',
    '## 측정 범위와 한계', '',
    '- 전체는 `src/**/*.css`다. 참조됨은 Next 앱의 page/layout 및 UI 진입점에서 정적 import/export, 문자열 dynamic import/require와 CSS @import를 따라 도달한 파일이다. 타입 전용 import는 제외한다. 이 구분은 브라우저에서 모든 규칙이 적용된다는 뜻이 아니다.',
    '- CSS AST 선언값만 센다. 주석, 선택자, 문자열 안의 색/px, url() 내부 값, @media 조건의 크기는 토큰 집계에서 제외한다. custom property 선언값과 var() fallback은 포함한다. 짧은 hex는 6/8자리로 확장하고 대소문자를 통일한다.',
    '- font-size·radius는 전체 선언값과 내부 px 토큰을 구분한다. 예를 들어 clamp(12px,2vw,20px)는 선언 1건과 px 토큰 2건이다. shadow는 box-shadow와 text-shadow를 합산하고 none도 선언값으로 센다. custom property 이름의 대소문자는 보존한다.',
    '- 전체 값 종류는 주석과 연속 공백을 정리한 선언값 기준이다. CSS 의미론상 같은 모든 표기를 통합하지 않으며 shorthand를 개별 속성으로 풀거나 var()를 실제 값으로 계산하지 않는다. font shorthand의 글자 크기는 font-size 표에 들어가지 않는다.',
    '- 의존 패키지 CSS, public 파일, JSX/SVG 인라인 스타일, CSS-in-JS, 원격 @import, 런타임에 조합되는 import는 제외한다. 정적 도달 분석은 조건부 코드의 실행 여부나 cascade·computed style·폰트 렌더링을 판정하지 않는다. 사용하지 않는 규칙이나 안전한 삭제 대상을 확정하는 도구가 아니다.',
    '- 이 수치는 현재 작업 트리의 기준선이다. 원문 e85ce6d 및 이전 design-token-baseline.md와 커밋·파서 조건이 달라질 수 있으므로 차이를 이 작업의 시각 개선량으로 해석하지 않는다. 토큰 치환·대비 평가·전후 화면 비교는 이번 단계에서 하지 않았다.', '',
    '## 전체와 코드에서 참조된 CSS', '',
    '| 지표 | 전체 CSS | 참조됨 |', '|---|---:|---:|',
  ];
  for (const [label, key] of [['파일', 'files'], ['UTF-8 바이트', 'bytes'], ['규칙', 'rules'], ['선언', 'declarations'], ['!important 선언', 'important']]) lines.push(`| ${label} | ${number(audit.total[key])} | ${number(audit.referenced[key])} |`);
  for (const [label, key] of [...metricRows, ['line-height', 'lineHeight'], ['선언값 내부 전체 px', 'px'], ['var() 참조', 'variables'], ['색 함수', 'colorFunctions']]) {
    lines.push(`| ${label} 발생 / 종류 | ${number(sum(audit.total[key]))} / ${number(Object.keys(audit.total[key]).length)} | ${number(sum(audit.referenced[key]))} / ${number(Object.keys(audit.referenced[key]).length)} |`);
  }
  lines.push('', '### 상위 값 · 각 8개', '', '| 지표 | 전체 CSS | 참조됨 |', '|---|---|---|');
  for (const [label, key] of metricRows) lines.push(`| ${label} | ${topValues(audit.total[key])} | ${topValues(audit.referenced[key])} |`);
  lines.push('', '## 참조 경로', '', `앱 UI 진입점: ${audit.entries.map(inline).join(', ') || '없음'}`, '', '코드에서 도달하지 않은 CSS:', '');
  const unreferenced = audit.rows.filter(row => !row.referenced);
  lines.push(...(unreferenced.length ? unreferenced.map(row => `- ${inline(row.file)}`) : ['- 없음']));
  lines.push('', '도달 코드가 참조하지만 src 집계 밖인 CSS:', '', ...(audit.externalCss.length ? audit.externalCss.map(reference => `- ${inline(reference)}`) : ['- 없음']));
  lines.push('', '도달 코드의 해결하지 못한 로컬 CSS 참조:', '', ...(audit.unresolved.length ? audit.unresolved.map(reference => `- ${inline(reference)}`) : ['- 없음']));
  lines.push('', '## 파일별 빈도', '', '| 파일 | 참조됨 | 바이트 | hex 발생/종류 | font-size 발생/종류 | radius 발생/종류 | shadow 발생/종류 | z-index 발생/종류 |', '|---|---|---:|---:|---:|---:|---:|---:|');
  for (const row of audit.rows) {
    const counts = ['hex', 'fontSize', 'radius', 'shadow', 'zIndex'].map(key => `${number(sum(row.metrics[key]))} / ${number(Object.keys(row.metrics[key]).length)}`);
    lines.push(`| [${row.file}](../../${row.file}) | ${row.referenced ? '예' : '아니요'} | ${number(row.metrics.bytes)} | ${counts.join(' | ')} |`);
  }
  lines.push('', '## 파일별 상위 값 · 각 8개', '');
  for (const row of audit.rows) {
    lines.push(`### ${row.file}`, '', `참조됨: ${row.referenced ? '예' : '아니요'} · 규칙 ${number(row.metrics.rules)} · 선언 ${number(row.metrics.declarations)} · !important ${number(row.metrics.important)}`, '', '| 지표 | 발생 | 종류 | 상위 값 |', '|---|---:|---:|---|');
    for (const [label, key] of metricRows) lines.push(`| ${label} | ${number(sum(row.metrics[key]))} | ${number(Object.keys(row.metrics[key]).length)} | ${topValues(row.metrics[key])} |`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function selfTest() {
  const measured = analyzeCss(`/* #bad 99px */ #fff { content: "#abc 88px"; background: url("icon.svg#def"); --palette: #AbC; color: var(--Color, #11223344); font-size: clamp(12px, 2vw, 20px); border-radius: 6px 10px; border-start-end-radius: 4px; box-shadow: 0 1px 2px #000; z-index: var(--layer, 12); } @media(min-width:777px) { .a { color: #abcd; font-size: 12px /* #fff 55px */; } }`);
  assert.deepEqual({ ...measured.hex }, { '#aabbcc': 1, '#11223344': 1, '#000000': 1, '#aabbccdd': 1 });
  assert.equal(sum(measured.fontSize), 2); assert.equal(measured.fontPx['12px'], 2); assert.equal(measured.fontPx['20px'], 1);
  assert.equal(measured.px['777px'], undefined); assert.equal(measured.px['88px'], undefined); assert.equal(measured.px['55px'], undefined);
  assert.equal(sum(measured.radius), 2); assert.equal(sum(measured.shadow), 1); assert.equal(sum(measured.zIndex), 1);
  assert.equal(measured.variables['--Color'], 1); assert.equal(measured.variables['--color'], undefined);
  assert.equal(measured.fontSize['12px'], 1);
  const url = analyzeCss('.a{--x:URL(data:image/svg+xml,#fff);font-size:var(--Size,12px);color:rgb(1,2,3);content:"10px"}');
  assert.equal(sum(url.hex), 0); assert.equal(sum(url.px), 1); assert.equal(sum(url.colorFunctions), 1);
  const base = path.resolve('css-audit-self-test'), source = file => path.join(base, file);
  const files = new Map([
    [source('src/app/page.tsx'), `import './page.css'; import type { A } from '../types'; import { type B } from '../types2'; export type { C } from '../types3'; import '@/component'; import('@xyflow/react/dist/style.css'); // import './comment.css'`],
    [source('src/component.tsx'), `const Lazy = import('./lazy');`],
    [source('src/lazy.tsx'), `require('./lazy.css');`],
    [source('src/types.ts'), `import './type-only.css';`],
    [source('src/types2.ts'), `import './type-only.css';`],
    [source('src/types3.ts'), `import './type-only.css';`],
    [source('src/type-only.css'), '.x{color:#fff}'],
    [source('src/lazy.css'), '.x{font-size:12px}'],
    [source('src/app/page.css'), `/* @import './comment.css'; */ @import url("./nested.css");`],
    [source('src/app/nested.css'), `@import './page.css'; .x{color:#abc}`],
    [source('src/app/comment.css'), '.x{color:#fff}'],
  ]);
  const graph = referenceGraph(base, files);
  assert.equal(graph.reachable.has(source('src/app/nested.css')), true);
  assert.equal(graph.reachable.has(source('src/lazy.css')), true);
  assert.equal(graph.reachable.has(source('src/type-only.css')), false);
  assert.equal(graph.reachable.has(source('src/app/comment.css')), false);
  assert.deepEqual(graph.externalCss, ['src/app/page.tsx → @xyflow/react/dist/style.css']);
  assert.deepEqual(graph.unresolved, []);
  console.info('CSS 감사 자체 검증 통과: 주석·문자열·URL·단위·타입 import·동적 import·순환 참조.');
}

async function main() {
  const flags = process.argv.slice(2);
  if (flags.length > 1 || flags.some(flag => !['--check', '--self-test', '--json'].includes(flag))) throw new Error('사용법: node scripts/css-audit.mjs [--check | --self-test | --json]');
  if (flags[0] === '--self-test') { selfTest(); return; }
  const audit = await auditProject(projectDirectory);
  if (flags[0] === '--json') { console.log(JSON.stringify(audit, null, 2)); return; }
  const report = markdownReport(audit);
  if (flags[0] === '--check') {
    const existing = await readFile(outputFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (existing !== report) throw new Error('CSS 감사 보고서가 현재 소스와 다릅니다. node scripts/css-audit.mjs로 다시 생성해 주세요.');
    console.info('CSS 감사 보고서 일치: 집계와 출력이 동일합니다.');
  } else {
    await mkdir(path.dirname(outputFile), { recursive: true });
    await writeFile(outputFile, report, 'utf8');
    console.info(`CSS 감사 작성: docs/design/css-audit.md · 전체 ${audit.total.files}개 / 참조 ${audit.referenced.files}개 · hex ${sum(audit.total.hex)}회`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
