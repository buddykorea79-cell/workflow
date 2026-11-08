export const ACCESS_CODE_LENGTH = 8;
export const ACCESS_CODE_PATTERN = '[0-9]{8}';

/** Keep codes as strings so leading zeroes survive; do not trim or normalize. */
export function isValidAccessCode(value: unknown): value is string {
  return typeof value === 'string' && value.length === ACCESS_CODE_LENGTH && /^[0-9]{8}$/.test(value);
}
