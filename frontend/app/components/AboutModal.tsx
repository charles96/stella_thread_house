'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { version } from '../../package.json';

// lucide-react 1.14 에는 Github 아이콘이 없어 표준 GitHub mark SVG 를 인라인.
function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      className={className}
      aria-hidden
    >
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function AboutModal({ open, onClose }: Props) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const REPO_URL = 'https://github.com/charles96/stella_thread_house';

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in-0 duration-200"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t('about.title')}</h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onClose}
            title={t('about.close')}
            aria-label={t('about.close')}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground text-lg font-bold">
            S
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Stella's Thread House</div>
            <div className="text-[12px] text-muted-foreground">
              {t('about.tagline')}
            </div>
          </div>
        </div>

        <div className="divide-y divide-border rounded-md border border-border bg-secondary/30 text-[12.5px]">
          <div className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="text-muted-foreground">
              {t('about.version')}
            </span>
            <span className="truncate text-right">{version}</span>
          </div>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-secondary"
            title={REPO_URL}
          >
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <GithubIcon className="h-3.5 w-3.5" />
              GitHub
            </span>
            <span className="truncate text-right text-primary hover:underline">
              {REPO_URL.replace(/^https?:\/\//, '')}
            </span>
          </a>
        </div>
      </div>
    </div>
  );
}
