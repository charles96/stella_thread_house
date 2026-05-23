'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  KeyboardEvent,
  ChangeEvent,
} from 'react';
import { Camera, ImageIcon, Plus, SendHorizonal, Square, X } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export interface InputBarHandle {
  attachImageDataUrls: (urls: string[], names?: string[]) => void;
}

const MAX_DIM = 1280;
const MAX_FILES = 4;

async function maybeConvertHeic(file: File): Promise<File> {
  const isHeic =
    /\.hei[cf]$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type);
  if (!isHeic) return file;
  try {
    const mod = await import('heic2any');
    const heic2any = (
      mod as unknown as {
        default: (opts: { blob: Blob; toType?: string; quality?: number }) => Promise<Blob | Blob[]>;
      }
    ).default;
    const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.85 });
    const blob = Array.isArray(out) ? out[0] : out;
    return new File([blob], file.name.replace(/\.hei[cf]$/i, '.jpg'), { type: 'image/jpeg' });
  } catch (e) {
    throw new Error(`HEIC 변환 실패: ${e instanceof Error ? e.message : ''}`);
  }
}

function drawToCanvas(source: CanvasImageSource, width: number, height: number): string {
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d 미지원');
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.85);
}

function fileToResizedDataUrlFallback(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('이미지 디코딩 실패'));
      img.onload = () => {
        try { resolve(drawToCanvas(img, img.naturalWidth, img.naturalHeight)); }
        catch (err) { reject(err); }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

async function fileToResizedDataUrl(file: File): Promise<string> {
  const working = await maybeConvertHeic(file);
  try {
    const bitmap = await createImageBitmap(working);
    return drawToCanvas(bitmap, bitmap.width, bitmap.height);
  } catch {
    return fileToResizedDataUrlFallback(working);
  }
}

interface InputBarProps {
  onSend: (text: string, images: string[], imageNames: string[], useVision: boolean) => void;
  disabled: boolean;
  isStreaming?: boolean;
  onStop?: () => void;
  liveTokRate?: number | null;
  onAttachedChange?: (dataUrls: string[]) => void;
}

const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar(
  { onSend, disabled, isStreaming = false, onStop, liveTokRate, onAttachedChange },
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
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

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
      alert('이미지를 읽는 중 오류가 발생했습니다.');
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

  const sendDisabled = disabled || !value.trim();
  const attachDisabled = disabled || images.length >= MAX_FILES;
  const hasImages = images.length > 0;

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

        {/* 팝업 메뉴 — 채팅창 뒤에서 슬라이드업 */}
        {menuOpen && (
          <div className="absolute bottom-0 left-0 right-0 rounded-2xl border border-border bg-card shadow-[0_0_0_4px_rgba(0,0,0,0.12),0_-4px_24px_rgba(0,0,0,0.22)] animate-in slide-in-from-bottom-2 duration-200">
            <div aria-hidden className="pointer-events-none absolute inset-x-0 -top-8 h-8 bg-gradient-to-t from-background/60 via-background/30 to-transparent" />
            <div className="flex flex-col p-1 pb-14">
              <button
                type="button"
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

        {/* 통합 입력 컨테이너 (팝업 위에 렌더링) */}
        <div
          className={cn(
            'relative flex items-center rounded-2xl bg-secondary shadow-md transition-transform duration-200',
            pulse && '-translate-y-1 scale-[0.98]',
          )}
        >
          {/* Textarea */}
          <div className="relative min-w-0 flex-1 pl-3">
            <Textarea
              ref={textareaRef}
              value={value}
              rows={1}
              placeholder={isStreaming ? '' : isMobile ? 'Type a message' : t('input.placeholder')}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={disabled}
              className={cn(
                'min-h-[38px] w-full resize-none overflow-y-hidden border-0 bg-transparent py-[9px] px-0 shadow-none outline-none ring-0 ring-offset-0 focus-visible:ring-0 focus-visible:ring-offset-0',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            />
            {isStreaming && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <span className="animate-in fade-in tabular-nums text-[11px] text-muted-foreground/70 duration-200">
                  {typeof liveTokRate === 'number' && liveTokRate > 0
                    ? `${liveTokRate.toFixed(1)} tok/s`
                    : '…'}
                </span>
              </div>
            )}
          </div>

          {/* + 버튼 */}
          <div className="shrink-0 p-1.5">
            <button
              type="button"
              onClick={() => {
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

          {/* 구분선 */}
          <div className="shrink-0 self-center h-4 w-px bg-foreground/20" />

          {/* Send / Stop 버튼 */}
          <div className="shrink-0 p-1.5">
            {isStreaming && onStop ? (
              <button
                type="button"
                onClick={onStop}
                title="Stop"
                aria-label="Stop"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive text-destructive-foreground transition-colors hover:bg-destructive/90"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
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
    </>
  );
});

export default InputBar;
