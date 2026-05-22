'use client';

import { Pin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

interface Props {
  open: boolean;
  onClose: () => void;
}

export default function PinLimitModal({ open, onClose }: Props) {
  const { t } = useI18n();

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Pin className="h-4 w-4 text-primary" />
          </span>
          <h2 className="text-base font-semibold">{t('sidebar.pinLimitTitle')}</h2>
        </div>
        <p className="mb-5 text-sm text-muted-foreground">
          {t('sidebar.pinLimit')}
        </p>
        <div className="flex justify-end">
          <Button size="sm" onClick={onClose}>
            {t('sidebar.pinLimitOk')}
          </Button>
        </div>
      </div>
    </div>
  );
}
