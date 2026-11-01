import type { Metadata } from 'next';
import './globals.css';
import './color-theme.css';
export const metadata: Metadata = { title: '온이음 · 업무의 흐름을 잇다', description: '업무의 기준부터 수행, 성과, 다음 담당자까지. 조직의 일을 연결하는 온이음 업무관리.', icons: { icon: '/icon.svg' } };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
