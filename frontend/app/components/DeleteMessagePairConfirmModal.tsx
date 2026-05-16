'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface Props {
  open: boolean;
  // 삭제 대상 질문의 미리보기 텍스트 (모달 본문에 노출).
  questionPreview: string;
  // 함께 삭제될 assistant 응답이 있는지. 본문 카피 분기용.
  hasPairedAnswer: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteMessagePairConfirmModal({
  open,
  questionPreview,
  hasPairedAnswer,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      else if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onCancel, onConfirm]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in-0 duration-150"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <h2 className="text-base font-semibold text-foreground">
            {t('delete.pair.title')}
          </h2>
        </div>
        <p className="mb-2 text-sm text-muted-foreground">
          {hasPairedAnswer
            ? t('delete.pair.bodyWithAnswer')
            : t('delete.pair.bodyWithoutAnswer')}
        </p>
        {questionPreview && (
          <blockquote className="mb-5 max-h-32 overflow-auto rounded-md border border-border bg-secondary/40 px-3 py-2 text-[12.5px] leading-relaxed text-foreground">
            {questionPreview}
          </blockquote>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
          >
            {t('delete.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-md border border-destructive bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
          >
            {t('delete.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
