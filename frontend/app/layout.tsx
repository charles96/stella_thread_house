import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme';
import { TimezoneProvider } from '@/lib/timezone';
import { ThreadSettingsProvider } from '@/lib/threadSettings';
import { TooltipProvider } from '@/components/ui/tooltip';
import SessionGuard from './components/SessionGuard';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Stella's Thread House",
  description: "Stella's Thread House · AI 챗봇",
  icons: { icon: '/logo.svg' },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" data-theme="chocolate">
      <body>
        <ThemeProvider>
          <I18nProvider>
            <TimezoneProvider>
              <ThreadSettingsProvider>
                <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                  <SessionGuard />
                  {children}
                </TooltipProvider>
              </ThreadSettingsProvider>
            </TimezoneProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
