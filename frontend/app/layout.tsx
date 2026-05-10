import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { ThemeProvider } from '@/lib/theme';
import { TimezoneProvider } from '@/lib/timezone';
import { TooltipProvider } from '@/components/ui/tooltip';

export const metadata: Metadata = {
  title: "Stella's Thread House",
  description: "Stella's Thread House · Ollama 기반 챗봇",
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
              <TooltipProvider delayDuration={0} skipDelayDuration={0}>
                {children}
              </TooltipProvider>
            </TimezoneProvider>
          </I18nProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
