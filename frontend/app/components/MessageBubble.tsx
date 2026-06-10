'use client';

import {
  Children,
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import {
  AlertTriangle,
  Archive,
  Ban,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  ExternalLink,
  Globe,
  GripVertical,
  ImageIcon,
  ImagePlus,
  Images,
  Pencil,
  Pin,
  PinOff,
  RotateCcw,
  RotateCw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { fileToResizedDataUrl, maybeConvertHeic } from '@/lib/imageUtils';
import {
  getImageState,
  hydrateImageStates,
  setImageState,
} from '@/lib/imageCache';
import { extractArtifacts, type Artifact } from '@/lib/artifacts';
import {
  decodeHtmlEntities,
  dedentTableRows,
  fixKoreanEmphasis,
  normalizeFlattenedTables,
  styleCitations,
} from '@/lib/markdown';
import ImageLightbox from './ImageLightbox';
import { useI18n } from '@/lib/i18n';
import { MermaidView, SvgView } from './ArtifactPanel';
import type { Message, ReadPageImage, SearchImage } from './ChatRoom';

// 백엔드가 보내는 에러 코드 → 프론트 i18n 키. 매핑이 있으면 메시지를 현재 UI 언어로
// 번역해 렌더하므로, 언어 전환 시 에러 메시지도 즉시 따라 바뀐다.
const ERROR_CODE_I18N: Record<string, string> = {
  context_overflow: 'error.contextOverflow',
  ai_config_error: 'error.aiConfig',
  vision_unsupported: 'error.visionUnsupported',
  model_not_found: 'error.modelNotFound',
};

// 물리 회전 후 같은 URL 의 이미지를 다시 받게 하는 캐시 버스트. 버전이 있을 때만 ?v= 부착.
function withCacheBust(url: string, v?: number): string {
  if (!v) return url;
  return url + (url.includes('?') ? '&' : '?') + 'v=' + v;
}

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

// 사용자가 Image Edit 모달에서 정한 imageOrder(URL 배열) 기준으로 이미지 배열을 정렬.
// order 에 등장하는 URL 은 그 순서대로 앞에 배치, 나머지(새로 추가된 것 등)는 자연 순서로 뒤에.
function applyImageOrder(
  images: SearchImage[],
  order: string[] | undefined,
): SearchImage[] {
  if (!order || order.length === 0) return images;
  const byUrl = new Map<string, SearchImage>();
  for (const img of images) byUrl.set(img.url, img);
  const ordered: SearchImage[] = [];
  for (const url of order) {
    const img = byUrl.get(url);
    if (img) {
      ordered.push(img);
      byUrl.delete(url);
    }
  }
  for (const img of images) {
    if (byUrl.has(img.url)) {
      ordered.push(img);
      byUrl.delete(img.url);
    }
  }
  return ordered;
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

function ReadPageRow({
  page: p,
  index,
  animate = false,
}: {
  page: RefItem;
  index: number;
  animate?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [maxChars, setMaxChars] = useState<number | null>(null);
  // 이 행이 '검색 진행 중(스트리밍)' 시점에 처음 나타났는지를 mount 시점에 고정.
  // 이미 완료된 대화를 스크롤로 다시 볼 때는 애니메이션이 재생되지 않도록 함.
  const [animateIn] = useState(() => animate);

  const fullTitle = decodeHtmlEntities(p.title || p.url);
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
    <li
      className={cn(
        'flex w-full items-center gap-1.5 text-[12px]',
        animateIn && 'animate-ref-row-in overflow-hidden',
      )}
    >
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
    </li>
  );
}

// 화면에 가까워질 때만 children 을 렌더 — 긴 thread 에서 화면 밖 이미지 스캐터의
// 렌더/이미지 로드를 지연(레이지). reservedHeight 로 자리 미리 확보 → 스크롤 점프 없음.
// 한 번 보이면 계속 렌더 유지(스크롤 왕복 시 재마운트/깜빡임 방지).
function LazyVisible({
  reservedHeight,
  children,
}: {
  reservedHeight: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el) return;
    // IntersectionObserver 미지원 환경 안전망 — 바로 렌더.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '800px 0px' }, // 뷰포트 800px 전부터 미리 렌더
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return (
    <div ref={ref} style={shown ? undefined : { minHeight: reservedHeight }}>
      {shown ? children : null}
    </div>
  );
}

function ImageScatter({
  images,
  cardOverlap,
  onCardClick,
  onInvalid,
  indexed = false,
  forcePoker = false,
  page: externalPage,
  onPageChange,
  onTotalPagesChange,
  hideInlinePagination = false,
  hidden = false,
  bust,
  localFor,
  holdPop = false,
}: {
  images: SearchImage[];
  cardOverlap: number;
  onCardClick: (globalIndex: number) => void;
  onInvalid: (src: string) => void;
  // true 면 각 카드 좌상단에 1-based 인덱스 배지 노출 (본문 [N] 인용과 매칭).
  indexed?: boolean;
  // true 면 이미지가 1장이어도 single-image fallback 대신 포커 카드 UI 사용.
  forcePoker?: boolean;
  // 부모에서 page state 를 lift-up 하면 unmount/remount 후에도 페이지 보존.
  page?: number;
  onPageChange?: (next: number) => void;
  // 부모가 totalPages 를 알아서 외부 컨트롤(< >) 을 렌더할 수 있도록 알림.
  onTotalPagesChange?: (n: number) => void;
  // true 면 스캐터 상단의 inline < > 버튼 숨김 (부모가 다른 위치에 렌더하는 경우).
  hideInlinePagination?: boolean;
  // 부모가 확대뷰 표시 중 스캐터를 display:none 으로 숨길 때 true. 숨김→표시(닫기) 시
  // 페이지 이동처럼 카드를 슬라이드-인 재생한다.
  hidden?: boolean;
  // 물리 회전 후 캐시 버스트 버전(URL→ver). src 에 ?v= 를 붙여 회전된 새 파일을 다시 받게 한다.
  // 키는 표시 대상 URL(로컬 사본이 있으면 그 URL).
  bust?: Record<string, number>;
  // 저장된 웹 이미지(원격 URL) → 로컬 사본(/attachments/) 매핑. 표시·회전을 로컬 사본으로 처리.
  localFor?: Record<string, string>;
  // true 면 카드를 숨긴 채 등장(팝콘) 애니메이션을 보류. References 라운드 확장이 끝난 뒤
  // false 로 바뀌면 그때 비로소 팝콘이 터지도록 — 검색 시 절차적(순차) 연출용.
  holdPop?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [perPage, setPerPage] = useState(7);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // 가로형 카드(landscape)는 w-28(112px), 세로형은 w-[5.5rem](88px). 혼합 케이스에서
    // 행 폭 계산이 실제 너비와 어긋나 overflow → 인접 표 깨짐. worst-case(112) 기준으로 계산해 항상 적합.
    const CARD_W = 112;
    const SAFE_MARGIN = 40; // 회전(최대 13°, 카드 상단 ~25px 수평 이동) + GPU overflow 여유
    const update = () => {
      // 확대 중 부모가 display:none 으로 숨기면 clientWidth=0 → perPage 가 1 로 튀었다가
      // 닫을 때 원복되며 슬라이드 애니메이션이 재발동한다. 폭 0(숨김)일 땐 갱신 스킵.
      if (el.clientWidth <= 0) return;
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
  // 부모에 totalPages 변화 알림 — 외부 < > 컨트롤 위해.
  useEffect(() => {
    onTotalPagesChange?.(totalPages);
  }, [totalPages, onTotalPagesChange]);
  const safePage = Math.min(page, totalPages - 1);

  // 결정적 의사 jitter (회전·세로 오프셋) — 슬라이드 애니메이션 effect 에서도 참조하므로 위로 선언.
  const angles = [-13, -7, -3, 4, -9, 8, 12, -5, 10, 2];

  // 이미지 로드 상태 — loaded set 에 onLoad 발화된 URL 누적.
  // 아래 슬라이드 애니메이션 effect 가 이 set 의 변화를 감지해 새로 로드된 카드를 등장 애니메이션.
  const [loaded, setLoaded] = useState<Set<string>>(() => new Set());
  const markLoaded = (src: string) => {
    setLoaded((prev) => {
      if (prev.has(src)) return prev;
      const next = new Set(prev);
      next.add(src);
      return next;
    });
    setImageState(src, { loaded: true });
  };

  // 페이지 이동 시 현재 보이는 카드들이 Reference documents 영역(아래) 에서 위로 슬라이드 + 페이드인.
  // 첫 렌더는 기존 first-appear animate-in 이 처리하므로 skip.
  // translateY 는 OUTER wrapper 에만 적용 — INNER 의 rotation 은 별도 transform layer 라
  // 슬라이드 중에도 각 카드의 회전 각도가 그대로 유지됨.
  // stagger 패턴: 지그재그 — 짝수 위치(0,2,4…) 가 먼저 한 웨이브, 그 다음 홀수 위치(1,3,5…) 가
  // 두 번째 웨이브로 솟아옴. 두 웨이브가 교차되며 카드가 좌↔우로 번갈아 튀어나오는 시각 효과.
  const cardWrapperRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const firstPageRunRef = useRef(true);

  // 공통 슬라이드 애니메이션 — 카드의 회전 각도 방향대로 아래에서 자기 자리로 진입.
  // 페이지 이동, 이미지 로드 완료 두 케이스에서 재사용.
  // 시작 전에 기존 애니메이션을 cancel → 빠른 < > 클릭이나 페이지 이동 + 로드 effect 가
  // 같은 카드에 연속으로 트리거될 때 두 keyframe 이 겹쳐 transform 이 어색하게 보간되는 현상 방지.
  const animateCardSlide = (idx: number, delay = 0) => {
    const el = cardWrapperRefs.current.get(idx);
    if (!el) return;
    // 기존 진행 중인 애니메이션 취소 (있다면).
    el.getAnimations().forEach((a) => {
      try {
        a.cancel();
      } catch {
        // ignore
      }
    });
    const rot = angles[idx % angles.length];
    const rad = (rot * Math.PI) / 180;
    const sx = -Math.sin(rad) * 80;
    const sy = Math.cos(rad) * 80;
    el.animate(
      [
        { transform: `translate(${sx}px, ${sy}px)`, opacity: 0 },
        { transform: 'translate(0, 0)', opacity: 1 },
      ],
      {
        duration: 380,
        delay,
        easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
        fill: 'backwards',
      },
    );
  };

  // 이미지 로드 완료 감지 — 새로 loaded 에 추가된 URL 의 카드를 tilt-slide-up 으로 등장.
  const prevLoadedRef = useRef<Set<string>>(new Set());
  useLayoutEffect(() => {
    const newlyLoadedIdxs: number[] = [];
    loaded.forEach((url) => {
      if (prevLoadedRef.current.has(url)) return;
      const idx = images.findIndex((im) => im.url === url);
      if (idx < 0) return;
      const cardPage = Math.floor(idx / PER_PAGE);
      if (cardPage !== safePage) return; // 현재 페이지 카드만 애니메이션
      newlyLoadedIdxs.push(idx);
    });
    prevLoadedRef.current = new Set(loaded);
    newlyLoadedIdxs.forEach((idx) => animateCardSlide(idx, Math.random() * 200));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, images, PER_PAGE, safePage]);

  useLayoutEffect(() => {
    if (firstPageRunRef.current) {
      firstPageRunRef.current = false;
      return;
    }
    const visibleIdxs: number[] = [];
    cardWrapperRefs.current.forEach((_, idx) => {
      if (Math.floor(idx / PER_PAGE) === safePage) visibleIdxs.push(idx);
    });
    visibleIdxs.sort((a, b) => a - b);
    visibleIdxs.forEach((idx) => {
      animateCardSlide(idx, Math.random() * 200);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePage, PER_PAGE]);

  // 확대뷰 닫기(숨김→표시) 시 현재 페이지 카드를 페이지 이동처럼 슬라이드-인 재생.
  // (GPU transform/opacity, 보이는 카드만 → 부하 미미)
  const prevHiddenRef = useRef(hidden);
  useLayoutEffect(() => {
    const wasHidden = prevHiddenRef.current;
    prevHiddenRef.current = hidden;
    if (!wasHidden || hidden) return; // 표시→표시/숨김 전환은 무시, 숨김→표시만
    const visibleIdxs: number[] = [];
    cardWrapperRefs.current.forEach((_, idx) => {
      if (Math.floor(idx / PER_PAGE) === safePage) visibleIdxs.push(idx);
    });
    visibleIdxs.sort((a, b) => a - b);
    visibleIdxs.forEach((idx) => animateCardSlide(idx, Math.random() * 200));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hidden]);

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

  // 카드별 자연 비율(w/h) — onLoad 에서 측정. 캐시된 값이 있으면 마운트 즉시 반영(layout shift 방지).
  // 카드 박스를 이 비율대로 그려, 선택 전(스캐터) 에도 원본 비율에 최대한 맞춰 보여준다.
  const [ratios, setRatios] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const [url, s] of hydrateImageStates(images.map((i) => i.url))) {
      if (s.ratio && s.ratio > 0) m.set(url, s.ratio);
    }
    return m;
  });
  const markRatio = (src: string, r: number) => {
    if (!(r > 0) || !Number.isFinite(r)) return;
    setRatios((prev) => {
      if (prev.get(src) === r) return prev;
      const next = new Map(prev);
      next.set(src, r);
      return next;
    });
    setImageState(src, { ratio: r });
  };
  // 카드 박스 치수 계산 — 긴 변을 BOX_MAX 로, 짧은 변은 비율대로(BOX_MIN 하한). 비율 모르면 orient 폴백.
  const BOX_MAX = 112; // 긴 변 최대 px (기존 w-28)
  const BOX_MIN = 64; // 짧은 변 최소 px — 극단적 파노라마/세로형이 너무 얇아지지 않게 클램프
  const cardBox = (
    url: string,
    kind: SearchImage['kind'],
    fallbackLandscape: boolean,
  ): { w: number; h: number } => {
    // YouTube/X 썸네일은 16:9 고정 느낌 유지.
    if (kind === 'youtube' || kind === 'x') return { w: 112, h: 88 };
    const r = ratios.get(url);
    if (r && r > 0) {
      if (r >= 1) {
        return { w: BOX_MAX, h: Math.max(BOX_MIN, Math.round(BOX_MAX / r)) };
      }
      return { w: Math.max(BOX_MIN, Math.round(BOX_MAX * r)), h: BOX_MAX };
    }
    // 로드 전 — orient 기반 근사(가로 112×88 / 세로 88×112).
    return fallbackLandscape ? { w: 112, h: 88 } : { w: 88, h: 112 };
  };
  // loaded / angles 는 위에서 이미 선언됨 (슬라이드 애니메이션 effect 가 참조).
  const canPrev = safePage > 0;
  const canNext = safePage < totalPages - 1;
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
    <div ref={containerRef} className="-mt-3 mb-2 pl-4">
      {totalPages > 1 && (
        <div className={cn(
          'mb-1 flex items-center justify-end gap-1 text-muted-foreground',
          hideInlinePagination && 'md:hidden',
        )}>
          <button
            type="button"
            onClick={() => canPrev && setPage((p) => p - 1)}
            disabled={!canPrev}
            aria-label="이전 페이지"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary disabled:pointer-events-none disabled:opacity-30 md:h-6 md:w-6"
          >
            <span className="text-base">&lt;</span>
          </button>
          <button
            type="button"
            onClick={() => canNext && setPage((p) => p + 1)}
            disabled={!canNext}
            aria-label="다음 페이지"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-secondary disabled:pointer-events-none disabled:opacity-30 md:h-6 md:w-6"
          >
            <span className="text-base">&gt;</span>
          </button>
        </div>
      )}

      <div
        // min-h 로 카드 행 높이 고정 — 페이지에 따라 가로/세로 카드 mix 가 달라도
        // Reference documents 등 아래 컨텐츠가 흔들리지 않도록 최대 케이스 높이 미리 확보.
        // 계산: pt-8(32) + 세로 카드 h-28(112) + 회전/jitter 여유(~20) + pb-2(8) ≈ 172px → 170 으로 라운드.
        className="flex min-h-[170px] flex-nowrap items-end pb-2 pt-8"
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
          // holdPop 동안에는 '첫 등장'으로 소비하지 않음 → 보류가 풀린 첫 렌더에서 비로소
          // 팝콘/슬라이드 등장 애니메이션이 재생되도록 마킹을 미룬다.
          if (!holdPop) animatedRef.current.add(cardKey);

          // 카드 박스 방향 — 실제(물리 회전 반영된) 이미지의 자연 비율 기준. 회전 후엔
          // 버스트로 src 가 바뀌어 onLoad 가 다시 측정 → orientations 가 갱신된다.
          const effLandscape =
            img.kind === 'youtube' ||
            img.kind === 'x' ||
            orientations.get(img.url) === 'landscape';
          // 실제 비율에 맞춘 카드 박스 치수(선택 전에도 원본 비율대로 최대한 노출).
          const box = cardBox(img.url, img.kind, effLandscape);

          return (
            <div
              key={`${img.url || img.linkUrl || globalIndex}`}
              ref={(el) => {
                // 페이지 이동 슬라이드 애니메이션을 위해 globalIndex 별로 wrapper ref 관리.
                if (el) cardWrapperRefs.current.set(globalIndex, el);
                else cardWrapperRefs.current.delete(globalIndex);
              }}
              style={{
                marginLeft: ml,
                display: onPage ? undefined : 'none',
              }}
              className={cn(
                'group/card relative shrink-0',
                onPage &&
                  isFirstAppear &&
                  !holdPop &&
                  'animate-in fade-in zoom-in-50 slide-in-from-top-16 duration-500 ease-out',
              )}
            >
            {/* Transform wrapper — 카드와 × 버튼이 같은 회전·hover 변환을 공유.
                transform-gpu + backface-visibility:hidden — 카드를 GPU 합성 layer 로 promote
                해서 회전/스케일 변경 시 CPU 재계산 없이 합성기에서 처리. */}
            <div
              style={{
                transform: `rotate(${rot}deg) translateY(${ty}px)`,
                backfaceVisibility: 'hidden',
              }}
              className={cn(
                'group relative origin-bottom transition-transform duration-300 ease-out transform-gpu will-change-transform',
                'group-hover/card:z-50 group-hover/card:!translate-y-[-12px] group-hover/card:!rotate-0 group-hover/card:!scale-[1.18]',
              )}
            >
            {indexed && (
              <span className="pointer-events-none absolute left-1 top-1 z-[2] inline-flex h-4 min-w-[18px] items-center justify-center rounded-sm border border-primary/40 bg-card px-1 font-mono text-[10.5px] tabular-nums leading-none text-primary shadow-sm">
                {globalIndex + 1}
              </span>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleClick}
              style={{ width: box.w, height: box.h }}
              className={cn(
                'relative block overflow-hidden rounded-lg bg-secondary/40 shadow-[0_6px_10px_rgba(0,0,0,0.5)] transition-opacity duration-300 ease-out group-hover/card:shadow-[0_16px_22px_rgba(0,0,0,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                // 보류 중(holdPop)에는 '이번에 처음 등장하는' 카드만 숨겨 확장 후 팝콘으로 나타나게 한다.
                // 이미 떠 있던 카드(첨부 이미지 등, isFirstAppear=false)는 그대로 유지해 깜빡임 방지.
                isLoaded && (!holdPop || !isFirstAppear)
                  ? 'opacity-100'
                  : 'opacity-0',
                isLoaded && isFirstAppear && !holdPop && 'animate-card-pop',
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
                  src={(() => {
                    const disp = localFor?.[img.url] ?? img.url;
                    return withCacheBust(disp, bust?.[disp]);
                  })()}
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
                    markRatio(img.url, el.naturalWidth / el.naturalHeight);
                    // 자연 픽셀 크기 캐시 — 확대 시 첫 렌더부터 최종 크기로 그리게(리사이즈 깜빡임 방지).
                    setImageState(img.url, {
                      natW: el.naturalWidth,
                      natH: el.naturalHeight,
                    });
                    markLoaded(img.url);
                  }}
                  className="relative h-full w-full cursor-zoom-in object-cover transition-transform duration-200"
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
              </TooltipTrigger>
              {(() => {
                // 풍선 도움말 — alt(sourceTitle) 우선. kind 라벨 / AI 분석 설명도 함께 노출.
                const lines: string[] = [];
                const head =
                  img.kind === 'youtube'
                    ? `YouTube · ${img.linkUrl ?? ''}`
                    : img.kind === 'x'
                      ? `X · ${img.linkUrl ?? ''}`
                      : img.sourceTitle ?? '';
                if (head) lines.push(head);
                if (img.analysis?.description) {
                  lines.push(
                    `[AI 분석 · ${img.analysis.relevant ? '관련' : '무관'}]`,
                  );
                  lines.push(img.analysis.description);
                }
                if (lines.length === 0) return null;
                return (
                  <TooltipContent
                    side="top"
                    sideOffset={6}
                    className="max-w-xs whitespace-pre-line break-words"
                  >
                    {lines.join('\n')}
                  </TooltipContent>
                );
              })()}
            </Tooltip>
            {/* 카드별 × 삭제 버튼 제거 — 삭제는 Content Edit 모달 또는 확대 뷰의 Delete 버튼에서 처리. */}
            </div>
            </div>
          );
        })}
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
  // 헤딩 레벨별 색 — h4(=기본 폰트색) 에서 시작해 큰 제목일수록 흰색으로 수렴.
  // 크기도 위계가 한눈에 보이도록 22 / 18 / 16 / 본문(14.5) px 로 차이 확대.
  '[&_h1]:mt-3 [&_h1]:mb-1.5 [&_h1]:text-[22px] [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:text-foreground',
  '[&_h2]:mt-2.5 [&_h2]:mb-1 [&_h2]:text-[18px] [&_h2]:font-bold [&_h2]:leading-snug [&_h2]:text-foreground',
  '[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-[16px] [&_h3]:font-bold [&_h3]:leading-snug [&_h3]:text-foreground',
  '[&_h4]:mt-1.5 [&_h4]:font-bold [&_h4]:text-foreground [&_h5]:font-bold [&_h5]:text-foreground [&_h6]:font-bold [&_h6]:text-foreground',
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

function MessageBubble({
  message,
  onOpenArtifact,
  activeArtifactId,
  onAttachImage,
  isFresh = false,
  onFollowup,
  isCollapsed = false,
  onDeleteTurn,
  onRemoveImage,
  onReorderImages,
  onUploadEditImage,
  precedingUserImages,
  precedingUserImageNames,
  convKind = 'thread',
  userOrdinal,
  onEditContent,
  onPinImage,
  onRotateImage,
  attachedSourceUrls,
  isGreeting = false,
  isLive = false,
}: {
  message: Message;
  onOpenArtifact?: (a: Artifact) => void;
  activeArtifactId?: string | null;
  onAttachImage?: (url: string) => void;
  isFresh?: boolean;
  onFollowup?: (text: string) => void;
  // 현재 접힘 상태인지 — turn 삭제 버튼이 접힘 상태에선 강제 노출되도록 사용.
  isCollapsed?: boolean;
  // 이 user msg의 turn(질문+답변) 삭제
  onDeleteTurn?: () => void;
  // References 이미지 카드에서 × 버튼으로 제거
  onRemoveImage?: (url: string) => void;
  // Image Edit 모달에서 일괄 reorder + delete 적용. orderedUrls 가 최종 순서이며,
  // 현재 combinedImages 에 있던 URL 중 빠진 것은 삭제 대상으로 간주.
  onReorderImages?: (orderedUrls: string[]) => void;
  // Image Edit 모달에서 사용자가 이미지를 직접 업로드. 성공 시 저장된 URL 반환.
  onUploadEditImage?: (dataUrl: string, fileName: string, sourceUrl?: string) => Promise<string | null>;
  // assistant 메시지의 경우, 직전 user 메시지에 첨부된 이미지 — References 위에 노출.
  precedingUserImages?: string[];
  // 위 이미지의 원본 파일명 (있는 경우) — References 라벨에서 사용.
  precedingUserImageNames?: string[];
  // 'thread' 면 user 발화를 소제목(번호 + 본문, 좌측 정렬)으로 렌더 — 'chat' 은 기존 버블 유지.
  convKind?: 'thread' | 'chat';
  // user 발화 순번(1-based) — 소제목 모드에서 prefix.
  userOrdinal?: number;
  // 쓰레드 소제목 인라인 편집 — 호출 측에서 백엔드 PATCH + 로컬 state 갱신.
  onEditContent?: (id: string, content: string) => void;
  // 포커 이미지 PIN/UNPIN — 메시지 metadata.pinnedImageUrl 영속.
  onPinImage?: (messageId: string, url: string | null) => void;
  // 저장된 이미지 물리 회전 — 서버 파일을 deg(시계방향 90 단위)만큼 실제 회전 후 덮어쓴다.
  onRotateImage?: (messageId: string, url: string, deg: number) => Promise<void>;
  // 현재 InputBar 에 첨부된 이미지의 원본 source URL 집합 — Attach 버튼 dim 판단에 사용.
  attachedSourceUrls?: Set<string>;
  // 첫 user 메시지 전 leading 인사말(greeting) — View/Edit 탭, follow-up 등 메타 UI 숨김.
  isGreeting?: boolean;
  // 현재 스트리밍 중인 메시지 — true 일 때 View/Edit 탭 숨김.
  isLive?: boolean;
}) {
  const { t } = useI18n();
  const isUser = message.role === 'user';
  // 쓰레드 소제목 인라인 편집 상태 — false 면 read-only.
  // contenteditable span 으로 구현: inline 흐름을 유지해 ordinal/주변 텍스트가 시각적으로 이동하지 않음.
  const [headingEditing, setHeadingEditing] = useState(false);
  const headingEditableRef = useRef<HTMLSpanElement>(null);
  // 모바일 전용 풀스크린 편집 상태
  const [mobileHeadingOpen, setMobileHeadingOpen] = useState(false);
  const [mobileHeadingDraft, setMobileHeadingDraft] = useState('');
  const mobileHeadingRef = useRef<HTMLTextAreaElement>(null);
  // 편집 진입 시점에 캡처한 원본 본문 — message.content 가 mid-edit 으로 바뀌어도
  // useEffect 가 사용자 입력을 덮어쓰지 않도록 별도 보관.
  const headingInitialRef = useRef<string>('');
  useEffect(() => {
    if (!headingEditing) return;
    const el = headingEditableRef.current;
    if (!el) return;
    // 초기값 주입 (uncontrolled — 이후 사용자 입력은 DOM 이 진실).
    // 의존성은 [headingEditing] 만 — message.content 가 변해도 사용자 입력을 잃지 않음.
    el.textContent = headingInitialRef.current;
    el.focus();
    // 캐럿을 끝으로.
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [headingEditing]);
  useEffect(() => {
    if (!mobileHeadingOpen) return;
    const el = mobileHeadingRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [mobileHeadingOpen]);
  function startHeadingEdit() {
    headingInitialRef.current = message.content ?? '';
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      setMobileHeadingDraft(message.content ?? '');
      setMobileHeadingOpen(true);
    } else {
      setHeadingEditing(true);
    }
  }
  function commitHeadingEdit() {
    const el = headingEditableRef.current;
    const next = (el?.textContent ?? '').trim();
    if (next && next !== (message.content ?? '').trim()) {
      onEditContent?.(message.id, next);
    }
    setHeadingEditing(false);
  }
  function commitMobileHeadingEdit() {
    const next = mobileHeadingDraft.trim();
    if (next && next !== (message.content ?? '').trim()) {
      onEditContent?.(message.id, next);
    }
    setMobileHeadingOpen(false);
  }
  function cancelHeadingEdit() {
    setHeadingEditing(false);
  }
  // assistant 답변 마크다운 편집 상태 — Preview/Edit 탭으로 토글.
  // onEditContent 핸들러는 user 메시지의 heading 편집과 동일하게 PATCH /messages/:id 로 영속.
  const [answerEditing, setAnswerEditing] = useState(false);
  const [answerDraft, setAnswerDraft] = useState('');
  const answerEditRef = useRef<HTMLTextAreaElement>(null);
  const answerBubbleRef = useRef<HTMLDivElement>(null);
  // Preview↔Edit 토글 시 textarea ↔ markdown 렌더 높이 차이로 버블 BOTTOM 이 움직임 →
  // 버블 아래 붙어 있는 Edit/Preview 탭(사용자 클릭 위치) 도 같이 이동해서 "화면이 움직임" 처럼 느껴짐.
  // BOTTOM 위치를 기록해두고 토글 후 useLayoutEffect 에서 동일 BOTTOM 으로 scrollTop 보정 →
  // 사용자가 클릭한 탭이 그대로 같은 screen Y 에 머무름.
  const answerToggleScrollRef = useRef<number | null>(null);
  const captureBubbleTop = () => {
    answerToggleScrollRef.current =
      answerBubbleRef.current?.getBoundingClientRect().bottom ?? null;
  };
  // useLayoutEffect — 페인트 전에 scrollTop 조정해서 사용자 눈엔 점프가 안 보임.
  useLayoutEffect(() => {
    const prevBottom = answerToggleScrollRef.current;
    if (prevBottom === null || !answerBubbleRef.current) return;
    const newBottom = answerBubbleRef.current.getBoundingClientRect().bottom;
    const diff = newBottom - prevBottom;
    answerToggleScrollRef.current = null;
    if (Math.abs(diff) < 1) return;
    // 가장 가까운 scroll container 찾아서 scrollTop 보정. 없으면 window.
    let el: HTMLElement | null = answerBubbleRef.current.parentElement;
    while (el) {
      const style = getComputedStyle(el);
      if (
        (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight
      ) {
        el.scrollTop += diff;
        return;
      }
      el = el.parentElement;
    }
    window.scrollBy({ top: diff });
  }, [answerEditing]);
  // 편집 진입 시 focus — autoFocus 는 브라우저가 자동 scrollIntoView 를 트리거해서
  // 화면이 위로 점프함. focus({ preventScroll: true }) 로 화면 위치 유지.
  useEffect(() => {
    if (!answerEditing) return;
    const el = answerEditRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    // 캐럿을 끝으로.
    const len = el.value.length;
    el.setSelectionRange(len, len);
  }, [answerEditing]);
  function startAnswerEdit() {
    captureBubbleTop();
    setAnswerDraft(message.content ?? '');
    setAnswerEditing(true);
  }
  function commitAnswerEdit() {
    captureBubbleTop();
    const next = answerDraft;
    if (next.trim() !== (message.content ?? '').trim()) {
      onEditContent?.(message.id, next);
    }
    setAnswerEditing(false);
  }
  function cancelAnswerEdit() {
    captureBubbleTop();
    setAnswerEditing(false);
    setAnswerDraft('');
  }
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
  const isStreaming = !isUser && !contentEverArrived;
  const thinkingLabel = isStreaming
    ? (isVisioning ? t('bot.visioning') : t('bot.thinking'))
    : (isVisioning ? t('bot.visioned') : t('bot.thought'));
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
    (hasThinkingText && isStreaming);
  // 스트리밍 중에는 자동 펼침, 본문 도착 후에는 자동으로 접힘 (사용자 클릭으로 다시 펼침 가능)
  const autoOpen = isStreaming && hasProcessPanel;
  const open = override ?? autoOpen;
  const toggle = () => setOverride(!open);

  // 절차적 연출: 검색으로 References(웹 링크)가 등장하면 먼저 라운드가 확장(ref-row-in)되고,
  // 확장이 끝난 뒤에야 이미지 팝콘이 터지도록 한다. 라이브 스트리밍 + References 가 있을 때만 적용.
  // (이미 완료된 대화를 다시 열 때나 References 가 없을 땐 지연 없이 즉시 노출)
  const [popReady, setPopReady] = useState(true);
  const popHoldStartedRef = useRef(false);
  useEffect(() => {
    if (!isStreaming || !hasReadPagesData) {
      // 지연이 필요 없거나(References 없음) 스트리밍이 끝난 상태 — 항상 보류 해제(즉시 노출).
      // 특히 확장 타이머(460ms)가 끝나기 전에 스트리밍이 종료돼도 이미지가 영영 숨지 않도록 보장.
      setPopReady(true);
      return;
    }
    // References 가 라이브로 처음 등장한 순간 1회: 팝콘을 잠시 보류 → 확장 애니메이션 후 해제.
    if (popHoldStartedRef.current) return;
    popHoldStartedRef.current = true;
    setPopReady(false);
    // ref-row-in(380ms) + 여유. 확장이 끝나는 시점에 맞춰 팝콘 해제.
    const REF_EXPAND_MS = 460;
    const timer = setTimeout(() => setPopReady(true), REF_EXPAND_MS);
    return () => clearTimeout(timer);
  }, [isStreaming, hasReadPagesData]);

  const artifacts = useMemo(
    () => (isUser ? [] : extractArtifacts(message.content, message.id)),
    [isUser, message.content, message.id],
  );

  const renderedContent = useMemo(() => {
    if (isUser) return message.content;
    // 알려진 에러 코드가 있으면 저장된 본문 대신 현재 UI 언어로 번역해 렌더 —
    // 언어를 전환하면 에러 메시지도 즉시 그 언어로 바뀐다.
    if (message.isError && message.errorCode) {
      const key = ERROR_CODE_I18N[message.errorCode];
      // 한글에 인접한 **강조** 가 ReactMarkdown 에서 풀리지 않도록 보정.
      if (key) return fixKoreanEmphasis(t(key as Parameters<typeof t>[0]));
    }
    // 에러 메시지는 경고 아이콘을 별도로 렌더하므로 옛 데이터에 박힌 선행 ⚠️ 는 제거.
    if (message.isError) {
      return message.content.replace(/^\s*⚠️️?\s*/u, '');
    }
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
  }, [isUser, message.content, message.isError, message.errorCode, t]);

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

  const galleryImages = useMemo<SearchImage[]>(() => {
    if (isUser) {
      return (message.images ?? []).map((u) => ({ url: u }));
    }
    return flatOrder;
  }, [isUser, message.images, flatOrder]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
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

  // Content Edit 모달이 사용하는 통합 항목 리스트 (첨부 + readPages 이미지 + searchImages + X-empty 카드).
  // 포커이미지판넬에 노출되는 모든 콘텐츠를 빠짐없이 모달에 표시하기 위해 readPageImagesFlat 의
  // X-empty(이미지 URL 없는 트윗) 도 별도 패스로 포함.
  // message.imageOrder 가 있으면 그 순서대로 정렬, 없으면 자연 순서.
  const combinedImagesForEdit = useMemo<SearchImage[]>(() => {
    const attached: SearchImage[] = (precedingUserImages ?? []).map((src) => ({
      url: src,
      removable: false,
    }));
    // readPageImagesFlat 가 이미 제외한 X-empty(linkUrl 만 있는) 항목도 회수.
    const seenForExtra = new Set<string>();
    for (const im of readPageImagesFlat) {
      if (im.linkUrl) seenForExtra.add(`${im.kind ?? 'image'}:${im.linkUrl}`);
      if (im.url) seenForExtra.add(`u:${im.url}`);
    }
    const extras: SearchImage[] = [];
    for (const p of message.readPages ?? []) {
      for (const im of p.images ?? []) {
        if (!(im.kind === 'x' && !im.src)) continue;
        const key = im.linkUrl
          ? `${im.kind}:${im.linkUrl}`
          : `u:${im.src}`;
        if (seenForExtra.has(key)) continue;
        seenForExtra.add(key);
        extras.push({
          url: im.linkUrl ?? '', // X-empty 는 linkUrl 을 키로 사용.
          sourceUrl: im.linkUrl ?? p.url,
          sourceTitle: im.alt || p.title,
          kind: im.kind,
          linkUrl: im.linkUrl,
        });
      }
    }
    const editImgs: SearchImage[] = (message.editImages ?? []).map((url) => ({
      url,
      removable: true,
    }));
    const natural = [...attached, ...readPageImagesFlat, ...extras, ...editImgs];
    return applyImageOrder(natural, message.imageOrder);
  }, [precedingUserImages, readPageImagesFlat, message.readPages, message.imageOrder, message.editImages]);
  const [readPageLightbox, setReadPageLightbox] = useState<number | null>(null);
  // 사용자가 단일 이미지의 자동 PIN 을 수동으로 해제한 URL 집합 — 시각 PIN 표시만 끄고 이미지는 그대로 노출 유지.
  // 컴포넌트 unmount 시 리셋 (페이지 새로고침하면 다시 auto-PIN). 영속하지 않음.
  const [autoPinOverrideUrls, setAutoPinOverrideUrls] = useState<Set<string>>(
    () => new Set(),
  );
  // 포커 카드 클릭 시 라이트박스 대신 채팅 화면 안에서 인라인 확대.
  // 값은 combinedImages 의 인덱스 (attached + readPages 합친 순서).
  // Reference documents 헤더의 Image Edit 토글 — 이미지 일괄 삭제 모달의 진입점.
  const [imageEditMode, setImageEditMode] = useState(false);
  // 모달 내 체크 선택 — URL 단위. 삭제 대상.
  const [imageEditSelection, setImageEditSelection] = useState<Set<string>>(
    () => new Set(),
  );
  // 모달에서 사용자가 임시로 편집 중인 URL 순서. Apply 시점에 onReorderImages 로 commit.
  // 초기화는 imageEditMode 가 처음 true 가 되는 순간 1회 — 도중에 새 이미지가 도착해도 reset 하지 않음.
  const [editingOrderUrls, setEditingOrderUrls] = useState<string[]>([]);
  const [draggingUrl, setDraggingUrl] = useState<string | null>(null);
  const [dragOverUrl, setDragOverUrl] = useState<string | null>(null);
  const [imageEditConfirmPending, setImageEditConfirmPending] = useState(false);
  // 업로드 중인 항목 — 파일 선택 즉시 로컬 프리뷰로 그리드에 표시.
  const [pendingUploads, setPendingUploads] = useState<
    { tempId: string; previewUrl: string }[]
  >([]);
  const editingOrderInit = useRef(false);
  useEffect(() => {
    if (imageEditMode) {
      if (!editingOrderInit.current) {
        setEditingOrderUrls(combinedImagesForEdit.map((i) => i.url));
        editingOrderInit.current = true;
      }
    } else {
      editingOrderInit.current = false;
      setImageEditSelection(new Set());
      setEditingOrderUrls([]);
      setDraggingUrl(null);
      setDragOverUrl(null);
      setImageEditConfirmPending(false);
      setPendingUploads([]);
    }
  }, [imageEditMode, combinedImagesForEdit]);
  const [expandedImageIndex, setExpandedImageIndex] = useState<number | null>(
    null,
  );
  const [expandedImageLoaded, setExpandedImageLoaded] = useState(false);
  // 확대 이미지의 자연 크기 — 회전 시 래퍼를 회전된 footprint 로 잡기 위해 onLoad 에서 측정.
  const [expandedNatural, setExpandedNatural] = useState<{
    w: number;
    h: number;
  } | null>(null);
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
  useEffect(() => {
    setExpandedImageLoaded(false);
    setExpandedNatural(null);
    setSpin(0);
    setSpinTransition(true);
  }, [expandedImageIndex]);
  // 뷰포트 폭 — 모바일에서 확대 이미지가 좌우 버튼 거터와 함께 화면을 넘치지 않도록 표시 크기 산정에 사용.
  // (0 = 미측정/SSR → 데스크탑 기본값 사용)
  const [viewportW, setViewportW] = useState(0);
  useEffect(() => {
    const update = () => setViewportW(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  // 확대 뷰가 놓인 영역(= Reference documents 와 같은 컬럼)의 가용 가로폭 측정.
  // 데스크탑에서 이 폭(버튼 거터 제외) 안에서 이미지를 최대한 크게 표시하기 위함.
  const mediaWrapRef = useRef<HTMLDivElement>(null);
  const [mediaWrapW, setMediaWrapW] = useState(0);
  useEffect(() => {
    const el = mediaWrapRef.current;
    if (!el) return;
    const update = () => setMediaWrapW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [expandedImageIndex]);
  // 물리 회전 후 같은 세션에서 새 이미지를 다시 받기 위한 캐시 버스트 버전(URL→ver).
  const [imgBust, setImgBust] = useState<Record<string, number>>({});
  // 회전 진행 중 URL(중복 클릭 방지). 회전 성공 시 버전을 올려 src 를 갱신한다.
  const [rotatingUrl, setRotatingUrl] = useState<string | null>(null);
  // 래퍼 높이 transition 활성 여부 — 회전 시작~정착까지 켜서, 공간 확보(증가)·정착(감소) 가 모두
  // 부드럽게 애니메이션되도록 한다(세로→가로처럼 높이가 줄어드는 경우의 '딱 끊김' 방지).
  const [heightAnim, setHeightAnim] = useState(false);
  // 회전 애니메이션 — 클릭 즉시 확대 이미지를 CSS 로 ±90° 부드럽게 돌리고(spin),
  // 백엔드 회전 + 새 파일 preload 가 끝나면 트랜지션 없이 0° 로 스냅하며 동시에 교체한다.
  // preload 로 새 파일을 캐시에 올려두면 교체가 즉시 일어나 빈(흰) 화면이 보이지 않는다.
  const [spin, setSpin] = useState(0);
  const [spinTransition, setSpinTransition] = useState(true);
  async function handleRotate(url: string, deg: number) {
    if (!onRotateImage || rotatingUrl) return;
    setHeightAnim(true);
    setRotatingUrl(url);
    // 1단계: 세로 공간을 '애니메이션으로' 먼저 확보 — rotatingUrl 이 set 되면 래퍼 height 가
    // reservedH(긴 변)로 transition 된다. 단, 높이가 늘어나는 경우(가로→세로 전환 = 현재 landscape)
    // 에만 확보가 의미 있으므로 그때만 230ms 대기 후 회전. 높이가 줄어드는 경우(현재 portrait)는
    // 확보할 게 없으니 바로 회전하고, 회전 후 높이를 부드럽게 줄여 정착시킨다.
    const willGrow =
      deg !== 180 && !!expandedNatural && expandedNatural.w > expandedNatural.h;
    if (willGrow) await new Promise<void>((r) => setTimeout(r, 230));
    // 2단계: 확보된 공간 안에서 이미지를 회전.
    // 시각 회전량 — 270(반시계)은 -90, 90은 +90, 180은 +180.
    const visual = deg === 270 ? -90 : deg === 180 ? 180 : 90;
    setSpinTransition(true);
    setSpin((s) => s + visual);
    try {
      await onRotateImage(message.id, url, deg);
      const nextVer = (imgBust[url] ?? 0) + 1;
      // 애니메이션 시간(≈270ms)과 새 파일 디코드를 모두 기다린 뒤 한 번에 스냅+교체.
      const animDone = new Promise<void>((r) => setTimeout(r, 270));
      const preloaded = new Promise<void>((resolve) => {
        const im = new Image();
        im.onload = () => resolve();
        im.onerror = () => resolve();
        im.src = withCacheBust(url, nextVer);
      });
      await Promise.all([animDone, preloaded]);
      // 새(이미 회전된) 파일을 트랜지션 없이 0° 로 스냅 — spin=visual 끝 위치와 시각적으로 동일해 이음새 없음.
      // 동시에 표시 비율(가로/세로)도 즉시 스왑해 박스가 새 방향으로 바로 맞춰지게(리사이즈 애니메이션 방지).
      setSpinTransition(false);
      setSpin(0);
      if (deg !== 180) {
        setExpandedNatural((n) => (n ? { w: n.h, h: n.w } : n));
      }
      setImgBust((b) => ({ ...b, [url]: nextVer }));
    } catch {
      // 실패 시 시각 회전 되돌림.
      setSpin((s) => s - visual);
    } finally {
      // rotatingUrl 해제 → 래퍼 높이 목표가 '최종 높이'로 바뀐다. heightAnim 이 아직 켜져 있어
      // 세로→가로처럼 높이가 줄어드는 경우 그 변화가 부드럽게 애니메이션된다. 정착 후 transition 끔.
      setRotatingUrl(null);
      setTimeout(() => setHeightAnim(false), 260);
    }
  }
  // 카드의 × 클릭 시 — 라이트박스 열지 않고, 채팅창 안에서 직접 삭제 확인 다이얼로그를 띄움.
  const [pendingDeleteUrl, setPendingDeleteUrl] = useState<string | null>(null);
  // 웹(외부) 이미지를 서버에 저장(=editImages 첨부)한 source URL 집합 — 저장 후 "저장됨" 표시.
  const [savedSourceUrls, setSavedSourceUrls] = useState<Set<string>>(new Set());
  // 현재 저장 진행 중인 source URL (버튼 로딩/중복 클릭 방지).
  const [savingUrl, setSavingUrl] = useState<string | null>(null);
  // 웹 이미지 저장 — image-proxy 로 dataUrl 확보 후, 업로드 첨부와 동일하게 서버에 업로드.
  async function handleSaveWebImage(url: string) {
    if (!onUploadEditImage || savingUrl) return;
    setSavingUrl(url);
    try {
      // 외부 이미지를 CORS 회피해 dataUrl 로 변환 (업로드용).
      const res = await fetch(
        `/api/chat/image-proxy?url=${encodeURIComponent(url)}`,
      );
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(j?.message || `HTTP ${res.status}`);
      }
      const { dataUrl } = (await res.json()) as { dataUrl: string };
      const fileName = (() => {
        try {
          const u = new URL(url, window.location.origin);
          const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
          return decodeURIComponent(last) || 'image.jpg';
        } catch {
          return 'image.jpg';
        }
      })();
      // sourceUrl(url) 도 함께 전달 → 메시지 metadata.savedSourceUrls 에 영속(새로고침 후 유지).
      const saved = await onUploadEditImage(dataUrl, fileName, url);
      if (saved) {
        setSavedSourceUrls((prev) => new Set(prev).add(url));
      } else {
        throw new Error('업로드 실패');
      }
    } catch (e) {
      alert(
        `이미지 저장 실패: ${e instanceof Error ? e.message : '오류'}`,
      );
    } finally {
      setSavingUrl(null);
    }
  }
  // ImageScatter 의 현재 페이지를 부모에서 보존 — 확대 보기/삭제 후 ImageScatter 가
  // unmount→remount 되어도 페이지가 0 으로 리셋되지 않게.
  const [scatterPage, setScatterPage] = useState(0);
  // ImageScatter 의 totalPages 를 lift-up — Stella 이름 행 우측에 < > 버튼 노출하기 위함.
  const [scatterTotalPages, setScatterTotalPages] = useState(1);
  // 사용자가 Close 버튼을 한 번이라도 눌렀는지 — 마운트 lifetime 동안 자동 확대 effect 를 완전 차단.
  // 메시지 metadata 에 저장된 pinnedImageUrl 을 마운트 시 (또는 갱신 시) 복원.
  // 인덱스는 반드시 화면에 실제 노출되는 `combinedImagesForEdit` 순서 (imageOrder 적용됨) 기준.
  // 자연 순서 (attached + readPages) 로 indexOf 하면 imageOrder 가 설정된 메시지에서
  // 다른 이미지가 expanded 돼서 "PIN 이 안 된 것처럼 보이는" 버그가 발생한다.
  // 사용자가 명시적으로 UNPIN 한 URL(autoPinOverrideUrls) 은 복원 대상에서 제외.
  const pinnedImageUrl = message.pinnedImageUrl;
  useEffect(() => {
    if (isUser || !pinnedImageUrl) return;
    if (autoPinOverrideUrls.has(pinnedImageUrl)) return;
    const idx = combinedImagesForEdit.findIndex(
      (im) => im.url === pinnedImageUrl,
    );
    if (idx >= 0 && expandedImageIndex !== idx) {
      setExpandedImageIndex(idx);
    }
  }, [
    isUser,
    pinnedImageUrl,
    combinedImagesForEdit,
    expandedImageIndex,
    autoPinOverrideUrls,
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
          <div className="my-3 w-full min-w-0 max-w-full overflow-x-clip px-2 py-2 [@media(pointer:coarse)]:select-none">
            <table
              {...rest}
              className={cn(
                // table-auto + min-w-full — 컬럼은 컨텐츠 너비로 늘어나며, 컨테이너가 더 넓으면 채움.
                // 줄바꿈은 단어/한글 구절 단위로만 발생, 가로가 넘치면 외곽 wrapper 의 overflow-x-auto 가 스크롤.
                'min-w-full w-auto table-auto border-collapse text-[13px] shadow-[0_2px_10px_rgba(0,0,0,0.18)]',
                // 헤더: primary 컬러 배경 + 두꺼운 글씨. whitespace-nowrap 제거 — 다열 한글 헤더가 nowrap이면
                // 최소 테이블 너비가 화면을 초과해 모바일에서 잘림 발생. break-keep 으로 단어 단위만 줄바꿈.
                '[&_thead]:bg-primary/15',
                '[&_th]:border [&_th]:border-primary/30 [&_th]:bg-primary/15 [&_th]:text-primary [&_th]:font-semibold [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:break-keep [&_th]:text-left',
                // 본문 셀: 옅은 보더, 짝수 행 zebra, 호버 하이라이트. break-keep 으로 단어 단위 줄바꿈만.
                '[&_td]:border [&_td]:border-border/70 [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:break-keep [&_td]:align-top',
                '[&_tbody_tr:nth-child(even)]:bg-secondary/30',
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
                'overflow-x-clip [@media(pointer:fine)]:overflow-x-auto touch-pan-y [@media(pointer:fine)]:overscroll-x-contain rounded-md border border-border bg-[#073642] p-3 pr-12 text-[12.5px] text-zinc-100 shadow-[0_4px_14px_rgba(0,0,0,0.35)]',
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
        'flex gap-3 min-w-0 max-w-full',
        // user/thread 소제목은 sticky 상태에서 chat 헤더와 바로 붙도록 위 마진 제거.
        // 그 외(chat 모드 user, 모든 assistant) 는 기존 my-2.
        isUser && convKind === 'thread' ? 'mb-2' : 'my-2',
        // 쓰레드 모드의 user 발화는 소제목처럼 좌측 풀폭으로 — 그 외(chat 모드 user, 모든 assistant) 는 기존대로.
        isUser && convKind !== 'thread' ? 'justify-end' : 'justify-start',
        isFresh &&
          isUser &&
          'animate-in fade-in slide-in-from-bottom-8 zoom-in-95 duration-500 ease-out',
      )}
    >
      {!isUser && convKind !== 'thread' && (
        <Avatar>
          <AvatarFallback>S</AvatarFallback>
        </Avatar>
      )}
      <div
        className={cn(
          'flex flex-col',
          isUser
            ? convKind === 'thread'
              ? 'min-w-0 flex-1'
              : 'max-w-[92%]'
            : 'min-w-0 flex-1',
          // 쓰레드 모드의 assistant 컬럼은 user 헤딩(좌측 풀폭) 아래로 들여쓰기 — 응답·포커카드·References 모두 동일 폭으로.
          !isUser && convKind === 'thread' && 'pl-2',
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
            {/* 포커 이미지 페이지네이션 — 행 맨 우측. ImageScatter 내부 inline 버튼은 hide.
                특정 이미지를 pin/확대한 상태(expandedImageIndex !== null) 에선 스캐터가 보이지 않으므로 < > 도 숨김. */}
            {scatterTotalPages > 1 && expandedImageIndex === null && (
              <div className="ml-auto hidden items-center gap-1 self-center pr-2 text-muted-foreground md:flex">
                <button
                  type="button"
                  onClick={() =>
                    scatterPage > 0 && setScatterPage(scatterPage - 1)
                  }
                  disabled={scatterPage <= 0}
                  aria-label="이전 페이지"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-secondary disabled:pointer-events-none disabled:opacity-30"
                >
                  <span className="text-base">&lt;</span>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    scatterPage < scatterTotalPages - 1 &&
                    setScatterPage(scatterPage + 1)
                  }
                  disabled={scatterPage >= scatterTotalPages - 1}
                  aria-label="다음 페이지"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-secondary disabled:pointer-events-none disabled:opacity-30"
                >
                  <span className="text-base">&gt;</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* 사용자 메시지의 첨부 이미지는 user 버블에서 숨기고 assistant 버블의 References 위 영역에서 표시.
            (precedingUserImages 가 그쪽에서 동일한 카드 UI 로 렌더됨.) */}

        {/* 이미지 영역 — 첨부 이미지 + 검색 이미지를 한 줄(하나의 포커 스캐터) 로 통합.
            카드 클릭 시 라이트박스 대신 인라인으로 큰 이미지 한 장만 노출 (나머지 숨김).
            큰 이미지 클릭 시 다시 스캐터로 복귀. */}
        {!isUser && (() => {
          // 사용자 업로드(첨부) 이미지도 확대 뷰에서 삭제 가능 — removable: true.
          // 삭제 시 removeMessageImage 가 직전 user 메시지의 images/imageNames 에서 제거.
          const attachedSlice: SearchImage[] = (precedingUserImages ?? []).map(
            (src) => ({ url: src, removable: true }),
          );
          // save 한 웹 이미지 → 로컬 사본(/attachments/) 매핑. 카드 식별자(URL)는 원격 그대로
          // 두어 PIN/순서/인덱스 로직을 보존하고, 표시·회전만 로컬 사본으로 처리(localFor).
          // 물리 회전은 우리가 소유한 로컬 파일만 가능하기 때문.
          const allEditUrls = message.editImages ?? [];
          const savedSet = new Set<string>([
            ...(message.savedSourceUrls ?? []),
            ...savedSourceUrls,
          ]);
          const baseName = (u: string): string => {
            try {
              const p = new URL(u, window.location.origin).pathname;
              return decodeURIComponent(p.split('/').filter(Boolean).pop() ?? '');
            } catch {
              return '';
            }
          };
          // 파일명 stem — 확장자 + 중복 회피 접미사(" (1)", "-<timestamp>") 제거 후 비교.
          const stem = (n: string): string =>
            n
              .replace(/\.[^.]+$/, '')
              .replace(/[\s_-]*\(\d+\)$/, '')
              .replace(/-\d{10,}$/, '');
          // 원격 source URL → 로컬 사본 URL 매핑 (basename 우선, 실패 시 stem 매칭).
          const localFor: Record<string, string> = {};
          const consumedLocal = new Set<string>();
          for (const src of savedSet) {
            const sb = baseName(src);
            const ss = stem(sb);
            const hit = allEditUrls.find(
              (l) =>
                !consumedLocal.has(l) &&
                (baseName(l) === sb || stem(baseName(l)) === ss),
            );
            if (hit) {
              localFor[src] = hit;
              consumedLocal.add(hit);
            }
          }
          // 한 이미지의 실제 표시/회전 대상 URL — 저장된 웹 이미지면 로컬 사본, 아니면 원본.
          const resolveLocal = (u: string): string => localFor[u] ?? u;
          // 자연 순서(첨부 → readPages → editImages) 를 imageOrder 가 있으면 그 순서대로 재배열.
          // 원격 카드의 로컬 사본으로 소비된 editImages 는 중복 카드 방지를 위해 제외.
          const editImgSlice: SearchImage[] = allEditUrls
            .filter((url) => !consumedLocal.has(url))
            .map((url) => ({ url, removable: true }));
          const combinedImages: SearchImage[] = applyImageOrder(
            [...attachedSlice, ...readPageImagesFlat, ...editImgSlice],
            message.imageOrder,
          );
          const hasAny = combinedImages.length > 0;
          // 1장 / N장 모두 동일 흐름: 항상 포커 카드 → 클릭 → 확대 → 닫기 → 포커 카드.
          const usePoker = true;
          const expanded =
            expandedImageIndex !== null
              ? combinedImages[expandedImageIndex] ?? null
              : null;
          if (!hasAny) {
            // Processing pages 상태(hasStatusPending)에서는 이미지가 올지 미확정이므로 공간 미확보.
            // References 가 표시되는 순간(hasReadPagesData)부터 이미지 최대폭을 미리 확보해
            // 이미지 도착 시 References 가 아래로 밀리지 않도록 함.
            const hasImageExpected =
              isStreaming &&
              (hasReadPagesData || hasPrecedingUserImages);
            return hasImageExpected ? (
              <div aria-hidden className="mb-2 min-h-[170px]" />
            ) : null;
          }
          // PIN 시각 상태 — 사용자가 명시적으로 PIN 한 경우에만 활성.
          const isExplicitlyPinned = expanded
            ? message.pinnedImageUrl === expanded.url
            : false;
          const isPinnedEffective = isExplicitlyPinned;
          // 확대 모드 — 스캐터는 항상 마운트 유지(아래에서 hidden 처리)하고, 큰 이미지를
          // 그 자리에 오버레이로 띄운다. (조건부 return 으로 스캐터를 unmount/remount 하면
          // 닫을 때 LazyVisible 재게이트·perPage 리셋·카드 재애니메이션으로 버벅임 발생)
          let expandedView: ReactNode = null;
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

            // 좌측 스택(첨부/저장/삭제) — 없는 버튼은 건너뛰고 다음 버튼이 위로 당겨지도록 packed slot 계산.
            const _u = expanded.url ?? '';
            const _isImgKind =
              expanded.kind !== 'youtube' && expanded.kind !== 'x';
            const showAttachBtn = !!onAttachImage && _isImgKind;
            const _isSavedImg =
              _u.includes('/attachments/') ||
              savedSourceUrls.has(_u) ||
              (message.savedSourceUrls?.includes(_u) ?? false);
            // 회전 — 물리 회전은 우리가 소유한 로컬 파일(/attachments/)만 가능.
            // 업로드 첨부, save 로 만든 로컬 사본, 그리고 save 된 웹 이미지(→로컬 사본으로 resolve)
            // 가 모두 해당. resolveLocal 로 실제 회전/표시 대상 URL 을 구한다.
            const _rotateTarget = resolveLocal(_u);
            const _isLocalFile = _rotateTarget.includes('/attachments/');
            const showRotate = !!onRotateImage && _isImgKind && _isLocalFile;
            // 표시 크기 — (물리 회전 반영된)자연 크기를 긴 변 340px 로 맞춤. 로드 전엔 0(폴백 클래스).
            // 모바일(<640px): 좌우 버튼 거터(≈160px)와 함께 화면을 넘치지 않도록 긴 변을 화면 폭에 맞춤.
            // 데스크탑: Reference documents 와 같은 컬럼 가용폭(mediaWrapW)에서 버튼 거터(160)+여유(16)를
            //   뺀 만큼까지 키워 원본 해상도에 더 가깝게 크게 표시(측정 전엔 기존 340). sc 가 1 을 넘지 않아
            //   원본보다 확대(블러)되지는 않는다.
            const EXP_MAXD =
              viewportW > 0 && viewportW < 640
                ? Math.max(120, Math.floor(viewportW * 0.9) - 168)
                : mediaWrapW > 0
                  ? Math.max(340, mediaWrapW - 176)
                  : 340;
            // 로드 전에도 캐시된 자연 크기가 있으면 그걸로 첫 렌더부터 최종 크기를 잡아
            // 열 때 'fallback 크기→최종 크기' 리사이즈(커졌다 줄어드는 느낌)를 없앤다.
            const cachedNat = (() => {
              if (expandedNatural) return null;
              const s = getImageState(_u);
              return s?.natW && s?.natH ? { w: s.natW, h: s.natH } : null;
            })();
            const effNatural = expandedNatural ?? cachedNat;
            let imgDispW = 0;
            let imgDispH = 0;
            if (effNatural && effNatural.w > 0 && effNatural.h > 0) {
              const long = Math.max(effNatural.w, effNatural.h);
              const sc = long > EXP_MAXD ? EXP_MAXD / long : 1;
              imgDispW = Math.round(effNatural.w * sc);
              imgDispH = Math.round(effNatural.h * sc);
              // 세로로 긴 이미지는 화면을 너무 많이 차지 → 데스크탑에서만 20% 축소.
              // (가로 이미지는 그대로, 모바일도 그대로)
              const isMobile = viewportW > 0 && viewportW < 640;
              if (!isMobile && effNatural.h > effNatural.w) {
                imgDispW = Math.round(imgDispW * 0.8);
                imgDispH = Math.round(imgDispH * 0.8);
              }
            }
            // 회전 후 필요한 세로 공간 = 긴 변(가로/세로 중 큰 값). 회전 시작 시 래퍼 높이를 이 값으로
            // 애니메이션(transition)해 먼저 확보한 뒤, 230ms 후 이미지를 돌린다(handleRotate 1→2단계).
            const rotatingThis = rotatingUrl === resolveLocal(_u);
            const reservedH = Math.max(imgDispW, imgDispH);
            const showSaveBtn =
              _isImgKind && !!_u && (_isSavedImg || !!onUploadEditImage);
            const showDeleteBtn =
              !!onRemoveImage && expanded.removable !== false;
            const _leftStack: string[] = [];
            if (showAttachBtn) _leftStack.push('attach');
            if (showSaveBtn) _leftStack.push('save');
            if (showDeleteBtn) _leftStack.push('delete');
            const leftTop = (k: 'attach' | 'save' | 'delete') =>
              `${0.75 + Math.max(0, _leftStack.indexOf(k)) * 2.25}rem`;
            expandedView = (
              // pin 상태(stuck) 에서는 animate-in 의 transform 이 fixed 자손의 containing block 을
              // wrapper 로 바꿔서 스크롤 시 fixed iframe 이 살짝 따라 움직이는 깜빡임 발생 → 끔.
              <div
                ref={mediaWrapRef}
                className={cn(
                  'mb-6 max-w-full',
                  // 회전 중에는 가로 클리핑을 풀어 회전 배경면이 잘려 흰색이 드러나지 않게 한다.
                  rotatingUrl ? 'overflow-visible' : 'overflow-x-clip',
                  !stuck && 'animate-in fade-in zoom-in-95 duration-200',
                )}
              >
                {/* placeholder — 핀 모드일 때 wrapper 가 fixed 로 빠지므로 같은 높이를 차지해 layout 흔들림 방지. */}
                {stuck && reservedHeight > 0 && (
                  <div style={{ height: reservedHeight }} aria-hidden />
                )}
                <div
                  className={cn(
                    'flex justify-center',
                    // top-[68px] — chat 헤더(68px) 바로 아래에 붙음.
                    // will-change-transform + translate3d(0,0,0) — GPU compositor layer 로 promote 해
                    // 스크롤 중 iframe 의 thumbnail repaint 깜빡임 방지.
                    stuck &&
                      'fixed top-[68px] z-30 transition-none [transform:translate3d(0,0,0)] will-change-transform [backface-visibility:hidden] [contain:layout_paint]',
                  )}
                  style={
                    stuck && pinnedLeft !== null
                      ? { left: pinnedLeft }
                      : undefined
                  }
                >
                <div
                  className={cn(
                    // 우측 거터(pr-20)=닫기/핀, 좌측 거터(pl-20)=첨부/저장/삭제 포스트잇 버튼 자리.
                    // 회전 중엔 버튼이 숨겨지므로 거터/폭 제한을 없애 회전 스윕이 잘리지 않게 한다.
                    rotatingUrl ? 'relative' : 'relative pr-20',
                    // YouTube 는 컨테이너 폭에 맞춰 줄어들도록 block + w-full 사용 (max 800px).
                    // 단, stuck 시엔 fixed 부모가 viewport 폭이 되므로 캡처된 width 를 inline style 로 강제.
                    isYouTube
                      ? stuck
                        ? ''
                        : 'w-full max-w-[800px] pl-20' // 좌측 Delete 버튼이 영상 위로 겹치지 않게 거터 확보
                      : rotatingUrl
                        ? 'inline-block'
                        : 'inline-block max-w-full pl-20',
                    // 모바일: 회전 버튼이 이미지 아래로 내려가므로 그만큼 하단 공간을 확보해
                    // 아래 References 와 겹치지 않게 한다(데스크탑은 모서리에 있어 불필요).
                    showRotate && 'max-[639px]:pb-12',
                  )}
                  style={
                    isYouTube && stuck && pinnedWidth !== null
                      ? { width: pinnedWidth + 80 }
                      : undefined
                  }
                >
                  {/* 우측 포스트잇 버튼 그룹 (Close / Attach / Delete / PIN).
                      PiP 버튼은 wrapper 밖에 별도 렌더 — PiP 모드에서도 unpip 가능해야 함.
                      숨김 조건:
                        · 현재 expanded 미디어 URL 에 대한 삭제 확인 오버레이 표시 중
                        · YouTube 미디어 + PiP 모드 (unpip 외 다른 액션 의미 없음)
                      `isYoutubePinned` 만 보면 다른 카드로 이동한 뒤에도 stale 상태가 남아
                      버튼이 비활성으로 보일 수 있어 반드시 `isYouTube` 와 함께 검사.
                      absolute 자식들의 containing block 은 상위 `relative pr-20` 이므로
                      이 wrapper div 가 끼어들어도 위치 재계산 영향 없음. */}
                  <div
                    className={cn(
                      'transition-opacity duration-150',
                      // 회전 중에는 포스트잇 버튼들을 숨기고(rotatingUrl), 회전이 끝나면 다시 노출.
                      (pendingDeleteUrl === expanded.url ||
                        (isYouTube && isYoutubePinned) ||
                        !!rotatingUrl ||
                        (!isYouTube && !expandedImageLoaded)) &&
                        'pointer-events-none opacity-0',
                    )}
                    aria-hidden={
                      pendingDeleteUrl === expanded.url ||
                      (isYouTube && isYoutubePinned) ||
                      !!rotatingUrl ||
                      (!isYouTube && !expandedImageLoaded)
                    }
                  >
                  {(() => {
                    // PIN(명시 + 단일 자동) 상태에선 Close 비활성화 — PIN 의 본 목적이 "노출 유지" 이므로
                    // 사용자는 UNPIN 후 Close 해야 한다는 UX. dim + tooltip 으로 안내.
                    const closeDisabled = isPinnedEffective;
                    return (
                      <button
                        type="button"
                        disabled={closeDisabled}
                        onClick={() => {
                          if (closeDisabled) return;
                          if (expanded?.url) {
                            setAutoPinOverrideUrls((prev) => {
                              if (prev.has(expanded.url)) return prev;
                              const next = new Set(prev);
                              next.add(expanded.url);
                              return next;
                            });
                          }
                          setExpandedImageIndex(null);
                          setIsYoutubePinned(false);
                          // pendingDeleteUrl 잔여 상태 방지 — 닫을 때 같이 클리어.
                          setPendingDeleteUrl(null);
                        }}
                        title={
                          closeDisabled
                            ? 'PIN 해제 후 닫기 가능'
                            : t('image.postit.close')
                        }
                        className={cn(
                          'absolute right-1 top-3 z-20 inline-flex -rotate-6 items-center gap-1 rounded-md border border-primary/40 bg-card px-2 py-0.5 text-[11px] font-medium text-primary shadow-md transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                          closeDisabled
                            ? 'cursor-not-allowed opacity-40'
                            : 'hover:rotate-0 hover:bg-primary hover:text-primary-foreground',
                        )}
                      >
                        <X className="h-3 w-3" />
                        {t('image.postit.close')}
                      </button>
                    );
                  })()}
                  {/* 회전 — 저장 이미지 한정. close/attach 와 같은 포스트잇 버튼으로
                      이미지 좌하단(↺)·우하단(↻) 거터에 배치. */}
                  {showRotate && (
                    <>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void handleRotate(_rotateTarget, 270)}
                        disabled={!!rotatingUrl}
                        title="왼쪽으로 90° 회전"
                        aria-label="왼쪽으로 90° 회전"
                        // 데스크탑: 이미지 좌하단 모서리. 모바일(<640px): 컨테이너 하단에 확보한 틈(pb-12)
                        // 안으로 내려가 상단 버튼 스택·하단 References 와 모두 겹치지 않는다.
                        className="absolute bottom-1 left-10 z-20 inline-flex -rotate-3 items-center justify-center rounded-md border border-primary/40 bg-card px-2 py-1 text-primary shadow-md transition-transform hover:rotate-0 hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 max-[639px]:left-2"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => void handleRotate(_rotateTarget, 90)}
                        disabled={!!rotatingUrl}
                        title="오른쪽으로 90° 회전"
                        aria-label="오른쪽으로 90° 회전"
                        // 데스크탑: 이미지 우하단 모서리. 모바일(<640px): 컨테이너 하단 틈(pb-12) 안으로 내려감.
                        className="absolute bottom-1 right-10 z-20 inline-flex rotate-3 items-center justify-center rounded-md border border-primary/40 bg-card px-2 py-1 text-primary shadow-md transition-transform hover:rotate-0 hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 max-[639px]:right-2"
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  {onAttachImage &&
                    expanded.kind !== 'youtube' &&
                    expanded.kind !== 'x' &&
                    (() => {
                      // 이미 InputBar 에 같은 source URL 이 첨부돼 있으면 dim + 비활성.
                      // 사용자가 InputBar 의 × 로 제거하면 자동으로 활성화.
                      const isAttached =
                        !!attachedSourceUrls?.has(expanded.url);
                      return (
                        <button
                          type="button"
                          disabled={isAttached}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (isAttached) return;
                            onAttachImage(expanded.url);
                          }}
                          title={
                            isAttached
                              ? '이미 첨부됨'
                              : t('image.postit.attach')
                          }
                          style={{ top: leftTop('attach') }}
                          className={cn(
                            'absolute left-1 z-20 inline-flex rotate-3 items-center gap-1 rounded-md border border-primary/40 bg-card px-2 py-0.5 text-[11px] font-medium text-primary shadow-md transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                            isAttached
                              ? 'cursor-not-allowed opacity-40'
                              : 'hover:rotate-0 hover:bg-primary hover:text-primary-foreground',
                          )}
                        >
                          <ImagePlus className="h-3 w-3" />
                          {t('image.postit.attach')}
                        </button>
                      );
                    })()}
                  {onRemoveImage &&
                    expanded.removable !== false &&
                    (() => {
                      // PIN 상태(명시 + 단일 자동) 에선 사용자가 "보존" 의도이므로 dim + 비활성.
                      const deleteDisabled = isPinnedEffective;
                      return (
                        <button
                          type="button"
                          disabled={deleteDisabled}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (deleteDisabled) return;
                            // 즉시 삭제 대신 채팅창 안 확인 다이얼로그로 통일.
                            setPendingDeleteUrl(expanded.url);
                          }}
                          title={
                            deleteDisabled
                              ? 'PIN 해제 후 삭제 가능'
                              : t('image.postit.delete')
                          }
                          style={{ top: leftTop('delete') }}
                          className={cn(
                            'absolute left-1 z-20 inline-flex rotate-3 items-center gap-1 rounded-md border border-destructive/50 bg-card px-2 py-0.5 text-[11px] font-medium text-destructive shadow-md transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive',
                            deleteDisabled
                              ? 'cursor-not-allowed opacity-40'
                              : 'hover:rotate-0 hover:bg-destructive hover:text-destructive-foreground',
                          )}
                        >
                          <Trash2 className="h-3 w-3" />
                          {t('image.postit.delete')}
                        </button>
                      );
                    })()}
                  {/* PIN — 페이지 이탈 후 복귀해도 이 미디어(이미지/유튜브)가 자동 확대되도록
                      message.metadata 에 영속. YouTube 의 PIP(floating 재생) 와 다른 개념. */}
                  {onPinImage &&
                    expanded.kind !== 'x' &&
                    (() => {
                      const isPinned = isPinnedEffective;
                      return (
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            if (isExplicitlyPinned) {
                              // 명시적 PIN 해제 → DB 정리.
                              onPinImage(message.id, null);
                              setAutoPinOverrideUrls((prev) => {
                                const next = new Set(prev);
                                next.add(expanded.url);
                                return next;
                              });
                            } else {
                              // PIN 설정 → DB 저장.
                              onPinImage(message.id, expanded.url);
                              setAutoPinOverrideUrls((prev) => {
                                if (!prev.has(expanded.url)) return prev;
                                const next = new Set(prev);
                                next.delete(expanded.url);
                                return next;
                              });
                            }
                          }}
                          title={isPinned ? 'UNPIN' : 'PIN'}
                          className={cn(
                            'absolute right-1 top-12 z-20 inline-flex -rotate-2 items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium shadow-md transition-transform hover:rotate-0 focus-visible:outline-none focus-visible:ring-2',
                            isPinned
                              ? 'border-primary bg-primary text-primary-foreground focus-visible:ring-primary hover:bg-primary/90'
                              : 'border-primary/40 bg-card text-primary focus-visible:ring-primary hover:bg-primary hover:text-primary-foreground',
                          )}
                        >
                          {isPinned ? (
                            <PinOff className="h-3 w-3" />
                          ) : (
                            <Pin className="h-3 w-3" />
                          )}
                          {isPinned ? 'UNPIN' : 'PIN'}
                        </button>
                      );
                    })()}
                  {/* 저장 상태 칩/버튼 — 좌측 스택의 가운데(첨부 아래, 삭제 위).
                      · 첨부(/attachments/) 또는 이미 저장한 웹 이미지 → "저장됨" dim 칩(비활성)
                      · 미저장 웹(외부) 이미지 → "저장" 활성 버튼 → 누르면 서버 업로드(첨부와 동일) */}
                  {expanded.kind !== 'youtube' &&
                    expanded.kind !== 'x' &&
                    !!expanded.url &&
                    (() => {
                      const isAttachment =
                        expanded.url.includes('/attachments/');
                      const isSaved =
                        isAttachment ||
                        savedSourceUrls.has(expanded.url) ||
                        (message.savedSourceUrls?.includes(expanded.url) ??
                          false);

                      // 저장됨 — dim 칩(비활성).
                      if (isSaved) {
                        return (
                          <span
                            aria-label={t('image.postit.archived')}
                            title={t('image.postit.archived')}
                            style={{ top: leftTop('save') }}
                            className="pointer-events-none absolute left-1 z-20 inline-flex rotate-2 items-center gap-1 rounded-md border border-primary/40 bg-card px-2 py-0.5 text-[11px] font-medium text-primary opacity-40 shadow-md"
                          >
                            <Archive className="h-3 w-3" />
                            {t('image.postit.archived')}
                          </span>
                        );
                      }

                      // 미저장 웹 이미지 — 저장 버튼(업로드 핸들러 있을 때만).
                      if (!onUploadEditImage) return null;
                      const isSaving = savingUrl === expanded.url;
                      return (
                        <button
                          type="button"
                          disabled={isSaving}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => handleSaveWebImage(expanded.url)}
                          title={t('image.postit.save')}
                          style={{ top: leftTop('save') }}
                          className={cn(
                            'absolute left-1 z-20 inline-flex rotate-2 items-center gap-1 rounded-md border border-primary/40 bg-card px-2 py-0.5 text-[11px] font-medium text-primary shadow-md transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                            isSaving
                              ? 'cursor-wait opacity-60'
                              : 'hover:rotate-0 hover:bg-primary hover:text-primary-foreground',
                          )}
                        >
                          <Archive className="h-3 w-3" />
                          {t('image.postit.save')}
                        </button>
                      );
                    })()}
                  </div>
                  {/* PiP(YouTube 핀) 버튼은 PiP 모드에서도 유일하게 노출돼야 하므로 wrapper 밖. */}
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
                      className="absolute right-1 top-[5.25rem] z-20 inline-flex rotate-3 items-center gap-1 rounded-md border border-primary/40 bg-card px-2 py-0.5 text-[11px] font-medium text-primary shadow-md transition-transform hover:rotate-0 hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
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
                      YouTube 는 부모(block) 의 폭을 그대로 따르도록 w-full, 이미지는 자연 크기 inline-block.
                      pendingDeleteUrl 매칭 시 이 박스 위에만 블러 + Delete 오버레이. */}
                  <div
                    className={cn(
                      'relative z-10',
                      // 이미지: 프레임(라운드/그림자/클리핑)은 안쪽 '사진 박스' 가 가지고 통째로 회전한다.
                      //         바깥은 위치 래퍼라 클리핑하지 않아야 회전 스윕이 잘리지 않음.
                      // YouTube: 기존처럼 바깥 박스에 프레임 적용.
                      isYouTube
                        ? 'w-full overflow-hidden rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.5)]'
                        : 'inline-block max-w-full',
                    )}
                  >
                    {pendingDeleteUrl === expanded.url && onRemoveImage && (
                      <div
                        className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/55 px-6 text-center backdrop-blur-md animate-in fade-in duration-150"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDeleteUrl(null);
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-5 w-5 text-destructive drop-shadow" />
                          <h3 className="text-[15px] font-semibold text-white">
                            {t('delete.image.title')}
                          </h3>
                        </div>
                        <p className="max-w-sm text-[13px] leading-relaxed text-white/85">
                          {t('delete.image.body')}
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDeleteUrl(null);
                            }}
                            className="rounded-md border border-white/40 bg-black/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-black/50"
                          >
                            {t('delete.cancel')}
                          </button>
                          <button
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onRemoveImage(expanded.url);
                              setPendingDeleteUrl(null);
                              setExpandedImageIndex(null);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/60 bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground shadow-xl hover:bg-destructive/90"
                          >
                            <Trash2 className="h-4 w-4" />
                            {t('delete.confirm')}
                          </button>
                        </div>
                        <button
                          type="button"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDeleteUrl(null);
                          }}
                          aria-label={t('delete.cancel')}
                          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border border-white/40 bg-black/55 text-white shadow-md hover:bg-black/75"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                    {youtubeId ? (
                      <div
                        ref={inlineVideoBoxRef}
                        className="relative aspect-video w-full bg-black transform-gpu [contain:paint] will-change-transform"
                      >
                        {/* iframe 자체에도 GPU layer + key 로 안정성 확보 — 스크롤 중 thumbnail 재로딩 방지. */}
                        <iframe
                          key={`yt-${youtubeId}`}
                          src={`https://www.youtube.com/embed/${youtubeId}`}
                          title={expanded.sourceTitle ?? 'YouTube'}
                          className="absolute inset-0 h-full w-full transform-gpu"
                          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                          allowFullScreen
                          loading="eager"
                        />
                      </div>
                    ) : (
                      <div
                        className="relative flex items-center justify-center"
                        // 회전 중에는 래퍼 높이를 '회전 후 필요한 높이(reservedH=긴 변)'로 애니메이션해
                        // 세로 공간을 먼저 확보한다(height transition). 그 동안 이미지는 아직 회전하지 않고,
                        // 확보가 끝난 뒤 회전 → 회전이 끝나도 아래 컨텐츠가 밀려나지 않음. 가로폭은 자동.
                        style={
                          effNatural
                            ? {
                                height: rotatingThis ? reservedH : imgDispH,
                                transition: heightAnim
                                  ? 'height 220ms ease'
                                  : 'none',
                              }
                            : undefined
                        }
                      >
                        {/* 사진 박스 — 라운드/그림자/클리핑을 '항상' 유지한 채 통째로 회전한다.
                            끝낼 때는 트랜지션을 꺼서(스냅) 리사이즈·프레임 재표시 애니메이션이 생기지 않음. */}
                        <div
                          className="relative z-10 overflow-hidden rounded-lg shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
                          style={{
                            ...(effNatural
                              ? { width: imgDispW, height: imgDispH }
                              : {}),
                            transform: spin ? `rotate(${spin}deg)` : undefined,
                            transition: spinTransition
                              ? 'transform 260ms ease'
                              : 'none',
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={withCacheBust(
                              resolveLocal(expanded.url),
                              imgBust[resolveLocal(expanded.url)],
                            )}
                            alt={expanded.sourceTitle ?? '이미지'}
                            referrerPolicy="no-referrer"
                            onLoad={(e) => {
                              const el = e.currentTarget;
                              setExpandedNatural({
                                w: el.naturalWidth,
                                h: el.naturalHeight,
                              });
                              // 자연 크기 캐시 — 다음에 열 때 첫 렌더부터 최종 크기로 그리도록.
                              setImageState(_u, {
                                natW: el.naturalWidth,
                                natH: el.naturalHeight,
                              });
                              setExpandedImageLoaded(true);
                            }}
                            // PIN 상태에서만 클릭하면 원본을 새 탭에서 열기 — Close/Delete 가 dim 된 PIN UX 와 일관.
                            // 회전된 로컬 사본을 회전 반영된 상태로 열도록 resolveLocal + 캐시버스트 적용.
                            onClick={
                              isPinnedEffective
                                ? () => {
                                    const target = resolveLocal(expanded.url);
                                    window.open(
                                      withCacheBust(target, imgBust[target]),
                                      '_blank',
                                      'noopener,noreferrer',
                                    );
                                  }
                                : undefined
                            }
                            title={
                              isPinnedEffective
                                ? '원본 새 탭에서 열기'
                                : undefined
                            }
                            className={cn(
                              'block',
                              // 박스(자연비율로 계산됨)를 정확히 꽉 채운다 — object-contain 의 반올림
                              // 레터박스(하단 흰 띠) 방지. 크기 미상(캐시도 없음)일 때만 contain 폴백.
                              effNatural
                                ? 'h-full w-full'
                                : 'max-h-[340px] max-w-full object-contain',
                              isPinnedEffective && 'cursor-zoom-in',
                            )}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                </div>
              </div>
            );
          }
          // 스캐터는 항상 마운트(remount 방지). 확대 중엔 hidden 으로 숨기고 expandedView 를 오버레이.
          // 화면 밖이면 렌더 지연(레이지) — 자리(min-h 170)는 미리 확보.
          return (
            <>
              {expandedView}
              <div className={cn(expanded && 'hidden')}>
                <LazyVisible reservedHeight={170}>
                  <ImageScatter
                    images={combinedImages}
                    cardOverlap={CARD_OVERLAP}
                    // 첨부/웹 이미지 모두 동일하게 인라인 확대 — 별도 라이트박스 없음.
                    onCardClick={(i) => setExpandedImageIndex(i)}
                    onInvalid={markInvalid}
                    forcePoker={usePoker}
                    page={scatterPage}
                    onPageChange={setScatterPage}
                    onTotalPagesChange={setScatterTotalPages}
                    hideInlinePagination
                    hidden={!!expanded}
                    bust={imgBust}
                    localFor={localFor}
                    holdPop={!popReady}
                  />
                </LazyVisible>
              </div>
            </>
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
                  (precedingUserImages?.length ?? 0) >= 1 ||
                  (message.editImages?.length ?? 0) >= 1) &&
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
              {/* 우측: 스트리밍 중엔 Thinking 토글, 스트리밍 종료 후엔 Image Edit 으로 교체.
                  같은 자리에 한 가지만 표시 → 둘이 겹치지 않음. */}
              {isStreaming && hasThinkingText && !hasStatusPending ? (
                <button
                  type="button"
                  onClick={toggle}
                  className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10.5px] font-normal text-muted-foreground hover:text-foreground"
                  title={thinkingLabel}
                >
                  <ThinkingIcon className="h-3 w-3 text-primary" />
                  <span>
                    {thinkingLabel}
                    {isStreaming && <>{' '}{t('bot.thinkingWriting')}</>}
                  </span>
                  {open ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                </button>
              ) : onRemoveImage && convKind === 'thread' ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setImageEditMode((v) => !v)}
                      aria-pressed={imageEditMode}
                      className={cn(
                        'ml-auto inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold shadow-sm transition-colors',
                        imageEditMode
                          ? 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
                          : 'border-primary/50 bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground',
                      )}
                    >
                      <Images className="h-3.5 w-3.5" />
                      <span>{t('imageEdit.button')}</span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={4}>
                    {t('imageEdit.buttonHint')}
                  </TooltipContent>
                </Tooltip>
              ) : null}
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
                <ul className="mt-1.5 ml-1.5 flex w-full min-h-[53px] flex-col gap-0.5 border-l-2 border-primary/30 pl-3">
                  {referencesList.map((r, i) => (
                    <ReadPageRow
                      key={r.url}
                      page={r}
                      index={i + (precedingUserImages?.length ?? 0)}
                      animate={isStreaming}
                    />
                  ))}
                </ul>
              </TooltipProvider>
            )}

            {/* 2) 진행 상태 — 웹 링크 아래에 표시 (URL 처리/Tavily 폴백 단계) */}
            {hasStatusPending && (
              <div className="mt-2 flex items-center gap-2">
                <StatusBadge status={message.status!} />
                {isStreaming && hasThinkingText && (
                  <button
                    type="button"
                    onClick={toggle}
                    className="ml-auto inline-flex items-center gap-1 rounded-full border border-border bg-background/40 px-2 py-0.5 text-[10.5px] font-normal text-muted-foreground hover:text-foreground"
                    title={thinkingLabel}
                  >
                    <ThinkingIcon className="h-3 w-3 text-primary" />
                    <span>{thinkingLabel}{isStreaming && <>{' '}{t('bot.thinkingWriting')}</>}</span>
                    {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                )}
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
              height="44"
              viewBox="0 0 14 44"
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
                {/* 컨테이너 -my-2 (=−8px) + SVG height 44 → 실제 layout 박스 28px.
                    상단 패널 하단 경계 = y=8, 하단 패널 상단 경계 = y=36 (44−8).
                    이전(layout 18px) 보다 10px 더 늘려 AI 답변을 살짝 아래로 밀고,
                    곡선·도트가 자연스럽게 길게 이어지도록.
                    선·도트 색은 white 테마의 --primary (30 60% 48%) 톤으로 하드코딩 —
                    다크에서도 동일한 진한 골든 톤 유지. */}
                {/* 양 끝점 (7,8) / (7,36) 은 도트 중심과 일치 유지.
                    이중 S 커브 — 위에서 오른쪽으로 휘었다가 가운데에서 다시 왼쪽으로 꺾여 내려옴.
                    control point 들의 x 를 viewBox 좌우 끝(0/14) 까지 밀어 곡률 강조. */}
                <path
                  d="M 7 8 C 14 13, 0 21, 7 22 C 14 23, 0 31, 7 36"
                  stroke="hsl(30 60% 48% / 0.7)"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  fill="none"
                />
                {/* 위쪽 halo + core 도트 — cy=8 (Reference documents 패널 하단 경계).
                    core 의 바깥쪽 stroke 는 흰색 고정 — 다크에서 코어 가장자리에 흰 링이 또렷이 보이도록
                    (white 테마는 어차피 배경이 흰색이라 변화 없음). */}
                <circle cx="7" cy="8" r="5" fill="hsl(var(--ref-connector-halo))" />
                <circle
                  cx="7"
                  cy="8"
                  r="2.5"
                  fill="hsl(30 60% 48%)"
                  stroke="hsl(0 0% 100%)"
                  strokeWidth="1"
                />
                {/* 아래쪽 halo + core 도트 — cy=36 (AI 답변 패널 상단 경계). */}
                <circle cx="7" cy="36" r="5" fill="hsl(var(--ref-connector-halo))" />
                <circle
                  cx="7"
                  cy="36"
                  r="2.5"
                  fill="hsl(30 60% 48%)"
                  stroke="hsl(0 0% 100%)"
                  strokeWidth="1"
                />
              </g>
            </svg>
          </div>
        )}


        {/* 초기 대기 (status도 thinking도 아직 없을 때) — 사용자가 기다리는 걸 알 수 있도록.
            isLive 조건: 실제로 스트리밍 중인 메시지에서만 표시 → 빈 채로 남은(중단/실패한)
            과거 메시지를 다시 열어도 "준비 중…"이 영구히 뜨지 않도록 한다. */}
        {!isUser &&
          isLive &&
          !message.content &&
          !message.status &&
          !hasThinkingText &&
          !hasReadPagesData && (
            <div className="mb-1.5 inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-secondary/60 px-3 py-1 text-[12px] text-muted-foreground">
              <Sparkles className="h-3 w-3 animate-pulse text-primary" />
              <span>{t('bot.preparingResponse')}</span>
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
            isUser
              ? convKind === 'thread'
                ? 'items-start'
                : 'items-end'
              : 'items-stretch',
          )}
        >
          {/* 모바일 전용 풀스크린 제목 편집기 */}
          {mobileHeadingOpen && (
            <div className="fixed inset-x-0 top-0 z-[500] flex h-dvh flex-col bg-background md:hidden">
              <div className="flex shrink-0 items-center border-b border-border px-4 py-3">
                <button
                  type="button"
                  onClick={() => setMobileHeadingOpen(false)}
                  className="text-sm text-muted-foreground"
                >
                  {t('delete.cancel')}
                </button>
                <span className="flex-1 text-center text-sm font-medium">
                  {t('edit.title')}
                </span>
                <button
                  type="button"
                  onClick={commitMobileHeadingEdit}
                  className="text-sm font-semibold text-primary"
                >
                  {t('edit.save')}
                </button>
              </div>
              <textarea
                ref={mobileHeadingRef}
                value={mobileHeadingDraft}
                onChange={(e) => setMobileHeadingDraft(e.target.value)}
                className="flex-1 resize-none bg-transparent p-5 text-[18px] font-semibold leading-snug text-foreground outline-none"
              />
            </div>
          )}

          {message.content && isUser && convKind === 'thread' && (
            <Tooltip>
              <TooltipTrigger asChild>
            <h2
              id={`user-msg-${message.id}`}
              // 헤딩 전체가 클릭 → 편집 트리거. 내부 button/link 의 stopPropagation 으로 자기 영역 분리.
              onClick={
                !headingEditing && !mobileHeadingOpen && onEditContent
                  ? (e) => {
                      // 텍스트 드래그 선택 중에는 편집 진입 무시.
                      const sel = window.getSelection?.();
                      if (sel && sel.toString().length > 0) return;
                      e.stopPropagation();
                      startHeadingEdit();
                    }
                  : undefined
              }
              className={cn(
                // 일반 인라인 소제목 (sticky 제거, 헤더의 sub-heading 표시가 그 역할 대신).
                'group/bubble relative mt-3 w-full max-w-full py-1 pl-1 pr-16 text-left text-[18px] font-semibold leading-snug tracking-tight text-foreground first:mt-0',
                !headingEditing &&
                  !mobileHeadingOpen &&
                  onEditContent &&
                  'cursor-text rounded-sm transition-colors hover:bg-accent/40',
              )}
            >
              {typeof userOrdinal === 'number' && (
                <span aria-hidden className="mr-1 text-primary tabular-nums">
                  {userOrdinal}.
                </span>
              )}
              {headingEditing ? (
                // contenteditable span — 인라인 흐름 그대로라 ordinal/주변 텍스트가 한 픽셀도 안 움직임.
                // inline-block + width calc 로 행 끝까지 시각 영역 확장 — 짧은 글이어도 한 줄 전체 클릭 가능.
                // ordinal(~2em) + 우측 액션(pr-16 ≈ 4em) 자리 확보.
                // 초기 텍스트는 useEffect 에서 ref 로 주입 (uncontrolled).
                // key 로 read-only span 과 분리 — React 가 DOM 재사용해서 잔존 텍스트가 합쳐지는 버그 방지.
                <span
                  key="heading-edit"
                  ref={headingEditableRef}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      commitHeadingEdit();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelHeadingEdit();
                    }
                  }}
                  onPaste={(e) => {
                    // 서식 없는 plain text 만 붙여넣기.
                    e.preventDefault();
                    const text = e.clipboardData.getData('text/plain');
                    document.execCommand('insertText', false, text);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  // ordinal (~2em) 자리만 빼고 우측은 pr-16 padding 이 이미 버튼 영역 확보 → 3em 만 reserve.
                  style={{ width: 'calc(100% - 3em)' }}
                  // align-top — inline-block 의 기본 baseline 은 마지막 라인 기준이라
                  // 여러 줄이 되면 옆 ordinal 이 따라 내려감. top 으로 잡으면 첫 줄과 정렬 유지.
                  className="inline-block max-w-full align-top whitespace-pre-wrap break-words rounded-sm bg-transparent outline-none ring-1 ring-primary/40 focus:ring-2 focus:ring-primary/60"
                />
              ) : (
                <span
                  key="heading-view"
                  className="doodle-underline inline-block max-w-full whitespace-pre-wrap break-words"
                >
                  {linkifyText(message.content)}
                </span>
              )}
              {/* 우측 액션 버튼 묶음 — hover/편집 시 노출. 편집 모드일 땐 ✓/×, 그 외엔 휴지통. */}
              <span className="absolute right-0 top-1 flex items-center gap-1">
                {headingEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        commitHeadingEdit();
                      }}
                      title="저장 (Enter)"
                      aria-label="저장"
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md hover:bg-primary/90"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        cancelHeadingEdit();
                      }}
                      title="취소 (Esc)"
                      aria-label="취소"
                      className="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-foreground shadow-md hover:bg-accent"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  onDeleteTurn && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTurn();
                      }}
                      title="이 질문과 답변 삭제"
                      className={cn(
                        'h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-md transition-opacity hover:bg-destructive/90',
                        isCollapsed
                          ? 'flex opacity-100'
                          : 'hidden group-hover/bubble:flex',
                      )}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )
                )}
              </span>
            </h2>
              </TooltipTrigger>
              {!headingEditing && onEditContent && (
                <TooltipContent side="bottom" sideOffset={4}>
                  {t('thread.heading.editHint')}
                </TooltipContent>
              )}
            </Tooltip>
          )}
          {message.content && isUser && convKind !== 'thread' && (
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

          {/* 어시스턴트 답변: 버블 그 자체 + 하단 우측에 포스트잇 해시태그 행.
              본문이 없어도 Reference documents 가 있거나 편집 중이면 Edit/Delete 탭을 표시. */}
          {!isUser && (message.content || hasProcessPanel || answerEditing) && (
            <>
              {/* relative z-[1] — 버블이 아래 탭 위에 올라가서 탭이 "뒷면에서 빠져나온" 느낌. */}
              {(message.content || answerEditing) && <div
                ref={answerBubbleRef}
                className="relative z-[1] w-full min-w-0 max-w-full overflow-x-clip transform-gpu rounded-2xl rounded-tl-md border border-border bg-bubble-bot px-3.5 py-2 text-[14.5px] leading-relaxed text-bubble-bot-foreground shadow-md"
              >
                {answerEditing ? (
                  <>
                    {/* 모바일: 전체화면 오버레이 — transform-gpu 버블이 fixed 의 containing block 이 되므로
                        createPortal 로 document.body 에 직접 마운트. */}
                    {typeof document !== 'undefined' && createPortal(
                      <div className="fixed inset-0 z-[200] flex flex-col bg-background md:hidden">
                        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
                          <button
                            type="button"
                            onClick={cancelAnswerEdit}
                            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-secondary"
                          >
                            <X className="h-3.5 w-3.5" />
                            {t('message.cancel')}
                          </button>
                          <span className="flex-1 text-center text-[13px] font-semibold text-foreground">
                            {t('message.edit')}
                          </span>
                          <button
                            type="button"
                            onClick={commitAnswerEdit}
                            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                          >
                            <Check className="h-3.5 w-3.5" />
                            {t('message.save')}
                          </button>
                        </div>
                        <textarea
                          autoFocus
                          value={answerDraft}
                          onChange={(e) => setAnswerDraft(e.target.value)}
                          className="flex-1 resize-none overflow-y-auto bg-transparent p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
                          placeholder="마크다운으로 답변 편집…"
                          spellCheck={false}
                        />
                      </div>,
                      document.body,
                    )}
                    {/* 데스크탑: 버블 인라인 textarea */}
                    <textarea
                      ref={answerEditRef}
                      value={answerDraft}
                      onChange={(e) => setAnswerDraft(e.target.value)}
                      rows={Math.max(
                        6,
                        Math.min(28, answerDraft.split('\n').length + 2),
                      )}
                      className="hidden w-full min-w-0 max-w-full resize-y bg-transparent font-mono text-[13px] leading-relaxed text-bubble-bot-foreground outline-none placeholder:text-muted-foreground md:block"
                      placeholder="마크다운으로 답변 편집…"
                      spellCheck={false}
                    />
                  </>
                ) : (
                  <div
                    className={cn(
                      markdownClass,
                      'min-w-0 max-w-full',
                      // 연결/스트림 실패 응답 — 본문 전체를 빨간색으로 강조.
                      message.isError &&
                        'font-medium text-red-400 [&_*]:!text-red-400',
                    )}
                  >
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
                )}
              </div>}
              {/* Edit / Save / Cancel — 답변 마크다운 직접 편집.
                  Thread 모드 전용 + greeting 메시지 제외.
                  본문 버블이 있으면 -mt-2 로 겹쳐 탭 느낌, Reference only 면 mt-1 로 분리.
                  검색/처리 진행 중(Searching the web… 등 status 표시, 본문 도착 전)에는
                  아직 편집할 답변이 없으므로 탭을 숨긴다(hasStatusPending). */}
              {onEditContent && !isGreeting && !isLive && !hasStatusPending && convKind === 'thread' && (
                <div className={cn((message.content || answerEditing) ? '-mt-2' : 'mt-2', 'mr-3 flex items-start gap-1 self-end')}>
                  {!answerEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={startAnswerEdit}
                        title={t('message.edit')}
                        className="relative z-[0] inline-flex min-w-[72px] items-center justify-center gap-1 rounded-b-md border border-t-0 border-primary/40 bg-card px-3 pb-1 pt-3 text-[11px] font-medium text-primary shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      >
                        <Pencil className="h-3 w-3" />
                        {t('message.edit')}
                      </button>
                      {onDeleteTurn && (
                        <button
                          type="button"
                          onClick={onDeleteTurn}
                          title={t('message.delete')}
                          className="relative z-[0] inline-flex min-w-[72px] items-center justify-center gap-1 rounded-b-md border border-t-0 border-destructive/40 bg-card px-3 pb-1 pt-3 text-[11px] font-medium text-destructive shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                        >
                          <Trash2 className="h-3 w-3" />
                          {t('message.delete')}
                        </button>
                      )}
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={commitAnswerEdit}
                        title={t('message.save')}
                        className="relative z-[0] inline-flex min-w-[72px] items-center justify-center gap-1 rounded-b-md border border-t-0 border-emerald-500/50 bg-card px-3 pb-1 pt-3 text-[11px] font-medium text-emerald-500 shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-colors hover:bg-emerald-500 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
                      >
                        <Check className="h-3 w-3" />
                        {t('message.save')}
                      </button>
                      <button
                        type="button"
                        onClick={cancelAnswerEdit}
                        title={t('message.cancel')}
                        className="relative z-[0] inline-flex min-w-[72px] items-center justify-center gap-1 rounded-b-md border border-t-0 border-destructive/50 bg-card px-3 pb-1 pt-3 text-[11px] font-medium text-destructive shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-colors hover:bg-destructive hover:text-destructive-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
                      >
                        <X className="h-3 w-3" />
                        {t('message.cancel')}
                      </button>
                    </>
                  )}
                </div>
              )}
              {/* per-message hashtag 렌더는 제거 — Thread 단위로 우측 패널 Hashtags 섹션에서만 노출. */}
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



      {/* Image Edit 모달 — 드래그앤드롭 reorder + 체크박스 일괄 삭제를 Apply 한번에 commit. */}
      {imageEditMode && onRemoveImage && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setImageEditMode(false)}
        >
          <div
            className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-lg border border-border bg-card p-5 shadow-2xl animate-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 삭제 확인 오버레이 — Apply 클릭 시 삭제 항목이 있을 때만 표시. */}
            {imageEditConfirmPending && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 rounded-lg bg-black/60 px-8 text-center backdrop-blur-sm animate-in fade-in duration-150">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive drop-shadow" />
                  <h3 className="text-[15px] font-semibold text-white">
                    {t('imageEdit.confirmTitle')}
                  </h3>
                </div>
                <p className="max-w-sm text-[13px] leading-relaxed text-white/85">
                  {t('imageEdit.confirmBody').replace('{n}', String(imageEditSelection.size))}
                </p>
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setImageEditConfirmPending(false)}
                    className="rounded-md border border-white/40 bg-black/30 px-3 py-1.5 text-sm font-medium text-white hover:bg-black/50"
                  >
                    {t('imageEdit.cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const finalOrder = editingOrderUrls.filter(
                        (u) => !imageEditSelection.has(u),
                      );
                      if (onReorderImages) {
                        onReorderImages(finalOrder);
                      } else {
                        for (const url of imageEditSelection) onRemoveImage(url);
                      }
                      setImageEditConfirmPending(false);
                      setImageEditMode(false);
                      setExpandedImageIndex(null);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-md border border-destructive/60 bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground shadow-xl hover:bg-destructive/90"
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('imageEdit.confirmApply')}
                  </button>
                </div>
              </div>
            )}
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Pencil className="h-4 w-4 text-primary" />
                <span>{t('imageEdit.title')}</span>
                <span className="text-[12px] font-normal text-muted-foreground">
                  ·{' '}
                  {t('imageEdit.count').replace(
                    '{n}',
                    String(editingOrderUrls.length),
                  )}
                </span>
              </h2>
              <button
                type="button"
                onClick={() => setImageEditMode(false)}
                aria-label={t('imageEdit.close')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-[12px] text-muted-foreground">
              {t('imageEdit.helpReorder')}
            </p>
            <div className="-mx-1 flex-1 overflow-y-auto px-1">
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                {editingOrderUrls.map((url, idx) => {
                  const found = combinedImagesForEdit.find((i) => i.url === url);
                  // editImages 가 상위에서 아직 반영 안 된 경우 임시 객체로 폴백.
                  const img: SearchImage = found ?? { url, removable: true };
                  if (!found && !url.includes('/attachments/')) return null;
                  const removable = img.removable !== false;
                  const selected = imageEditSelection.has(img.url);
                  const isDragging = draggingUrl === img.url;
                  const isDragOver =
                    dragOverUrl === img.url && draggingUrl !== img.url;
                  return (
                    <div
                      key={img.url}
                      draggable
                      onDragStart={(e) => {
                        setDraggingUrl(img.url);
                        e.dataTransfer.effectAllowed = 'move';
                        try {
                          e.dataTransfer.setData('text/plain', img.url);
                        } catch {
                          // some browsers throw on setData with certain types
                        }
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (dragOverUrl !== img.url) setDragOverUrl(img.url);
                      }}
                      onDragLeave={() => {
                        if (dragOverUrl === img.url) setDragOverUrl(null);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const src = draggingUrl;
                        setDraggingUrl(null);
                        setDragOverUrl(null);
                        if (!src || src === img.url) return;
                        setEditingOrderUrls((prev) => {
                          const next = prev.filter((u) => u !== src);
                          const targetIdx = next.indexOf(img.url);
                          if (targetIdx < 0) return prev;
                          next.splice(targetIdx, 0, src);
                          return next;
                        });
                      }}
                      onDragEnd={() => {
                        setDraggingUrl(null);
                        setDragOverUrl(null);
                      }}
                      onClick={() => {
                        if (!removable) return;
                        setImageEditSelection((prev) => {
                          const next = new Set(prev);
                          if (next.has(img.url)) next.delete(img.url);
                          else next.add(img.url);
                          return next;
                        });
                      }}
                      title={
                        removable && img.url.includes('/attachments/')
                          ? decodeURIComponent(img.url.split('/').pop() ?? img.url)
                          : removable
                            ? img.sourceTitle ?? img.url
                            : t('imageEdit.attachedTitle')
                      }
                      className={cn(
                        'group/cell relative aspect-square overflow-hidden rounded-md border bg-secondary/40 transition-all',
                        removable ? 'cursor-grab' : 'cursor-grab opacity-90',
                        isDragging && 'opacity-30',
                        selected
                          ? 'border-primary ring-2 ring-primary'
                          : isDragOver
                            ? 'border-amber-400 ring-2 ring-amber-400'
                            : 'border-border hover:border-primary/60',
                      )}
                    >
                      {/* kind 별 셀 본체 — youtube/x 카드는 썸네일 위 브랜드 오버레이,
                          썸네일 없는 X-empty 는 텍스트 기반 카드. 일반 이미지는 단순 img. */}
                      {img.kind === 'youtube' && img.url ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.url}
                            alt={img.sourceTitle ?? 'YouTube'}
                            className="pointer-events-none h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                            draggable={false}
                            onError={(e) => {
                              // YouTube 썸네일이 404 면 모서리에 YT 표시만 남기고 검은 배경 유지.
                              (e.currentTarget as HTMLImageElement).style.visibility =
                                'hidden';
                            }}
                          />
                          <span
                            className="pointer-events-none absolute left-1/2 top-1/2 inline-flex h-7 w-10 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded bg-red-600/95 text-white shadow-md"
                            aria-hidden
                          >
                            <svg
                              viewBox="0 0 24 24"
                              className="h-4 w-4 fill-current"
                            >
                              <path d="M8 5v14l11-7z" />
                            </svg>
                          </span>
                          <span className="pointer-events-none absolute right-1 top-1 rounded bg-red-600/95 px-1 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-white shadow-sm">
                            YouTube
                          </span>
                        </>
                      ) : img.kind === 'x' ? (
                        // X: 썸네일 URL 이 있으면 이미지 + X 배지, 없으면 텍스트 기반 카드.
                        img.url &&
                        /^https?:\/\//i.test(img.url) &&
                        !/^https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\//i.test(
                          img.url,
                        ) ? (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.url}
                              alt={img.sourceTitle ?? 'X'}
                              className="pointer-events-none h-full w-full object-cover"
                              referrerPolicy="no-referrer"
                              draggable={false}
                              onError={(e) => {
                                (e.currentTarget as HTMLImageElement).style.visibility =
                                  'hidden';
                              }}
                            />
                            <span className="pointer-events-none absolute right-1 top-1 inline-flex items-center gap-1 rounded bg-black/85 px-1.5 py-0.5 text-[9.5px] font-semibold text-white shadow-sm">
                              <svg
                                viewBox="0 0 24 24"
                                aria-hidden
                                className="h-2.5 w-2.5 fill-current"
                              >
                                <path d="M18.244 2H21l-6.62 7.563L22 22h-6.79l-4.51-5.835L5.5 22H2.74l7.077-8.087L2 2h6.93l4.083 5.395L18.244 2zm-1.184 18h1.59L7.06 4h-1.7l11.7 16z" />
                              </svg>
                              X
                            </span>
                          </>
                        ) : (
                          <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-1 bg-neutral-900 px-2 text-center text-white">
                            <svg
                              viewBox="0 0 24 24"
                              aria-hidden
                              className="h-5 w-5 fill-current"
                            >
                              <path d="M18.244 2H21l-6.62 7.563L22 22h-6.79l-4.51-5.835L5.5 22H2.74l7.077-8.087L2 2h6.93l4.083 5.395L18.244 2zm-1.184 18h1.59L7.06 4h-1.7l11.7 16z" />
                            </svg>
                            <span className="line-clamp-2 text-[10px] font-medium leading-tight text-white/85">
                              {img.sourceTitle || 'X / Twitter'}
                            </span>
                          </div>
                        )
                      ) : (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={img.url}
                            alt={img.sourceTitle ?? t('imageEdit.imageAlt')}
                            className="pointer-events-none h-full w-full object-cover"
                            referrerPolicy="no-referrer"
                            draggable={false}
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.visibility =
                                'hidden';
                            }}
                          />
                        </>
                      )}
                      {/* 업로드 배지 — 사용자가 직접 업로드한 이미지(/attachments/ URL) 우상단에 표시. */}
                      {removable && img.url.includes('/attachments/') && (
                        <span
                          className="pointer-events-none absolute right-1 top-1 inline-flex items-center justify-center rounded-sm border border-primary/40 p-0.5 text-primary"
                          aria-label="uploaded"
                        >
                          <Archive className="h-3 w-3 drop-shadow-[0_1px_2px_rgba(0,0,0,0.6)]" />
                        </span>
                      )}
                      {/* PIN 배지 — 메시지 metadata 의 pinnedImageUrl 과 일치하는 카드 위에 표시.
                          좌하단에 노란 핀 아이콘으로 한 눈에 PIN 된 항목을 식별 가능. */}
                      {message.pinnedImageUrl === img.url && (
                        <span
                          className="pointer-events-none absolute left-1 bottom-1 inline-flex items-center gap-0.5 rounded bg-amber-500/95 px-1 py-0.5 text-[9.5px] font-semibold text-white shadow-md"
                          aria-label="PIN"
                          title="PIN"
                        >
                          <Pin className="h-2.5 w-2.5" />
                          PIN
                        </span>
                      )}
                      {/* 순번 배지 — drop 시 새 위치를 알 수 있게. */}
                      <span className="pointer-events-none absolute right-1 bottom-1 rounded bg-black/65 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-white shadow-sm">
                        {idx + 1}
                      </span>
                      {removable && (
                        <span
                          className={cn(
                            'pointer-events-none absolute left-1 top-1 inline-flex h-5 w-5 items-center justify-center rounded border-2 shadow-sm transition-colors',
                            // 미선택 시에도 체크박스 자체는 불투명한 배경을 가져야 어떤 이미지 위에서도 또렷이 보임.
                            // text-transparent 는 휴지통 아이콘만 안 보이게 — 체크박스 박스 자체는 또렷.
                            selected
                              ? 'border-destructive bg-destructive text-destructive-foreground'
                              : 'border-white bg-neutral-900 text-transparent',
                          )}
                          aria-hidden
                        >
                          <Trash2 className="h-3 w-3" />
                        </span>
                      )}
                      {!removable && (
                        <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/55 px-1 py-0.5 text-[9.5px] font-medium text-white/90">
                          {t('imageEdit.attached')}
                        </span>
                      )}
                      <span
                        className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-black/0 p-1 text-white/0 transition-opacity group-hover/cell:bg-black/45 group-hover/cell:text-white/90"
                        aria-hidden
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>
                    </div>
                  );
                })}
                {/* 업로드 중인 항목 — 로컬 프리뷰 + 스피너 오버레이 */}
                {pendingUploads.map(({ tempId, previewUrl }) => (
                  <div
                    key={tempId}
                    className="relative aspect-square overflow-hidden rounded-md border border-primary/50 bg-secondary/40"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl}
                      alt=""
                      className="pointer-events-none h-full w-full object-cover opacity-40"
                      draggable={false}
                    />
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/50">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      <span className="text-[9.5px] font-medium text-white/80">
                        {t('imageEdit.uploading')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
              <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                {/* 이미지 업로드 버튼 — 사용자가 직접 이미지를 추가할 수 있음 */}
                {onUploadEditImage && (
                  <>
                    {/* label 로 input 을 직접 트리거 — 프로그래밍적 .click() 은 fixed 모달 내부에서 브라우저별로 동작이 다름 */}
                    <label
                      className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11.5px] text-primary hover:bg-primary/20"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ImagePlus className="h-3.5 w-3.5" />
                      {t('imageEdit.upload')}
                      <input
                        type="file"
                        accept="image/*,.heic,.heif"
                        multiple
                        className="sr-only"
                        onChange={(e) => {
                          const files = Array.from(e.target.files ?? []);
                          const input = e.target;
                          if (!files.length) return;
                          for (const file of files) {
                            const tempId = `pending-${Date.now()}-${Math.random()}`;
                            const uploadFn = onUploadEditImage;
                            void (async () => {
                              // HEIC/HEIF 변환 + 리사이즈 → preview + upload 모두 동일 dataUrl 사용
                              let dataUrl: string;
                              let convertedName = file.name;
                              try {
                                const converted = await maybeConvertHeic(file);
                                convertedName = converted.name;
                                dataUrl = await fileToResizedDataUrl(converted);
                              } catch (err) {
                                console.error('[upload] 변환 실패', err);
                                return;
                              }
                              const previewUrl = dataUrl;
                              setPendingUploads((prev) => [
                                ...prev,
                                { tempId, previewUrl },
                              ]);
                              try {
                                const url = await uploadFn(dataUrl, convertedName);
                                if (url) {
                                  setEditingOrderUrls((prev) => [...prev, url]);
                                }
                              } catch (err) {
                                console.error('[upload]', err);
                              } finally {
                                setPendingUploads((prev) =>
                                  prev.filter((p) => p.tempId !== tempId),
                                );
                              }
                            })();
                          }
                          input.value = '';
                        }}
                      />
                    </label>
                    <span className="text-border">|</span>
                  </>
                )}

                <span>
                  {t('imageEdit.selected').replace(
                    '{n}',
                    String(imageEditSelection.size),
                  )}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setImageEditSelection(
                      new Set(
                        combinedImagesForEdit
                          .filter((i) => i.removable !== false)
                          .map((i) => i.url),
                      ),
                    )
                  }
                  className="rounded-md border border-border bg-background px-2 py-0.5 text-[11.5px] hover:bg-accent"
                >
                  {t('imageEdit.selectAll')}
                </button>
                <button
                  type="button"
                  onClick={() => setImageEditSelection(new Set())}
                  disabled={imageEditSelection.size === 0}
                  className="rounded-md border border-border bg-background px-2 py-0.5 text-[11.5px] hover:bg-accent disabled:opacity-40"
                >
                  {t('imageEdit.clear')}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setEditingOrderUrls(combinedImagesForEdit.map((i) => i.url))
                  }
                  className="rounded-md border border-border bg-background px-2 py-0.5 text-[11.5px] hover:bg-accent"
                  title={t('imageEdit.resetOrderTitle')}
                >
                  {t('imageEdit.resetOrder')}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setImageEditMode(false)}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm hover:bg-accent"
                >
                  {t('imageEdit.cancel')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (imageEditSelection.size > 0) {
                      setImageEditConfirmPending(true);
                    } else {
                      if (onReorderImages) {
                        onReorderImages(editingOrderUrls);
                      }
                      setImageEditMode(false);
                      setExpandedImageIndex(null);
                    }
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md border border-primary/50 bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Check className="h-3.5 w-3.5" />
                  <span>
                    {imageEditSelection.size > 0
                      ? t('imageEdit.applyWithDelete').replace(
                          '{n}',
                          String(imageEditSelection.size),
                        )
                      : t('imageEdit.apply')}
                  </span>
                </button>
              </div>
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

export default memo(MessageBubble);
