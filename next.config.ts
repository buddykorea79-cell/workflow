import type { NextConfig } from 'next';
const config: NextConfig = {
  poweredByHeader: false, devIndicators: false,
  serverExternalPackages: ['pdfjs-dist', '@neondatabase/serverless', 'ws', 'kordoc', 'pdfkit', 'exceljs'],
  outputFileTracingIncludes: { '/api/organization-division/export': ['./public/fonts/Pretendard-Regular.otf'] },
  // Kordoc is used for text extraction with OCR disabled; omit unused native OCR engines.
  outputFileTracingExcludes: { '/*': ['**/node_modules/onnxruntime-node/**/*', '**/node_modules/onnxruntime-common/**/*', '**/node_modules/@hyzyla/pdfium/**/*', '**/node_modules/@huggingface/tokenizers/**/*'] },
};
export default config;
