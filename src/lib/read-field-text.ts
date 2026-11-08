export type ReadFieldPart = { text: string; href?: string };

/** Keep sentence punctuation outside links, retaining balanced brackets in URL paths. */
function withoutSentenceSuffix(value: string): string {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{', '〉': '〈', '》': '《', '」': '「', '』': '『', '】': '【' };
  const counts = new Map<string, number>();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let end = value.length;
  while (end > 0) {
    const last = value[end - 1];
    if (/[.,;:!?，。；：！？]/u.test(last)) { end--; continue; }
    const opening = pairs[last];
    if (opening && (counts.get(last) ?? 0) > (counts.get(opening) ?? 0)) { counts.set(last, counts.get(last)! - 1); end--; continue; }
    break;
  }
  return value.slice(0, end);
}

/** Plain text stays intact; only explicit, parseable HTTP(S) URLs become links. */
export function readFieldParts(value: string): ReadFieldPart[] {
  const parts: ReadFieldPart[] = [];
  const text = (content: string) => {
    if (!content) return;
    const previous = parts.at(-1);
    if (previous && !previous.href) previous.text += content;
    else parts.push({ text: content });
  };
  let cursor = 0;
  for (const match of value.matchAll(/https?:\/\/[^\s<>"'`\u0000-\u001f\u007f]+/giu)) {
    text(value.slice(cursor, match.index));
    const candidate = withoutSentenceSuffix(match[0]);
    let href: string | undefined;
    try {
      // Browsers normalize backslashes as separators; do not change the written destination.
      if (candidate && !candidate.includes('\\')) {
        const parsed = new URL(candidate);
        if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) href = parsed.href;
      }
    } catch { /* A malformed candidate remains ordinary text. */ }
    if (href) { parts.push({ text: candidate, href }); text(match[0].slice(candidate.length)); }
    else text(match[0]);
    cursor = match.index + match[0].length;
  }
  text(value.slice(cursor));
  return parts;
}
