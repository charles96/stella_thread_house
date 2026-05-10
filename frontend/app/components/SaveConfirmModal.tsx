'use client';

import { Save, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';

export default function SaveConfirmModal({
  open,
  onCancel,
  onSaveAndContinue,
  onContinueWithoutSaving,
  saving,
}: {
  open: boolean;
  onCancel: () => void;
  onSaveAndContinue: () => void;
  onContinueWithoutSaving: () => void;
  saving?: boolean;
}) {
  const [internalSaving, setInternalSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const busy = saving || internalSaving;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="w-full max-w-sm rounded-xl border border-border bg-card p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <Save className="h-4 w-4" />
            <h2 className="text-base font-semibold">저장하지 않은 변경사항</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onCancel}
            disabled={busy}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <p className="mb-5 text-sm text-muted-foreground">
          현재까지의 대화/폴더 변경사항을 서버에 저장하시겠습니까?
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            취소
          </Button>
          <Button
            variant="outline"
            onClick={onContinueWithoutSaving}
            disabled={busy}
          >
            저장 안 함
          </Button>
          <Button
            onClick={async () => {
              setInternalSaving(true);
              try {
                await onSaveAndContinue();
              } finally {
                setInternalSaving(false);
              }
            }}
            disabled={busy}
          >
            {busy ? '저장 중…' : '저장'}
          </Button>
        </div>
      </div>
    </div>
  );
}
