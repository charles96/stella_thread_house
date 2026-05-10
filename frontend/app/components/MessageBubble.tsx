'use client';

import { Children, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import {
  AlertTriangle,
  Ban,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  ExternalLink,
  Globe,
  ImageIcon,
  ImagePlus,
  Pin,
  PinOff,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { hydrateImageStates, setImageState } from '@/lib/imageCache';
import { extractArtifacts, type Artifact } from '@/lib/artifacts';
import {
  dedentTableRows,
  fixKoreanEmphasis,
  normalizeFlattenedTables,
  styleCitations,
} from '@/lib/markdown';
import ImageLightbox from './ImageLightbox';
import { useI18n } from '@/lib/i18n';
import { MermaidView, SvgView } from './ArtifactPanel';
import type { Message, ReadPageImage, SearchImage } from './ChatRoom';

function extractCodeText(children: ReactNode): string {
  const arr = Children.toArray(children);
  if (arr.length === 0) return '';
  const first = arr[0];
  if (typeof first === 'string') return first;
  if (typeof first === 'object' && first !== null && 'props' in first) {
    const inner = (first as { props: { children?: ReactNode } }).props.children;
    if (typeof inner === 'string') return inner.replace(/\n$/, '');
    if (Array.isArray(inner)) {
      return inner
        .map((c) => (typeof c === 'string' ? c : ''))
        .join('')
        .replace(/\n$/, '');
    }
  }
  return '';
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function onClick(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('clipboard 복사 실패', err);
    }
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? '복사됨' : '복사'}
      aria-label={copied ? '복사됨' : '코드 복사'}
      className={cn(
        'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-secondary/80 text-muted-foreground opacity-60 transition-opacity hover:bg-secondary hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100',
        copied && 'border-primary/60 bg-primary/15 text-primary opacity-100',
      )}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function imageDedupKey(u: string): string {
  try {
    let url = new URL(u);
    // CORP 우회용 백엔드 프록시(/page/img-proxy?url=<원본>)는 쿼리의 원본 URL로 환원해
    // dedup 한다. 그렇지 않으면 모든 프록시 URL이 같은 path 라 충돌.
    if (/\/page\/img-proxy$/i.test(url.pathname)) {
      const orig = url.searchParams.get('url');
      if (orig) {
        try {
          url = new URL(orig);
        } catch {
          // ignore — fall through with original url
        }
      }
    }
    // 호스트 + 경로 기반 + 파일명 — 쿼리스트링/리사이즈 변형은 무시.
    const last = url.pathname.split('/').filter(Boolean).pop() ?? '';
    // 대표 파일명에서 사이즈 변형(_640x480, -200x300, _w1024) 제거
    const stripped = last
      .toLowerCase()
      .replace(/[_-]\d{2,4}x\d{2,4}(?=\.|$)/, '')
      .replace(/[_-]w\d{2,4}(?=\.|$)/, '')
      .replace(/-(?:thumb|small|medium|large|xl)(?=\.|$)/, '');
    return `${url.host.toLowerCase()}|${stripped}`;
  } catch {
    return u.toLowerCase();
  }
}

// 사용자 메시지 텍스트에서 http(s) URL 을 찾아 클릭 가능한 anchor 로 치환.
// 그 외 텍스트는 그대로 유지하여 whitespace-pre-wrap 으로 줄바꿈/공백 보존.
function linkifyText(text: string): ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s<>"'`]+)/g;
  // URL 끝의 흔한 마침표/쉼표/괄호 등은 본문 구두점일 가능성이 높아 분리.
  const trim = (u: string) => {
    const m = u.match(/^(.*?)([.,;:!?)\]}>"']+)$/);
    return m ? { url: m[1], trail: m[2] } : { url: u, trail: '' };
  };
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let match: RegExpExecArray | null;
  while ((match = urlRegex.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const { url, trail } = trim(match[0]);
    out.push(
      <a
        key={`u${i++}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className="break-all underline underline-offset-2 hover:opacity-80"
      >
        {url}
      </a>,
    );
    if (trail) out.push(trail);
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function FetchIcon({ className }: { className?: string }) {
  // 일반 fetch 단계용: 다운로드 화살표 풀스
  return (
    <svg
      viewBox="0 0 28 28"
      className={cn('shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="14" cy="14" r="10" strokeOpacity="0.3" />
      <path d="M 14 14 m -5 0 a 5 5 0 0 1 10 0">
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 14 14"
          to="360 14 14"
          dur="0.9s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}

function TavilyIcon({ className }: { className?: string }) {
  // 지구본 + 회전하는 돋보기. Tavily 키워드 검색 단계용.
  return (
    <svg
      viewBox="0 0 28 28"
      className={cn('shrink-0', className)}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* 지구본 */}
      <circle cx="11" cy="13" r="6.5" strokeOpacity="0.55" />
      <ellipse cx="11" cy="13" rx="6.5" ry="2.6" strokeOpacity="0.55" />
      <path d="M 11 6.5 V 19.5" strokeOpacity="0.55" />
      <path d="M 4.5 13 H 17.5" strokeOpacity="0.55" />
      {/* 데이터 포인트 (깜빡임) */}
      <circle cx="8" cy="11" r="0.9" fill="currentColor" stroke="none">
        <animate
          attributeName="opacity"
          values="0.3;1;0.3"
          dur="1.4s"
          begin="0s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="14" cy="14" r="0.9" fill="currentColor" stroke="none">
        <animate
          attributeName="opacity"
          values="0.3;1;0.3"
          dur="1.4s"
          begin="0.4s"
          repeatCount="indefinite"
        />
      </circle>
      <circle cx="11" cy="16.5" r="0.9" fill="currentColor" stroke="none">
        <animate
          attributeName="opacity"
          values="0.3;1;0.3"
          dur="1.4s"
          begin="0.8s"
          repeatCount="indefinite"
        />
      </circle>
      {/* 돋보기 (지구본 위에서 도는 듯한 효과) */}
      <g style={{ transformOrigin: '11px 13px' }}>
        <circle
          cx="20"
          cy="9"
          r="2.5"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <line
          x1="22"
          y1="11"
          x2="24.5"
          y2="13.5"
          stroke="currentColor"
          strokeWidth="1.7"
        />
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 11 13"
          to="360 11 13"
          dur="3.2s"
          repeatCount="indefinite"
        />
      </g>
    </svg>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isTavily = /tavily|웹 검색|search/i.test(status);
  let Icon = FetchIcon;
  let palette =
    'border border-border bg-background/40 text-muted-foreground';
  if (isTavily) {
    Icon = TavilyIcon;
    palette =
      'border border-sky-400/60 bg-gradient-to-r from-sky-400/15 to-sky-400/5 text-sky-300 shadow-[0_2px_10px_rgba(56,189,248,0.25)]';
  }
  return (
    <div
      className={cn(
        'mt-2 inline-flex items-center gap-2 self-start rounded-lg px-3 py-1.5 text-[12.5px] font-medium animate-in fade-in slide-in-from-left-1 duration-200',
        palette,
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="leading-none">{status}</span>
    </div>
  );
}

function urlKind(url: string): { kind: 'youtube' | 'web'; label: string } {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, '');
    if (host === 'youtube.com' || host === 'youtu.be') {
      return { kind: 'youtube', label: 'YouTube' };
    }
  } catch {
    // ignore parse errors — fallback to web
  }
  return { kind: 'web', label: 'Web' };
}

function UrlKindIcon({ url }: { url: string }) {
  const { kind, label } = urlKind(url);
  if (kind === 'youtube') {
    // 둥근 사각형(테두리=text-muted-foreground) + 빨간 재생 삼각형.
    return (
      <svg
        viewBox="0 0 24 24"
        className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-label={label}
        role="img"
      >
        <rect
          x="2.5"
          y="6"
          width="19"
          height="12"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path d="M10.5 9.3 L15.5 12 L10.5 14.7 Z" fill="#ef4444" />
      </svg>
    );
  }
  return (
    <Globe
      className="h-3.5 w-3.5 shrink-0 text-primary"
      aria-label={label}
    />
  );
}

// 파비콘 우선 표시. 로드 실패 시 사이트 종류 아이콘으로 폴백.
function SiteIcon({ url }: { url: string }) {
  const [errored, setErrored] = useState(false);
  let host: string | null = null;
  try {
    host = new URL(url).hostname;
  } catch {
    // ignore
  }
  if (errored || !host) {
    return <UrlKindIcon url={url} />;
  }
  return (
    /* eslint-disable-next-line @next/next/no-img-element */
    <img
      src={`https://www.google.com/s2/favicons?domain=${host}&sz=32`}
      alt=""
      width={14}
      height={14}
      className="h-3.5 w-3.5 shrink-0 rounded-sm bg-card object-contain"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
    />
  );
}

interface RefItem {
  url: string;
  title?: string;
  // chars/ok 는 페이지 본문이 추출된 항목에만 있음 — 검색결과만 있고 추출 안된 항목은 undefined.
  chars?: number;
  ok?: boolean;
  // 추출 경로 — fetch(자체) / tavily. 이름표로 노출.
  source?: 'fetch' | 'tavily';
  images?: ReadPageImage[];
}

function ReadPageRow({ page: p, index }: { page: RefItem; index: number }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [maxChars, setMaxChars] = useState<number | null>(null);

  const fullTitle = p.title || p.url;
  const extracted = typeof p.chars === 'number';
  const okFlag = p.ok ?? true;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      // 한국어 기준 평균 문자 폭 ~10px (12px font, 약간의 zenkaku 비례).
      // 보수적으로 9.6px 기준으로 계산해 약간 짧게 유지.
      const w = el.clientWidth;
      if (w <= 0) return;
      const chars = Math.max(4, Math.floor(w / 9.6));
      setMaxChars(chars);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const display =
    maxChars != null && fullTitle.length > maxChars
      ? fullTitle.slice(0, Math.max(1, maxChars - 1)) + '…'
      : fullTitle;

  return (
    <li className="flex w-full items-center gap-1.5 text-[12px]">
      <span className="inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-sm border border-primary/40 bg-primary/10 px-1 font-mono text-[10.5px] tabular-nums leading-none text-primary">
        {index + 1}
      </span>
      {extracted && !okFlag && (
        <Ban
          className="h-3.5 w-3.5 shrink-0 text-destructive/80"
          aria-label="읽기 실패"
        />
      )}
      <SiteIcon url={p.url} />
      <div ref={wrapRef} className="min-w-0 flex-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className={cn(
                'block whitespace-nowrap hover:underline',
                extracted && !okFlag
                  ? 'text-muted-foreground line-through'
                  : 'text-foreground',
              )}
            >
              {display}
            </a>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            align="start"
            className="max-w-[480px] break-words text-[12px] leading-relaxed"
          >
            <div className="font-medium">{fullTitle}</div>
            {p.title && p.url && p.title !== p.url && (
              <div className="mt-0.5 text-[10.5px] text-muted-foreground">
                {p.url}
              </div>
            )}
          </TooltipContent>
        </Tooltip>
      </div>
      {/* 추출 경로 배지 — fetch 는 기본이라 생략, tavily 만 노출 */}
      {p.source === 'tavily' && (
        <span className="shrink-0 rounded bg-amber-500/15 px-1 py-0.5 text-[9.5px] font-medium text-amber-500">
          Tavily
        </span>
      )}
      {extracted && okFlag && (
        <span className="shrink-0 tabular-nums text-[10.5px] text-muted-foreground">
          {(p.chars ?? 0).toLocaleString()}자
        </span>
      )}
    </li>
  );
}

function ImageScatter({
  images,
  cardOverlap,
  onCardClick,
  onInvalid,
  onRemove,
  indexed = false,
  forcePoker = false,
  page: externalPage,
  onPageChange,
}: {
  images: SearchImage[];
  cardOverlap: number;
  onCardClick: (globalIndex: number) => void;
  onInvalid: (src: string) => void;
  onRemove?: (url: string) => void;
  // true 면 각 카드 좌상단에 1-based 인덱스 배지 노출 (본문 [N] 인용과 매칭).
  indexed?: boolean;
  // true 면 이미지가 1장이어도 single-image fallback 대신 포커 카드 UI 사용.
  forcePoker?: boolean;
  // 부모에서 page state 를 lift-up 하면 unmount/remount 후에도 페이지 보존.
  page?: number;
  onPageChange?: (next: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [perPage, setPerPage] = useState(7);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // 가로형 카드(landscape)는 w-28(112px), 세로형은 w-[5.5rem](88px). 혼합 케이스에서
    // 행 폭 계산이 실제 너비와 어긋나 overflow → 인접 표 깨짐. worst-case(112) 기준으로 계산해 항상 적합.
    const CARD_W = 112;
    const SAFE_MARGIN = 12; // 회전/jitter 여유
    const update = () => {
      const w = el.clientWidth - SAFE_MARGIN;
      // n=1: CARD_W. n>=2: CARD_W + (n-1)*(CARD_W - cardOverlap)
      const step = Math.max(1, CARD_W - cardOverlap);
      const n = Math.max(1, Math.floor((w - CARD_W) / step) + 1);
      setPerPage(n);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cardOverlap]);

  const PER_PAGE = perPage;
  const totalPages = Math.max(1, Math.ceil(images.length / PER_PAGE));
  // 외부 page 가 주어지면 그것을 사용 (controlled). 아니면 내부 state.
  const [internalPage, setInternalPage] = useState(0);
  const page = externalPage ?? internalPage;
  const setPage = (next: number | ((prev: number) => number)) => {
    if (onPageChange) {
      const v =
        typeof next === 'function'
          ? (next as (p: number) => number)(page)
          : next;
      onPageChange(v);
    } else {
      setInternalPage(next);
    }
  };
  // 삭제 등으로 totalPages 가 줄어 현재 page 가 범위 밖으로 나갈 때만 보정.
  useEffect(() => {
    if (page > totalPages - 1) {
      setPage(Math.max(0, totalPages - 1));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);
  const safePage = Math.min(page, totalPages - 1);

  // 이전에 한 번이라도 렌더된 이미지 URL — 등장 애니메이션은 처음 등장에만 적용.
  // 페이지 이동(<, >)으로 다시 보일 때는 애니메이션 없이 즉시 노출.
  // localStorage 캐시에 loaded 마크가 있으면 마운트 시 미리 채워서 재방문 시 애니메이션 생략.
  const animatedRef = useRef<Set<string>>(
    new Set(
      Array.from(hydrateImageStates(images.map((i) => i.url)).entries())
        .filter(([, s]) => s.loaded)
        .map(([k]) => k),
    ),
  );

  // 카드별 비율 추적 — onLoad 에서 자연 가로/세로 비교 후 'landscape'/'portrait' 저장.
  // 캐시된 orient 가 있으면 마운트 즉시 반영해 layout shift 방지.
  const [orientations, setOrientations] = useState<
    Map<string, 'landscape' | 'portrait'>
  >(() => {
    const m = new Map<string, 'landscape' | 'portrait'>();
    for (const [url, s] of hydrateImageStates(images.map((i) => i.url))) {
      if (s.orient) m.set(url, s.orient);
    }
    return m;
  });
  const markOrientation = (src: string, kind: 'landscape' | 'portrait') => {
    setOrientations((prev) => {
      if (prev.get(src) === kind) return prev;
      const next = new Map(prev);
      next.set(src, kind);
      return next;
    });
    setImageState(src, { orient: kind });
  };
  const [loaded, setLoaded] = useState<Set<string>>(() => {
    const set = new Set<string>();
    for (const [url, s] of hydrateImageStates(images.map((i) => i.url))) {
      if (s.loaded) set.add(url);
    }
    return set;
  });
  const markLoaded = (src: string) => {
    setLoaded((prev) => {
      if (prev.has(src)) return prev;
      const next = new Set(prev);
      next.add(src);
      return next;
    });
    setImageState(src, { loaded: true });
  };

  const canPrev = safePage > 0;
  const canNext = safePage < totalPages - 1;

  // 결정적 의사 jitter (회전·세로 오프셋)
  const angles = [-13, -7, -3, 4, -9, 8, 12, -5, 10, 2];
  const yJitter = [0, -6, 4, -2, 6, -8, 1, -4, 5, -3];

  // 이미지가 1개일 때는 포커 카드 회전 없이 큰 이미지 한 장으로 표시.
  // 단, indexed 또는 forcePoker 면 단일 이미지도 포커 카드 UI 유지 — 다른 스캐터와 비주얼 일관성.
  if (images.length === 1 && !indexed && !forcePoker) {
    const img = images[0];

    // YouTube 단일 결과는 iframe 임베드로 즉시 재생 가능하게.
    if (img.kind === 'youtube') {
      const idFromLink =
        img.linkUrl?.match(/[?&]v=([A-Za-z0-9_-]{6,15})/)?.[1];
      const idFromThumb = img.url?.match(
        /\/vi\/([A-Za-z0-9_-]{6,15})\//,
      )?.[1];
      const videoId = idFromLink ?? idFromThumb;
      if (videoId) {
        return (
          <div ref={containerRef} className="mb-2">
            <div className="relative aspect-video w-full max-w-2xl overflow-hidden rounded-lg border border-border bg-black shadow-[0_4px_12px_rgba(0,0,0,0.3)]">
              <iframe
                src={`https://www.youtube.com/embed/${videoId}`}
                title={img.sourceTitle ?? 'YouTube video'}
                className="absolute inset-0 h-full w-full"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            </div>
          </div>
        );
      }
    }

    const isXEmpty = img.kind === 'x' && !img.url;
    const isLoaded = isXEmpty ? true : loaded.has(img.url);
    const handleClick = () => {
      if (isXEmpty && img.linkUrl) {
        window.open(img.linkUrl, '_blank', 'noopener,noreferrer');
        return;
      }
      onCardClick(0);
    };
    return (
      <div ref={containerRef} className="mb-2">
        <button
          type="button"
          onClick={handleClick}
          title={[
            img.kind === 'youtube'
              ? `YouTube · ${img.linkUrl ?? ''}`
              : img.kind === 'x'
                ? `X · ${img.linkUrl ?? ''}`
                : (img.sourceTitle ?? '크게 보기'),
            img.analysis?.description
              ? `\n[AI 분석 · ${img.analysis.relevant ? '관련' : '무관'}]\n${img.analysis.description}`
              : '',
          ]
            .filter(Boolean)
            .join('')}
          className={cn(
            'group relative inline-block max-w-full overflow-hidden rounded-lg bg-transparent shadow-[0_4px_12px_rgba(0,0,0,0.3)] transition-shadow duration-200 hover:shadow-[0_6px_16px_rgba(0,0,0,0.4)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
            img.analyzing && 'vision-glow',
          )}
        >
          {isXEmpty ? (
            <span className="flex h-72 w-72 items-center justify-center bg-black text-white">
              <span className="text-7xl font-bold leading-none">𝕏</span>
            </span>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={img.url}
              alt={img.sourceTitle ?? '이미지'}
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={() => onInvalid(img.url)}
              onLoad={(e) => {
                const el = e.currentTarget as HTMLImageElement;
                if (
                  img.kind !== 'youtube' &&
                  (el.naturalWidth < 200 || el.naturalHeight < 200)
                ) {
                  onInvalid(img.url);
                  return;
                }
                markLoaded(img.url);
              }}
              className={cn(
                'block h-auto max-h-96 w-auto max-w-full cursor-zoom-in',
                'transition-opacity duration-200',
                isLoaded ? 'opacity-100' : 'opacity-0',
              )}
            />
          )}
          {img.kind === 'youtube' && (
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600/90 text-white shadow-lg">
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="ml-0.5 h-7 w-7"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </span>
            </span>
          )}
          {img.analysis && (
            <span
              className="pointer-events-none absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-primary drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
              aria-label={
                img.analysis.relevant ? 'AI 분석: 관련' : 'AI 분석: 무관'
              }
            >
              <Eye
                className={cn(
                  'h-3.5 w-3.5',
                  !img.analysis.relevant && 'opacity-60',
                )}
              />
            </span>
          )}
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="mb-2">
      {totalPages > 1 && (
        <div className="mb-1 flex items-center justify-end gap-1 text-muted-foreground">
          <button
            type="button"
            onClick={() => canPrev && setPage((p) => p - 1)}
            disabled={!canPrev}
            aria-label="이전 페이지"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-secondary disabled:pointer-events-none disabled:opacity-30"
          >
            <span className="text-base">&lt;</span>
          </button>
          <button
            type="button"
            onClick={() => canNext && setPage((p) => p + 1)}
            disabled={!canNext}
            aria-label="다음 페이지"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-secondary disabled:pointer-events-none disabled:opacity-30"
          >
            <span className="text-base">&gt;</span>
          </button>
        </div>
      )}

      <div
        className="flex flex-nowrap items-end pb-2 pt-8"
        style={{ overflowY: 'visible' }}
      >
        {/* 페이지 이동 시 off-page 이미지를 DOM 에서 제거하지 않고 hidden 으로만 숨김.
            이렇게 하면 <img> 가 unmount 되지 않아 페이지 왕복해도 깜빡임/재로딩 없음. */}
        {images.map((img, globalIndex) => {
          const cardPage = Math.floor(globalIndex / PER_PAGE);
          const onPage = cardPage === safePage;
          // 현재 페이지 내 위치 인덱스 — margin-left 계산용.
          const inPageIdx = globalIndex - cardPage * PER_PAGE;
          const i = inPageIdx;
          const rot = angles[globalIndex % angles.length];
          const ty = yJitter[globalIndex % yJitter.length];
          const ml = i === 0 ? 0 : -cardOverlap;
          const isXEmpty = img.kind === 'x' && !img.url;
          const isLoaded = isXEmpty ? true : loaded.has(img.url);
          const handleClick = () => {
            // X 카드는 라이트박스 의미가 없으니 새 탭으로 직접 이동.
            if (isXEmpty && img.linkUrl) {
              window.open(img.linkUrl, '_blank', 'noopener,noreferrer');
              return;
            }
            onCardClick(globalIndex);
          };
          // 처음 보는 카드인지 — 처음일 때만 등장 애니메이션 부여, 이후 페이징은 즉시 노출.
          const cardKey = img.url || img.linkUrl || `${globalIndex}`;
          const isFirstAppear = !animatedRef.current.has(cardKey);
          animatedRef.current.add(cardKey);

          return (
            <div
              key={`${img.url || img.linkUrl || globalIndex}`}
              style={{
                marginLeft: ml,
                display: onPage ? undefined : 'none',
              }}
              className={cn(
                'group/card relative shrink-0',
                onPage &&
                  isFirstAppear &&
                  'animate-in fade-in zoom-in-50 slide-in-from-top-16 duration-500 ease-out',
              )}
            >
            {/* Transform wrapper — 카드와 × 버튼이 같은 회전·hover 변환을 공유. */}
            <div
              style={{
                transform: `rotate(${rot}deg) translateY(${ty}px)`,
              }}
              className={cn(
                'group relative origin-bottom transition-transform duration-300 ease-out',
                'group-hover/card:z-50 group-hover/card:!translate-y-[-12px] group-hover/card:!rotate-0 group-hover/card:!scale-[1.18]',
              )}
            >
            {indexed && (
              <span className="pointer-events-none absolute left-1 top-1 z-[2] inline-flex h-4 min-w-[18px] items-center justify-center rounded-sm border border-primary/40 bg-card px-1 font-mono text-[10.5px] tabular-nums leading-none text-primary shadow-sm">
                {globalIndex + 1}
              </span>
            )}
            <button
              type="button"
              onClick={handleClick}
              title={[
                img.kind === 'youtube'
                  ? `YouTube · ${img.linkUrl ?? ''}`
                  : img.kind === 'x'
                    ? `X · ${img.linkUrl ?? ''}`
                    : (img.sourceTitle ?? '크게 보기'),
                img.analysis?.description
                  ? `\n[AI 분석 · ${img.analysis.relevant ? '관련' : '무관'}]\n${img.analysis.description}`
                  : '',
              ]
                .filter(Boolean)
                .join('')}
              className={cn(
                'block overflow-hidden rounded-lg bg-secondary/40 shadow-[0_6px_10px_rgba(0,0,0,0.5)] transition-[box-shadow,opacity] duration-300 ease-out group-hover/card:shadow-[0_16px_22px_rgba(0,0,0,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                // 비율 기반 카드 dim — YouTube/X 또는 가로형 이미지는 가로 카드(112×88), 세로형은 세로 카드(88×112).
                img.kind === 'youtube' ||
                  img.kind === 'x' ||
                  orientations.get(img.url) === 'landscape'
                  ? 'h-[5.5rem] w-28'
                  : 'h-28 w-[5.5rem]',
                isLoaded ? 'opacity-100' : 'opacity-0',
                // 로딩이 완료된 카드만 팝콘 터지듯 살짝 튀는 등장 모션.
                // 처음 보는 카드(=캐시 hit 아님)일 때만 애니메이션 — 다른 thread 갔다 돌아와도 재실행 X.
                isLoaded && isFirstAppear && 'animate-card-pop',
                img.analyzing && 'vision-glow',
              )}
            >
              {!isLoaded && (
                <span className="absolute inset-0 animate-pulse bg-gradient-to-br from-secondary/60 via-secondary/30 to-secondary/60" />
              )}
              {isXEmpty ? (
                <span className="absolute inset-0 flex items-center justify-center bg-black text-white">
                  <span className="text-3xl font-bold leading-none">𝕏</span>
                </span>
              ) : (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={img.url}
                  alt={img.sourceTitle ?? `이미지 ${globalIndex + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => onInvalid(img.url)}
                  onLoad={(e) => {
                    const el = e.currentTarget as HTMLImageElement;
                    if (
                      img.kind !== 'youtube' &&
                      (el.naturalWidth < 200 || el.naturalHeight < 200)
                    ) {
                      onInvalid(img.url);
                      return;
                    }
                    markOrientation(
                      img.url,
                      el.naturalWidth >= el.naturalHeight
                        ? 'landscape'
                        : 'portrait',
                    );
                    markLoaded(img.url);
                  }}
                  className="relative h-full w-full cursor-zoom-in object-fill"
                />
              )}
              {img.kind === 'youtube' && (
                <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600/90 text-white shadow-lg">
                    <svg
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="ml-0.5 h-4 w-4"
                    >
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </span>
                </span>
              )}
              {img.analysis && (
                <span
                  className="pointer-events-none absolute right-1 top-1 flex h-5 w-5 items-center justify-center text-primary drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]"
                  aria-label={
                    img.analysis.relevant
                      ? 'AI 분석: 관련'
                      : 'AI 분석: 무관'
                  }
                >
                  <Eye
                    className={cn(
                      'h-3.5 w-3.5',
                      !img.analysis.relevant && 'opacity-60',
                    )}
                  />
                </span>
              )}
            </button>
            {/* × 는 일반 이미지 카드에서만 노출 — YouTube/X 카드는 영상·외부 링크라 "삭제" 의미가 약함.
                또한 removable === false 로 명시된 카드(예: 사용자 첨부 이미지) 도 제외. */}
            {onRemove &&
              !isXEmpty &&
              img.kind !== 'youtube' &&
              img.kind !== 'x' &&
              img.removable !== false && (
                <button
                  type="button"
                  onMouseDown={(e) => {
                    // 클릭 시 포커스 이동으로 페이지가 스크롤되는 현상 방지.
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(img.url);
                  }}
                  title="이미지 제거"
                  aria-label="이미지 제거"
                  className="absolute right-1 top-1 z-[2] flex h-5 w-5 items-center justify-center rounded-full border border-primary/40 bg-card text-primary shadow-md transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ImageGroup({
  index,
  group,
  cardOverlap,
  onCardClick,
  onInvalid,
}: {
  index: number;
  group: { sourceUrl: string; sourceTitle?: string; images: SearchImage[] };
  cardOverlap: number;
  onCardClick: (img: SearchImage) => void;
  onInvalid: (src: string) => void;
}) {
  const angles = [-9, -5, -2, 2, 5, 9, -7, 4];
  const hasSource = !!group.sourceUrl;
  return (
    <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 pb-4 pt-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-md bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-foreground">
            {group.sourceTitle ?? group.sourceUrl ?? '검색 이미지'}
          </div>
          {hasSource && (
            <a
              href={group.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex max-w-full items-center gap-1 truncate text-[11px] text-muted-foreground hover:text-foreground"
              title={group.sourceUrl}
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{group.sourceUrl}</span>
            </a>
          )}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">
          {group.images.length}장
        </span>
      </div>
      <div
        className="overflow-x-auto pb-1 pt-6"
        style={{ overflowY: 'visible' }}
      >
        <div className="flex flex-nowrap items-center pl-2">
          {group.images.map((img, i) => {
            const rot = angles[i % angles.length];
            const ml = i === 0 ? 0 : -cardOverlap;
            return (
              <button
                key={`${i}-${img.url}`}
                type="button"
                onClick={() => onCardClick(img)}
                title={img.sourceTitle ?? group.sourceTitle ?? '크게 보기'}
                style={{
                  transform: `rotate(${rot}deg)`,
                  marginLeft: ml,
                }}
                className="group relative h-28 w-[5.5rem] shrink-0 origin-bottom overflow-hidden rounded-lg drop-shadow-[0_6px_8px_rgba(0,0,0,0.45)] transition-[transform,filter] duration-200 ease-out hover:z-50 hover:!translate-y-[-10px] hover:!rotate-0 hover:!scale-[1.18] hover:drop-shadow-[0_14px_18px_rgba(0,0,0,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.sourceTitle ?? `이미지 ${i + 1}`}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => onInvalid(img.url)}
                  onLoad={(e) => {
                    const el = e.currentTarget as HTMLImageElement;
                    if (el.naturalWidth < 200 || el.naturalHeight < 200) {
                      onInvalid(img.url);
                    }
                  }}
                  className="h-full w-full cursor-zoom-in object-fill"
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ArtifactCard({
  kind,
  code,
  onClick,
  active,
}: {
  kind: 'mermaid' | 'svg';
  code: string;
  onClick: () => void;
  active: boolean;
}) {
  const label = kind === 'mermaid' ? 'Mermaid 다이어그램' : 'SVG 그래픽';
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        'group my-2 flex w-full cursor-pointer flex-col overflow-hidden rounded-lg border border-border bg-secondary/30 transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        active && 'border-primary/60 bg-primary/10',
      )}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5">
        <ImageIcon className="h-3.5 w-3.5 text-primary" />
        <span className="flex-1 text-[12px] font-medium text-foreground">
          {label}
        </span>
        <span className="text-[10.5px] text-muted-foreground">
          크게 보기
        </span>
        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />
      </div>
      <div className="relative h-56 w-full bg-background">
        <div className="pointer-events-none absolute inset-0">
          {kind === 'mermaid' ? (
            <div className="flex h-full items-center justify-center overflow-hidden p-3">
              {/* key 없이 — 스트리밍 중 code 가 바뀌어도 remount 되지 않도록.
                  내부 useEffect 가 dep 로 안정적으로 갱신 처리. */}
              <MermaidView code={code} />
            </div>
          ) : (
            <div className="flex h-full items-center justify-center overflow-hidden p-3 [&_svg]:max-h-full [&_svg]:max-w-full">
              <SvgView code={code} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const markdownClass = cn(
  'prose-sm max-w-none break-words text-bubble-bot-foreground',
  '[&_h1]:mt-2 [&_h1]:mb-1 [&_h1]:text-[17px] [&_h1]:font-bold',
  '[&_h2]:mt-2 [&_h2]:mb-1 [&_h2]:text-base [&_h2]:font-bold',
  '[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-[15px] [&_h3]:font-bold',
  '[&_h4]:font-bold [&_h5]:font-bold [&_h6]:font-bold',
  '[&_p]:my-1.5',
  '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5',
  '[&_ol]:my-1.5 [&_ol]:list-decimal [&_ol]:pl-5',
  '[&_li]:my-0.5 [&_li>p]:my-0',
  // 강조 (bold) — 굵은 글씨 + primary 톤 텍스트만으로 본문에서 부상.
  '[&_strong]:font-bold [&_strong]:text-primary',
  // 이탤릭 — 톤은 살짝 다르게(secondary foreground 계열) + 약간 약한 색.
  '[&_em]:italic [&_em]:text-foreground/85 [&_em]:underline [&_em]:decoration-dotted [&_em]:decoration-primary/50 [&_em]:underline-offset-2',
  '[&_a]:text-sky-300 [&_a]:underline',
  '[&_code]:rounded [&_code]:bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[12.5px] [&_code]:font-mono',
  '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-[#073642] [&_pre]:p-3 [&_pre]:text-zinc-100 [&_pre]:shadow-[0_4px_14px_rgba(0,0,0,0.35)]',
  '[&_pre_code]:block [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[12.5px]',
  '[&_blockquote]:my-2 [&_blockquote]:rounded-sm [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:bg-secondary/40 [&_blockquote]:py-1 [&_blockquote]:pl-3 [&_blockquote]:pr-2 [&_blockquote]:text-muted-foreground',
  '[&_hr]:my-3 [&_hr]:border-border',
  '[&_table]:my-2 [&_table]:border-collapse [&_table]:text-[13px]',
  '[&_th]:border [&_th]:border-border [&_th]:bg-secondary/60 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left',
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
  '[&_img]:my-2 [&_img]:max-w-full [&_img]:rounded-md [&_img]:border [&_img]:border-border',
  '[&>:first-child]:mt-0 [&>:last-child]:mb-0',
);

export default function MessageBubble({
  message,
  onOpenArtifact,
  activeArtifactId,
  onAttachImage,
  isFresh = false,
  onFollowup,
  isCollapsibleTurn = false,
  isCollapsed = false,
  onToggleCollapse,
  onDeleteTurn,
  onRemoveImage,
  isVisionInFlight = false,
  precedingUserImages,
  precedingUserImageNames,
  onRemovePrecedingUserImage,
}: {
  message: Message;
  onOpenArtifact?: (a: Artifact) => void;
  activeArtifactId?: string | null;
  onAttachImage?: (url: string) => void;
  isFresh?: boolean;
  onFollowup?: (text: string) => void;
  // user msg에 응답이 있어 접기/펼치기가 가능한 turn인지
  isCollapsibleTurn?: boolean;
  // 현재 접힘 상태인지
  isCollapsed?: boolean;
  // 접힘/펼침 토글 (user msg 클릭 시 호출)
  onToggleCollapse?: () => void;
  // 이 user msg의 turn(질문+답변) 삭제
  onDeleteTurn?: () => void;
  // References 이미지 카드에서 × 버튼으로 제거
  onRemoveImage?: (url: string) => void;
  // 첨부 이미지가 비전으로 처리 중인지 — true 면 페이드 펄스.
  isVisionInFlight?: boolean;
  // assistant 메시지의 경우, 직전 user 메시지에 첨부된 이미지 — References 위에 노출.
  precedingUserImages?: string[];
  // 위 이미지의 원본 파일명 (있는 경우) — References 라벨에서 사용.
  precedingUserImageNames?: string[];
  // 위 이미지 카드의 × 버튼으로 직전 user 메시지에서 해당 이미지를 제거.
  onRemovePrecedingUserImage?: (url: string) => void;
}) {
  const { t } = useI18n();
  const isUser = message.role === 'user';
  const [override, setOverride] = useState<boolean | null>(null);
  const [contentEverArrived, setContentEverArrived] = useState(
    !isUser && !!message.content,
  );
  useEffect(() => {
    if (!isUser && message.content && !contentEverArrived) {
      setContentEverArrived(true);
    }
  }, [isUser, message.content, contentEverArrived]);
  // 본문이 도착하는 순간 사용자 토글 상태도 초기화 → 자동으로 접혀서 원래 컴팩트 상태로
  useEffect(() => {
    if (contentEverArrived) setOverride(null);
  }, [contentEverArrived]);
  const hasThinkingText = !isUser && !!message.thinking;
  // References 통합 리스트 — sources(전체 검색결과 N건) 가 있으면 canonical 순서로 사용,
  // 없으면 readPages 만. readPages 매칭은 URL 로 — 추출된 항목은 chars/ok 정보가 함께 보임.
  const referencesList: RefItem[] = useMemo(() => {
    if (isUser) return [];
    const sources = message.sources ?? [];
    const readPages = message.readPages ?? [];
    if (sources.length === 0) {
      return readPages.map((p) => ({
        url: p.url,
        title: p.title,
        chars: p.chars,
        ok: p.ok,
        source: p.source,
        images: p.images,
      }));
    }
    const rpByUrl = new Map(readPages.map((p) => [p.url, p]));
    return sources.map((s) => {
      const rp = rpByUrl.get(s.url);
      return {
        url: s.url,
        title: rp?.title ?? s.title,
        chars: rp?.chars,
        source: rp?.source,
        ok: rp?.ok,
        images: rp?.images,
      };
    });
  }, [isUser, message.sources, message.readPages]);
  const hasReadPagesData = !isUser && referencesList.length > 0;
  const hasPrecedingUserImages =
    !isUser &&
    !!precedingUserImages &&
    precedingUserImages.length > 0;
  // 비전 분석이 일어난(또는 일어날) 메시지인지:
  // 1) 사용자가 이미지를 첨부했거나 vision 토글을 켠 경우 → visionContext 플래그
  // 2) URL 직접 모드의 readPages 이미지 중 분석 중/완료된 항목 존재
  const isVisioning =
    !isUser &&
    (!!message.visionContext ||
      (message.readPages?.some(
        (p) => p.images?.some((i) => i.analyzing || i.analysis),
      ) ?? false));
  const thinkingLabel = isVisioning ? t('bot.visioning') : t('bot.thinking');
  const ThinkingIcon = isVisioning ? Eye : Sparkles;
  // 합쳐진 처리 패널: 생각 과정 또는 읽은 페이지 둘 중 하나라도 있으면 표시
  // 진행 중 status도 패널 안에 표시되도록 포함.
  const hasStatusPending =
    !isUser && !!message.status && !message.content;
  // thinking 만 있고 readPages 도 없는 경우 — 본문이 도착하면(=thinking 종료) 패널·연결선 모두 숨긴다.
  const hasProcessPanel =
    hasReadPagesData ||
    hasPrecedingUserImages ||
    hasStatusPending ||
    (hasThinkingText && !contentEverArrived);
  const isStreaming = !isUser && !contentEverArrived;
  // 스트리밍 중에는 자동 펼침, 본문 도착 후에는 자동으로 접힘 (사용자 클릭으로 다시 펼침 가능)
  const autoOpen = isStreaming && hasProcessPanel;
  const open = override ?? autoOpen;
  const toggle = () => setOverride(!open);

  const artifacts = useMemo(
    () => (isUser ? [] : extractArtifacts(message.content, message.id)),
    [isUser, message.content, message.id],
  );

  const renderedContent = useMemo(() => {
    if (isUser) return message.content;
    // 모델이 가끔 본문에 사고 과정 헤더를 적는 경우 제거.
    const stripped = message.content.replace(
      /^[\s>]*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:\[?\s*(?:생각\s*과정|사고\s*과정|분석|thinking)\s*\]?\s*)(?:\*\*|__)?\s*[:：]?\s*$\n?/gim,
      '',
    );
    return styleCitations(
      fixKoreanEmphasis(
        normalizeFlattenedTables(dedentTableRows(stripped)),
      ),
    );
  }, [isUser, message.content]);

  // invalid 마크는 localStorage 에 캐시 — 재방문 시 깨진 이미지를 다시 로드 시도하지 않음.
  // 마운트 시 message 의 모든 이미지 URL 을 hydrate.
  const [invalidSrcs, setInvalidSrcs] = useState<Set<string>>(() => {
    const urls: string[] = [];
    for (const u of message.images ?? []) urls.push(u);
    for (const im of message.searchImages ?? []) urls.push(im.url);
    for (const p of message.readPages ?? [])
      for (const im of p.images ?? []) urls.push(im.src);
    const set = new Set<string>();
    for (const [url, s] of hydrateImageStates(urls)) {
      if (s.invalid) set.add(url);
    }
    return set;
  });
  const markInvalid = (src: string) => {
    setInvalidSrcs((prev) => {
      if (prev.has(src)) return prev;
      const next = new Set(prev);
      next.add(src);
      return next;
    });
    setImageState(src, { invalid: true });
  };

  const uniqueSearchImages = useMemo<SearchImage[]>(() => {
    const list = message.searchImages ?? [];
    const seen = new Set<string>();
    const out: SearchImage[] = [];
    for (const img of list) {
      if (invalidSrcs.has(img.url)) continue;
      const key = imageDedupKey(img.url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(img);
    }
    return out;
  }, [message.searchImages, invalidSrcs]);

  const CARD_OVERLAP = 14;

  const imageGroups = useMemo(() => {
    const map = new Map<
      string,
      { sourceUrl: string; sourceTitle?: string; images: SearchImage[] }
    >();
    const orphans: SearchImage[] = [];
    for (const img of uniqueSearchImages) {
      if (img.sourceUrl) {
        const key = img.sourceUrl;
        let g = map.get(key);
        if (!g) {
          g = {
            sourceUrl: key,
            sourceTitle: img.sourceTitle,
            images: [],
          };
          map.set(key, g);
        }
        g.images.push(img);
      } else {
        orphans.push(img);
      }
    }
    return { groups: Array.from(map.values()), orphans };
  }, [uniqueSearchImages]);

  // 라이트박스 인덱스 매핑: 그룹별 이미지를 평면 순서로
  const flatOrder = useMemo<SearchImage[]>(() => {
    const arr: SearchImage[] = [];
    for (const g of imageGroups.groups) arr.push(...g.images);
    arr.push(...imageGroups.orphans);
    return arr;
  }, [imageGroups]);

  function indexOfImage(img: SearchImage): number {
    return flatOrder.findIndex((x) => x.url === img.url);
  }

  const galleryImages = useMemo<SearchImage[]>(() => {
    if (isUser) {
      return (message.images ?? []).map((u) => ({ url: u }));
    }
    return flatOrder;
  }, [isUser, message.images, flatOrder]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const openLightbox = (i: number) => setLightboxIndex(i);
  const closeLightbox = () => setLightboxIndex(null);

  const readPageImagesFlat = useMemo<SearchImage[]>(() => {
    if (isUser) return [];
    const out: SearchImage[] = [];
    const seen = new Set<string>();
    // 1) 페이지에서 직접 추출한 이미지
    for (const p of message.readPages ?? []) {
      if (!p.images) continue;
      for (const img of p.images) {
        // 미리보기 이미지 영역이므로 X 트윗처럼 실제 이미지 URL 이 없는 항목은 제외.
        if (img.kind === 'x' && !img.src) continue;
        if (img.kind !== 'x' && invalidSrcs.has(img.src)) continue;
        // X는 src가 비어있을 수 있어 linkUrl을 기준으로 dedup.
        const dedupKey = img.linkUrl
          ? `${img.kind ?? 'image'}:${img.linkUrl}`
          : imageDedupKey(img.src);
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        // YouTube hq/sd default 는 4:3 letterbox 가 박혀있어 카드에서 검은 줄로 보임 → 진짜 16:9 인 mqdefault 로 정규화.
        const normalizedUrl =
          img.kind === 'youtube'
            ? img.src.replace(/\/(hq|sd)default\.jpg/, '/mqdefault.jpg')
            : img.src;
        out.push({
          url: normalizedUrl,
          sourceUrl: img.linkUrl ?? p.url,
          sourceTitle: img.alt || p.title,
          kind: img.kind,
          linkUrl: img.linkUrl,
          analyzing: img.analyzing && !img.analysis,
          analysis: img.analysis,
        });
      }
    }
    // 2) Tavily 검색이 가져온 이미지도 위쪽 포커 카드 리스트에 통합
    for (const img of message.searchImages ?? []) {
      if (invalidSrcs.has(img.url)) continue;
      const dedupKey = imageDedupKey(img.url);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      out.push({
        url: img.url,
        sourceUrl: img.sourceUrl,
        sourceTitle: img.sourceTitle,
      });
    }
    return out;
  }, [isUser, message.readPages, message.searchImages, invalidSrcs]);
  const [readPageLightbox, setReadPageLightbox] = useState<number | null>(null);
  // 포커 카드 클릭 시 라이트박스 대신 채팅 화면 안에서 인라인 확대.
  // 값은 combinedImages 의 인덱스 (attached + readPages 합친 순서).
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(
    null,
  );
  // YouTube 핀 모드 — true 면 영상이 viewport 상단에 fixed 로 고정. 스크롤 방향 무관 항상 따라옴.
  // X 축은 클릭 시점의 인라인 위치 그대로 유지 → Y 만 변동. 핀 즉시 fixed → 자연 위치는 placeholder 로 메꿈.
  const [isYoutubePinned, setIsYoutubePinned] = useState(false);
  const inlineVideoBoxRef = useRef<HTMLDivElement>(null);
  const [reservedHeight, setReservedHeight] = useState(0);
  // 핀 시작 시 인라인 박스의 left X 와 width 를 캡처. fixed 로 빠질 때 동일한 위치/크기 유지.
  const [pinnedLeft, setPinnedLeft] = useState<number | null>(null);
  const [pinnedWidth, setPinnedWidth] = useState<number | null>(null);
  useEffect(() => {
    if (!isYoutubePinned) return;
    const update = () => {
      const box = inlineVideoBoxRef.current;
      if (box && box.offsetHeight > 0) setReservedHeight(box.offsetHeight);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isYoutubePinned, expandedImageIndex]);
  // 카드의 × 클릭 시 — 라이트박스 열지 않고, 채팅창 안에서 직접 삭제 확인 다이얼로그를 띄움.
  const [pendingDeleteUrl, setPendingDeleteUrl] = useState<string | null>(null);
  // ImageScatter 의 현재 페이지를 부모에서 보존 — 확대 보기/삭제 후 ImageScatter 가
  // unmount→remount 되어도 페이지가 0 으로 리셋되지 않게.
  const [scatterPage, setScatterPage] = useState(0);
  // 1장만 있을 때 자동 클릭 트리거 — 같은 url 에 대해선 한번만 발화 (사용자가 닫으면 다시 안 열림).
  const autoExpandedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (isUser) return;
    const attached = (precedingUserImages ?? []).length;
    const total = attached + readPageImagesFlat.length;
    if (total === 1 && expandedImageIndex === null) {
      const key =
        attached === 1
          ? (precedingUserImages ?? [])[0]
          : readPageImagesFlat[0]?.url;
      if (key && autoExpandedKeyRef.current !== key) {
        autoExpandedKeyRef.current = key;
        setExpandedImageIndex(0);
      }
    } else if (total !== 1) {
      autoExpandedKeyRef.current = null;
    }
  }, [
    isUser,
    precedingUserImages,
    readPageImagesFlat,
    expandedImageIndex,
  ]);
  const mdComponents = useMemo<Components>(() => {
    return {
      a({ href, children, ...rest }) {
        const isExternal =
          typeof href === 'string' && /^https?:\/\//i.test(href);
        return (
          <a
            href={href}
            {...(isExternal
              ? { target: '_blank', rel: 'noopener noreferrer' }
              : {})}
            {...rest}
          >
            {children}
          </a>
        );
      },
      img({ src, alt, ...rest }) {
        if (!src) return null;
        return (
          // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
          <img
            src={src as string}
            alt={typeof alt === 'string' ? alt : ''}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = 'none';
            }}
            {...rest}
          />
        );
      },
      // 넓은 표는 버블 폭을 넘어가면 자체 가로 스크롤. 한국어가 글자 단위로
      // 세로로 쪼개지지 않도록 cell 에 `word-break: keep-all` (단어/구절 단위로만
      // 줄바꿈) 을 적용 — `whitespace-nowrap` 은 줄바꿈 자체를 막아 버블을 화면 밖으로
      // 밀어버려 사용 안 함.
      table({ children, ...rest }) {
        return (
          // 테이블 가독성 강화 — 헤더 배경 강조 + 짝수 행 zebra striping + 호버 하이라이트
          // + primary 톤 외곽 보더로 본문 텍스트와 시각적 분리.
          // 사면 padding 으로 그림자가 그려질 공간을 모두 확보.
          <div className="my-3 w-full max-w-full overflow-x-auto px-2 py-2">
            <table
              {...rest}
              className={cn(
                // table-auto + min-w-full — 컬럼은 컨텐츠 너비로 늘어나며, 컨테이너가 더 넓으면 채움.
                // 줄바꿈은 단어/한글 구절 단위로만 발생, 가로가 넘치면 외곽 wrapper 의 overflow-x-auto 가 스크롤.
                'min-w-full w-auto table-auto border-collapse text-[13px] shadow-[0_2px_10px_rgba(0,0,0,0.18)]',
                // 헤더: primary 컬러 배경 + 두꺼운 글씨 + 한 줄 (헤더는 보통 짧음 → nowrap).
                '[&_thead]:bg-primary/15',
                '[&_th]:border [&_th]:border-primary/30 [&_th]:bg-primary/15 [&_th]:text-primary [&_th]:font-semibold [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:whitespace-nowrap [&_th]:text-left',
                // 본문 셀: 옅은 보더, 짝수 행 zebra, 호버 하이라이트. break-keep 으로 단어 단위 줄바꿈만.
                '[&_td]:border [&_td]:border-border/70 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:break-keep [&_td]:align-top',
                '[&_tbody_tr:nth-child(even)]:bg-secondary/30',
                '[&_tbody_tr:hover]:bg-primary/10 [&_tbody_tr]:transition-colors',
              )}
            >
              {children}
            </table>
          </div>
        );
      },
      pre({ children, className, ...rest }) {
        const arr = Children.toArray(children);
        const first = arr[0];
        if (first && typeof first === 'object' && 'props' in first) {
          const cls =
            (first as { props: { className?: string } }).props.className ?? '';
          if (/language-(mermaid|svg)/i.test(cls)) {
            return <>{children}</>;
          }
        }
        const text = extractCodeText(children);
        return (
          <div className="group relative my-2">
            <pre
              className={cn(
                // 두 테마 모두 동일 — Solarized base02 (#073642) 터미널 배경 + 옅은 글씨.
                'overflow-x-auto rounded-md border border-border bg-[#073642] p-3 pr-12 text-[12.5px] text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.35)]',
                className,
              )}
              {...rest}
            >
              {children}
            </pre>
            {text && <CopyButton text={text} />}
          </div>
        );
      },
      code({ className, children, ...props }) {
        const lang = /language-(\w+)/.exec(className ?? '')?.[1]?.toLowerCase();
        if (lang === 'mermaid' || lang === 'svg') {
          const code = String(children).replace(/\n$/, '');
          const kind: 'mermaid' | 'svg' = lang === 'mermaid' ? 'mermaid' : 'svg';
          const art = artifacts.find(
            (a) => a.kind === kind && a.code === code.trim(),
          );
          return (
            <ArtifactCard
              kind={kind}
              code={code}
              onClick={() => art && onOpenArtifact?.(art)}
              active={art?.id === activeArtifactId}
            />
          );
        }
        // inline vs block code: react-markdown v9+ sets className for block
        const isInline = !className;
        if (isInline) {
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        }
        return (
          <code className={className} {...props}>
            {children}
          </code>
        );
      },
    };
  }, [artifacts, onOpenArtifact, activeArtifactId]);

  const thinkRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && isStreaming && thinkRef.current) {
      thinkRef.current.scrollTop = thinkRef.current.scrollHeight;
    }
  }, [message.thinking, open, isStreaming]);


  return (
    <>
    <div
      className={cn(
        'flex gap-3 my-2 min-w-0 max-w-full',
        isUser ? 'justify-end' : 'justify-start',
        isFresh &&
          isUser &&
          'animate-in fade-in slide-in-from-bottom-8 zoom-in-95 duration-500 ease-out',
      )}
    >
      {!isUser && (
        <Avatar>
          <AvatarFallback>S</AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn(
          'flex flex-col',
          isUser ? 'max-w-[92%]' : 'min-w-0 flex-1',
        )}
      >
        {!isUser && (
          <div className="mb-1 ml-1 flex items-baseline gap-2">
            <span className="font-doodle text-base font-semibold text-foreground">
              {t('bot.name')}
            </span>
            {message.time && (
              <span className="text-[10.5px] tabular-nums text-muted-foreground">
                {message.time}
              </span>
            )}
          </div>
        )}

        {/* 사용자 메시지의 첨부 이미지는 user 버블에서 숨기고 assistant 버블의 References 위 영역에서 표시.
            (precedingUserImages 가 그쪽에서 동일한 카드 UI 로 렌더됨.) */}

        {/* 이미지 영역 — 첨부 이미지 + 검색 이미지를 한 줄(하나의 포커 스캐터) 로 통합.
            카드 클릭 시 라이트박스 대신 인라인으로 큰 이미지 한 장만 노출 (나머지 숨김).
            큰 이미지 클릭 시 다시 스캐터로 복귀. */}
        {!isUser && (() => {
          const attachedSlice: SearchImage[] = (precedingUserImages ?? []).map(
            (src) => ({ url: src, removable: false }),
          );
          const combinedImages: SearchImage[] = [
            ...attachedSlice,
            ...readPageImagesFlat,
          ];
          const attachedCount = attachedSlice.length;
          const hasAny = combinedImages.length > 0;
          // 1장 / N장 모두 동일 흐름: 항상 포커 카드 → 클릭 → 확대 → 닫기 → 포커 카드.
          const usePoker = true;
          const expanded =
            expandedImageIndex !== null
              ? combinedImages[expandedImageIndex] ?? null
              : null;
          if (!hasAny) return null;
          // 확대 모드 — 스캐터 자리에 큰 이미지 한 장. 클릭하면 다시 스캐터로 복귀.
          if (expanded) {
            const youtubeId = (() => {
              if (expanded.kind !== 'youtube') return null;
              const idFromLink = expanded.linkUrl?.match(
                /[?&]v=([A-Za-z0-9_-]{6,15})/,
              )?.[1];
              const idFromThumb = expanded.url?.match(
                /\/vi\/([A-Za-z0-9_-]{6,15})\//,
              )?.[1];
              return idFromLink ?? idFromThumb ?? null;
            })();
            const isYouTube = !!youtubeId;

            const stuck = isYouTube && isYoutubePinned;
            return (
              <div className="mb-6 animate-in fade-in zoom-in-95 duration-200 max-w-full overflow-x-clip">
                {/* placeholder — 핀 모드일 때 wrapper 가 fixed 로 빠지므로 같은 높이를 차지해 layout 흔들림 방지. */}
                {stuck && reservedHeight > 0 && (
                  <div style={{ height: reservedHeight }} aria-hidden />
                )}
                <div
                  className={cn(
                    'flex justify-center',
                    stuck && 'fixed top-[76px] z-30 transition-none',
                  )}
                  style={
                    stuck && pinnedLeft !== null
                      ? { left: pinnedLeft }
                      : undefined
                  }
                >
                <div
                  className={cn(
                    'relative pr-20',
                    // YouTube 는 컨테이너 폭에 맞춰 줄어들도록 block + w-full 사용 (max 800px).
                    // 단, stuck 시엔 fixed 부모가 viewport 폭이 되므로 캡처된 width 를 inline style 로 강제.
                    isYouTube
                      ? stuck
                        ? ''
                        : 'w-full max-w-[800px]'
                      : 'inline-block max-w-full',
                  )}
                  style={
                    isYouTube && stuck && pinnedWidth !== null
                      ? { width: pinnedWidth + 80 }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    onClick={() => {
                      setExpandedImageIndex(null);
                      setIsYoutubePinned(false);
                    }}
                    title={t('image.postit.close')}
                    className="absolute right-1 top-3 z-20 inline-flex -rotate-6 items-center gap-1 rounded-md border border-primary/40 bg-card px-2 py-0.5 text-[11px] font-medium text-primary shadow-md transition-transform hover:rotate-0 hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <X className="h-3 w-3" />
                    {t('image.postit.close')}
                  </button>
                  {onRemoveImage &&
                    expanded.kind !== 'youtube' &&
                    expanded.kind !== 'x' &&
                    expanded.removable !== false && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          // 즉시 삭제 대신 채팅창 안 확인 다이얼로그로 통일.
                          setPendingDeleteUrl(expanded.url);
                        }}
                        title={t('image.postit.delete')}
                        className="absolute right-1 top-12 z-20 inline-flex rotate-3 items-center gap-1 rounded-md border border-destructive/50 bg-card px-2 py-0.5 text-[11px] font-medium text-destructive shadow-md transition-transform hover:rotate-0 hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                        {t('image.postit.delete')}
                      </button>
                    )}
                  {onAttachImage &&
                    expanded.kind !== 'youtube' &&
                    expanded.kind !== 'x' && (
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          onAttachImage(expanded.url);
                        }}
                        title={t('image.postit.attach')}
                        className="absolute right-1 top-[5.25rem] z-20 inline-flex -rotate-3 items-center gap-1 rounded-md border border-primary/40 bg-card px-2 py-0.5 text-[11px] font-medium text-primary shadow-md transition-transform hover:rotate-0 hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <ImagePlus className="h-3 w-3" />
                        {t('image.postit.attach')}
                      </button>
                    )}
                  {isYouTube && (
                    <button
                      type="button"
                      onClick={() => {
                        if (isYoutubePinned) {
                          setIsYoutubePinned(false);
                          return;
                        }
                        // 핀 ON 직전, 인라인 박스의 화면상 left/width 를 캡처 → fixed 로 빠져도 위치/크기 유지.
                        const box = inlineVideoBoxRef.current;
                        if (box) {
                          const rect = box.getBoundingClientRect();
                          setPinnedLeft(rect.left);
                          setPinnedWidth(rect.width);
                        }
                        setIsYoutubePinned(true);
                      }}
                      title={
                        isYoutubePinned
                          ? t('image.postit.unpin')
                          : t('image.postit.pin')
                      }
                      className="absolute right-1 top-12 z-20 inline-flex rotate-3 items-center gap-1 rounded-md border border-primary/40 bg-card px-2 py-0.5 text-[11px] font-medium text-primary shadow-md transition-transform hover:rotate-0 hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      {isYoutubePinned ? (
                        <PinOff className="h-3 w-3" />
                      ) : (
                        <Pin className="h-3 w-3" />
                      )}
                      {isYoutubePinned
                        ? t('image.postit.unpin')
                        : t('image.postit.pin')}
                    </button>
                  )}

                  {/* 미디어 자리 — iframe/img. sticky 모드면 부모 wrapper 자체가 sticky top:0 으로 따라옴.
                      YouTube 는 부모(block) 의 폭을 그대로 따르도록 w-full, 이미지는 자연 크기 inline-block. */}
                  <div
                    className={cn(
                      'relative z-10 overflow-hidden rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.5)]',
                      isYouTube ? 'w-full' : 'inline-block max-w-full',
                    )}
                  >
                    {youtubeId ? (
                      <div
                        ref={inlineVideoBoxRef}
                        className="relative aspect-video w-full bg-black"
                      >
                        <iframe
                          src={`https://www.youtube.com/embed/${youtubeId}`}
                          title={expanded.sourceTitle ?? 'YouTube'}
                          className="absolute inset-0 h-full w-full"
                          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                        />
                      </div>
                    ) : (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={expanded.url}
                        alt={expanded.sourceTitle ?? '이미지'}
                        referrerPolicy="no-referrer"
                        className="block h-auto max-h-[480px] w-auto max-w-full object-contain"
                      />
                    )}
                  </div>
                </div>
                </div>
              </div>
            );
          }
          // 기본 — 포커 카드 스캐터.
          return (
            <ImageScatter
              images={combinedImages}
              cardOverlap={CARD_OVERLAP}
              // 첨부/웹 이미지 모두 동일하게 인라인 확대 — 별도 라이트박스 없음.
              onCardClick={(i) => setExpandedImageIndex(i)}
              onInvalid={markInvalid}
              forcePoker={usePoker}
              page={scatterPage}
              onPageChange={setScatterPage}
              onRemove={
                onRemoveImage
                  ? (url) => {
                      if (attachedSlice.some((a) => a.url === url)) return;
                      // 상세 라이트박스 거치지 않고 채팅창 안에서 바로 확인 다이얼로그.
                      setPendingDeleteUrl(url);
                    }
                  : undefined
              }
            />
          );
        })()}

        {hasProcessPanel && (
          <div
            className={cn(
              'w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-secondary/95 p-2.5 shadow-md backdrop-blur-sm animate-in fade-in duration-200',
              // 답변과 점선으로 이어주는 경우는 mb 제거, 그 외는 1.5.
              message.content ? 'mb-0' : 'mb-1.5',
              // 스캐터일 때 카드 하단을 패널 라운드가 1/3쯤 가리도록 겹쳐 올림.
              // 모든 케이스(검색 이미지 / 첨부 이미지 / 1장 / N장) 통일 — forcePoker=true 로 항상 포커 카드.
              // 인라인 확대 모드(expandedImageIndex !== null)에서는 큰 이미지 하단이 잘리니 비활성화.
              expandedImageIndex === null &&
                (readPageImagesFlat.length >= 1 ||
                  (precedingUserImages?.length ?? 0) >= 1) &&
                'relative z-10 -mt-14',
            )}
          >
            <div className="flex items-center gap-1.5 text-[11.5px] font-medium text-muted-foreground">
              {hasReadPagesData || hasPrecedingUserImages ? (
                <>
                  <BookOpen
                    className={cn(
                      'h-3.5 w-3.5 text-primary',
                      isStreaming && 'animate-pulse',
                    )}
                    aria-hidden
                  />
                  <span>{t('message.refs')}</span>
                </>
              ) : hasStatusPending ? (
                <>
                  <Globe className="h-3.5 w-3.5 animate-pulse text-primary" />
                  <span>{t('message.processing')}</span>
                </>
              ) : (
                <>
                  <ThinkingIcon className="h-3.5 w-3.5 text-primary" />
                  <span>{thinkingLabel}</span>
                </>
              )}
              {hasThinkingText && (
                <button
                  type="button"
                  onClick={toggle}
                  className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10.5px] font-normal text-muted-foreground hover:text-foreground"
                  title={thinkingLabel}
                >
                  <ThinkingIcon className="h-3 w-3 text-primary" />
                  <span>
                    {thinkingLabel}
                    {isStreaming ? ` ${t('bot.thinkingWriting')}` : ''}
                  </span>
                  {open ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
              )}
            </div>

            {/* 1) 사용자 첨부 이미지 — Reference documents 와 동일 형식의 번호 리스트.
                포커 카드는 패널 위쪽(검색 이미지 영역)에 별도 스캐터로 노출됨. */}
            {hasPrecedingUserImages && (
              <ul className="mt-1.5 ml-1.5 flex w-full flex-col gap-0.5 border-l-2 border-primary/30 pl-3">
                {precedingUserImages!.map((_, i) => {
                  const rawName = precedingUserImageNames?.[i] ?? '';
                  // 너무 길면 가운데 잘림 — 기본 truncate 는 끝만 잘려 확장자 정보가 사라짐.
                  // 30자 초과 시 앞 22 + … + 마지막 5(확장자 포함) 형태로.
                  const displayName = (() => {
                    if (!rawName) return '';
                    if (rawName.length <= 30) return rawName;
                    return `${rawName.slice(0, 22)}…${rawName.slice(-5)}`;
                  })();
                  const label = displayName
                    ? displayName
                    : `${t('image.attached')} ${i + 1}`;
                  return (
                    <li
                      key={i}
                      className="flex w-full items-center gap-1.5 text-[12px]"
                    >
                      <span className="inline-flex h-4 min-w-[18px] shrink-0 items-center justify-center rounded-sm border border-primary/40 bg-primary/10 px-1 font-mono text-[10.5px] tabular-nums leading-none text-primary">
                        {i + 1}
                      </span>
                      <ImageIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <button
                        type="button"
                        // 라벨 클릭도 인라인 확대 — 첨부 이미지는 combinedImages 배열 앞부분(0..attachedCount-1).
                        onClick={() => setExpandedImageIndex(i)}
                        className="min-w-0 flex-1 truncate text-left text-foreground hover:underline"
                        title={rawName || t('input.attachTooltip')}
                      >
                        {label}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 2) References (웹 링크) — 첨부 이미지 아래에 위치, 인용 번호는 첨부 이미지 다음으로 이어짐. */}
            {hasReadPagesData && (
              <TooltipProvider delayDuration={200}>
                {/* BookOpen 아이콘 중앙(content-x ≈ 7px)에 맞춰 세로 가이드 라인.
                    ml-1.5(6px) + border-l(2px)로 위쪽 아이콘 중앙과 정렬, pl-3로 항목 본문은 충분히 들여씀. */}
                <ul className="mt-1.5 ml-1.5 flex w-full flex-col gap-0.5 border-l-2 border-primary/30 pl-3">
                  {referencesList.map((r, i) => (
                    <ReadPageRow
                      key={r.url}
                      page={r}
                      index={i + (precedingUserImages?.length ?? 0)}
                    />
                  ))}
                </ul>
              </TooltipProvider>
            )}

            {/* 2) 진행 상태 — 웹 링크 아래에 표시 (URL 처리/Tavily 폴백 단계) */}
            {hasStatusPending && (
              <div className="mt-2">
                <StatusBadge status={message.status!} />
              </div>
            )}

            {/* 3) think 본문 — open 토글 시 max-height + opacity 로 부드럽게 열고 닫힘 */}
            {hasThinkingText && (
              <div
                className={cn(
                  'grid transition-all duration-300 ease-out',
                  open
                    ? 'mt-2 grid-rows-[1fr] opacity-100'
                    : 'mt-0 grid-rows-[0fr] opacity-0',
                )}
              >
                <div className="overflow-hidden">
                  <div
                    ref={thinkRef}
                    className={cn(
                      'max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-dashed p-2.5 text-[12.5px] leading-relaxed text-muted-foreground',
                      isStreaming
                        ? 'border-primary/60 bg-primary/5'
                        : 'border-border bg-background/40',
                    )}
                  >
                    {message.thinking}
                    {isStreaming && (
                      <span className="ml-0.5 inline-block animate-caret-blink text-primary">
                        ▋
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* References 패널과 답변 패널 사이를 자연스러운 곡선 + 양 끝 도트로 연결.
            SVG 베지어 곡선으로 살짝 휘어 hand-drawn 느낌, 도트는 또렷하게 보이도록 primary 풀톤. */}
        {hasProcessPanel && message.content && (
          <div
            aria-hidden
            className="relative z-20 -my-2 flex w-full justify-center"
          >
            <svg
              width="14"
              height="34"
              viewBox="0 0 14 34"
              className="overflow-visible"
            >
              <defs>
                {/* 도트와 선 모두에 부드러운 drop-shadow 음영. */}
                <filter
                  id="ref-connector-shadow"
                  x="-50%"
                  y="-50%"
                  width="200%"
                  height="200%"
                >
                  <feDropShadow
                    dx="0"
                    dy="1"
                    stdDeviation="1.2"
                    floodColor="rgba(0,0,0,0.45)"
                  />
                </filter>
              </defs>
              <g filter="url(#ref-connector-shadow)">
                {/* 위쪽 halo + core 도트 — 패널 위에 살짝 걸치는 위치 */}
                <circle cx="7" cy="5" r="5" fill="hsl(var(--primary) / 0.18)" />
                <circle
                  cx="7"
                  cy="5"
                  r="2.5"
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--background))"
                  strokeWidth="1"
                />
                {/* 살짝 휘어진 곡선 — 가운데 부분에서 좌→우로 미세하게 흔들리는 S 곡선 */}
                <path
                  d="M 7 8 C 11 14, 3 20, 7 26"
                  stroke="hsl(var(--primary) / 0.7)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  fill="none"
                />
                {/* 아래쪽 halo + core 도트 */}
                <circle cx="7" cy="29" r="5" fill="hsl(var(--primary) / 0.18)" />
                <circle
                  cx="7"
                  cy="29"
                  r="2.5"
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--background))"
                  strokeWidth="1"
                />
              </g>
            </svg>
          </div>
        )}


        {/* 초기 대기 (status도 thinking도 아직 없을 때) — 사용자가 기다리는 걸 알 수 있도록 */}
        {!isUser &&
          !message.content &&
          !message.status &&
          !hasThinkingText &&
          !hasReadPagesData && (
            <div className="mb-1.5 inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-secondary/60 px-3 py-1 text-[12px] text-muted-foreground">
              <Sparkles className="h-3 w-3 animate-pulse text-primary" />
              <span>응답 준비 중…</span>
              <span className="inline-flex h-3 items-center gap-0.5">
                <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:0ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:150ms]" />
                <span className="h-1 w-1 animate-bounce rounded-full bg-muted-foreground [animation-delay:300ms]" />
              </span>
            </div>
          )}

        <div
          className={cn(
            'flex flex-col',
            isUser ? 'items-end' : 'items-stretch',
          )}
        >
          {message.content && isUser && (
            <>
              <div className="group/bubble relative rounded-2xl rounded-tr-md bg-bubble-user px-3.5 py-2 text-[14.5px] leading-relaxed text-bubble-user-foreground shadow-sm">
                <span className="whitespace-pre-wrap break-words">
                  {linkifyText(message.content)}
                  {onDeleteTurn && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTurn();
                      }}
                      title="이 질문과 답변 삭제"
                      className={cn(
                        'absolute -right-8 top-1/2 h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md transition-opacity hover:bg-destructive/90',
                        isCollapsed
                          ? 'flex opacity-100'
                          : 'hidden group-hover/bubble:flex',
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </div>
              {message.time && (
                <span className="mt-1 mr-1 text-[10.5px] tabular-nums text-muted-foreground">
                  {message.time}
                </span>
              )}
            </>
          )}

          {/* 어시스턴트 답변: 버블 그 자체 + 하단 우측에 포스트잇 해시태그 행 */}
          {message.content && !isUser && (
            <>
              <div className="w-full min-w-0 max-w-full overflow-x-hidden rounded-2xl rounded-tl-md border border-border bg-bubble-bot px-3.5 py-2 text-[14.5px] leading-relaxed text-bubble-bot-foreground shadow-md">
                <div className={cn(markdownClass, 'min-w-0 max-w-full')}>
                  <ReactMarkdown
                    remarkPlugins={[
                      // 한국어에서 `~` 는 범위 구분자(예: "17세기 후반~18세기", "숙종~영조") 로
                      // 자주 쓰여 GFM 의 단일-tilde strikethrough 가 오작동. 표준 `~~text~~` 만 허용.
                      [remarkGfm, { singleTilde: false }],
                      remarkMath,
                    ]}
                    rehypePlugins={[
                      rehypeRaw,
                      [rehypeKatex, { throwOnError: false, strict: false }],
                    ]}
                    components={mdComponents}
                  >
                    {renderedContent}
                  </ReactMarkdown>
                </div>
              </div>
              {message.hashtagsGenerating &&
                !(message.hashtags && message.hashtags.length > 0) && (
                  <div className="mt-2 flex justify-end self-end pl-8">
                    <span className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-secondary/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-[0_2px_4px_rgba(0,0,0,0.2)]">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
                      Creating hashtags...
                    </span>
                  </div>
                )}
              {message.hashtags && message.hashtags.length > 0 && (
                <div className="mt-2 flex flex-wrap justify-end gap-1.5 self-end pl-8">
                  {message.hashtags.slice(0, 8).map((tag, i) => {
                    const rotations = [-2, 1.5, -1, 2, -1.5, 1, -2.5, 0.5];
                    const rot = rotations[i % rotations.length];
                    return (
                      <Tooltip key={i}>
                        <TooltipTrigger asChild>
                          <span
                            style={{ transform: `rotate(${rot}deg)` }}
                            className="inline-block max-w-[180px] cursor-default truncate whitespace-nowrap rounded-sm border border-primary/30 bg-primary/15 px-2 py-0.5 text-[11px] font-medium text-primary shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-transform duration-200 hover:!rotate-0 hover:!scale-110"
                          >
                            {tag}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top">{tag}</TooltipContent>
                      </Tooltip>
                    );
                  })}
                  {message.hashtags.length > 8 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-block cursor-default whitespace-nowrap rounded-sm border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground shadow-[0_2px_4px_rgba(0,0,0,0.25)]">
                          +{message.hashtags.length - 8}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[280px]">
                        {message.hashtags.slice(8).join(' ')}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              )}
            </>
          )}
        </div>


        {!isUser &&
          message.followupGenerating &&
          !(message.followup && message.followup.options.length > 0) && (
            <div className="mt-2 inline-flex items-center gap-1.5 self-start rounded-lg border border-border bg-secondary/40 px-3 py-2 text-[12.5px] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <DotsLoading />
            </div>
          )}
        {!isUser &&
          message.followup &&
          message.followup.options.length > 0 && (
            <div className="mt-2 rounded-lg border border-border bg-secondary/30 p-3 shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300">
              {message.followup.question && (
                <div className="mb-2 flex items-center gap-1.5 text-[12.5px] text-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span>{message.followup.question}</span>
                </div>
              )}
              <div className="flex flex-col items-start gap-1.5">
                {message.followup.options.map((opt, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onFollowup?.(opt)}
                    className="max-w-full rounded-2xl rounded-tl-md border border-primary/40 bg-bubble-user px-3.5 py-1.5 text-left text-[13px] font-medium text-bubble-user-foreground shadow-sm transition-transform hover:translate-x-1 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary animate-in fade-in slide-in-from-left-2 duration-300"
                    style={{ animationDelay: `${i * 60}ms` }}
                    title="이 답으로 보내기"
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          )}
      </div>

      {lightboxIndex !== null && galleryImages.length > 0 && (
        <ImageLightbox
          images={galleryImages}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={closeLightbox}
          onAttach={
            onAttachImage
              ? (url) => {
                  onAttachImage(url);
                  closeLightbox();
                }
              : undefined
          }
        />
      )}

      {readPageLightbox !== null && readPageImagesFlat.length > 0 && (
        <ImageLightbox
          images={readPageImagesFlat}
          index={readPageLightbox}
          onIndexChange={(i) => setReadPageLightbox(i)}
          onClose={() => setReadPageLightbox(null)}
          onAttach={
            onAttachImage
              ? (url) => {
                  onAttachImage(url);
                  setReadPageLightbox(null);
                }
              : undefined
          }
          onDelete={onRemoveImage}
        />
      )}

      {/* 검색 이미지 카드 × 클릭 → 채팅창 안에서 직접 삭제 확인. 라이트박스 거치지 않음. */}
      {pendingDeleteUrl && onRemoveImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setPendingDeleteUrl(null)}
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
                onClick={() => setPendingDeleteUrl(null)}
                className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
              >
                {t('delete.cancel')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onRemoveImage(pendingDeleteUrl);
                  setPendingDeleteUrl(null);
                  // 확대 보기 중이었다면 같이 닫음.
                  setExpandedImageIndex(null);
                }}
                className="rounded-md border border-destructive/50 bg-destructive px-3 py-1.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                {t('delete.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>

    </>
  );
}

function DotsLoading() {
  return (
    <span className="inline-flex gap-0.5">
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-primary" style={{ animationDelay: '0ms' }} />
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-primary" style={{ animationDelay: '120ms' }} />
      <span className="inline-block h-1 w-1 animate-bounce rounded-full bg-primary" style={{ animationDelay: '240ms' }} />
    </span>
  );
}
