'use client';

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  KeyboardEvent,
  ChangeEvent,
} from 'react';
import { ImagePlus, SendHorizonal, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export interface InputBarHandle {
  // names: 각 dataUrl 의 원본 파일명 (없으면 빈 문자열).
  attachImageDataUrls: (urls: string[], names?: string[]) => void;
}

const MAX_DIM = 1280;
const MAX_FILES = 4;

// HEIC/HEIF 는 Safari 외 브라우저에서 createImageBitmap이 디코드 못 하므로
// heic2any 로 JPEG 변환 후 일반 흐름을 탄다.
async function maybeConvertHeic(file: File): Promise<File> {
  const isHeic =
    /\.hei[cf]$/i.test(file.name) || /^image\/hei[cf]$/i.test(file.type);
  if (!isHeic) return file;
  try {
    const mod = await import('heic2any');
    const heic2any = (
      mod as unknown as {
        default: (opts: {
          blob: Blob;
          toType?: string;
          quality?: number;
        }) => Promise<Blob | Blob[]>;
      }
    ).default;
    const out = await heic2any({
      blob: file,
      toType: 'image/jpeg',
      quality: 0.85,
    });
    const blob = Array.isArray(out) ? out[0] : out;
    const newName = file.name.replace(/\.hei[cf]$/i, '.jpg');
    return new File([blob], newName, { type: 'image/jpeg' });
  } catch (e) {
    throw new Error(
      `HEIC 이미지 변환 실패: ${e instanceof Error ? e.message : ''}`,
    );
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

// FileReader + <img> 기반 fallback — createImageBitmap이 지원하지 않는 포맷(AVIF 등)에 사용.
function fileToResizedDataUrlFallback(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string;
      const img = new Image();
      img.onerror = () => reject(new Error('이미지 디코딩 실패'));
      img.onload = () => {
        try {
          resolve(drawToCanvas(img, img.naturalWidth, img.naturalHeight));
        } catch (err) {
          reject(err);
        }
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
    // createImageBitmap이 해당 포맷을 지원하지 않을 때 <img> 기반으로 재시도.
    return fileToResizedDataUrlFallback(working);
  }
}

interface InputBarProps {
  onSend: (
    text: string,
    images: string[],
    imageNames: string[],
    useVision: boolean,
  ) => void;
  disabled: boolean;
  // 스트리밍 진행 중인지. true면 Send 옆에 Stop 버튼 노출.
  isStreaming?: boolean;
  // Stop 버튼 클릭 시 호출
  onStop?: () => void;
  liveTokRate?: number | null;
  // 현재 첨부된 이미지의 dataUrl 배열을 알려줌 — 부모는 dataUrl ↔ source URL 매핑을 통해 추적.
  onAttachedChange?: (dataUrls: string[]) => void;
}

const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar(
  {
    onSend,
    disabled,
    isStreaming = false,
    onStop,
    liveTokRate,
    onAttachedChange,
  },
  ref,
) {
  const { t } = useI18n();
  const [value, setValue] = useState('');
  const [images, setImages] = useState<string[]>([]);
  // 첨부 이미지 dataUrl 과 평행한 원본 파일명 배열. 길이 동일.
  const [imageNames, setImageNames] = useState<string[]>([]);
  const [visionOn, setVisionOn] = useState(false);
  const [pulse, setPulse] = useState(false);

  // 이미지 첨부 → 비전 토글 자동 ON. 모두 제거되면 자동 OFF.
  useEffect(() => {
    setVisionOn(images.length > 0);
  }, [images.length]);
  // 첨부 이미지 변화를 부모에 통보 — Attach 버튼 dim 등 외부 동기화용.
  useEffect(() => {
    onAttachedChange?.(images);
  }, [images, onAttachedChange]);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 줄바꿈 발생 시 textarea 가 세로로 자라도록 — 최대 3줄. 그 이상은 자체 스크롤.
  // value 변경 때마다 height='auto' 로 리셋 후 scrollHeight 측정해 max 와 비교.
  // overflow-y 는 3줄 안일 땐 hidden(스크롤바 미표시), 초과 시에만 auto.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const cs = getComputedStyle(ta);
    const lineHeight = parseFloat(cs.lineHeight) || 24;
    const padTop = parseFloat(cs.paddingTop) || 0;
    const padBottom = parseFloat(cs.paddingBottom) || 0;
    const borderTop = parseFloat(cs.borderTopWidth) || 0;
    const borderBottom = parseFloat(cs.borderBottomWidth) || 0;
    const maxH = lineHeight * 3 + padTop + padBottom + borderTop + borderBottom;
    const scrollH = ta.scrollHeight;
    const next = Math.min(scrollH, maxH);
    ta.style.height = `${next}px`;
    ta.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
  }, [value]);

  useImperativeHandle(ref, () => ({
    attachImageDataUrls(urls: string[], names: string[] = []) {
      setImages((prev) => [...prev, ...urls].slice(0, MAX_FILES));
      setImageNames((prev) =>
        [...prev, ...urls.map((_, i) => names[i] ?? '')].slice(0, MAX_FILES),
      );
      setTimeout(() => textareaRef.current?.focus(), 50);
    },
  }));

  function submit() {
    const text = value.trim();
    if (disabled) return;
    // 텍스트 입력은 필수. 이미지만 첨부된 상태에서는 전송 안함.
    if (!text) return;
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
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  async function onPick(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    const remaining = Math.max(0, MAX_FILES - images.length);
    const batch = files.slice(0, remaining);
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

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
    setImageNames((prev) => prev.filter((_, i) => i !== idx));
  }

  // 이미지 첨부 여부와 무관하게 — 텍스트가 비어있으면 Send 비활성. 이미지만 보내는 케이스는 허용 안함.
  const sendDisabled = disabled || !value.trim();

  return (
    <div className="relative px-4 py-2">
      {/* 이미지 첨부 미리보기 — InputBar 높이에 영향을 주지 않도록 absolute 로 띄움.
          입력창 위쪽 border 선은 첨부 여부와 관계없이 같은 위치를 유지하고,
          이미지는 그 선을 넘어 위쪽 채팅 영역으로 살짝 올라가 보이게 한다. */}
      {images.length > 0 && (
        <div className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] left-4 right-4 z-10 flex gap-2 overflow-x-auto pb-1">
          {images.map((src, i) => (
            <div
              key={i}
              className="pointer-events-auto relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-border bg-secondary shadow-[0_6px_16px_rgba(0,0,0,0.55)]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={src}
                alt={`첨부 ${i + 1}`}
                className="h-full w-full object-cover"
              />
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

      <div className="flex items-end gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || images.length >= MAX_FILES}
              aria-label={t('input.attach')}
              className={cn(
                'h-10 w-10 shrink-0 rounded-full border border-primary/40 bg-card text-primary shadow-md hover:bg-accent hover:text-primary disabled:opacity-100 disabled:border-border disabled:bg-card disabled:text-muted-foreground/60',
                images.length > 0 &&
                  'border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground disabled:bg-primary disabled:text-primary-foreground',
              )}
              aria-pressed={images.length > 0}
            >
              <ImagePlus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">{t('input.attachTooltip')}</TooltipContent>
        </Tooltip>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          hidden
          onChange={onPick}
        />

        <Textarea
          ref={textareaRef}
          value={value}
          rows={1}
          placeholder={t('input.placeholder')}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          // height 는 useEffect 에서 컨텐츠 기준 동적 세팅. 3줄 초과 시 내부 스크롤.
          // height 변화를 transition 에 포함해 줄바꿈 시 자연스럽게 확장/축소.
          className={cn(
            // overflow-y 는 useEffect 가 컨텐츠 길이에 따라 hidden/auto 로 토글.
            'min-h-[40px] flex-1 resize-none overflow-y-hidden rounded-2xl bg-secondary shadow-md transition-[height,transform] duration-200 ease-out',
            pulse && '-translate-y-1 scale-[0.98]',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        />

        {/* 스트리밍 중에는 Send 버튼이 Stop으로 토글된다. 같은 자리, 다른 동작/스타일.
            items-end 컨테이너라 h-8 버튼은 h-10 아이콘 버튼 대비 중심선이 4px 낮음 → mb-1 로 보정. */}
        {isStreaming && onStop ? (
          <Button
            type="button"
            variant="destructive"
            onClick={onStop}
            size="icon"
            className="mb-1 h-8 w-8 shrink-0 rounded-full"
            title="Stop"
            aria-label="Stop"
          >
            <Square className="h-3 w-3 fill-current" />
          </Button>
        ) : (
          <Button
            type="button"
            onClick={submit}
            disabled={sendDisabled}
            className="mb-1 h-8 shrink-0 gap-1 rounded-full px-3 text-[12px]"
          >
            <SendHorizonal className="h-3.5 w-3.5" />
            {t('input.send')}
          </Button>
        )}

        {typeof liveTokRate === 'number' && liveTokRate > 0 && (
          <span
            className="shrink-0 rounded-full bg-secondary px-2 py-1 text-[10.5px] font-medium tabular-nums text-muted-foreground animate-in fade-in duration-200"
            title="응답 생성 속도 (실시간 추정)"
          >
            {liveTokRate.toFixed(1)} tok/s
          </span>
        )}
      </div>
    </div>
  );
});

export default InputBar;
