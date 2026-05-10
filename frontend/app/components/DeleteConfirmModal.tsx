'use client';

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';

interface Props {
  open: boolean;
  // 사용자가 정확히 입력해야 삭제가 활성화되는 이름.
  itemName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DeleteConfirmModal({
  open,
  itemName,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useI18n();
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft('');
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!open) return null;

  const matches = draft.trim() === itemName.trim() && itemName.trim() !== '';

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h2 className="text-base font-semibold">{t('delete.title')}</h2>
        </div>
        <p className="mb-1 text-sm text-foreground">
          {t('delete.permanentWarning')}
        </p>
        <p className="mb-3 text-sm text-muted-foreground">
          {t('delete.typeNamePrompt')}
        </p>
        <div className="mb-3 select-all rounded-md border border-border bg-secondary/40 px-2.5 py-1.5 font-mono text-[12.5px] text-foreground">
          {itemName || t('delete.empty')}
        </div>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches) {
              e.preventDefault();
              onConfirm();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onCancel();
            }
          }}
          placeholder={t('delete.namePlaceholder')}
          className="mb-4 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none ring-2 ring-transparent focus:ring-primary"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('delete.cancel')}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            disabled={!matches}
            onClick={onConfirm}
          >
            {t('delete.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}
