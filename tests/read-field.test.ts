import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFieldParts } from '../src/lib/read-field-text';

test('read-field links preserve every character and separate surrounding sentence punctuation', () => {
  const text = '자료: (https://example.org/report?a=1&b=2).\n다음 http://example.net/a(b), 확인';
  const parts = readFieldParts(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.deepEqual(parts.filter(part => part.href), [
    { text: 'https://example.org/report?a=1&b=2', href: 'https://example.org/report?a=1&b=2' },
    { text: 'http://example.net/a(b)', href: 'http://example.net/a(b)' },
  ]);
});

test('non-http schemes, relative links, malformed hosts and backslash destinations stay plain text', () => {
  const text = 'javascript:alert(1) data:text/html,x file:///private mailto:user@example.com //example.com https:// https://[wrong] https://example.com\\@other.example';
  const parts = readFieldParts(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  assert.equal(parts.some(part => part.href), false);
});

test('international and uppercase HTTP URLs parse safely while their written labels remain intact', () => {
  const text = 'HTTPS://예시.한국/보고서?q=업무 http://localhost:3000/review';
  const parts = readFieldParts(text);
  assert.equal(parts.map(part => part.text).join(''), text);
  const links = parts.filter(part => part.href);
  assert.equal(links.length, 2);
  assert.equal(links[0].text, 'HTTPS://예시.한국/보고서?q=업무');
  assert.equal(new URL(links[0].href!).protocol, 'https:');
  assert.equal(links[1].href, 'http://localhost:3000/review');
});

const componentRequire = createRequire(path.resolve('tests/read-field.test.ts'));
const cssLoader = componentRequire.extensions['.css'];
componentRequire.extensions['.css'] = () => undefined;
let ui: typeof import('../src/components/ui');
try { ui = componentRequire('../src/components/ui'); }
finally { if (cssLoader) componentRequire.extensions['.css'] = cssLoader; else delete componentRequire.extensions['.css']; }

function render(value: string | number | null | undefined, options: { date?: boolean; span?: boolean } = {}) {
  return renderToStaticMarkup(createElement(ui.ReadField, { label: '업무 설명', value, ...options }));
}

test('read fields show missing text for null and whitespace while retaining numeric zero and raw recovery metadata', () => {
  for (const value of [undefined, null, '', ' \n\t ']) {
    const html = render(value);
    assert.match(html, /data-field-label="업무 설명"/);
    assert.match(html, /data-read-label="업무 설명"/);
    assert.match(html, /read-field-empty">미입력/);
    assert.doesNotMatch(html, /<input|<textarea|<select/);
  }
  const zero = render(0);
  assert.match(zero, /data-read-value="0"/); assert.match(zero, /read-field-value ">0</);
  assert.doesNotMatch(zero, /미입력/);
  assert.ok(render(' \n\t ').includes('data-read-value=" \n\t "'));
});

test('date formatting changes the display only and retains the original value for draft recovery', () => {
  const html = render('2026-11-07T15:30:00Z', { date: true });
  assert.match(html, /2026\. 11\. 8\./);
  assert.match(html, /data-read-value="2026-11-07T15:30:00Z"/);
  assert.match(render('', { date: true }), />미입력</);
  assert.match(render('not-a-date', { date: true }), /data-read-value="not-a-date"/);
});

test('long multiline descriptions remain complete and HTTP links use safe target attributes', () => {
  const text = `  ${'긴 설명 내용 '.repeat(260)}\n두 번째 줄\nhttps://example.org/report?a=1&b=2\n마지막 줄  `;
  const html = render(text, { span: true });
  assert.match(html, /class="field read-field field-span"/);
  assert.ok(html.includes('긴 설명 내용 '.repeat(260)));
  assert.ok(html.includes('\n두 번째 줄\n'));
  assert.match(html, /href="https:\/\/example\.org\/report\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer"/);
  assert.ok(html.includes('\n마지막 줄  '));
  assert.doesNotMatch(html, /maxlength|disabled|<textarea/);
});

test('HTML-shaped input is React text, and unsafe schemes are never rendered as anchor destinations', () => {
  const html = render('<img src=x onerror=alert(1)>\njavascript:alert(1)\nhttps://example.org/" onclick="alert(2)');
  assert.doesNotMatch(html, /<img|href="javascript:|<script|<a[^>]+onclick=/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /href="https:\/\/example\.org\/"/);
  assert.match(html, /data-read-value="&lt;img/);
});
