import { PassThrough } from 'node:stream';
import type { ReactNode } from 'react';
import { renderToPipeableStream } from 'react-dom/server';

/** Wait for actual lazy content; the stream may also retain fallback/React replacement markup. */
export function renderComponent(element: ReactNode): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    let failed = false;
    const timer = setTimeout(() => { failed = true; stream.abort(); output.destroy(); reject(new Error('Component rendering did not finish within 10 seconds')); }, 10_000);
    output.on('data', chunk => chunks.push(Buffer.from(chunk)));
    output.on('end', () => { clearTimeout(timer); if (!failed) resolve(Buffer.concat(chunks).toString('utf8')); });
    output.on('error', error => { clearTimeout(timer); failed = true; reject(error); });
    const stream = renderToPipeableStream(element, {
      onAllReady() { if (!failed) stream.pipe(output); },
      onError(error) { if (!failed) { failed = true; clearTimeout(timer); reject(error); } },
      onShellError(error) { failed = true; clearTimeout(timer); reject(error); },
    });
  });
}
