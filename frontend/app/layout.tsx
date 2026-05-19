import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme';
import { TimezoneProvider } from '@/lib/timezone';
import { ThreadSettingsProvider } from '@/lib/threadSettings';
import { TooltipProvider } from '@/components/ui/tooltip';

export const metadata: Metadata = {
  title: "Stella's Thread House",
  description: "Stella's Thread House · Ollama 기반 챗봇",
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
