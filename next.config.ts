import type { NextConfig } from 'next';
import { securityHeaders, type SecurityHeaderEnvironment } from './src/lib/security-headers';

export function securityHeaderRoutes(env: SecurityHeaderEnvironment) {
  return [
    { source: '/:path*', headers: securityHeaders(env) },
    // Next retains configured headers when serializing route responses, including redirects.
    { source: '/api/attachments/:path*', headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }] },
  ];
}

const config: NextConfig = {
  poweredByHeader: false, devIndicators: false,
  async headers() {
    return securityHeaderRoutes({ NODE_ENV: process.env.NODE_ENV, VERCEL: process.env.VERCEL, AWS_ENDPOINT_URL_S3: process.env.AWS_ENDPOINT_URL_S3 });
  },
  serverExternalPackages: ['pdfjs-dist', '@neondatabase/serverless', 'ws', 'kordoc', 'pdfkit', 'exceljs'],
  outputFileTracingIncludes: { '/api/organization-division/export': ['./public/fonts/Pretendard-Regular.otf'] },
  // Kordoc is used for text extraction with OCR disabled; omit unused native OCR engines.
  outputFileTracingExcludes: { '/*': ['**/node_modules/onnxruntime-node/**/*', '**/node_modules/onnxruntime-common/**/*', '**/node_modules/@hyzyla/pdfium/**/*', '**/node_modules/@huggingface/tokenizers/**/*'] },
};
export default config;
