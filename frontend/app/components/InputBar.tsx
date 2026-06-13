'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  KeyboardEvent,
  ChangeEvent,
} from 'react';
import { Camera, ImageIcon, Pencil, Plus, SendHorizonal, Square, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { fileToResizedDataUrl, drawToCanvas } from '@/lib/imageUtils';

export interface InputBarHandle {
  attachImageDataUrls: (urls: string[], names?: string[]) => void;
}

const MAX_FILES = 4;

interface InputBarProps {
  onSend: (text: string, images: string[], imageNames: string[], useVision: boolean) => void;
  disabled: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  liveTokRate?: number | null;
  onAttachedChange?: (dataUrls: string[]) => void;
  // Thread 모드에서만 '직접 작성' 버튼 노출. Chat 모드면 숨김(기본 true).
  isThread?: boolean;
  // '직접 작성' 버튼에 2초 이상 hover 하면 true, 벗어나면 false. (최하단 스크롤 + 입력 영역 실루엣 프리뷰)
  onManualPreview?: (active: boolean) => void;
  // '직접 작성' 버튼 클릭 — 빈 제목/본문 생성 + 본문 Edit 모드 오픈.
  onManualCreate?: () => void;
}

const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar(
  { onSend, disabled, isStreaming = false, onStop, liveTokRate, onAttachedChange, isThread = true, onManualPreview, onManualCreate },
  ref,
) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [imageNames, setImageNames] = useState<string[]>([]);
  const [visionOn, setVisionOn] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cameraModal, setCameraModal] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [collapsedWidth, setCollapsedWidth] = useState(240);
  const [streamingWidth, setStreamingWidth] = useState(164);
  const measureRef = useRef<HTMLSpanElement>(null);
  const streamingMeasureRef = useRef<HTMLSpanElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // '직접 작성' 버튼 2초 hover 타이머.
  const manualHoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (manualHoverTimer.current) clearTimeout(manualHoverTimer.current);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    setIsIOS(/iPhone|iPad|iPod/i.test(navigator.userAgent));
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => { setVisionOn(images.length > 0); }, [images.length]);
  useEffect(() => { onAttachedChange?.(images); }, [images, onAttachedChange]);

  // 스트리밍 종료 시 포커스 해제 → 채팅창이 unfocused 상태로 복귀
  const prevStreamingRef = useRef(false);
  useEffect(() => {
    if (prevStreamingRef.current && !isStreaming) {
      textareaRef.current?.blur();
      setIsFocused(false);
    }
    prevStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // 바텀 시트 바깥 클릭 닫기
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (!(e.target as HTMLElement).closest('[data-attach-menu]')) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [menuOpen]);

  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // textarea 높이 자동 조절 (최대 3줄)
  useEffect(() => {
    const timer = setTimeout(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.style.height = 'auto';
      const cs = getComputedStyle(ta);
      const lineHeight = parseFloat(cs.lineHeight) || 24;
      const padTop = parseFloat(cs.paddingTop) || 0;
      const padBottom = parseFloat(cs.paddingBottom) || 0;
      const maxH = lineHeight * 3 + padTop + padBottom;
      const scrollH = ta.scrollHeight;
      ta.style.height = `${Math.min(scrollH, maxH)}px`;
      ta.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
    }, 50);
    return () => clearTimeout(timer);
  }, [value]);

  useImperativeHandle(ref, () => ({
    attachImageDataUrls(urls: string[], names: string[] = []) {
      setImages((prev) => [...prev, ...urls].slice(0, MAX_FILES));
      setImageNames((prev) => [...prev, ...urls.map((_, i) => names[i] ?? '')].slice(0, MAX_FILES));
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
  }));

  function submit() {
    const text = value.trim();
    if (disabled || !text) return;
    onSend(text, images, imageNames, visionOn);
    setValue('');
    setImages([]);
    setImageNames([]);
    setVisionOn(false);
    setPulse(true);
    setTimeout(() => setPulse(false), 250);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  }

  async function processFiles(files: File[]) {
    const remaining = Math.max(0, MAX_FILES - images.length);
    const batch = files.slice(0, remaining);
    if (!batch.length) return;
    try {
      const dataUrls = await Promise.all(batch.map(fileToResizedDataUrl));
      const names = batch.map((f) => f.name);
      setImages((prev) => [...prev, ...dataUrls].slice(0, MAX_FILES));
      setImageNames((prev) => [...prev, ...names].slice(0, MAX_FILES));
    } catch (err) {
      console.error(err);
      alert(t('input.imageReadError'));
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    await processFiles(files);
  }

  const removeImage = useCallback((idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
    setImageNames((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  async function openCamera() {
    if (isMobile) {
      cameraRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      setCameraModal(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 50);
    } catch {
      alert('카메라에 접근할 수 없습니다. 브라우저 권한을 확인하세요.');
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video) return;
    const dataUrl = drawToCanvas(video, video.videoWidth, video.videoHeight);
    const name = `camera_${Date.now()}.jpg`;
    setImages((prev) => [...prev, dataUrl].slice(0, MAX_FILES));
    setImageNames((prev) => [...prev, name].slice(0, MAX_FILES));
    stopStream();
    setCameraModal(false);
  }

  function closeCamera() {
    stopStream();
    setCameraModal(false);
  }

  const placeholderText = isStreaming ? '' : isMobile ? 'Type a message' : t('input.placeholder');

  useLayoutEffect(() => {
    if (measureRef.current) {
      // pl-3(12) + p-1.5+w-8+p-1.5(44) + w-px(1) + p-1.5+w-8+p-1.5(44) = 101px
      setCollapsedWidth(measureRef.current.offsetWidth + 106);
    }
  }, [placeholderText]);

  useLayoutEffect(() => {
    if (streamingMeasureRef.current) {
      // px-3 양쪽(24px) + stop 버튼 p-1.5+w-8+p-1.5(44px)
      setStreamingWidth(streamingMeasureRef.current.offsetWidth + 68);
    }
  }, [liveTokRate]);

  // 스트리밍 중에는 포커스 여부 무시 — 전송 직후 textarea 포커스가 남아 있어도 축소 상태로.
  const isStreamingCollapsed = isStreaming && value.length === 0 && images.length === 0;
  const isExpanded = !isStreamingCollapsed && (isFocused || value.length > 0 || images.length > 0);
  // 수동 작성 버튼 표시 조건 — Thread 모드에서, 입력창이 접혀(비포커스) 있고 스트리밍이 아닐 때만
  // 우측에 노출. 포커스로 확장되면 사라지고, 블러로 축소(300ms)된 뒤 delay 후 다시 페이드인.
  const showManualBtn = isThread && !isExpanded && !isStreaming;
  // 모바일 접힘 상태에서 '버튼이 보일 때만' 입력창 폭을 보정한다. 데스크톱은 내용 맞춤 pill 을
  // 중앙 정렬하지만 모바일은 화면이 좁아 그러면 입력창이 너무 좁으므로, 우측 버튼 공간(60px)만
  // 남기고 입력창을 넓게(calc) + 좌측 정렬한다. Chat 모드(버튼 없음)면 기존처럼 full-width.
  const mobileCollapsed = isMobile && !isExpanded && !isStreamingCollapsed;
  const mobileWideForBtn = mobileCollapsed && isThread;
  // tok/s 데이터가 실제로 있는지 — 없으면 중지 버튼만 표시
  const hasTokRate = typeof liveTokRate === 'number' && liveTokRate > 0;

  const sendDisabled = disabled || !value.trim();
  const attachDisabled = disabled || images.length >= MAX_FILES;
  const hasImages = images.length > 0;
  // 중지 버튼만 있을 때 너비: glow border(3px) + p-1.5+w-8+p-1.5(44px) = 47px
  const stopOnlyWidth = 47;

  return (
    <>
    {/* PC 카메라 모달 */}
    {cameraModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={closeCamera}>
        <div
          className="relative flex flex-col items-center gap-4 rounded-2xl bg-background p-4 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <video ref={videoRef} className="rounded-xl" style={{ maxWidth: '480px', width: '100%' }} playsInline muted />
          <div className="flex gap-3">
            <button
              type="button"
              onClick={capturePhoto}
              className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Camera className="h-4 w-4" />
              촬영
            </button>
            <button
              type="button"
              onClick={closeCamera}
              className="flex items-center gap-2 rounded-full border border-border px-5 py-2 text-sm font-medium hover:bg-accent"
            >
              <X className="h-4 w-4" />
              취소
            </button>
          </div>
        </div>
      </div>
    )}
    {/* placeholder 너비 측정용 숨김 span */}
    <span
      ref={measureRef}
      aria-hidden
      className="pointer-events-none invisible absolute whitespace-nowrap text-sm"
    >
      {placeholderText}
    </span>
    {/* 스트리밍 tok/s 너비 측정용 숨김 span */}
    <span
      ref={streamingMeasureRef}
      aria-hidden
      className="pointer-events-none invisible absolute whitespace-nowrap text-sm font-medium tabular-nums"
    >
      {typeof liveTokRate === 'number' && liveTokRate > 0 ? `${liveTokRate.toFixed(1)} tok/s` : '…'}
    </span>

    <div className="relative px-4 py-2">
      {/* 첨부 이미지 미리보기 */}
      {hasImages && (
        <div className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-4 right-4 z-10 flex gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <div
              key={i}
              className="pointer-events-auto relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt={`첨부 ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-black/90"
                aria-label="이미지 제거"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 히든 인풋 */}
      <input ref={fileRef} type="file" accept={isIOS ? 'image/*' : 'image/*,.heic,.heif'} multiple hidden onChange={onPick} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={onPick} />

      {/* 입력 + 팝업 래퍼 */}
      <div className="relative" data-attach-menu>

        {/* 통합 입력 컨테이너 (팝업 위에 렌더링) */}
        <div
          className={cn(
            'input-glow-border transition-[width,border-radius] duration-300 ease-in-out',
            // 버튼이 보이는 모바일 접힘만 좌측 정렬(우측 여백을 버튼 공간으로). 그 외엔 중앙 정렬.
            mobileWideForBtn ? 'mr-auto' : 'mx-auto',
          )}
          style={{
            width: isStreamingCollapsed
              ? `${hasTokRate ? streamingWidth : stopOnlyWidth}px`
              : isExpanded
                ? '100%'
                : mobileWideForBtn
                  ? 'calc(100% - 60px)'
                  : isMobile
                    ? '100%'
                    : `${collapsedWidth}px`,
            borderRadius: isStreamingCollapsed ? '9999px' : undefined,
          }}
        >
        {/* 수동 작성 버튼 — 입력창에 붙이지 않고 우측에 띄워 둔 원형 아이콘 (모바일 포함).
            입력창(mx-auto, 폭 transition) 의 오른쪽 가장자리에 left-full 로 앵커.
            · 포커스로 입력창이 100% 로 확장되면 → 즉시 opacity-0 으로 사라짐(pointer-events 차단).
            · 블러로 입력창이 축소(300ms)되면 → delay-300 후 우측 제자리에서 페이드인.
            (.input-glow-border > * 가 border-radius 를 강제하므로 !rounded-full 로 덮음) */}
        {/* delayDuration={0} — 커서가 올라가면 지연 없이 즉시 풍선도움말 표시.
            라벨은 i18n(t)로 다국어 지원. */}
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  // 클릭 — 빈 제목/본문 생성 + 본문 Edit 모드. 진행 중이던 hover 프리뷰는 해제.
                  if (manualHoverTimer.current) {
                    clearTimeout(manualHoverTimer.current);
                    manualHoverTimer.current = null;
                  }
                  onManualPreview?.(false);
                  onManualCreate?.();
                }}
                onMouseEnter={() => {
                  if (!showManualBtn) return;
                  // 2초 이상 hover 가 유지되면 프리뷰(최하단 스크롤 + 실루엣) 활성화.
                  manualHoverTimer.current = setTimeout(() => onManualPreview?.(true), 2000);
                }}
                onMouseLeave={() => {
                  if (manualHoverTimer.current) {
                    clearTimeout(manualHoverTimer.current);
                    manualHoverTimer.current = null;
                  }
                  onManualPreview?.(false);
                }}
                aria-label={t('input.manualWrite')}
                aria-hidden={!showManualBtn}
                tabIndex={showManualBtn ? 0 : -1}
                className={cn(
                  'absolute left-full top-1/2 z-10 ml-3 flex h-11 w-11 -translate-y-1/2 items-center justify-center !rounded-full border border-border bg-card text-muted-foreground shadow-[0_4px_14px_rgba(0,0,0,0.35)] transition-[opacity,color,background-color] duration-200 hover:bg-accent hover:text-primary',
                  showManualBtn
                    ? 'opacity-100 delay-300'
                    : 'pointer-events-none opacity-0 delay-0',
                )}
              >
                <Pencil className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top">{t('input.manualWrite')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        {/* 팝업 메뉴 — 채팅창 너비 기준으로 슬라이드업 */}
        {menuOpen && (
          <div className="absolute bottom-0 left-0 right-0 rounded-2xl border border-border bg-card shadow-[0_0_0_4px_rgba(0,0,0,0.12),0_-4px_24px_rgba(0,0,0,0.22)] animate-in slide-in-from-bottom-2 duration-200">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background/60 via-background/30 to-transparent" />
            <div className="flex flex-col p-1 pb-14">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setMenuOpen(false); openCamera(); }}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition-colors hover:bg-accent active:bg-accent"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Camera className="h-4 w-4" />
                </span>
                {t('input.attachMenu.camera')}
              </button>
              <div className="mx-3 h-px bg-border" />
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setMenuOpen(false); fileRef.current?.click(); }}
                className="flex items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-medium transition-colors hover:bg-accent active:bg-accent"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ImageIcon className="h-4 w-4" />
                </span>
                {t('input.attachMenu.localPhoto')}
              </button>
            </div>
          </div>
        )}
        <div
          onClick={() => { if (!isExpanded) textareaRef.current?.focus(); }}
          className={cn(
            'relative flex items-center bg-secondary transition-[transform,border-radius] duration-300 ease-in-out',
            pulse && '-translate-y-1 scale-[0.98]',
            !isExpanded && 'cursor-text',
          )}
          style={{ borderRadius: isStreamingCollapsed ? '9999px' : undefined }}
        >
          {/* 스트리밍 축소 상태 — tok/s: rate 생기면 grid 트릭으로 부드럽게 확장 */}
          {isStreamingCollapsed && (
            <div
              className={cn(
                'grid min-w-0 overflow-hidden transition-[grid-template-columns,opacity] duration-300 ease-in-out',
                hasTokRate ? 'grid-cols-[1fr] opacity-100' : 'grid-cols-[0fr] opacity-0',
              )}
            >
              <div className="min-w-0 overflow-hidden">
                <span className="block whitespace-nowrap px-3 tabular-nums text-sm font-medium text-foreground/80">
                  {hasTokRate ? `${liveTokRate!.toFixed(1)} tok/s` : ''}
                </span>
              </div>
            </div>
          )}

          {/* Textarea + + 버튼 + 구분선 — 스트리밍 끝나면 fade-in 으로 자연스럽게 등장 */}
          {!isStreamingCollapsed && (
            <div className="flex min-w-0 flex-1 items-center animate-in fade-in duration-300">
              <div className="relative min-w-0 flex-1 pl-3">
                {!value && !isStreaming && (
                  <span className="pointer-events-none absolute inset-y-0 left-0 right-0 pl-3 flex items-center text-sm text-muted-foreground truncate">
                    {placeholderText}
                  </span>
                )}
                <Textarea
                  ref={textareaRef}
                  value={value}
                  rows={1}
                  placeholder=""
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={onKeyDown}
                  onFocus={() => setIsFocused(true)}
                  onBlur={() => setIsFocused(false)}
                  disabled={disabled}
                  className={cn(
                    'min-h-[44px] w-full resize-none overflow-y-hidden border-0 bg-transparent py-3 px-0 leading-5 shadow-none outline-none ring-0 ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0',
                    disabled && 'cursor-not-allowed opacity-60',
                  )}
                />
              </div>
              <div className="shrink-0 p-1.5">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (attachDisabled) return;
                    if (isIOS) { fileRef.current?.click(); }
                    else { setMenuOpen((v) => !v); }
                  }}
                  disabled={attachDisabled}
                  aria-label={t('input.attach')}
                  className={cn(
                    'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                    hasImages
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-primary',
                    attachDisabled && 'cursor-not-allowed opacity-40',
                  )}
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="shrink-0 self-center h-4 w-px bg-foreground/20" />
            </div>
          )}

          {/* Send / Stop 버튼 */}
          <div className="shrink-0 p-1.5">
            {isStreaming && onStop ? (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={onStop}
                title="Stop"
                aria-label="Stop"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-[0_0_12px_3px_rgba(239,68,68,0.5)] transition-colors hover:bg-destructive/90 hover:shadow-[0_0_16px_5px_rgba(239,68,68,0.6)]"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={submit}
                disabled={sendDisabled}
                aria-label={t('input.send')}
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full transition-colors',
                  sendDisabled
                    ? 'cursor-not-allowed text-muted-foreground/40'
                    : 'text-primary hover:text-primary/80',
                )}
              >
                <SendHorizonal className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        </div>
      </div>
    </div>
    </>
  );
});

export default InputBar;
