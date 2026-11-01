import type { NextConfig } from 'next';
const config: NextConfig = { poweredByHeader: false, devIndicators: false, serverExternalPackages: ['pdfjs-dist', '@neondatabase/serverless', 'ws'] };
export default config;
