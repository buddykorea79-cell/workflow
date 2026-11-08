export type FieldIssue = { path: string; message: string };

/** Choose a Korean particle without exposing field keys to the user. */
export function withParticle(label: string, consonant: string, vowel: string) {
  const last = label.trim().charCodeAt(label.trim().length - 1);
  const hasFinal = last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
  return `${label}${hasFinal ? consonant : vowel}`;
}

export function requireText(value: string, label: string): string {
  return value.trim() ? '' : `${withParticle(label, '을', '를')} 입력해 주세요.`;
}

export function requiredTextIssues(fields: { path: string; value: string; label: string }[]): FieldIssue[] {
  return fields.flatMap(({ path, value, label }) => {
    const message = requireText(value, label);
    return message ? [{ path, message }] : [];
  });
}

export function matchFieldPath(path: string, available: readonly string[]): string | undefined {
  return available.filter(candidate => path === candidate || path.startsWith(`${candidate}.`)).sort((a, b) => b.length - a.length)[0];
}

export function summarizeIssues(messages: string[], limit = 5) {
  const visible = messages.slice(0, limit);
  if (messages.length > limit) visible.push(`외 ${messages.length - limit}건`);
  return visible.join('\n');
}
