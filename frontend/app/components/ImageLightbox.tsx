'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Eye,
  ImagePlus,
  Trash2,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import type { SearchImage } from './ChatRoom';

interface Props {
  images: SearchImage[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
  onAttach?: (url: string) => void;
  // 현재 이미지 삭제 — 제공되면 상단에 휴지통 버튼 노출.
  onDelete?: (url: string) => void;
  // true 로 마운트되면 곧장 삭제 확인 다이얼로그 노출.
  confirmDeleteOnOpen?: boolean;
}

export default function ImageLightbox({
  images,
  index,
  onClose,
  onIndexChange,
  onAttach,
  onDelete,
  confirmDeleteOnOpen = false,
}: Props) {
  const { t } = useI18n();
  const total = images.length;
  const safeIndex = Math.max(0, Math.min(index, total - 1));
  const current = images[safeIndex];
  // 마운트 시 confirmDeleteOnOpen 가 true 면 곧장 confirm 모드로 시작.
  const [confirming, setConfirming] = useState(confirmDeleteOnOpen);
  // 이미지 인덱스가 바뀌면 진행 중이던 confirm 은 취소 — 다른 이미지에 잘못 적용되지 않게.
  // 단, 마운트 시점은 스킵 — 그 시점에 setConfirming(false) 가 발화되면
  // 초기 confirmDeleteOnOpen 의 true 값이 즉시 덮여 다이얼로그가 안 뜨는 버그.
  const indexFirstRunRef = useRef(true);
  useEffect(() => {
    if (indexFirstRunRef.current) {
      indexFirstRunRef.current = false;
      return;
    }
    setConfirming(false);
  }, [safeIndex]);

  const prev = useCallback(() => {
    if (total <= 1) return;
    onIndexChange((safeIndex - 1 + total) % total);
  }, [safeIndex, total, onIndexChange]);

  const next = useCallback(() => {
    if (total <= 1) return;
    onIndexChange((safeIndex + 1) % total);
  }, [safeIndex, total, onIndexChange]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // confirm 다이얼로그가 떠 있으면 Esc 는 다이얼로그만 닫고 라이트박스는 유지.
      if (e.key === 'Escape') {
        if (confirming) setConfirming(false);
        else onClose();
      } else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    }
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [prev, next, onClose, confirming]);

  if (!current) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="이미지 보기"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-sm animate-in fade-in-0 duration-200"
      onClick={onClose}
    >
      {/* 상단 우측 액션 바 — flex gap 으로 버튼 간격 일정. 좌→우: 첨부, 삭제, 닫기. */}
      <div
        className="absolute right-4 top-4 flex items-center gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        {onAttach && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onAttach(current.url);
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-primary/40 bg-card text-primary shadow-md transition-colors hover:bg-primary hover:text-primary-foreground"
            title="이 이미지를 입력창에 첨부"
            aria-label="이미지 첨부"
          >
            <ImagePlus className="h-5 w-5" />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={(e) => {
              e.stopPropagation();
              setConfirming(true);
            }}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-destructive/50 bg-card text-destructive shadow-md transition-colors hover:bg-destructive hover:text-destructive-foreground"
            title="이 이미지 제거"
            aria-label="이미지 제거"
          >
            <Trash2 className="h-5 w-5" />
          </button>
        )}
        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-secondary/70 text-foreground hover:bg-secondary"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          title="닫기 (Esc)"
          aria-label="닫기"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 삭제 확인 다이얼로그 — 라이트박스 위에 떠 있는 작은 모달.
          stopPropagation 으로 백드롭 클릭(라이트박스 닫기) 와 분리. */}
      {confirming && onDelete && (
        <div
          className="absolute inset-0 z-[110] flex items-center justify-center bg-black/60 animate-in fade-in duration-150"
          onClick={(e) => {
            e.stopPropagation();
            setConfirming(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              <h2 className="text-base font-semibold text-foreground">
                {t('delete.image.title')}
              </h2>
            </div>
            <p className="mb-5 text-sm text-muted-foreground">
              {t('delete.image.body')}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(false);
                }}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
              >
                {t('delete.cancel')}
              </button>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirming(false);
                  onDelete(current.url);
                  // 삭제 후 다음 이미지로 넘어가지 않고 이전 화면(라이트박스 종료) 으로 복귀.
                  onClose();
                }}
                className="rounded-md border border-primary/40 bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t('delete.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {total > 1 && (
        <>
          <button
            type="button"
            className="group absolute left-3 top-1/2 -translate-y-1/2 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-white shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-110 hover:border-white/40 hover:bg-white/20 active:scale-95"
            onClick={(e) => {
              e.stopPropagation();
              prev();
            }}
            title="이전 (←)"
            aria-label="이전 이미지"
          >
            <ChevronLeft className="h-6 w-6 transition-transform duration-200 group-hover:-translate-x-0.5" />
          </button>
          <button
            type="button"
            className="group absolute right-3 top-1/2 -translate-y-1/2 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/10 text-white shadow-lg backdrop-blur-md transition-all duration-200 hover:scale-110 hover:border-white/40 hover:bg-white/20 active:scale-95"
            onClick={(e) => {
              e.stopPropagation();
              next();
            }}
            title="다음 (→)"
            aria-label="다음 이미지"
          >
            <ChevronRight className="h-6 w-6 transition-transform duration-200 group-hover:translate-x-0.5" />
          </button>
        </>
      )}

      <div
        className="flex max-h-[88vh] max-w-[92vw] flex-col items-stretch px-6 lg:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 왼쪽: 이미지 (자기 너비만큼만 차지) */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {(() => {
          // YouTube 이미지는 iframe 임베드. 자동재생 없이 프리뷰 + 재생 버튼 노출.
          if (current.kind === 'youtube') {
            const idFromLink = current.linkUrl?.match(
              /[?&]v=([A-Za-z0-9_-]{6,15})/,
            )?.[1];
            const idFromThumb = current.url?.match(
              /\/vi\/([A-Za-z0-9_-]{6,15})\//,
            )?.[1];
            const videoId = idFromLink ?? idFromThumb;
            if (videoId) {
              return (
                <div
                  className="relative aspect-video w-[min(80vw,960px)] self-center overflow-hidden rounded-t-md bg-black shadow-2xl animate-in zoom-in-95 duration-200 lg:rounded-l-md lg:rounded-r-none lg:rounded-t-none"
                  onClick={(e) => e.stopPropagation()}
                >
                  <iframe
                    src={`https://www.youtube.com/embed/${videoId}`}
                    title={current.sourceTitle ?? 'YouTube video'}
                    className="absolute inset-0 h-full w-full"
                    allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                  />
                </div>
              );
            }
          }
          return (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={current.url}
              alt={current.sourceTitle ?? `이미지 ${safeIndex + 1}`}
              referrerPolicy="no-referrer"
              className={cn(
                'block max-h-[80vh] w-auto max-w-full self-center rounded-t-md object-contain shadow-2xl animate-in zoom-in-95 duration-200 lg:rounded-l-md lg:rounded-r-none lg:rounded-t-none',
              )}
            />
          );
        })()}

        {/* 오른쪽 aside: 비전 분석만 노출. 출처/이미지 링크는 화면 하단 텍스트 링크로 분리. */}
        {current.analysis && (
          <aside
            className="flex w-full flex-col gap-3 overflow-y-auto rounded-b-lg border border-t-0 border-border bg-secondary/80 p-4 text-left backdrop-blur lg:w-[360px] lg:max-h-[80vh] lg:shrink-0 lg:rounded-l-none lg:rounded-r-lg lg:rounded-b-lg lg:border-l-0 lg:border-t"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-wider text-primary">
                <Eye className="h-3.5 w-3.5" />
                <span>비전 AI 분석</span>
                <span
                  className={cn(
                    'ml-auto rounded px-1.5 py-[1px] text-[10.5px] font-semibold tracking-normal',
                    current.analysis.relevant
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'bg-zinc-500/20 text-zinc-300',
                  )}
                >
                  {current.analysis.relevant ? '관련' : '무관'}
                </span>
              </div>
              <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-foreground">
                {current.analysis.description || '(설명 없음)'}
              </div>
            </div>
          </aside>
        )}
      </div>

      {/* 하단 페이지 링크 — 텍스트만 노출, 호버 시 URL 풍선도움말, 클릭 시 새 탭. */}
      <div
        className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-4 text-[12.5px]"
        onClick={(e) => e.stopPropagation()}
      >
        {current.sourceUrl && (
          <a
            href={current.sourceUrl}
            target="_blank"
            rel="noreferrer"
            title={current.sourceUrl}
            className="text-muted-foreground transition-colors hover:text-foreground hover:underline"
          >
            {t('image.source')}
          </a>
        )}
        {total > 1 && (
          <span className="rounded-full bg-secondary/70 px-2.5 py-0.5 text-[11.5px] text-foreground">
            {safeIndex + 1} / {total}
          </span>
        )}
      </div>
    </div>
  );
}
