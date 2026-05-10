'use client';

import { useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Toast {
  id: string;
  threadId: string;
  threadTitle: string;
  message: string;
}

interface Props {
  toasts: Toast[];
  onClick: (threadId: string) => void;
  onDismiss: (id: string) => void;
}

const AUTO_DISMISS_MS = 6000;

export default function Toaster({ toasts, onClick, onDismiss }: Props) {
  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[1500] flex flex-col gap-2">
      {toasts.map((tt) => (
        <ToastItem key={tt.id} toast={tt} onClick={onClick} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onClick,
  onDismiss,
}: {
  toast: Toast;
  onClick: (threadId: string) => void;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const id = window.setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast.id]);

  return (
    <div
      className={cn(
        'pointer-events-auto flex w-[320px] items-start gap-2.5 rounded-lg border border-border bg-card p-3 shadow-xl',
        'animate-in fade-in slide-in-from-right-4 duration-200',
      )}
    >
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <button
        type="button"
        onClick={() => onClick(toast.threadId)}
        className="min-w-0 flex-1 text-left"
      >
        <div className="truncate text-[12.5px] font-medium text-foreground hover:underline">
          {toast.threadTitle || 'Thread'}
        </div>
        <div className="text-[11.5px] text-muted-foreground">{toast.message}</div>
      </button>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label="dismiss"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
