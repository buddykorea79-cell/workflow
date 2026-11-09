/** One budget covers source preparation, model lookup, generation and bounded repair. */
export const AI_GENERATION_TIMEOUT_MS = 180_000;
/** Let the server return its useful timeout error before the browser gives up. */
export const AI_GENERATION_CLIENT_TIMEOUT_MS = 190_000;
/** Route handlers declare this as a literal for Next.js static analysis. */
export const AI_GENERATION_ROUTE_MAX_DURATION_SECONDS = 200;
