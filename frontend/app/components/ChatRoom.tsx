'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import MessageBubble from './MessageBubble';
import InputBar, { type InputBarHandle } from './InputBar';
import Sidebar from './Sidebar';
import ArtifactPanel from './ArtifactPanel';
import SettingsModal from './SettingsModal';
import AboutModal from './AboutModal';
import SaveConfirmModal from './SaveConfirmModal';
import ThreadDetailPanel from './ThreadDetailPanel';
import DashboardPanel from './DashboardPanel';
import DeleteConfirmModal from './DeleteConfirmModal';
import PinLimitModal from './PinLimitModal';
import DeleteMessagePairConfirmModal from './DeleteMessagePairConfirmModal';
import Toaster, { type Toast } from './Toaster';
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { type Artifact } from '@/lib/artifacts';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import { useThreadSettings } from '@/lib/threadSettings';

export interface ModelInfo {
  name: string;
  parameterSize?: string;
  family?: string;
}

// AI 설정 그룹(Reasoning / Vision) — 각각 독립된 endpoint / apiKey / model.
export interface AiGroupCfg {
  endpoint: string;
  apiKey: string;
  model: string;
  // 출력 토큰 상한(문자열 입력값). 빈 값이면 백엔드 기본값 사용.
  maxTokens: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  role?: 'admin' | 'member';
  hasPassword?: boolean;
}

export interface Source {
  title: string;
  url: string;
}

export interface SearchImage {
  url: string;
  sourceTitle?: string;
  sourceUrl?: string;
  kind?: 'image' | 'youtube' | 'x';
  linkUrl?: string;
  analyzing?: boolean;
  // 카드의 × 삭제 버튼 노출 여부. 미설정 시 true 로 간주.
  removable?: boolean;
  analysis?: {
    relevant: boolean;
    description: string;
  };
}

export interface ReadPageImage {
  src: string;
  alt?: string;
  kind?: 'image' | 'youtube' | 'x';
  linkUrl?: string;
  analyzing?: boolean;
  analysis?: {
    relevant: boolean;
    description: string;
  };
}

export interface ReadPage {
  url: string;
  title?: string;
  chars: number;
  ok: boolean;
  // 추출 경로 — 백엔드에서 fetch / tavily 중 하나.
  source?: 'fetch' | 'tavily';
  images?: ReadPageImage[];
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  images?: string[];
  // images 와 평행한 원본 파일명 배열 (사용자 첨부 시점). 길이는 images 와 동일.
  imageNames?: string[];
  searchImages?: SearchImage[];
  sources?: Source[];
  readPages?: ReadPage[];
  status?: string;
  // 스트림/연결 실패 등 에러로 채워진 응답 — 답변 버블을 빨간색으로 표시.
  isError?: boolean;
  // 알려진 에러의 코드(예: 'context_overflow'). 있으면 MessageBubble 이 content 대신
  // 현재 UI 언어로 번역해 렌더 → 언어 전환 시 에러 메시지도 즉시 따라 바뀜.
  errorCode?: string;
  // 사용자가 이미지를 첨부했거나 vision 토글이 켜진 상태에서 발생한 봇 응답
  visionContext?: boolean;
  // '직접 작성'으로 생성된 제목(user) 메시지 표시 — content 가 비어도 heading 을 렌더해
  // 클릭 편집이 가능하도록 한다. metadata 로 영속되어 새로고침 후에도 유지.
  manualEntry?: boolean;
  time: string;
  hashtags?: string[];
  // hashtag 생성이 진행 중인지 — 결과가 도착하기 전 placeholder 표시용.
  hashtagsGenerating?: boolean;
  replySummary?: string;
  followup?: { question?: string; options: string[] };
  // followup 생성 진행 중 placeholder ("...") 표시용 플래그.
  followupGenerating?: boolean;
  metric?: {
    tokens: number;
    durationMs: number;
    tokensPerSec: number;
    promptTokens?: number;
  };
  // 포커 이미지 판넬에서 사용자가 PIN 한 이미지 URL — 다음 방문 시에도 자동 확대 노출.
  // metadata 로 DB 영속 → 페이지 이탈 후 복귀해도 유지.
  pinnedImageUrl?: string | null;
  // Image Edit 모달에서 사용자가 정한 이미지 순서 — URL 배열. 포커 이미지 판넬은 이 순서대로 노출.
  // 비어있으면(undefined) 자연 순서(첨부 → readPages → searchImages) 그대로.
  // metadata.imageOrder 로 DB 영속.
  imageOrder?: string[];
  // Image Edit 모달에서 사용자가 직접 업로드한 이미지 URL 배열.
  // /api/attachments/<botMsgId>/<fileName> 형태. metadata.editImages 로 DB 영속.
  editImages?: string[];
  // 웹(외부) 이미지를 "저장"해 서버에 업로드한 원본 source URL 목록.
  // 새로고침 후에도 해당 웹 이미지에 "저장됨" 을 표시하기 위해 metadata 로 영속.
  savedSourceUrls?: string[];
}

export interface Conversation {
  id: string;
  title: string;
  // 'thread' = hashtag/Summary/그래프 등 풀 기능 / 'chat' = 단순 채팅. 기본 'thread'.
  kind?: 'thread' | 'chat';
  // 윈도우 — 가장 최근에 로드된 메시지부터 시간순. 위로 스크롤하면 keyset 페이지네이션으로 prepend.
  messages: Message[];
  updatedAt: number;
  model?: string;
  folderId?: string | null;
  // 서버에서 누적된 해시태그 (메시지 메타에서 합집합) — 메시지를 안 가져온 conversation 도 hashtag 는 알 수 있게.
  hashtags?: string[];
  // 사용자가 우측 패널 Hashtags 에서 배제한 태그 — 그래프/표시에서 제외. 영속(server-side).
  excludedHashtags?: string[];
  pinned?: boolean;
  // 페이지네이션 상태
  messagesLoaded?: boolean; // 한 번이라도 메시지를 fetch 했는지
  hasMoreMessages?: boolean; // 더 과거 메시지가 DB에 남아있는지 (Chat: 위 스크롤)
  hasMoreNewerMessages?: boolean; // 더 미래 메시지가 DB에 남아있는지 (Thread: 아래 스크롤)
  loadingOlder?: boolean; // 현재 위로 추가 fetch 중
  loadingNewer?: boolean; // 현재 아래로 추가 fetch 중 (Thread 전용)
}

export interface Folder {
  id: string;
  name: string;
  // conversations.kind 와 동일 — Threads / Chat 섹션 각각의 폴더 리스트로 분기.
  kind?: 'thread' | 'chat';
  expanded: boolean;
  createdAt: number;
}

// 모든 백엔드 호출은 same-origin `/api/*` — Next rewrites 가 백엔드 호스트로 프록시.
const API_URL = '/api';
const ACTIVE_KEY = 'gemma-chat-active-v1';
const FOLDERS_KEY = 'gemma-chat-folders-v1';
const MEMORY_SIZE = 10;

// 백엔드 messages 테이블이 (conversation_id, id DESC) 로 keyset 페이지네이션 하므로
// 클라이언트가 만드는 임시 id 도 시간순 정렬되는 UUIDv7 이어야 한다.
// 같은 밀리초 안에서 send() 가 user/bot 메시지를 연속 생성하는 케이스(특히 followup
// 클릭 시) 에 ID 순서가 무작위가 되는 걸 막기 위해 rand_a(12비트)를 단조 증가 카운터로 사용.
let _uuidv7LastTs = 0n;
let _uuidv7Seq = 0;
function uuidv7(): string {
  let ts = BigInt(Date.now());
  if (ts <= _uuidv7LastTs) {
    // 동일 ms 또는 시계가 뒤로 간 경우(드물게) — 카운터 증가, 필요시 ts 강제 진행.
    if (ts < _uuidv7LastTs) ts = _uuidv7LastTs;
    _uuidv7Seq += 1;
    if (_uuidv7Seq > 0xfff) {
      ts += 1n;
      _uuidv7Seq = 0;
    }
  } else {
    _uuidv7Seq = 0;
  }
  _uuidv7LastTs = ts;

  const bytes = new Uint8Array(16);
  bytes[0] = Number((ts >> 40n) & 0xffn);
  bytes[1] = Number((ts >> 32n) & 0xffn);
  bytes[2] = Number((ts >> 24n) & 0xffn);
  bytes[3] = Number((ts >> 16n) & 0xffn);
  bytes[4] = Number((ts >> 8n) & 0xffn);
  bytes[5] = Number(ts & 0xffn);
  // version(4비트) + 카운터 상위 4비트 → byte 6
  bytes[6] = 0x70 | ((_uuidv7Seq >> 8) & 0x0f);
  // 카운터 하위 8비트 → byte 7
  bytes[7] = _uuidv7Seq & 0xff;
  // 나머지 8 바이트는 랜덤
  crypto.getRandomValues(bytes.subarray(8));
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function formatTime(ts: number | Date) {
  const d = typeof ts === 'number' ? new Date(ts) : ts;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const time = `${hh}:${mm}:${ss}`;
  // 자정 기준 "오늘" 의 경계 — 같은 날짜면 시간만, 어제면 "Yesterday HH:MM:SS", 그 이전은 yy/MM/dd 포함.
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const today = startOfDay.getTime();
  const yesterday = today - 24 * 60 * 60 * 1000;
  const t = d.getTime();
  if (t >= today) return time;
  if (t >= yesterday) return `Yesterday ${time}`;
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  const MM = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}/${MM}/${dd} ${time}`;
}

function nowTime() {
  return formatTime(Date.now());
}

function stripDataUrl(dataUrl: string): string {
  // data: URL prefix 만 제거. URL/path 형식이면 그대로 (백엔드가 base64 로 환원).
  if (!dataUrl.startsWith('data:')) return dataUrl;
  const i = dataUrl.indexOf(',');
  return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
}

function makeGreeting(greetingText = '안녕하세요! 무엇이든 물어보세요 😊'): Message {
  return {
    id: uuidv7(),
    role: 'assistant',
    content: greetingText,
    time: nowTime(),
  };
}

function makeConversation(
  greetingText?: string,
  kind: 'thread' | 'chat' = 'thread',
): Conversation {
  return {
    id: uuidv7(),
    kind,
    title: kind === 'chat' ? 'New Chat' : 'New Thread',
    messages: [makeGreeting(greetingText)],
    updatedAt: Date.now(),
    messagesLoaded: true,
    hasMoreMessages: false,
  };
}

// ── MessageItem ──────────────────────────────────────────────────────────────
// memo 래퍼: 스트리밍 중 ChatRoom re-render 시 non-live 메시지가 bailout 하도록.
// 부모에서 stable 콜백을 받아 내부에서 m.id 를 바인딩 → MessageBubble 에 안정된 함수 전달.
interface MessageItemProps {
  m: Message;
  deleteTurnId: string | undefined;
  isHiddenByCollapse: boolean;
  isCollapsedSelf: boolean;
  responsesCount: number;
  precedingUserImages: string[] | undefined;
  precedingUserImageNames: string[] | undefined;
  convKind: 'thread' | 'chat';
  userOrdinal: number | undefined;
  activeArtifactId: string | null;
  attachedSourceUrls: Set<string> | undefined;
  isFresh: boolean;
  isLive: boolean;
  autoEdit: boolean;
  isCollapsed: boolean;
  isGreeting: boolean;
  onEditContent: (id: string, content: string) => void;
  onPinImage: (id: string, url: string | null) => void;
  onRotateImage: (id: string, url: string, deg: number) => Promise<void>;
  onOpenArtifact: (a: Artifact) => void;
  onAttachImage: (url: string) => void;
  onFollowup: (text: string) => void;
  onRemoveImageById: (id: string, url: string) => void;
  onReorderImagesById: (id: string, urls: string[]) => void;
  onUploadEditImageById: (id: string, dataUrl: string, fileName: string, sourceUrl?: string) => Promise<string | null>;
  onDeleteTurnById: (id: string) => void;
  onToggleTurnCollapse: (id: string) => void;
  setMsgRef: (id: string, el: HTMLDivElement | null) => void;
}

const MessageItem = memo(function MessageItem({
  m,
  deleteTurnId,
  isHiddenByCollapse,
  isCollapsedSelf,
  responsesCount,
  precedingUserImages,
  precedingUserImageNames,
  convKind,
  userOrdinal,
  activeArtifactId,
  attachedSourceUrls,
  isFresh,
  isLive,
  autoEdit,
  isCollapsed,
  isGreeting,
  onEditContent,
  onPinImage,
  onRotateImage,
  onOpenArtifact,
  onAttachImage,
  onFollowup,
  onRemoveImageById,
  onReorderImagesById,
  onUploadEditImageById,
  onDeleteTurnById,
  onToggleTurnCollapse,
  setMsgRef,
}: MessageItemProps) {
  const handleRemoveImage = useCallback((url: string) => onRemoveImageById(m.id, url), [m.id, onRemoveImageById]);
  const handleReorderImages = useCallback((urls: string[]) => onReorderImagesById(m.id, urls), [m.id, onReorderImagesById]);
  const handleUploadEditImage = useCallback((dataUrl: string, fileName: string, sourceUrl?: string) => onUploadEditImageById(m.id, dataUrl, fileName, sourceUrl), [m.id, onUploadEditImageById]);
  const handleDeleteTurn = useCallback(() => { if (deleteTurnId) onDeleteTurnById(deleteTurnId); }, [deleteTurnId, onDeleteTurnById]);
  const handleToggle = useCallback(() => onToggleTurnCollapse(m.id), [m.id, onToggleTurnCollapse]);
  const handleRef = useCallback((el: HTMLDivElement | null) => setMsgRef(m.id, el), [m.id, setMsgRef]);

  return (
    <div ref={handleRef} data-msg-id={m.id} className="relative">
      <div
        className={cn(
          'grid overflow-clip transition-[grid-template-rows,opacity,margin] duration-300 ease-out',
          isHiddenByCollapse
            ? 'grid-rows-[0fr] opacity-0 pointer-events-none -my-1'
            : 'grid-rows-[1fr] opacity-100',
        )}
      >
        <div className="min-h-0">
          <MessageBubble
            message={m}
            convKind={convKind}
            userOrdinal={userOrdinal}
            isGreeting={isGreeting}
            autoEdit={autoEdit}
            onEditContent={onEditContent}
            onPinImage={onPinImage}
            onRotateImage={onRotateImage}
            attachedSourceUrls={attachedSourceUrls}
            onOpenArtifact={onOpenArtifact}
            activeArtifactId={activeArtifactId}
            onAttachImage={onAttachImage}
            isFresh={isFresh}
            isLive={isLive}
            onFollowup={onFollowup}
            isCollapsed={isCollapsed}
            onRemoveImage={handleRemoveImage}
            onReorderImages={handleReorderImages}
            onUploadEditImage={handleUploadEditImage}
            precedingUserImages={precedingUserImages}
            precedingUserImageNames={precedingUserImageNames}
            onDeleteTurn={deleteTurnId ? handleDeleteTurn : undefined}
          />
        </div>
      </div>
      {isCollapsedSelf && responsesCount > 0 && (
        <button
          type="button"
          onClick={handleToggle}
          className="mt-1 inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-secondary"
        >
          <ChevronRight className="h-3 w-3" />
          <span>응답 {responsesCount}개 접힘 — 클릭하여 펼치기</span>
        </button>
      )}
    </div>
  );
});
// ─────────────────────────────────────────────────────────────────────────────

// 검색 처리 중 스트림 파트(search/pages/page_timeout/image_*/status)를 메시지 필드에 반영.
// 능동 스트림과 수동(다른 기기) 실시간 미러 양쪽에서 공용 → Reference documents·팝콘 이미지 UI 동기화.
// 처리하면 true, 아니면 false 반환(호출 측이 다른 type 으로 넘어가도록).
function applyServerStreamPart(
  json: Record<string, unknown>,
  botId: string,
  patchConv: (updater: (c: Conversation) => Conversation) => void,
): boolean {
  if (json.type === 'search' && Array.isArray(json.results)) {
    const rawImgs: unknown[] = Array.isArray(json.images) ? json.images : [];
    const imgs: SearchImage[] = rawImgs
      .map((it) => {
        if (typeof it === 'string') return { url: it };
        if (
          it &&
          typeof it === 'object' &&
          'url' in it &&
          typeof (it as { url: unknown }).url === 'string'
        ) {
          const o = it as {
            url: string;
            sourceTitle?: string;
            sourceUrl?: string;
          };
          return { url: o.url, sourceTitle: o.sourceTitle, sourceUrl: o.sourceUrl };
        }
        return null;
      })
      .filter((x): x is SearchImage => !!x);
    patchConv((c) => ({
      ...c,
      messages: c.messages.map((m) =>
        m.id === botId
          ? {
              ...m,
              sources: json.results as Source[],
              searchImages: imgs.length ? imgs : undefined,
            }
          : m,
      ),
      updatedAt: Date.now(),
    }));
    return true;
  }
  if (json.type === 'pages' && Array.isArray(json.pages)) {
    const pages = (json.pages as unknown[])
      .map((p) => {
        if (!p || typeof p !== 'object') return null;
        const o = p as Record<string, unknown>;
        if (typeof o.url !== 'string') return null;
        const rawImgs = Array.isArray(o.images) ? (o.images as unknown[]) : [];
        const images = rawImgs
          .map((it): ReadPageImage | null => {
            if (!it || typeof it !== 'object') return null;
            const r = it as Record<string, unknown>;
            if (typeof r.src !== 'string') return null;
            const alt = typeof r.alt === 'string' ? r.alt : undefined;
            const kind =
              r.kind === 'youtube' || r.kind === 'x' || r.kind === 'image'
                ? r.kind
                : undefined;
            const linkUrl =
              typeof r.linkUrl === 'string' ? r.linkUrl : undefined;
            const out: ReadPageImage = { src: r.src };
            if (alt) out.alt = alt;
            if (kind) out.kind = kind;
            if (linkUrl) out.linkUrl = linkUrl;
            if (r.analyzing === true) out.analyzing = true;
            return out;
          })
          .filter((x): x is ReadPageImage => x !== null);
        return {
          url: o.url,
          title: typeof o.title === 'string' ? o.title : undefined,
          chars: typeof o.chars === 'number' ? o.chars : 0,
          ok: o.ok === true,
          images: images.length > 0 ? images : undefined,
        } as ReadPage;
      })
      .filter((x): x is ReadPage => !!x);
    patchConv((c) => ({
      ...c,
      messages: c.messages.map((m) =>
        m.id === botId ? { ...m, readPages: pages.length ? pages : undefined } : m,
      ),
      updatedAt: Date.now(),
    }));
    return true;
  }
  if (json.type === 'page_timeout' && typeof json.url === 'string') {
    const timedUrl = json.url as string;
    patchConv((c) => ({
      ...c,
      messages: c.messages.map((m) => {
        if (m.id !== botId) return m;
        const existing = m.readPages ?? [];
        if (existing.some((p) => p.url === timedUrl)) return m;
        const source = m.sources?.find((s) => s.url === timedUrl);
        return {
          ...m,
          readPages: [
            ...existing,
            { url: timedUrl, title: source?.title, chars: 0, ok: false } as ReadPage,
          ],
        };
      }),
      updatedAt: Date.now(),
    }));
    return true;
  }
  if (
    json.type === 'image_analyzing_start' &&
    typeof json.pageUrl === 'string' &&
    typeof json.src === 'string'
  ) {
    const pageUrl = json.pageUrl as string;
    const src = json.src as string;
    patchConv((c) => ({
      ...c,
      messages: c.messages.map((m) => {
        if (m.id !== botId || !m.readPages) return m;
        const nextPages = m.readPages.map((p) => {
          if (p.url !== pageUrl || !p.images) return p;
          const nextImages = p.images.map((img) =>
            img.src === src ? { ...img, analyzing: true } : img,
          );
          return { ...p, images: nextImages };
        });
        return { ...m, readPages: nextPages };
      }),
      updatedAt: Date.now(),
    }));
    return true;
  }
  if (
    json.type === 'image_analysis' &&
    typeof json.pageUrl === 'string' &&
    Array.isArray(json.analyses)
  ) {
    const pageUrl = json.pageUrl as string;
    const analyses = (json.analyses as unknown[])
      .map((it) => {
        if (!it || typeof it !== 'object') return null;
        const o = it as Record<string, unknown>;
        if (typeof o.src !== 'string') return null;
        return {
          src: o.src,
          relevant: o.relevant === true,
          description: typeof o.description === 'string' ? o.description : '',
        };
      })
      .filter(
        (x): x is { src: string; relevant: boolean; description: string } => !!x,
      );
    patchConv((c) => ({
      ...c,
      messages: c.messages.map((m) => {
        if (m.id !== botId || !m.readPages) return m;
        const nextPages = m.readPages.map((p) => {
          if (p.url !== pageUrl || !p.images) return p;
          const lookup = new Map(analyses.map((a) => [a.src, a]));
          const nextImages = p.images.map((img) => {
            const a = lookup.get(img.src);
            if (!a) return img;
            return {
              ...img,
              analyzing: false,
              analysis: { relevant: a.relevant, description: a.description },
            };
          });
          return { ...p, images: nextImages };
        });
        return { ...m, readPages: nextPages };
      }),
      updatedAt: Date.now(),
    }));
    return true;
  }
  if (json.type === 'status' && json.text) {
    patchConv((c) => ({
      ...c,
      messages: c.messages.map((m) =>
        m.id === botId ? { ...m, status: json.text as string } : m,
      ),
      updatedAt: Date.now(),
    }));
    return true;
  }
  return false;
}

export default function ChatRoom() {
  const { t, lang } = useI18n();
  const { tavilyTopRead } = useThreadSettings();
  const [, startThreadTransition] = useTransition();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hasMoreConvs, setHasMoreConvs] = useState(false);
  const convCursorRef = useRef<string | null>(null);
  const loadingMoreConvsRef = useRef(false);
  const [loadingMoreConvs, setLoadingMoreConvs] = useState(false);
  const [pinnedOrder, setPinnedOrder] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('stella:pinnedOrder');
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });
  // 메인 영역 표시 모드. 기본은 Dashboard. Thread 행 클릭 시 'thread' 로 전환.
  const [view, setView] = useState<'dashboard' | 'thread'>('dashboard');
  // 삭제 확인 모달 — 사용자가 이름을 정확히 입력해야 활성화됨.
  const [pinLimitOpen, setPinLimitOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'conversation' | 'folder'; id: string; name: string }
    | null
  >(null);
  // AI 응답 완료 알림 토스트 — 다른 thread 보고 있을 때도 페이지 어디서든 뜸.
  const [toasts, setToasts] = useState<Toast[]>([]);
  // 비동기 closure(스트림 종료 후 영속 등) 안에서 항상 최신 conversations 를 읽기 위한 ref.
  const conversationsRef = useRef<Conversation[]>([]);
  // 비동기 closure 가 "지금 사용자가 보고 있는 thread 인지" 판정할 때 쓰는 최신 activeId.
  const activeIdRef = useRef<string | null>(null);
  const [pending, setPending] = useState(false);
  // 점진적 렌더링 — 긴 thread 를 열 때 처음엔 일부만 렌더(페이지 즉시 전환), idle/로딩에 맞춰 확장.
  // Infinity = 전체 렌더(제한 없음). thread 에만 적용(chat 은 최신이 하단이라 위에서부터 자르면 안 됨).
  const RENDER_INITIAL = 14;
  const [renderLimit, setRenderLimit] = useState(Number.POSITIVE_INFINITY);
  // ★ 핵심: cap 을 useEffect 가 아니라 "렌더 단계"에서 동기 적용 — 그래야 전체 메시지를
  //   한 번에 렌더하는 비용(freeze)이 애초에 발생하지 않음. activeId/로드상태가 바뀌는 첫 렌더에
  //   바로 cap 을 세팅하면 React 가 자식(메시지들) 렌더 전에 재렌더하므로 freeze 없음.
  const renderCapKeyRef = useRef<string>('');
  {
    const ac = conversations.find((c) => c.id === activeId);
    const key = `${activeId ?? ''}:${ac?.messagesLoaded ? '1' : '0'}`;
    if (renderCapKeyRef.current !== key) {
      renderCapKeyRef.current = key;
      const isLongThread =
        (ac?.kind ?? 'thread') === 'thread' &&
        !!ac?.messagesLoaded &&
        (ac?.messages.length ?? 0) > RENDER_INITIAL;
      setRenderLimit(isLongThread ? RENDER_INITIAL : Number.POSITIVE_INFINITY);
    }
  }
  // 현재 응답 생성 중인 conversation id 집합 (로컬+원격, user 단위 SSE 로 추적).
  // size > 0 이면 "AI 응답 중" → 어느 thread/메뉴에 있어도 입력창을 전역 중지 상태로 유지.
  const [streamingConvIds, setStreamingConvIds] = useState<Set<string>>(
    () => new Set(),
  );
  // 현재 스트리밍 중인 assistant 메시지의 ID — ref 대신 state 로 관리해 concurrent 렌더에서 tearing 방지.
  const [liveMessageId, setLiveMessageId] = useState<string | null>(null);
  // 이 탭이 직접 스트리밍 중인 assistant 메시지 id — 로컬 SSE 로 이미 렌더하므로
  // 같은 id 의 실시간 미러 이벤트(start/delta/end/updated)는 무시해야 함(중복/충돌 방지).
  const localStreamingIdRef = useRef<string | null>(null);
  // 원격 스트림으로 인해 pending(입력창 잠금) 을 켰는지 — thread 이동 시 stale 해제용.
  const remotePendingRef = useRef(false);
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [mountedArtifact, setMountedArtifact] = useState<Artifact | null>(
    null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Reasoning / Vision AI 설정 — 각 그룹이 독립된 endpoint / apiKey / model 을 가진다.
  // system_config 'ai' row 가 단일 진실 출처. GET/PUT /admin/ai 로 로드·저장.
  const [reasoningCfg, setReasoningCfg] = useState<AiGroupCfg>({
    endpoint: '',
    apiKey: '',
    model: '',
    maxTokens: '',
  });
  const [visionCfg, setVisionCfg] = useState<AiGroupCfg>({
    endpoint: '',
    apiKey: '',
    model: '',
    maxTokens: '',
  });
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  // 인증 체크가 끝났는데 user 가 없으면 /login 으로 이동.
  useEffect(() => {
    if (authChecked && !user) router.replace('/login');
  }, [authChecked, user, router]);
  const [freshIds, setFreshIds] = useState<Set<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [tagCloudOpen, setTagCloudOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [savingState, setSavingState] = useState(false);
  const serverConvsRef = useRef<Map<string, Conversation>>(new Map());
  const serverFoldersRef = useRef<Map<string, Folder>>(new Map());
  const [liveTokRate, setLiveTokRate] = useState<number | null>(null);
  // 헤더 제목 인라인 편집 상태.
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  // AI 설정 로드 — { reasoning, vision } 중첩 스키마. 각 그룹의 endpoint/apiKey/model.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/admin/ai`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        type GroupResp = {
          endpoint?: string;
          apiKey?: string;
          model?: string;
          maxTokens?: number;
        };
        const j = (await res.json()) as {
          reasoning?: GroupResp;
          vision?: GroupResp;
        };
        if (cancelled) return;
        const toCfg = (g?: GroupResp): AiGroupCfg => ({
          endpoint: g?.endpoint ?? '',
          apiKey: g?.apiKey ?? '',
          model: g?.model ?? '',
          maxTokens: g?.maxTokens != null ? String(g.maxTokens) : '',
        });
        setReasoningCfg(toCfg(j.reasoning));
        setVisionCfg(toCfg(j.vision));
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // 그룹별 부분 갱신 — 로컬 state 즉시 반영 + 해당 그룹 patch 를 PUT /admin/ai.
  const updateAiGroup = useCallback(
    (kind: 'reasoning' | 'vision', patch: Partial<AiGroupCfg>): Promise<void> => {
      if (kind === 'reasoning') setReasoningCfg((p) => ({ ...p, ...patch }));
      else setVisionCfg((p) => ({ ...p, ...patch }));
      // PUT 완료 Promise 반환 → 호출부가 저장 완료 후 모델목록을 재조회(키 갱신 반영)할 수 있다.
      return fetch(`${API_URL}/admin/ai`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [kind]: patch }),
      })
        .then(() => undefined)
        .catch(() => undefined);
    },
    [],
  );
  // 사용자 발화별 턴(=user msg + 다음 user msg 직전까지의 assistant 응답들) 접힘 상태.
  // user msg id 기준으로 저장. 활성 대화가 바뀌면 자동 비움.
  const [collapsedTurns, setCollapsedTurns] = useState<Set<string>>(
    () => new Set(),
  );
  // Message Manager 에서 삭제할 때 부드러운 접힘 모션을 위해 잠시 표시 — 메시지 id 집합.
  // 실제 제거 직전 isHiddenByCollapse 와 같이 동작.
  const [deletingMessageIds, setDeletingMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  // 재정렬 직후 새 위치에서 잠시 접혀있다 펼쳐지는(unfold) 모션을 위해 사용.
  // double-RAF 으로 add → remove 처리해 grid-rows 트랜지션을 트리거.
  const [unfoldingMessageIds, setUnfoldingMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    setCollapsedTurns(new Set());
    setDeletingMessageIds(new Set());
    setUnfoldingMessageIds(new Set());
    // messageRefs 는 clear 하지 않음 — 이미 캐시된 thread 로 전환 시
    // MessageItem ref 가 이 effect 직전에 설정되므로 clear 가 freshly mounted ref 를 지워버림.
    // unmount 시 setMsgRef(id, null) 로 자동으로 null 처리되어 stale 항목은 무해함.
  }, [activeId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/auth/me`, {
          credentials: 'include',
        });
        if (!res.ok) {
          if (!cancelled) setUser(null);
          return;
        }
        const json = (await res.json()) as AuthUser;
        if (!cancelled) setUser(json);
      } catch {
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const doLogout = useCallback(async () => {
    try {
      await fetch(`${API_URL}/auth/logout`, { credentials: 'include' });
    } catch {
      // ignore
    }
    setUser(null);
  }, []);
  // dirty 상태이면 저장 확인 모달을 띄우고, 사용자의 선택에 따라 저장 후 / 저장 없이 logout.
  // 깨끗하면 그대로 logout.
  const handleLogout = useCallback(() => {
    if (isDirty) {
      setSaveConfirmOpen(true);
    } else {
      void doLogout();
    }
  }, [isDirty, doLogout]);
  const scrollRef = useRef<HTMLDivElement>(null);
  // 스크롤 컨테이너 내부 컨텐츠 — 스트리밍 중 높이 증가(References/thinking/답변)를
  // ResizeObserver 로 감지해 하단을 계속 따라가게 하기 위한 참조.
  const scrollContentRef = useRef<HTMLDivElement>(null);
  // 스트리밍 중 '하단 추종' 여부. 사용자가 위로 스크롤해 내용을 읽는 중이면 false 가 되어
  // 강제로 끌어내리지 않음. 다시 하단 근처로 오면 true 로 복귀.
  const stickBottomRef = useRef(true);
  // 직전 scrollTop — 스크롤 '방향' 판별용. References 등장 등 높이 점프로 생기는
  // 스크롤 이벤트가 추종을 잘못 끄지 않도록, '사용자가 위로 올린 경우'만 해제하기 위함.
  const lastScrollTopRef = useRef(0);
  const hydratedRef = useRef(false);

  const loadMoreConversations = useCallback(async () => {
    if (!hasMoreConvs || loadingMoreConvsRef.current || !convCursorRef.current) return;
    loadingMoreConvsRef.current = true;
    setLoadingMoreConvs(true);
    try {
      const res = await fetch(
        `${API_URL}/conversations?cursor=${encodeURIComponent(convCursorRef.current)}&limit=50`,
        { credentials: 'include' },
      );
      if (!res.ok) return;
      const page = (await res.json()) as {
        data: Conversation[];
        nextCursor: string | null;
        hasMore: boolean;
      };
      convCursorRef.current = page.nextCursor;
      setHasMoreConvs(page.hasMore);
      const newConvs = page.data.map(
        (c): Conversation => ({
          ...c,
          kind: c.kind ?? 'thread',
          messages: [],
          messagesLoaded: false,
          hasMoreMessages: true,
        }),
      );
      setConversations((prev) => {
        const existingIds = new Set(prev.map((c) => c.id));
        const toAdd = newConvs.filter((c) => !existingIds.has(c.id));
        toAdd.forEach((c) => serverConvsRef.current.set(c.id, c));
        return [...prev, ...toAdd];
      });
    } catch {
      // ignore
    } finally {
      loadingMoreConvsRef.current = false;
      setLoadingMoreConvs(false);
    }
  }, [hasMoreConvs]);

  // 현재 viewport 상단에 가장 가깝게 보이는 user 메시지 id — Message Navigator 하이라이트 동기화용.
  const [visibleUserMessageId, setVisibleUserMessageId] = useState<
    string | null
  >(null);
  // 스크롤로 viewport 상단을 지나친 user 헤딩 정보 — chat 헤더 안에 대제목 밑에 표시.
  const [headerSubheading, setHeaderSubheading] = useState<{
    ordinal: number;
    content: string;
  } | null>(null);
  // conversationsRef 를 매 렌더에서 동기화 — 비동기 closure 가 stale 닫힘 안 보게.
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  useEffect(() => {
    activeIdRef.current = activeId;
  }, [activeId]);
  const inputBarRef = useRef<InputBarHandle>(null);
  // 진행 중인 chat/stream 요청을 중단하기 위한 컨트롤러 ref
  const streamAbortRef = useRef<AbortController | null>(null);
  // 현재 진행 중인 user msg / bot msg id (Stop 시 화면에서 제거)
  const streamMsgIdsRef = useRef<{
    convId: string;
    userId: string;
    botId: string;
  } | null>(null);

  // Stop 버튼 클릭 시 호출. 진행 중인 stream을 즉시 끊고, 현재 turn을 '완전 취소'.
  // 화면에서 제거 + 백엔드(서버 사이드 저장)에도 취소 신호 → user/assistant 메시지 삭제.
  // (백엔드는 stream finally 에서 최종 저장 대신 삭제 → 새로고침해도 잔재 없음)
  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    const ids = streamMsgIdsRef.current;
    // 스트리밍 상태를 '즉시' 해제 — 백엔드 emitStreamEnd(stream.inactive)를 기다리지 않는다.
    // (검색 의도 분석 등 백엔드가 해당 단계를 빠져나오는 데 시간이 걸려도 중지 버튼이
    //  바로 사라지도록. 백엔드의 후속 stream.inactive 는 no-op 이 된다.)
    setPending(false);
    setLiveMessageId(null);
    setLiveTokRate(null);
    localStreamingIdRef.current = null;
    remotePendingRef.current = false;
    if (ids) {
      setStreamingConvIds((prev) => {
        if (!prev.has(ids.convId)) return prev;
        const next = new Set(prev);
        next.delete(ids.convId);
        return next;
      });
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== ids.convId) return c;
          return {
            ...c,
            messages: c.messages.filter(
              (m) => m.id !== ids.userId && m.id !== ids.botId,
            ),
            updatedAt: Date.now(),
          };
        }),
      );
      // 명시적 취소 신호 — abort 로 연결이 끊겨도(또는 저장 전이어도) 백엔드가 안전하게 삭제.
      void fetch(`${API_URL}/chat/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: ids.convId,
          userMessageId: ids.userId,
          assistantMessageId: ids.botId,
        }),
      }).catch(() => {});
      streamMsgIdsRef.current = null;
    }
  }, []);
  const messageRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  function scrollToMessage(messageId: string, delay = 0) {
    const doScroll = () => {
      // ref Map 우선 — 빠르고 React lifecycle 와 동기화됨.
      let el = messageRefs.current.get(messageId);
      // ref 가 stale/누락된 경우 (thread 빈번 전환 등) DOM 에서 직접 조회 → 항상 동작 보장.
      if (!el || !el.isConnected) {
        const found = scrollRef.current?.querySelector<HTMLDivElement>(
          `[data-msg-id="${CSS.escape(messageId)}"]`,
        );
        if (found) {
          el = found;
          messageRefs.current.set(messageId, found);
        }
      }
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    if (delay > 0) setTimeout(doScroll, delay);
    else doScroll();
  }

  // dataUrl → 원본 source URL 매핑. 포커카드의 Attach 버튼 dim 판단에 사용.
  const dataUrlToSourceRef = useRef<Map<string, string>>(new Map());
  const [attachedSourceUrls, setAttachedSourceUrls] = useState<Set<string>>(
    () => new Set(),
  );
  async function attachImageFromUrl(url: string) {
    try {
      // 상대경로( /api/attachments/... 등 우리 서버에 이미 올라온 이미지)는 same-origin 이므로
      // 백엔드 image-proxy(절대 http/https URL 만 허용) 를 거치지 않고 브라우저에서 직접 fetch.
      // 외부 http(s) 이미지만 CORS 회피용으로 image-proxy 를 경유.
      const isSameOrigin = (() => {
        try {
          return (
            new URL(url, window.location.origin).origin ===
            window.location.origin
          );
        } catch {
          return false;
        }
      })();

      let dataUrl: string;
      if (isSameOrigin) {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!/^image\//i.test(blob.type)) {
          throw new Error(
            t('error.notAnImage').replace('{type}', blob.type || t('common.unknown')),
          );
        }
        dataUrl = await new Promise<string>((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result as string);
          fr.onerror = () => reject(new Error(t('error.fileReadFailed')));
          fr.readAsDataURL(blob);
        });
      } else {
        const res = await fetch(
          `${API_URL}/chat/image-proxy?url=${encodeURIComponent(url)}`,
        );
        if (!res.ok) {
          const j = await res.json().catch(() => null);
          throw new Error(j?.message || `HTTP ${res.status}`);
        }
        dataUrl = ((await res.json()) as { dataUrl: string }).dataUrl;
      }

      // URL pathname 의 마지막 segment 를 파일명으로 사용 (없으면 빈 문자열).
      const name = (() => {
        try {
          const u = new URL(url, window.location.origin);
          const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
          return decodeURIComponent(last);
        } catch {
          return '';
        }
      })();
      dataUrlToSourceRef.current.set(dataUrl, url);
      inputBarRef.current?.attachImageDataUrls([dataUrl], [name]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.error');
      alert(`${t('error.imageAttachFailed')}: ${msg}`);
    }
  }
  // InputBar 의 현재 dataUrl 목록을 받아 → 살아남은 source URL 집합으로 재계산.
  // 사용자가 InputBar 에서 × 로 제거하거나 전송 후 빈 목록이 오면 set 도 비워짐.
  // useCallback — 정체성이 매 렌더마다 변하면 InputBar useEffect 가 무한 재발화하므로 고정.
  const handleAttachedChange = useCallback((dataUrls: string[]) => {
    const live = new Set(dataUrls);
    const m = dataUrlToSourceRef.current;
    for (const k of [...m.keys()]) {
      if (!live.has(k)) m.delete(k);
    }
    setAttachedSourceUrls((prev) => {
      // 같은 멤버면 prev 그대로 — 불필요한 재렌더 회피.
      if (prev.size === m.size) {
        let same = true;
        for (const v of m.values()) {
          if (!prev.has(v)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return new Set(m.values());
    });
  }, []);

  // (모델 목록/엔드포인트 검증은 Settings 의 AI 섹션이 그룹별로 자체 관리)

  // 마운트 시 데이터 로드: 서버에서 conversation 메타 + folder 목록.
  // 메시지는 active thread 가 정해지면 그때 lazy fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [convRes, foldRes] = await Promise.all([
          fetch(`${API_URL}/conversations?limit=50`, { credentials: 'include' }),
          fetch(`${API_URL}/folders`, { credentials: 'include' }),
        ]);
        if (convRes.ok && foldRes.ok) {
          const page = (await convRes.json()) as {
            data: Conversation[];
            nextCursor: string | null;
            hasMore: boolean;
          };
          const sConvs = page.data;
          const sFolds = (await foldRes.json()) as Folder[];
          serverConvsRef.current = new Map(sConvs.map((c) => [c.id, c]));
          serverFoldersRef.current = new Map(sFolds.map((f) => [f.id, f]));
          convCursorRef.current = page.nextCursor;
          if (cancelled) return;
          setHasMoreConvs(page.hasMore);
          if (sConvs.length > 0) {
            // 서버는 메시지 없이 메타만 반환 → 빈 messages 로 초기화.
            const init = sConvs.map(
              (c): Conversation => ({
                ...c,
                kind: c.kind ?? 'thread',
                messages: [],
                messagesLoaded: false,
                hasMoreMessages: true,
              }),
            );
            setConversations(init);
            // URL ?c=<id> 파라미터 우선 → localStorage 의 lastActive → 첫 대화.
            const fromUrl = (() => {
              try {
                const sp = new URLSearchParams(window.location.search);
                const cid = sp.get('c');
                return cid && init.some((c) => c.id === cid) ? cid : null;
              } catch {
                return null;
              }
            })();
            if (fromUrl) {
              setActiveId(fromUrl);
              setView('thread');
            } else {
              const lastActive = localStorage.getItem(ACTIVE_KEY);
              setActiveId(
                lastActive && init.some((c) => c.id === lastActive)
                  ? lastActive
                  : init[0].id,
              );
              // URL 에 thread 파라미터가 없으면 dashboard 유지 (기본값).
            }
            setFolders(sFolds);
            hydratedRef.current = true;
            return;
          }
        }
      } catch {
        // 서버 실패 — 비어 있는 상태로 시작. 사용자가 "+ Thread" 로 직접 생성.
      }
      if (cancelled) return;
      setConversations([]);
      setActiveId(null);
      hydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // localStorage 는 마지막 active thread id 만 캐시. 메시지/대화 본문은 서버를 단일 소스로.
  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      if (activeId) localStorage.setItem(ACTIVE_KEY, activeId);
    } catch {
      // quota etc.
    }
  }, [activeId]);

  // (view, activeId) 변경 시 URL 동기화.
  //   view=thread + activeId → /?c=<id>
  //   view=dashboard         → /dashboard
  //   pathname=/settings 일 땐 URL 을 건드리지 않음 (settings 가 우선 경로).
  //
  // thread→thread 전환은 replaceState: 스레드 간 이동마다 history entry가 쌓이면
  // 모바일 swipe back이 main list 대신 이전 스레드로 이동하는 버그가 발생.
  // dashboard→thread / thread→dashboard 만 pushState (back gesture로 복귀 가능).
  const lastUrlRef = useRef<string>('');
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (typeof window === 'undefined') return;
    if (window.location.pathname === '/settings') return;
    let url: string;
    if (view === 'thread' && activeId) {
      url = `/?c=${encodeURIComponent(activeId)}`;
    } else {
      url = '/dashboard';
    }
    if (url === lastUrlRef.current) return;
    const prevUrl = lastUrlRef.current;
    lastUrlRef.current = url;
    // thread→thread: replaceState — 스레드 목록 탐색이 history를 오염시키지 않도록.
    if (prevUrl.startsWith('/?c=') && url.startsWith('/?c=')) {
      window.history.replaceState({}, '', url);
    } else {
      window.history.pushState({}, '', url);
    }
  }, [view, activeId]);

  // 초기 마운트 시 — direct URL (/settings, /dashboard) 진입 케이스 처리.
  // 이후 내부 토글은 window.history.pushState 로 직접, popstate 로 sync.
  useEffect(() => {
    if (pathname === '/settings') {
      setSettingsOpen(true);
    } else if (pathname === '/dashboard') {
      setView('dashboard');
    }
    // 의도적으로 mount 시 한 번만. pathname 변경은 popstate 가 담당.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 브라우저 back/forward 로 URL 이 바뀌면 view/activeId/settings 를 다시 맞춤.
  useEffect(() => {
    const onPop = () => {
      try {
        const path = window.location.pathname;
        // /settings → 모달만 토글, view 는 보존.
        if (path === '/settings') {
          setSettingsOpen(true);
          lastUrlRef.current = `${path}${window.location.search}`;
          return;
        }
        setSettingsOpen(false);

        const sp = new URLSearchParams(window.location.search);
        const cid = sp.get('c');
        if (cid) {
          const exists = conversationsRef.current.some((c) => c.id === cid);
          if (exists) {
            setActiveId(cid);
            setView('thread');
            // 모바일에서 thread 로 들어올 땐 sidebar 닫아서 thread 화면이 보이게.
            if (typeof window !== 'undefined' && window.innerWidth < 768) {
              setSidebarOpen(false);
            }
            lastUrlRef.current = `${path}${window.location.search}`;
            return;
          }
        }
        // 모바일에서는 thread → list 로 갈 때 view 를 바꾸지 않고 sidebar 만 열어,
        // thread 컴포넌트를 mount 상태로 유지 → swipe-back 시 "다시 로딩되는 느낌" 제거.
        // (in-app 백 버튼과 동일한 동작.)
        const isMobile =
          typeof window !== 'undefined' && window.innerWidth < 768;
        if (isMobile) {
          setSidebarOpen(true);
        } else {
          setView('dashboard');
        }
        lastUrlRef.current = `${path}${window.location.search}`;
      } catch {
        // ignore
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
    } catch {
      // ignore
    }
  }, [folders]);

  // dirty 감지: 서버 스냅샷과 비교. 객체 reference가 다르거나 id 셋이 다르면 dirty.
  useEffect(() => {
    if (!hydratedRef.current) return;
    const sc = serverConvsRef.current;
    const sf = serverFoldersRef.current;
    // 메시지는 별도 endpoint 로 즉시 영속되므로 dirty 판정에서 제외.
    // conversation 메타(제목/폴더/모델) 만 diff.
    const metaDiff = (a: Conversation | undefined, b: Conversation): boolean => {
      if (!a) return true;
      return (
        a.title !== b.title ||
        (a.folderId ?? null) !== (b.folderId ?? null) ||
        (a.model ?? null) !== (b.model ?? null)
      );
    };
    const dirty =
      conversations.some((c) => metaDiff(sc.get(c.id), c)) ||
      conversations.length !== sc.size ||
      folders.some((f) => sf.get(f.id) !== f) ||
      folders.length !== sf.size;
    setIsDirty(dirty);
  }, [conversations, folders]);

  // 페이지를 떠나려 할 때 — 브라우저 네이티브 confirm.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // 명시적 저장: 서버 스냅샷과 diff하여 POST/PATCH/DELETE.
  const saveToServer = useCallback(async (): Promise<boolean> => {
    const sc = serverConvsRef.current;
    const sf = serverFoldersRef.current;
    const tasks: Promise<Response>[] = [];

    // Conversations: 신규/수정
    for (const c of conversations) {
      const prev = sc.get(c.id);
      if (prev === c) continue;
      if (prev === undefined) {
        // 신규 conversation은 메시지 없이 메타만 등록. 메시지는 별도 endpoint 로 append.
        const { messages: _omitMsgs, ...meta } = c;
        void _omitMsgs;
        tasks.push(
          fetch(`${API_URL}/conversations`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(meta),
          }),
        );
      } else {
        tasks.push(
          fetch(`${API_URL}/conversations/${c.id}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: c.title,
              model: c.model ?? null,
              folderId: c.folderId ?? null,
              pinned: c.pinned ?? false,
            }),
          }),
        );
      }
    }
    // Conversations: 삭제
    const currentConvIds = new Set(conversations.map((c) => c.id));
    for (const id of Array.from(sc.keys())) {
      if (!currentConvIds.has(id)) {
        tasks.push(
          fetch(`${API_URL}/conversations/${id}`, {
            method: 'DELETE',
            credentials: 'include',
          }),
        );
      }
    }

    // Folders 동일
    for (const f of folders) {
      const prev = sf.get(f.id);
      if (prev === f) continue;
      if (prev === undefined) {
        tasks.push(
          fetch(`${API_URL}/folders`, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(f),
          }),
        );
      } else {
        tasks.push(
          fetch(`${API_URL}/folders/${f.id}`, {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: f.name, expanded: f.expanded }),
          }),
        );
      }
    }
    const currentFolderIds = new Set(folders.map((f) => f.id));
    for (const id of Array.from(sf.keys())) {
      if (!currentFolderIds.has(id)) {
        tasks.push(
          fetch(`${API_URL}/folders/${id}`, {
            method: 'DELETE',
            credentials: 'include',
          }),
        );
      }
    }

    try {
      const responses = await Promise.all(tasks);
      const failed = responses.find((r) => !r.ok);
      if (failed) {
        console.error('일부 저장 실패', failed.status);
        return false;
      }
      // 스냅샷 갱신 — 현재 state가 곧 최신.
      serverConvsRef.current = new Map(conversations.map((c) => [c.id, c]));
      serverFoldersRef.current = new Map(folders.map((f) => [f.id, f]));
      setIsDirty(false);
      return true;
    } catch (e) {
      console.error('저장 실패', e);
      return false;
    }
  }, [conversations, folders]);

  // ---------- 메시지 페이지네이션 ----------

  const MSG_PAGE = 50;

  // 백엔드에서 메시지 한 페이지 fetch. before 가 없으면 최신 N개.
  // 반환은 시간 오름차순.
  type ServerMessage = {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    thinking?: string | null;
    metadata?: Record<string, unknown>;
    createdAt: number;
  };
  const fetchMessagesPage = useCallback(
    async (
      convId: string,
      before: string | null,
      after?: string | null,
    ): Promise<{ msgs: Message[]; hasMore: boolean }> => {
      const qs = new URLSearchParams();
      if (before) qs.set('before', before);
      if (after != null) qs.set('after', after);
      qs.set('limit', String(MSG_PAGE));
      const res = await fetch(
        `${API_URL}/conversations/${convId}/messages?${qs.toString()}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as ServerMessage[];
      const msgs: Message[] = rows.map((r) => {
        // followup(재질문) 은 ephemeral — 현재 페이지 세션에서만 유효, 영속 안 함.
        // 옛 데이터에 잔존할 수 있으니 로드 시점에 필터링.
        const meta = { ...(r.metadata ?? {}) } as Record<string, unknown>;
        delete meta.followup;
        delete meta.followupGenerating;
        return {
          id: r.id,
          role: r.role,
          content: r.content,
          thinking: r.thinking ?? undefined,
          ...meta,
          // 서버 row 의 실제 createdAt 을 항상 사용 — metadata 에 들어있던 예전 짧은 형식(time)을 덮어씀.
          time: formatTime(r.createdAt),
          // 진행 중 플래그는 DB 에 저장되더라도 새로고침 후엔 무의미 → 항상 false 로 초기화.
          // 옛날 데이터에 이 플래그가 박혀 "Creating hashtags..." 가 영구적으로 남는 버그 방지.
          hashtagsGenerating: false,
          followupGenerating: false,
        } as Message;
      });
      // 받아온 row 수가 페이지 가득이면 과거가 더 있을 가능성 있음.
      return { msgs, hasMore: rows.length >= MSG_PAGE };
    },
    [],
  );

  // 실시간 동기화 — 같은 thread 를 다른 기기/탭에서 열어둔 경우, 그쪽 변경(메시지 추가/최종답변)을
  // EventSource(SSE)로 수신해 현재 화면에 새로고침 없이 병합.
  // 변경을 일으킨 본인 탭도 echo 를 받지만 id dedup + liveMessageId 가드로 무해하게 무시됨.
  useEffect(() => {
    if (!activeId) return;
    const convId = activeId;
    const es = new EventSource(`${API_URL}/conversations/${convId}/events`);

    // 원격 스트림의 라이브 토큰 속도 계산용 (능동 흐름과 동일: content 누적 길이 / 경과초).
    let rStartedAt = 0;
    let rAccumLen = 0;
    let rLastUpdate = 0;

    // delta rAF 배칭 — 토큰마다 setConversations(전체 메시지 map) 하지 않고 프레임당 1회로 묶음.
    // 글 많은 thread 에서 실시간 스트림 성능 저하 방지. 누적 결과(content/thinking)는 동일.
    const pendingDelta = new Map<string, { content: string; thinking: string }>();
    let deltaFlushHandle: number | null = null;
    const flushDelta = () => {
      if (deltaFlushHandle !== null) {
        cancelAnimationFrame(deltaFlushHandle);
        deltaFlushHandle = null;
      }
      if (pendingDelta.size === 0) return;
      const applied = new Map(pendingDelta);
      pendingDelta.clear();
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId || !c.messagesLoaded) return c;
          let changed = false;
          const messages = c.messages.map((m) => {
            const d = applied.get(m.id);
            if (!d) return m;
            changed = true;
            return {
              ...m,
              content: d.content ? (m.content ?? '') + d.content : m.content,
              thinking: d.thinking
                ? (m.thinking ?? '') + d.thinking
                : m.thinking,
            };
          });
          return changed ? { ...c, messages } : c;
        }),
      );
    };
    const scheduleDeltaFlush = () => {
      if (deltaFlushHandle === null) {
        deltaFlushHandle = requestAnimationFrame(flushDelta);
      }
    };

    const mapDto = (r: ServerMessage): Message => {
      const meta = { ...(r.metadata ?? {}) } as Record<string, unknown>;
      delete meta.followup;
      delete meta.followupGenerating;
      return {
        id: r.id,
        role: r.role,
        content: r.content,
        thinking: r.thinking ?? undefined,
        ...meta,
        time: formatTime(r.createdAt),
        hashtagsGenerating: false,
        followupGenerating: false,
      } as Message;
    };

    es.onmessage = (ev) => {
      let parsed: {
        type?: string;
        conversationId?: string;
        payload?: unknown;
      };
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return; // heartbeat 등 비-JSON 은 무시
      }
      if (parsed.conversationId !== convId) return;

      // 발신자(이 탭) 본인이 만든 스트림은 로컬 SSE 가 이미 렌더 → 미러 이벤트 무시.
      const ownStream = (id: unknown) =>
        typeof id === 'string' && id === localStreamingIdRef.current;

      if (parsed.type === 'messages.appended') {
        const dtos = (parsed.payload as ServerMessage[]) ?? [];
        setConversations((prev) =>
          prev.map((c) => {
            // 아직 메시지를 로드 안 한 대화는 열 때 새로 fetch 되므로 병합 생략.
            if (c.id !== convId || !c.messagesLoaded) return c;
            const have = new Set(c.messages.map((m) => m.id));
            const add = dtos.filter((d) => !have.has(d.id)).map(mapDto);
            if (add.length === 0) return c; // 본인 echo → dedup
            return { ...c, messages: [...c.messages, ...add] };
          }),
        );
      } else if (parsed.type === 'message.updated') {
        const dto = parsed.payload as ServerMessage;
        if (!dto?.id || ownStream(dto.id)) return;
        // 최종 전체 content 가 도착 → 미적용 delta 는 폐기(중복 append 방지).
        pendingDelta.delete(dto.id);
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId || !c.messagesLoaded) return c;
            let changed = false;
            const messages = c.messages.map((m) => {
              if (m.id !== dto.id) return m;
              // 로컬에서 에러로 표시한 메시지(⚠️ 연결 실패)는 백엔드 finally 가 보내는
              // 부분/빈 content 미러 업데이트로 덮어쓰지 않음 — 에러 표시 유지.
              if (m.isError) return m;
              changed = true;
              return { ...m, ...mapDto(dto) };
            });
            return changed ? { ...c, messages } : c;
          }),
        );
      } else if (parsed.type === 'message.deleted') {
        // 목차/제목 기준 삭제 — 다른 기기/탭에서 해당 메시지(질문+답변) 제거.
        const { ids } = (parsed.payload ?? {}) as { ids?: string[] };
        if (!ids?.length) return;
        const rm = new Set(ids);
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId || !c.messagesLoaded) return c;
            const messages = c.messages.filter((m) => !rm.has(m.id));
            return messages.length === c.messages.length
              ? c
              : { ...c, messages };
          }),
        );
      } else if (parsed.type === 'messages.reordered') {
        // 목차(TOC) 드래그 등으로 바뀐 순서 반영.
        const { orderedIds } = (parsed.payload ?? {}) as {
          orderedIds?: string[];
        };
        if (!orderedIds?.length) return;
        const order = new Map(orderedIds.map((id, i) => [id, i]));
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId || !c.messagesLoaded) return c;
            const sorted = [...c.messages].sort((a, b) => {
              const ai = order.has(a.id)
                ? (order.get(a.id) as number)
                : Number.MAX_SAFE_INTEGER;
              const bi = order.has(b.id)
                ? (order.get(b.id) as number)
                : Number.MAX_SAFE_INTEGER;
              return ai - bi;
            });
            return { ...c, messages: sorted };
          }),
        );
      } else if (parsed.type === 'message.stream.start') {
        const { messageId } = (parsed.payload ?? {}) as { messageId?: string };
        if (!messageId || ownStream(messageId)) return;
        // 다른 기기/탭이 응답 생성 시작 — 입력창 streaming 상태 + 대상 메시지 표시 미러링.
        setPending(true);
        setLiveMessageId(messageId);
        remotePendingRef.current = true;
        rStartedAt = 0;
        rAccumLen = 0;
        rLastUpdate = 0;
        setLiveTokRate(null);
      } else if (parsed.type === 'message.delta') {
        const { messageId, kind, text } = (parsed.payload ?? {}) as {
          messageId?: string;
          kind?: 'content' | 'thinking';
          text?: string;
        };
        if (!messageId || !text || ownStream(messageId)) return;
        // 라이브 토큰 속도 — content 누적 길이 / 경과초 (능동 흐름과 동일, 180ms throttle).
        if (kind !== 'thinking') {
          rAccumLen += text.length;
          const now = Date.now();
          if (rStartedAt === 0) rStartedAt = now;
          if (now - rLastUpdate > 180) {
            const elapsed = (now - rStartedAt) / 1000;
            if (elapsed > 0.05) setLiveTokRate(rAccumLen / elapsed);
            rLastUpdate = now;
          }
        }
        // 토큰을 배치에 누적 → 프레임당 1회 flush (능동 브라우저처럼 점진 렌더, 동작 동일).
        const cur = pendingDelta.get(messageId) ?? { content: '', thinking: '' };
        if (kind === 'thinking') cur.thinking += text;
        else cur.content += text;
        pendingDelta.set(messageId, cur);
        scheduleDeltaFlush();
      } else if (parsed.type === 'message.part') {
        // 검색 결과/Reference documents/이미지 등 raw 파트 → 능동과 동일한 공용 핸들러로 반영.
        const { messageId, part } = (parsed.payload ?? {}) as {
          messageId?: string;
          part?: Record<string, unknown>;
        };
        if (!messageId || !part || ownStream(messageId)) return;
        applyServerStreamPart(part, messageId, (updater) =>
          setConversations((prev) =>
            prev.map((c) =>
              c.id === convId && c.messagesLoaded ? updater(c) : c,
            ),
          ),
        );
      } else if (parsed.type === 'message.metric') {
        const { messageId, tokens, durationMs, tokensPerSec, promptTokens } =
          (parsed.payload ?? {}) as {
            messageId?: string;
            tokens?: number;
            durationMs?: number;
            tokensPerSec?: number;
            promptTokens?: number;
          };
        if (!messageId || ownStream(messageId)) return;
        // 토큰 사용량 동기화 — 대상 메시지의 metric 필드 갱신.
        setConversations((prev) =>
          prev.map((c) => {
            if (c.id !== convId || !c.messagesLoaded) return c;
            let changed = false;
            const messages = c.messages.map((m) => {
              if (m.id !== messageId) return m;
              changed = true;
              return {
                ...m,
                metric: {
                  tokens: tokens ?? 0,
                  durationMs: durationMs ?? 0,
                  tokensPerSec: tokensPerSec ?? 0,
                  promptTokens,
                },
              };
            });
            return changed ? { ...c, messages } : c;
          }),
        );
      } else if (parsed.type === 'message.stream.end') {
        const { messageId } = (parsed.payload ?? {}) as { messageId?: string };
        if (messageId && ownStream(messageId)) return;
        flushDelta(); // 남은 토큰 즉시 반영
        // 응답 생성 종료 — 입력창 재개.
        setPending(false);
        setLiveMessageId(null);
        remotePendingRef.current = false;
        setLiveTokRate(null);
      }
    };

    // EventSource 는 끊겨도 자동 재연결 — 별도 처리 불필요.
    return () => {
      es.close();
      flushDelta(); // 남은 배치 토큰 반영 후 정리
      // 원격 스트림 도중 thread 를 떠나면 stale 한 pending/liveMessageId 해제.
      if (remotePendingRef.current) {
        remotePendingRef.current = false;
        setPending(false);
        setLiveMessageId(null);
        setLiveTokRate(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // 사이드바 실시간 동기화 — 대화(thread/chat)·폴더 추가/삭제/이름변경/이동/핀을 다른 기기/탭과 동기화.
  // serverConvsRef/serverFoldersRef 도 같은 객체 참조로 갱신 → 저장 diff 가 재전송하지 않게 함.
  useEffect(() => {
    const es = new EventSource(`${API_URL}/conversations/events/user`);
    es.onmessage = (ev) => {
      let parsed: { type?: string; payload?: unknown };
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return; // heartbeat 등
      }
      const p = (parsed.payload ?? {}) as Record<string, unknown>;

      if (parsed.type === 'conversation.upsert') {
        const dto = p.conversation as
          | (Partial<Conversation> & { id: string })
          | undefined;
        if (!dto?.id) return;
        setConversations((prev) => {
          const existing = prev.find((c) => c.id === dto.id);
          const merged: Conversation = existing
            ? {
                ...existing,
                title: dto.title ?? existing.title,
                kind: dto.kind ?? existing.kind ?? 'thread',
                model: dto.model ?? undefined,
                folderId: dto.folderId ?? null,
                hashtags: dto.hashtags,
                excludedHashtags: dto.excludedHashtags,
                pinned: dto.pinned,
                updatedAt: dto.updatedAt ?? existing.updatedAt,
              }
            : {
                id: dto.id,
                title: dto.title ?? '',
                kind: dto.kind ?? 'thread',
                messages: [],
                messagesLoaded: false,
                hasMoreMessages: true,
                updatedAt: dto.updatedAt ?? Date.now(),
                model: dto.model ?? undefined,
                folderId: dto.folderId ?? null,
                hashtags: dto.hashtags,
                excludedHashtags: dto.excludedHashtags,
                pinned: dto.pinned,
              };
          serverConvsRef.current.set(dto.id, merged); // 같은 참조 → 재저장 방지
          return existing
            ? prev.map((c) => (c.id === dto.id ? merged : c))
            : [merged, ...prev];
        });
      } else if (parsed.type === 'conversation.deleted') {
        const id = p.id as string | undefined;
        if (!id) return;
        serverConvsRef.current.delete(id);
        setConversations((prev) => prev.filter((c) => c.id !== id));
        setActiveId((cur) => (cur === id ? null : cur));
      } else if (parsed.type === 'folder.upsert') {
        const f = p.folder as (Partial<Folder> & { id: string }) | undefined;
        if (!f?.id) return;
        setFolders((prev) => {
          const existing = prev.find((x) => x.id === f.id);
          const merged: Folder = {
            id: f.id,
            name: f.name ?? existing?.name ?? '',
            kind: f.kind ?? existing?.kind ?? 'thread',
            // 펼침 상태는 각 브라우저 로컬 뷰 선호 → 기존 값 유지(이름변경 등에서 안 흔들리게).
            expanded: existing?.expanded ?? f.expanded ?? true,
            createdAt: f.createdAt ?? existing?.createdAt ?? Date.now(),
          };
          serverFoldersRef.current.set(f.id, merged);
          return existing
            ? prev.map((x) => (x.id === f.id ? merged : x))
            : [...prev, merged];
        });
      } else if (parsed.type === 'folder.deleted') {
        const id = p.id as string | undefined;
        if (!id) return;
        serverFoldersRef.current.delete(id);
        setFolders((prev) => prev.filter((x) => x.id !== id));
      } else if (parsed.type === 'stream.active') {
        // 어느 thread 든 응답 생성 시작 → 전역 스트리밍 집합에 추가.
        const cid = p.conversationId as string | undefined;
        if (!cid) return;
        setStreamingConvIds((prev) => {
          if (prev.has(cid)) return prev;
          const next = new Set(prev);
          next.add(cid);
          return next;
        });
      } else if (parsed.type === 'stream.inactive') {
        const cid = p.conversationId as string | undefined;
        if (!cid) return;
        setStreamingConvIds((prev) => {
          if (!prev.has(cid)) return prev;
          const next = new Set(prev);
          next.delete(cid);
          return next;
        });
      }
    };
    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 활성 conversation 이 바뀌고 아직 메시지를 한 번도 fetch 하지 않았으면 첫 페이지를 가져온다.
  // Thread: 가장 오래된 메시지(문서 처음)부터 순방향으로 시작. Chat: 최신 메시지부터 역방향.
  useEffect(() => {
    if (!activeId) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv || conv.messagesLoaded) return;
    const isThreadKind = (conv.kind ?? 'thread') === 'thread';
    let cancelled = false;
    (async () => {
      try {
        const { msgs, hasMore } = isThreadKind
          ? await fetchMessagesPage(activeId, null, '__start__')
          : await fetchMessagesPage(activeId, null);
        if (cancelled) return;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  messages: msgs,
                  messagesLoaded: true,
                  hasMoreMessages: isThreadKind ? false : hasMore,
                  hasMoreNewerMessages: isThreadKind ? hasMore : false,
                }
              : c,
          ),
        );
        // Chat: 역방향 페이지 미리 받아둠.
        if (!isThreadKind && hasMore && msgs.length > 0) {
          void prefetchOlderMessages(activeId, msgs[0].id);
        }
        // Thread: 문서는 처음부터 표시하되, 최신 발화가 누락되지 않도록 끝까지 순방향 자동 로드.
        // (긴 thread 도 새로고침 후 마지막 메시지가 보이게 — 저장은 정상, 로드만 보강.)
        if (isThreadKind && hasMore && msgs.length > 0) {
          let cursorId: string | null = msgs[msgs.length - 1].id;
          let more: boolean = hasMore;
          while (more && cursorId && !cancelled) {
            const next = await fetchMessagesPage(activeId, null, cursorId);
            if (cancelled) return;
            if (next.msgs.length === 0) {
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === activeId
                    ? { ...c, hasMoreNewerMessages: false }
                    : c,
                ),
              );
              break;
            }
            setConversations((prev) =>
              prev.map((c) => {
                if (c.id !== activeId) return c;
                const have = new Set(c.messages.map((m) => m.id));
                const add = next.msgs.filter((m) => !have.has(m.id));
                return {
                  ...c,
                  messages: [...c.messages, ...add],
                  hasMoreNewerMessages: next.hasMore,
                };
              }),
            );
            cursorId = next.msgs[next.msgs.length - 1].id;
            more = next.hasMore;
          }
        }
      } catch {
        if (cancelled) return;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId
              ? { ...c, messagesLoaded: true, hasMoreMessages: false, hasMoreNewerMessages: false }
              : c,
          ),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // 점진적 렌더 — 활성 thread 가 로드되면 처음엔 일부만 렌더하고 idle 로 점차 확장.
  // (페이지 전환은 즉시, 무거운 본문은 백그라운드로 채움. messagesLoaded 가 true 가 될 때 시작.)
  // (active 는 이 시점에 아직 미정의 — conversations 에서 직접 조회.)
  const activeLoadedForRender =
    conversations.find((c) => c.id === activeId)?.messagesLoaded ?? false;
  // 위 렌더-단계 cap 이 긴 thread 를 RENDER_INITIAL 로 줄여둔 상태 → 여기선 idle 로 점차 확장만.
  useEffect(() => {
    const RENDER_CHUNK = 12;
    if (!activeId || !activeLoadedForRender) return;
    const conv0 = conversationsRef.current.find((c) => c.id === activeId);
    const isThread = (conv0?.kind ?? 'thread') === 'thread';
    const total0 = conv0?.messages.length ?? 0;
    if (!isThread || total0 <= RENDER_INITIAL) return; // 짧으면 이미 전체 렌더
    let limit = RENDER_INITIAL;
    let cancelled = false;
    let handle: number | null = null;
    const schedule = (fn: () => void): number =>
      typeof window.requestIdleCallback === 'function'
        ? (window.requestIdleCallback(fn, { timeout: 250 }) as unknown as number)
        : (window.setTimeout(fn, 16) as unknown as number);
    const grow = () => {
      if (cancelled) return;
      const conv = conversationsRef.current.find((c) => c.id === activeId);
      const total = conv?.messages.length ?? 0;
      const stillLoading = conv?.hasMoreNewerMessages ?? false;
      if (limit >= total && !stillLoading) {
        // 모두 따라잡음 → 제한 해제(이후 스트리밍 추가분도 즉시 렌더).
        setRenderLimit(Number.POSITIVE_INFINITY);
        return;
      }
      limit += RENDER_CHUNK;
      setRenderLimit(limit);
      handle = schedule(grow);
    };
    handle = schedule(grow);
    return () => {
      cancelled = true;
      if (handle === null) return;
      if (typeof window.cancelIdleCallback === 'function')
        window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeLoadedForRender]);

  // 폴링이 필요한 메시지 id — 활성 thread 의 마지막 메시지가 빈 assistant 인 경우만.
  // 안정적 id 라서 useEffect 가 무한 재실행되지 않음 (다른 conversations 변경엔 반응 X).
  const pollingPlaceholderMsgId = useMemo(() => {
    if (!activeId) return null;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv || !conv.messagesLoaded) return null;
    const last = conv.messages[conv.messages.length - 1];
    if (!last || last.role !== 'assistant') return null;
    if (last.content && last.content.length > 0) return null;
    return last.id;
  }, [activeId, conversations]);

  // 백엔드에서 백그라운드 처리 중인 assistant 메시지 — 마지막 메시지가 빈 placeholder 면
  // (예: 사용자가 질문 후 즉시 새로고침) 주기적으로 DB 조회해 응답이 완료됐는지 확인.
  // pending=true(현재 페이지에서 스트리밍 중) 일 땐 폴링 불필요 — SSE 가 직접 업데이트.
  useEffect(() => {
    if (!pollingPlaceholderMsgId || !activeId || pending) return;
    const targetMsgId = pollingPlaceholderMsgId;
    const targetConvId = activeId;
    let cancelled = false;
    let tries = 0;
    const MAX_TRIES = 60; // 약 3분 (3초 × 60) — 그 후엔 폴링 중지, 사용자 수동 새로고침 안내.
    const tick = async () => {
      if (cancelled) return;
      tries += 1;
      if (tries > MAX_TRIES) {
        cancelled = true;
        return;
      }
      try {
        const res = await fetch(
          `${API_URL}/conversations/${targetConvId}/messages?limit=5`,
          { credentials: 'include' },
        );
        if (!res.ok) return;
        const rows = (await res.json()) as ServerMessage[];
        const updated = rows.find((r) => r.id === targetMsgId);
        if (!updated) return;
        if (!updated.content || updated.content.length === 0) return;
        // 응답이 도착 — 로컬 state 에 반영하고 폴링 중지.
        const meta = { ...(updated.metadata ?? {}) } as Record<string, unknown>;
        delete meta.followup;
        delete meta.followupGenerating;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === targetConvId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === targetMsgId
                      ? {
                          ...m,
                          content: updated.content,
                          thinking: updated.thinking ?? m.thinking,
                          ...meta,
                          time: formatTime(updated.createdAt),
                        }
                      : m,
                  ),
                }
              : c,
          ),
        );
        cancelled = true;
      } catch {
        // 다음 주기에서 재시도
      }
    };
    // 즉시 한 번 + 이후 주기적으로.
    void tick();
    const interval = window.setInterval(tick, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pollingPlaceholderMsgId, activeId, pending]);

  // 다음 이전-페이지를 미리 받아두는 캐시. { convId, beforeId } 로 키를 삼아 stale 체크.
  const olderPrefetchRef = useRef<{
    convId: string;
    beforeId: string;
    msgs: Message[];
    hasMore: boolean;
  } | null>(null);
  const prefetchingRef = useRef(false);

  const prefetchOlderMessages = useCallback(
    async (convId: string, oldestMsgId: string) => {
      if (prefetchingRef.current) return;
      prefetchingRef.current = true;
      try {
        const { msgs, hasMore } = await fetchMessagesPage(convId, oldestMsgId);
        olderPrefetchRef.current = { convId, beforeId: oldestMsgId, msgs, hasMore };
      } catch {
        // 실패는 무시 — 다음 스크롤 트리거 시 다시 시도
      } finally {
        prefetchingRef.current = false;
      }
    },
    [fetchMessagesPage],
  );

  // Thread 순방향 prefetch 캐시
  const newerPrefetchRef = useRef<{
    convId: string;
    afterId: string;
    msgs: Message[];
    hasMore: boolean;
  } | null>(null);
  const prefetchingNewerRef = useRef(false);

  const prefetchNewerMessages = useCallback(
    async (convId: string, newestMsgId: string) => {
      if (prefetchingNewerRef.current) return;
      prefetchingNewerRef.current = true;
      try {
        const { msgs, hasMore } = await fetchMessagesPage(convId, null, newestMsgId);
        newerPrefetchRef.current = { convId, afterId: newestMsgId, msgs, hasMore };
      } catch {
        // 실패는 무시
      } finally {
        prefetchingNewerRef.current = false;
      }
    },
    [fetchMessagesPage],
  );

  // Thread 전용: 아래 스크롤 시 더 새로운 메시지를 append.
  const loadNewerMessages = useCallback(async () => {
    const conv = conversations.find((c) => c.id === activeId);
    const el = scrollRef.current;
    if (!conv || !activeId || !el) return;
    if (!conv.hasMoreNewerMessages || conv.loadingNewer) return;
    if (conv.messages.length === 0) return;
    const newestId = conv.messages[conv.messages.length - 1].id;

    const applyNewerMsgs = (msgs: Message[], hasMore: boolean) => {
      const prevHeight = el.scrollHeight;
      const prevTop = el.scrollTop;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? { ...c, messages: [...c.messages, ...msgs], hasMoreNewerMessages: hasMore, loadingNewer: false }
            : c,
        ),
      );
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const after = scrollRef.current;
          if (!after) return;
          // 아래에 추가됐으므로 scrollTop 은 유지 (위치 점프 없음)
          after.scrollTop = prevTop + (after.scrollHeight - prevHeight) * 0;
        });
      });
      if (hasMore && msgs.length > 0) {
        void prefetchNewerMessages(activeId, msgs[msgs.length - 1].id);
      }
    };

    const cached = newerPrefetchRef.current;
    if (cached && cached.convId === activeId && cached.afterId === newestId) {
      newerPrefetchRef.current = null;
      applyNewerMsgs(cached.msgs, cached.hasMore);
      return;
    }

    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? { ...c, loadingNewer: true } : c)),
    );
    try {
      const { msgs, hasMore } = await fetchMessagesPage(activeId, null, newestId);
      applyNewerMsgs(msgs, hasMore);
    } catch {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeId ? { ...c, loadingNewer: false } : c)),
      );
    }
  }, [conversations, activeId, fetchMessagesPage, prefetchNewerMessages]);

  // 스크롤이 상단 근처에 닿으면 더 과거 메시지를 prepend.
  // 추가 도중에 시각적으로 점프하지 않도록 scrollHeight 차이만큼 scrollTop 보정.
  const loadOlderMessages = useCallback(async () => {
    const conv = conversations.find((c) => c.id === activeId);
    const el = scrollRef.current;
    if (!conv || !activeId || !el) return;
    if (!conv.hasMoreMessages || conv.loadingOlder) return;
    if (conv.messages.length === 0) return;
    const oldestId = conv.messages[0].id;

    const applyOlderMsgs = (msgs: Message[], hasMore: boolean) => {
      const prevHeight = el.scrollHeight;
      const prevTop = el.scrollTop;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? { ...c, messages: [...msgs, ...c.messages], hasMoreMessages: hasMore, loadingOlder: false }
            : c,
        ),
      );
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const after = scrollRef.current;
          if (!after) return;
          after.scrollTop = prevTop + (after.scrollHeight - prevHeight);
        });
      });
      // 방금 prepend 한 페이지의 맨 앞 메시지 기준으로 다음 페이지를 미리 받아둠
      if (hasMore && msgs.length > 0) {
        void prefetchOlderMessages(activeId, msgs[0].id);
      }
    };

    // 미리 받아둔 페이지가 있으면 즉시 적용 (네트워크 대기 없음)
    const cached = olderPrefetchRef.current;
    if (cached && cached.convId === activeId && cached.beforeId === oldestId) {
      olderPrefetchRef.current = null;
      applyOlderMsgs(cached.msgs, cached.hasMore);
      return;
    }

    // 캐시 미스 — 직접 fetch
    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? { ...c, loadingOlder: true } : c)),
    );
    try {
      const { msgs, hasMore } = await fetchMessagesPage(activeId, oldestId);
      applyOlderMsgs(msgs, hasMore);
    } catch {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId ? { ...c, loadingOlder: false } : c,
        ),
      );
    }
  }, [conversations, activeId, fetchMessagesPage, prefetchOlderMessages]);

  // 스크롤 중일 때 입력창을 잠시 숨기기 위한 플래그. scroll 이벤트가 멈추고
  // ~250ms 가 지나면 false 로 복귀.
  const [isScrolling, setIsScrolling] = useState(false);
  // stopTimer 를 useEffect 클로저 내부에 두면 streaming 중 loadOlderMessages 정체성 변화로
  // effect 가 재등록될 때마다 클로저가 새로 만들어져 250ms 타이머가 영원히 못 끝나는 버그.
  // ref 로 빼서 effect 재실행과 무관하게 살아남음.
  const scrollStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 스크롤 중 여부를 ref 로 추적 — scroll 이벤트마다 setIsScrolling(true) 를 호출하면
  // 매 픽셀마다 re-render 가 트리거되므로, 이미 scrolling 상태면 state 업데이트를 생략.
  const isScrollingRef = useRef(false);
  // loadOlderMessages / loadNewerMessages 의 최신 정체성을 ref 로 추적.
  const loadOlderRef = useRef(loadOlderMessages);
  const loadNewerRef = useRef(loadNewerMessages);
  useEffect(() => { loadOlderRef.current = loadOlderMessages; }, [loadOlderMessages]);
  useEffect(() => { loadNewerRef.current = loadNewerMessages; }, [loadNewerMessages]);

  // 메시지 영역 스크롤 감지.
  // Chat: 위로 가면(scrollTop < 800) 과거 메시지 fetch.
  // Thread: 아래로 가면(bottom < 800) 미래 메시지 fetch.
  // deps 를 [] 로 비워 mount 시 1회만 등록 → streaming 중 빈번한 re-render 와 무관.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const st = el.scrollTop;
      const prevSt = lastScrollTopRef.current;
      lastScrollTopRef.current = st;
      if (st < 800) void loadOlderRef.current();
      const distFromBottom = el.scrollHeight - st - el.clientHeight;
      if (distFromBottom < 800) void loadNewerRef.current();
      // 자동 스크롤 윈도우 안이면(프로그래밍 스크롤) 추종 플래그/ isScrolling 토글 생략.
      if (Date.now() < programmaticScrollRef.current) return;
      // 추종 해제는 '사용자가 위로 스크롤한 경우'에만 — References 등장 등 높이 점프로
      // distFromBottom 이 커지는 것만으로는 끄지 않는다(스크롤 위치는 그대로이므로).
      // 하단 근처로 돌아오면 다시 추종 ON.
      if (distFromBottom < 120) {
        stickBottomRef.current = true;
      } else if (st < prevSt - 4) {
        stickBottomRef.current = false;
      }
      // 이미 스크롤 중이면 불필요한 state 업데이트 생략 (매 픽셀마다 setIsScrolling 호출 방지).
      if (!isScrollingRef.current) {
        isScrollingRef.current = true;
        setIsScrolling(true);
      }
      if (scrollStopTimerRef.current) clearTimeout(scrollStopTimerRef.current);
      scrollStopTimerRef.current = setTimeout(() => {
        isScrollingRef.current = false;
        setIsScrolling(false);
        scrollStopTimerRef.current = null;
      }, 250);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // InputBar overlay 의 wheel/touch 이벤트를 scrollRef 로 포워딩.
  // document 에 리스너를 달고 핸들러에서 scrollRef.current 를 lazy 참조 → 조건부 렌더링 무관하게 동작.
  useEffect(() => {
    const isInputArea = (target: HTMLElement, scrollEl: HTMLElement): boolean => {
      // scrollRef 안의 이벤트는 native scroll 이 처리하므로 skip.
      if (scrollEl.contains(target)) return false;
      // scrollRef 와 같은 <main> 안에 있는지 확인 → 다른 라우트의 wheel 은 무시.
      const main = scrollEl.closest('main');
      return !!main && main.contains(target);
    };
    const isScrollableTextarea = (target: HTMLElement): boolean =>
      target.tagName === 'TEXTAREA' &&
      (target as HTMLTextAreaElement).scrollHeight > target.clientHeight;

    const onWheel = (e: WheelEvent) => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      const t = e.target as HTMLElement;
      if (!isInputArea(t, scrollEl)) return;
      if (isScrollableTextarea(t)) return;
      scrollEl.scrollTop += e.deltaY;
    };
    let touchY = 0;
    let touchActive = false;
    const onTouchStart = (e: TouchEvent) => {
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      const t = e.target as HTMLElement;
      if (!isInputArea(t, scrollEl)) { touchActive = false; return; }
      touchActive = true;
      touchY = e.touches[0].clientY;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!touchActive) return;
      const scrollEl = scrollRef.current;
      if (!scrollEl) return;
      const t = e.target as HTMLElement;
      if (isScrollableTextarea(t)) return;
      scrollEl.scrollTop += touchY - e.touches[0].clientY;
      touchY = e.touches[0].clientY;
    };
    const onTouchEnd = () => { touchActive = false; };

    document.addEventListener('wheel', onWheel, { passive: true });
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    document.addEventListener('touchend', onTouchEnd, { passive: true });
    document.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      document.removeEventListener('wheel', onWheel);
      document.removeEventListener('touchstart', onTouchStart);
      document.removeEventListener('touchmove', onTouchMove);
      document.removeEventListener('touchend', onTouchEnd);
      document.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []);

  // 백엔드에 conversation 메타가 없으면 만든다 (첫 메시지 전송 직전에 호출).
  const ensureConversationOnServer = useCallback(
    async (c: Conversation): Promise<void> => {
      if (serverConvsRef.current.has(c.id)) return;
      try {
        const res = await fetch(`${API_URL}/conversations`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: c.id,
            kind: c.kind ?? 'thread',
            title: c.title,
            model: c.model ?? null,
            folderId: c.folderId ?? null,
          }),
        });
        if (res.ok) {
          serverConvsRef.current.set(c.id, c);
        } else {
          console.error(
            '[persist] ensure conversation failed',
            res.status,
            await res.text().catch(() => ''),
          );
        }
      } catch (e) {
        console.error('[persist] ensure conversation threw', e);
      }
    },
    [],
  );

  // 특정 메시지의 metadata(또는 content/thinking)를 백엔드에 부분 업데이트.
  // hashtags/replySummary/followup/metric 처럼 스트림 종료 후 비동기로 채워지는 필드를 영속할 때 사용.
  // 메시지 POST 가 아직 완료되지 않은 경우 PATCH 가 404 → 짧게 backoff 하며 재시도.
  const persistMessageMetadata = useCallback(
    async (convId: string, msgId: string): Promise<void> => {
      const buildBody = () => {
        const conv = conversationsRef.current.find((c) => c.id === convId);
        const m = conv?.messages.find((mm) => mm.id === msgId);
        if (!m) return null;
        // followup/followupGenerating 은 ephemeral — DB 에 영속하지 않음.
        const {
          id: _id,
          role: _role,
          content,
          thinking,
          followup: _fp,
          followupGenerating: _fg,
          hashtagsGenerating: _hg,
          ...rest
        } = m;
        void _id;
        void _role;
        void _fp;
        void _fg;
        void _hg;
        return JSON.stringify({
          content,
          thinking: thinking ?? null,
          metadata: rest,
        });
      };
      const delays = [0, 500, 1500, 3000];
      for (const wait of delays) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        const body = buildBody();
        if (!body) return;
        try {
          const res = await fetch(
            `${API_URL}/conversations/${convId}/messages/${msgId}`,
            {
              method: 'PATCH',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body,
            },
          );
          if (res.ok) return;
          // 404 = 아직 POST 안 끝남 → 재시도. 그 외 코드는 즉시 포기.
          if (res.status !== 404) return;
        } catch {
          // 네트워크 일시 오류 — 다음 delay 에서 재시도
        }
      }
    },
    [],
  );

  // 메시지를 백엔드에 append (스트리밍 종료 후 호출)
  const persistMessages = useCallback(
    async (convId: string, msgs: Message[]): Promise<boolean> => {
      if (msgs.length === 0) return true;
      const payload = {
        messages: msgs.map((m) => {
          // 진행 중 임시 플래그(_hg/_fg) 및 followup(재질문) 은 ephemeral — DB 저장 제외.
          // 그렇지 않으면 새로고침 후 무한히 "Creating hashtags..." / "..." 로 남거나 재질문이 부활.
          const {
            id,
            role,
            content,
            thinking,
            hashtagsGenerating: _hg,
            followupGenerating: _fg,
            followup: _fp,
            ...rest
          } = m;
          void _hg;
          void _fg;
          void _fp;
          return {
            id,
            role,
            content,
            thinking: thinking ?? null,
            metadata: rest,
          };
        }),
      };
      try {
        const res = await fetch(
          `${API_URL}/conversations/${convId}/messages`,
          {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          },
        );
        if (!res.ok) {
          console.error(
            '[persist] POST messages failed',
            res.status,
            await res.text().catch(() => ''),
          );
          return false;
        }
        return true;
      } catch (e) {
        console.error('[persist] POST messages threw', e);
        return false;
      }
    },
    [],
  );


  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  // user msg → 응답이 있는 user msg id 집합 (collapsible 여부)
  // assistant msg → 부모 user msg id 매핑
  // 접힌 turn의 assistant 메시지 id 집합 + turn별 응답 수
  const { turnHasResponse, hiddenIds, hiddenCountByTurn } = useMemo(() => {
    const msgs = active?.messages ?? [];
    const parentMap = new Map<string, string>();
    const hasResponse = new Set<string>();
    const countByTurn = new Map<string, number>();
    let lastUserId: string | null = null;
    for (const m of msgs) {
      if (m.role === 'user') {
        lastUserId = m.id;
      } else if (lastUserId) {
        parentMap.set(m.id, lastUserId);
        hasResponse.add(lastUserId);
        countByTurn.set(lastUserId, (countByTurn.get(lastUserId) ?? 0) + 1);
      }
    }
    const hidden = new Set<string>();
    for (const m of msgs) {
      if (m.role === 'user') continue;
      const parent = parentMap.get(m.id);
      if (parent && collapsedTurns.has(parent)) hidden.add(m.id);
    }
    return {
      turnHasResponse: hasResponse,
      hiddenIds: hidden,
      hiddenCountByTurn: countByTurn,
    };
  }, [active?.messages, collapsedTurns]);

  // 쓰레드 전환 시에는 위에서부터 스크롤 내리는 애니메이션 없이 바로 최하단에서 시작.
  // 같은 쓰레드 내에서 새 메시지가 추가될 때만 부드럽게 스크롤.
  const lastScrolledIdRef = useRef<string | null>(null);
  // 한 번이라도 "메시지가 채워진 상태에서" 자동 스크롤이 끝난 thread 의 id 집합.
  // 첫 메시지 fetch 가 도착하기 전에 active 가 잡히면 scrollHeight 가 작아 헛스크롤되는데,
  // 메시지가 채워진 직후 한 번 더 강제로 하단 점프를 시켜 항상 최신글 위치에서 시작하게.
  const initializedThreadsRef = useRef<Set<string>>(new Set());
  // 프로그래밍 자동 스크롤이 진행 중인지 — onScroll 이 사용자 액션과 구분하기 위해 참조.
  const programmaticScrollRef = useRef<number>(0);
  // send() 가 새 메시지 추가 시 true 로 세팅 → 자동 스크롤 effect 가 120px 가드 무시하고
  // 무조건 하단으로 스크롤. 한 번 사용 후 effect 가 자동 클리어.
  const forceScrollOnNextUpdateRef = useRef(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const switched = lastScrolledIdRef.current !== active?.id;
    lastScrolledIdRef.current = active?.id ?? null;
    // "메시지 채워진 후 첫 진입" 판정 — 활성 thread 의 메시지가 처음으로 1개 이상이고
    // 아직 initialized 표시 안 된 경우. 이 케이스도 무조건 하단 점프.
    const hasMessages = (active?.messages?.length ?? 0) > 0;
    const firstLoadAfterMount =
      !!active?.id &&
      !initializedThreadsRef.current.has(active.id) &&
      hasMessages;
    if (firstLoadAfterMount && active?.id) {
      initializedThreadsRef.current.add(active.id);
    }
    const jumpInstant = switched || firstLoadAfterMount;
    // send() 직후엔 사용자가 위쪽을 보고 있어도 무조건 하단 점프 (자기가 발화한 새 메시지가 보이게).
    const forceFollow = forceScrollOnNextUpdateRef.current;
    forceScrollOnNextUpdateRef.current = false;
    if (!jumpInstant && !forceFollow) {
      // 같은 thread 내 후속 변경(스트리밍/메타 갱신/이미지 제거 등) — 하단 근처일 때만 따라 내림.
      if (pending) {
        // 스트리밍 중: 하단 추종 플래그를 따른다(ResizeObserver 추종 effect 와 동일 기준).
        // 사용자가 위로 올라가 읽는 중이면(stickBottomRef=false) 끌어내리지 않음.
        if (!stickBottomRef.current) return;
      } else {
        const distFromBottom =
          el.scrollHeight - el.scrollTop - el.clientHeight;
        if (distFromBottom > 120) return;
      }
    }
    // 자동 스크롤 시작 — onScroll 핸들러가 isScrolling 을 토글하지 않도록 짧게 표시.
    programmaticScrollRef.current = Date.now() + (jumpInstant || pending ? 50 : 600);
    const activeIsThread = (active?.kind ?? 'thread') === 'thread';
    // 첫 진입(switched / firstLoadAfterMount):
    //  - Thread: 문서 처음(맨 위)에서 시작.
    //  - Chat: 최신 메시지(맨 아래)에서 시작.
    if (jumpInstant) {
      if (activeIsThread) {
        el.scrollTo({ top: 0, behavior: 'auto' });
        return;
      }
      const lastUserId = (() => {
        const msgs = active?.messages ?? [];
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === 'user') return msgs[i].id;
        }
        return null;
      })();
      const targetEl = lastUserId
        ? messageRefs.current.get(lastUserId)
        : null;
      if (targetEl) {
        targetEl.scrollIntoView({ behavior: 'auto', block: 'start' });
        return;
      }
    }
    // Chat 스트리밍/후속 업데이트: 하단 추종.
    if (!activeIsThread || forceFollow || pending) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: jumpInstant || forceFollow || pending ? 'auto' : 'smooth',
      });
    }
    // pending 도 의존 — 스트리밍 종료 후 마지막 렌더에서도 한번 더 따라 내려가도록.
  }, [active?.id, active?.messages, pending]);

  // AI 응답 준비 중(pending) 하단 추종 — React state 변화(active.messages)뿐 아니라
  // References 패널 등장, 행 펼침 애니메이션(380ms), thinking 패널 확장, 답변 텍스트 reflow,
  // 비동기 이미지 로드 등 '높이만 늘어나는' 변화도 ResizeObserver 로 감지해 매 순간 하단으로 갱신.
  // 사용자가 위로 스크롤해 읽는 중이면(stickBottomRef=false) 끌어내리지 않음.
  useEffect(() => {
    if (!pending) return;
    const el = scrollRef.current;
    const content = scrollContentRef.current;
    if (!el || !content) return;
    // pending 시작 시점: 하단 근처면 추종 ON 으로 초기화(자기 발화 직후엔 항상 하단).
    // 멀리 위에서 읽는 중이면 추종하지 않음(원격 스트림 등에서 갑작스런 점프 방지).
    const dist0 = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickBottomRef.current = dist0 < 800;
    const followToBottom = () => {
      if (!stickBottomRef.current) return;
      // onScroll 이 사용자 스크롤로 오인하지 않도록 짧은 프로그래밍 윈도우 표시.
      programmaticScrollRef.current = Date.now() + 80;
      el.scrollTop = el.scrollHeight;
    };
    // 초기 1회 + 이후 컨텐츠 높이 변화마다.
    followToBottom();
    const ro = new ResizeObserver(() => followToBottom());
    ro.observe(content);
    return () => ro.disconnect();
  }, [pending]);

  // 스크롤에 따른 "현재 보이는 user 메시지" 추적 — Message Navigator 의 하이라이트 항목과 동기화.
  // viewport 상단(80px 마진) 위에 있고 그 중 가장 viewport top 에 가까운 user 메시지를 선택.
  // 동시에 chat 헤더에 표시할 sub-heading (bottom 이 viewport top 위로 완전히 올라간 헤딩) 도 같이 갱신.
  const isThread = (active?.kind ?? 'thread') === 'thread';

  // '직접 작성' 버튼 2초 hover 프리뷰 — 켜지면 작성 영역(제목 + 본문) 실루엣을 본문 하단에
  // 표시하고 Thread 최하단으로 강제 스크롤한다. 커서가 벗어나면 끈다.
  const [manualPreview, setManualPreview] = useState(false);
  const handleManualPreview = useCallback((next: boolean) => {
    setManualPreview(next);
  }, []);

  // 최하단으로 스크롤. 레이지 이미지/지연 렌더로 하단 높이가 스크롤 도중 계속 늘어나면
  // 한 번의 scrollTo(scrollHeight) 는 옛 바닥에 멈춰 버린다. → 높이가 안정될 때까지
  // 매 프레임 바닥을 재타겟해 끝까지 따라간다(높이 변화 시에만 다시 smooth 스크롤 재발행).
  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const start = Date.now();
    let lastH = -1;
    let stable = 0;
    const step = () => {
      const e = scrollRef.current;
      if (!e) return;
      programmaticScrollRef.current = Date.now() + 400;
      const h = e.scrollHeight;
      const distance = h - (e.scrollTop + e.clientHeight);
      if (h !== lastH) {
        // 컨텐츠 높이 변화(이미지/지연 렌더) → 새 바닥으로 다시 부드럽게.
        e.scrollTo({ top: h, behavior: 'smooth' });
        lastH = h;
        stable = 0;
      } else if (distance <= 2) {
        stable++;
      } else {
        stable = 0;
      }
      // 높이 안정 + 바닥 도달이 몇 프레임 유지되거나, 안전 타임아웃이면 종료.
      if (stable >= 4 || Date.now() - start > 2500) return;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  // '직접 작성' 버튼 클릭 — 빈 제목(user heading) + 빈 본문(assistant) 메시지를 turn 으로 생성해
  // 로컬 반영 + DB 적재하고, 본문은 자동으로 Edit 모드로 연다(autoEditId).
  const [autoEditId, setAutoEditId] = useState<string | null>(null);
  const handleManualCreate = useCallback(() => {
    const conv = conversationsRef.current.find((c) => c.id === activeIdRef.current);
    if (!conv || (conv.kind ?? 'thread') !== 'thread') return;
    if (pending || streamingConvIds.size > 0) return;
    const titleId = uuidv7();
    const bodyId = uuidv7();
    const titleMsg: Message = {
      id: titleId,
      role: 'user',
      content: '',
      manualEntry: true,
      time: nowTime(),
    };
    const bodyMsg: Message = {
      id: bodyId,
      role: 'assistant',
      content: '',
      thinking: '',
      manualEntry: true,
      time: nowTime(),
    };
    setManualPreview(false);
    forceScrollOnNextUpdateRef.current = true;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === conv.id
          ? { ...c, messages: [...c.messages, titleMsg, bodyMsg], updatedAt: Date.now() }
          : c,
      ),
    );
    // 본문을 Edit 모드로 — mount 후 한 번만 트리거되면 되므로 잠시 뒤 해제(remount 시 재오픈 방지).
    setAutoEditId(bodyId);
    setTimeout(() => {
      setAutoEditId((cur) => (cur === bodyId ? null : cur));
    }, 1500);
    // 새 항목(제목/본문 편집창)이 렌더된 뒤 최하단으로 스크롤(높이 변화 추적).
    requestAnimationFrame(() => scrollToBottom());
    // DB 적재 — conversation 메타 보장 후 두 메시지 append.
    void ensureConversationOnServer(conv).then(() => {
      void persistMessages(conv.id, [titleMsg, bodyMsg]);
    });
  }, [pending, streamingConvIds, ensureConversationOnServer, persistMessages, scrollToBottom]);

  // 실루엣이 DOM 에 렌더된 뒤(다음 프레임) 갱신된 scrollHeight 기준으로 끝까지 스크롤해야
  // 실루엣 전체가 정확히 보인다. setManualPreview 와 같은 틱에 스크롤하면 실루엣 높이가
  // 반영되기 전이라 아래가 잘린다. → manualPreview 가 켜진 뒤 effect 에서 스크롤.
  useEffect(() => {
    if (!manualPreview) return;
    const raf1 = requestAnimationFrame(() => scrollToBottom());
    return () => cancelAnimationFrame(raf1);
  }, [manualPreview, scrollToBottom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const userMsgs = (active?.messages ?? []).filter(
      (m) => m.role === 'user',
    );
    let raf = 0;
    const update = () => {
      const containerTop = el.getBoundingClientRect().top;
      let bestId: string | null = null;
      let bestOffset = -Infinity;
      // sub-heading 후보: bottom 이 container top 위로 완전히 올라간 헤딩 중 가장 최근.
      let subId: string | null = null;
      let subOffset = -Infinity;
      for (const m of userMsgs) {
        const node = messageRefs.current.get(m.id);
        if (!node) continue;
        const r = node.getBoundingClientRect();
        const offset = r.top - containerTop;
        if (offset <= 80 && offset > bestOffset) {
          bestOffset = offset;
          bestId = m.id;
        }
        const bottomOffset = r.bottom - containerTop;
        if (bottomOffset < 0 && offset > subOffset) {
          subOffset = offset;
          subId = m.id;
        }
      }
      if (bestId === null && userMsgs.length > 0) {
        bestId = userMsgs[0].id;
      }
      setVisibleUserMessageId(bestId);
      // Thread 모드에서만 헤더 sub-heading 노출.
      if (!isThread || subId === null) {
        setHeaderSubheading(null);
      } else {
        const idx = userMsgs.findIndex((x) => x.id === subId);
        const m = idx >= 0 ? userMsgs[idx] : null;
        if (m) {
          setHeaderSubheading({
            ordinal: idx + 1,
            content: m.content,
          });
        }
      }
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, [active?.id, active?.messages, isThread]);

  // thread 모드에서 user 발화를 소제목(1, 2, 3 ...)으로 노출하기 위한 ordinal 맵.
  // 현재 thread 의 통합 hashtag — conversation.hashtags 가 단일 출처.
  // 더 이상 message metadata 에서 모으지 않음.
  const threadHashtags = useMemo(() => {
    if (!active || (active.kind ?? 'thread') !== 'thread') return [];
    return active.hashtags ?? [];
  }, [active]);

  // 우측 Hashtags 섹션의 × 버튼 핸들러 — 해당 태그를 conversation.hashtags 에서 제거 +
  // excludedHashtags(blacklist) 에 추가해 AI 가 재추가하지 않게. 백엔드 PATCH 로 영속.
  function toggleExcludedHashtag(tag: string) {
    if (!activeId) return;
    const convId = activeId;
    let nextHashtags: string[] = [];
    let nextExcluded: string[] = [];
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const curHashtags = c.hashtags ?? [];
        const curExcluded = c.excludedHashtags ?? [];
        const key = tag.toLowerCase();
        nextHashtags = curHashtags.filter((t) => t.toLowerCase() !== key);
        nextExcluded = curExcluded.some((t) => t.toLowerCase() === key)
          ? curExcluded
          : [...curExcluded, tag];
        return {
          ...c,
          hashtags: nextHashtags,
          excludedHashtags: nextExcluded,
        };
      }),
    );
    void fetch(`${API_URL}/conversations/${convId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hashtags: nextHashtags,
        excludedHashtags: nextExcluded,
      }),
    }).catch((e) => {
      console.error('[exclude hashtag] failed', e);
    });
  }

  // 우측 Hashtags 섹션 Edit 모드의 Add 핸들러 — 수동으로 추가한 태그는
  // excludedHashtags 에서도 제거(un-blacklist)해서 AI 가 다음 응답에서 다시 후보로 고려할 수 있게.
  function addHashtag(tag: string) {
    if (!activeId) return;
    const convId = activeId;
    const raw = tag.trim();
    if (!raw) return;
    let nextHashtags: string[] = [];
    let nextExcluded: string[] = [];
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const curHashtags = c.hashtags ?? [];
        const curExcluded = c.excludedHashtags ?? [];
        const key = raw.toLowerCase();
        nextHashtags = curHashtags.some((t) => t.toLowerCase() === key)
          ? curHashtags
          : [...curHashtags, raw];
        nextExcluded = curExcluded.filter((t) => t.toLowerCase() !== key);
        return {
          ...c,
          hashtags: nextHashtags,
          excludedHashtags: nextExcluded,
        };
      }),
    );
    void fetch(`${API_URL}/conversations/${convId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hashtags: nextHashtags,
        excludedHashtags: nextExcluded,
      }),
    }).catch((e) => {
      console.error('[add hashtag] failed', e);
    });
  }

  const userOrdinalByMsgId = useMemo(() => {
    const m = new Map<string, number>();
    if (!active) return m;
    let n = 0;
    for (const msg of active.messages) {
      if (msg.role === 'user') {
        n += 1;
        m.set(msg.id, n);
      }
    }
    return m;
  }, [active]);

  // Message Navigator 용 — 각 user 메시지 + 그 다음 assistant 메시지를 한 쌍(pair)으로 매핑.
  // pairAssistantId 는 사용자 질문 바로 뒤에 오는 assistant 응답 id. 없으면 undefined.
  const userQuestions = useMemo(() => {
    if (!active) return [] as Array<{
      id: string;
      content: string;
      pairAssistantId?: string;
    }>;
    const msgs = active.messages;
    const out: Array<{ id: string; content: string; pairAssistantId?: string }> = [];
    for (let i = 0; i < msgs.length; i++) {
      const m = msgs[i];
      if (m.role !== 'user') continue;
      const next = msgs[i + 1];
      out.push({
        id: m.id,
        content: (m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
        pairAssistantId:
          next && next.role === 'assistant' ? next.id : undefined,
      });
    }
    return out;
  }, [active]);

  // 자동으로 마지막 artifact를 우측 패널에 띄우지 않는다 — 사용자가 인라인
  // 카드를 클릭했을 때만 패널이 열린다. 대화 전환 시 닫힘은 별도 effect에서 처리.

  useEffect(() => {
    setActiveArtifact(null);
  }, [activeId]);

  useEffect(() => {
    if (activeArtifact) {
      setMountedArtifact(activeArtifact);
      return;
    }
    const t = setTimeout(() => setMountedArtifact(null), 320);
    return () => clearTimeout(t);
  }, [activeArtifact]);

  // 이미지 카드에서 사용자 제거. 해당 URL 을 대화 내 모든 메시지에서 탐색해 제거:
  //   · assistant: searchImages / readPages[].images / editImages
  //   · user: images (+ 평행 imageNames) — 사용자 업로드(첨부) 이미지
  // messageId 는 호출 측 편의값일 뿐, 실제 위치는 URL 로 찾는다(직전 user 메시지 등 다른 메시지일 수 있음).
  // /attachments/ URL(editImages·사용자 업로드)은 서버 파일도 DELETE. 변경된 메시지마다 PATCH.
  function removeMessageImage(_messageId: string, url: string) {
    if (!activeId) return;
    const convId = activeId;
    // StrictMode 이중 호출에도 안전하도록 id 키 Map 으로 수집(마지막 값이 덮어씀 → 멱등).
    const updatedById = new Map<string, Message>();
    const isAttachmentFile = url.includes('/attachments/');
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        return {
          ...c,
          messages: c.messages.map((m) => {
            const inSearch = (m.searchImages ?? []).some((i) => i.url === url);
            const inEdit = (m.editImages ?? []).some((u) => u === url);
            const inReadPage = (m.readPages ?? []).some((p) =>
              (p.images ?? []).some((i) => i.src === url),
            );
            const userIdx = (m.images ?? []).findIndex((u) => u === url);
            const inUser = userIdx >= 0;
            if (!inSearch && !inEdit && !inReadPage && !inUser) return m;

            const nextSearch = (m.searchImages ?? []).filter(
              (img) => img.url !== url,
            );
            const nextReadPages = (m.readPages ?? []).map((p) => ({
              ...p,
              images: (p.images ?? []).filter((i) => i.src !== url),
            }));
            const nextEditImages = (m.editImages ?? []).filter((u) => u !== url);
            // 사용자 업로드 images + 평행 imageNames 를 같은 인덱스에서 동시 제거.
            let nextImages = m.images;
            let nextImageNames = m.imageNames;
            if (inUser && m.images) {
              nextImages = m.images.filter((_, i) => i !== userIdx);
              if (m.imageNames) {
                nextImageNames = m.imageNames.filter((_, i) => i !== userIdx);
              }
            }
            const updated: Message = {
              ...m,
              searchImages: nextSearch.length > 0 ? nextSearch : undefined,
              readPages: nextReadPages,
              editImages: nextEditImages.length > 0 ? nextEditImages : undefined,
              images:
                nextImages && nextImages.length > 0 ? nextImages : undefined,
              imageNames:
                nextImageNames && nextImageNames.length > 0
                  ? nextImageNames
                  : undefined,
            };
            updatedById.set(m.id, updated);
            return updated;
          }),
        };
      }),
    );
    if (isAttachmentFile) {
      void fetch(url, { method: 'DELETE', credentials: 'include' }).catch(
        () => {},
      );
    }
    // 변경된 메시지마다 backend PATCH — content/thinking 은 그대로, metadata 만 동기화.
    for (const m of updatedById.values()) {
      const {
        id: _id,
        role: _role,
        content,
        thinking,
        followup: _fp,
        followupGenerating: _fg,
        hashtagsGenerating: _hg,
        ...rest
      } = m;
      void _id;
      void _role;
      void _fp;
      void _fg;
      void _hg;
      void patchMessageRaw(
        convId,
        m.id,
        content,
        thinking ?? null,
        rest as Record<string, unknown>,
      );
    }
  }

  // Image Edit 모달에서 사용자가 reorder + delete 를 한번에 적용.
  // orderedUrls: 모달이 최종적으로 정한 URL 순서 (deleted 된 URL 은 빠진 상태).
  // 동작:
  //  1) 현재 메시지의 combinedImages 에 있는 URL 중 orderedUrls 에 없는 것은 삭제 대상.
  //  2) searchImages / readPages[].images / editImages 에서 삭제 URL 제거.
  //  3) editImages 삭제 시 서버 파일도 DELETE.
  //  4) imageOrder = orderedUrls 로 저장 → 판넬은 이 순서대로 렌더.
  function reorderMessageImages(messageId: string, orderedUrls: string[]) {
    if (!activeId) return;
    const keep = new Set(orderedUrls);
    let nextMessage: Message | null = null;
    let deletedEditUrls: string[] = [];
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c;
        return {
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== messageId) return m;
            const nextSearch = (m.searchImages ?? []).filter((img) =>
              keep.has(img.url),
            );
            const nextReadPages = (m.readPages ?? []).map((p) => ({
              ...p,
              images: (p.images ?? []).filter((i) => keep.has(i.src)),
            }));
            const nextEditImages = (m.editImages ?? []).filter((u) => keep.has(u));
            deletedEditUrls = (m.editImages ?? []).filter((u) => !keep.has(u));
            const updated: Message = {
              ...m,
              searchImages: nextSearch.length > 0 ? nextSearch : undefined,
              readPages: nextReadPages,
              editImages: nextEditImages.length > 0 ? nextEditImages : undefined,
              imageOrder: orderedUrls.length > 0 ? orderedUrls : undefined,
            };
            nextMessage = updated;
            return updated;
          }),
        };
      }),
    );
    for (const url of deletedEditUrls) {
      void fetch(url, { method: 'DELETE', credentials: 'include' }).catch(() => {});
    }
    if (!nextMessage) return;
    const m = nextMessage as Message;
    const {
      id: _id,
      role: _role,
      content,
      thinking,
      followup: _fp,
      followupGenerating: _fg,
      hashtagsGenerating: _hg,
      ...rest
    } = m;
    void _id;
    void _role;
    void _fp;
    void _fg;
    void _hg;
    void patchMessageRaw(
      activeId,
      messageId,
      content,
      thinking ?? null,
      rest as Record<string, unknown>,
    );
  }

  // Image Edit 모달에서 사용자가 직접 업로드한 이미지를 bot 메시지 폴더에 저장.
  // 업로드 성공 시 URL 반환 (모달이 editingOrderUrls 에 즉시 추가할 수 있도록).
  async function uploadEditImage(
    messageId: string,
    dataUrl: string,
    fileName: string,
    // 웹 이미지 "저장"에서 호출된 경우, 원본 source URL — savedSourceUrls 에 영속해
    // 새로고침 후에도 해당 웹 이미지에 "저장됨" 표시 유지.
    sourceUrl?: string,
  ): Promise<string | null> {
    if (!activeId) return null;
    try {
      const res = await fetch(`${API_URL}/attachments/upload`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, files: [{ name: fileName, dataUrl }] }),
      });
      if (!res.ok) return null;
      const j = (await res.json()) as { files: { name: string; url: string }[] };
      if (!j.files?.length) return null;
      const url = `${API_URL}${j.files[0].url}`;
      let nextMessage: Message | null = null;
      const convId = activeId;
      setConversations((prev) =>
        prev.map((c) => {
          if (c.id !== convId) return c;
          return {
            ...c,
            messages: c.messages.map((m) => {
              if (m.id !== messageId) return m;
              const nextEditImages = [...(m.editImages ?? []), url];
              const nextSaved =
                sourceUrl && !(m.savedSourceUrls ?? []).includes(sourceUrl)
                  ? [...(m.savedSourceUrls ?? []), sourceUrl]
                  : m.savedSourceUrls;
              const updated: Message = {
                ...m,
                editImages: nextEditImages,
                savedSourceUrls: nextSaved,
              };
              nextMessage = updated;
              return updated;
            }),
          };
        }),
      );
      if (!nextMessage) return null;
      const m = nextMessage as Message;
      const {
        id: _id,
        role: _role,
        content,
        thinking,
        followup: _fp,
        followupGenerating: _fg,
        hashtagsGenerating: _hg,
        ...rest
      } = m;
      void _id; void _role; void _fp; void _fg; void _hg;
      void patchMessageRaw(
        convId,
        messageId,
        content,
        thinking ?? null,
        rest as Record<string, unknown>,
      );
      return url;
    } catch {
      return null;
    }
  }

  function newConversation() {
    // Thread 는 문서 작성용 → 채팅과 다른 인사말 사용.
    const c = makeConversation(t('bot.greeting.thread'), 'thread');
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    void ensureConversationOnServer(c);
  }

  function newChat() {
    const c = makeConversation(t('bot.greeting'), 'chat');
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
    void ensureConversationOnServer(c);
  }

  // makeConversation의 prev 사용 컨텍스트 — 일반 setState 안에서는 현재 t를
  // 클로저로 잡지만 deleteConversation 안에서 setActiveId 시 새 대화 생성도 같은 t 사용.

  function deleteConversation(id: string) {
    // 삭제 대상이 현재 스트리밍 중이면 먼저 중단.
    if (streamMsgIdsRef.current?.convId === id) {
      streamAbortRef.current?.abort();
      streamMsgIdsRef.current = null;
    }
    setConversations((prev) => {
      const deleted = prev.find((c) => c.id === id);
      const next = prev.filter((c) => c.id !== id);
      if (id === activeId) {
        const sameKind = next.filter((c) => (c.kind ?? 'thread') === (deleted?.kind ?? 'thread'));
        if (sameKind.length > 0) setActiveId(sameKind[0].id);
        else {
          setActiveId(null);
          setView('dashboard');
        }
      }
      return next;
    });
    // 백엔드에서도 영구 삭제. 메시지는 ON DELETE CASCADE 로 함께 정리됨.
    void fetch(`${API_URL}/conversations/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {});
    // 서버 스냅샷 ref 도 정리해 dirty 판정 정확히.
    serverConvsRef.current.delete(id);
  }

  function renameConversation(id: string, title: string) {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, title } : c)),
    );
    // 백엔드에 즉시 반영. 서버에 아직 없는 conversation 이면 PATCH는 404가 되는데,
    // 그 경우는 첫 메시지 전송 시 ensureConversationOnServer 가 새 title 로 POST 하므로 무시 가능.
    void fetch(`${API_URL}/conversations/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    }).catch(() => {});
  }

  function togglePinConversation(id: string) {
    const target = conversations.find((c) => c.id === id);
    if (!target) return;
    const isCurrentlyPinned = target.pinned ?? false;
    if (!isCurrentlyPinned) {
      const pinnedCount = conversations.filter((c) => c.pinned).length;
      if (pinnedCount >= 10) {
        setPinLimitOpen(true);
        return;
      }
    }
    const nextPinned = !isCurrentlyPinned;
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: nextPinned } : c)),
    );
    setPinnedOrder((prev) => {
      const next = nextPinned
        ? prev.includes(id) ? prev : [...prev, id]
        : prev.filter((x) => x !== id);
      try { localStorage.setItem('stella:pinnedOrder', JSON.stringify(next)); } catch { /* */ }
      return next;
    });
    void fetch(`${API_URL}/conversations/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinned: nextPinned }),
    }).catch(() => {});
  }

  function reorderPinned(orderedIds: string[]) {
    setPinnedOrder(orderedIds);
    try { localStorage.setItem('stella:pinnedOrder', JSON.stringify(orderedIds)); } catch { /* */ }
  }

  // user msg id 기준 turn 접힘 토글
  function toggleTurnCollapse(userMsgId: string) {
    setCollapsedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(userMsgId)) next.delete(userMsgId);
      else next.add(userMsgId);
      return next;
    });
  }

  // Message Navigator 삭제 confirm 모달 상태 — { userMsgId, content, hasPairedAnswer }.
  const [pairDeletePending, setPairDeletePending] = useState<{
    userMsgId: string;
    content: string;
    hasPairedAnswer: boolean;
  } | null>(null);

  // 포커 이미지 PIN/UNPIN — 메시지 metadata.pinnedImageUrl 갱신 + DB 영속.
  // null 이면 PIN 해제. 페이지 재방문 시 자동 확대 복원에 사용.
  function togglePinImage(messageId: string, url: string | null) {
    if (!activeId) return;
    const convId = activeId;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === messageId
                  ? { ...m, pinnedImageUrl: url }
                  : m,
              ),
            }
          : c,
      ),
    );
    // persistMessageMetadata 는 conversationsRef 에서 최신 메시지를 읽는데,
    // setConversations 직후엔 ref 가 아직 갱신 전 → 다음 tick 으로 미뤄 ref 동기화 후 PATCH.
    setTimeout(() => void persistMessageMetadata(convId, messageId), 0);
  }

  // 저장된 이미지 물리 회전 — 서버의 실제 파일을 90 단위로 회전(원본 해상도 유지)해 덮어쓴다.
  // 메타데이터에 각도를 저장하지 않는다(파일이 이미 회전됨). deg 는 시계방향 90 단위(음수 허용).
  // 호출 측(MessageBubble)이 성공 후 캐시 버스트로 새 이미지를 다시 받아 화면에 반영한다.
  async function rotateImage(
    _messageId: string,
    url: string,
    deg: number,
  ): Promise<void> {
    const norm = (((deg % 360) + 360) % 360) as number;
    if (norm === 0) return;
    // url 에서 /attachments/<msgId>/<fileName> 추출 — 첨부/저장 이미지에 한해 회전 가능.
    const m = /\/attachments\/([^/]+)\/([^/?#]+)/.exec(url);
    if (!m) return;
    const res = await fetch(`${API_URL}/attachments/rotate`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      // fileName 은 url 의 인코딩된 세그먼트 그대로 — 백엔드가 decodeURIComponent 처리.
      body: JSON.stringify({ messageId: m[1], fileName: m[2], degrees: norm }),
    });
    if (!res.ok) throw new Error('rotate failed');
  }

  // 메시지(제목/본문) 편집 — 로컬 즉시 반영 + 백엔드 PATCH.
  function editUserMessageContent(userMsgId: string, nextContent: string) {
    if (!activeId) return;
    const convId = activeId;
    // 내용을 전부 비우면(빈 값) 메뉴얼 작성 항목과 동일하게 manualEntry 를 부여해,
    // 버블/제목 + Edit 탭이 사라지지 않고 "내용/소제목을 입력하세요" 플레이스홀더로 남아
    // 다시 작성할 수 있게 한다. (AI 작성 글을 Edit 로 비웠을 때도 동일하게 동작)
    const becomesEmpty = nextContent.trim() === '';
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === userMsgId
                  ? {
                      ...m,
                      content: nextContent,
                      ...(becomesEmpty ? { manualEntry: true } : {}),
                    }
                  : m,
              ),
              updatedAt: Date.now(),
            }
          : c,
      ),
    );
    if (becomesEmpty) {
      // content + metadata(manualEntry 포함) 를 함께 영속 → 새로고침 후에도 빈 편집 가능 상태 유지.
      setTimeout(() => void persistMessageMetadata(convId, userMsgId), 0);
    } else {
      void fetch(
        `${API_URL}/conversations/${convId}/messages/${userMsgId}`,
        {
          method: 'PATCH',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: nextContent }),
        },
      ).catch((e) => {
        console.error('[edit message] failed', e);
      });
    }
  }

  // 질문 1개 삭제 요청 — 확인 모달 띄움. 확인 시 실제 삭제는 deleteTurn 재사용 (기존 로직).
  function requestDeletePair(userMsgId: string) {
    if (!active) return;
    const idx = active.messages.findIndex((m) => m.id === userMsgId);
    if (idx < 0) return;
    const userMsg = active.messages[idx];
    const next = active.messages[idx + 1];
    setPairDeletePending({
      userMsgId,
      content: (userMsg.content ?? '').trim().slice(0, 400),
      hasPairedAnswer: !!(next && next.role === 'assistant'),
    });
  }

  // Message Navigator 드래그 앤 드롭 — 질문 순서대로 user 메시지 id 배열을 받아
  // 각 user 뒤에 따라오던 assistant 묶음(turn)을 그대로 같이 옮긴 뒤
  // 백엔드 PATCH /messages/reorder 로 position 일괄 갱신.
  function reorderQuestions(orderedUserIds: string[]) {
    if (!active || !activeId) return;
    const convId = activeId;
    const msgs = active.messages;
    // 첫 user 메시지 이전의 모든 메시지(보통 greeting) 는 그대로 맨 앞에 유지.
    let firstUserIdx = msgs.findIndex((m) => m.role === 'user');
    if (firstUserIdx < 0) firstUserIdx = msgs.length;
    const leading = msgs.slice(0, firstUserIdx);
    // 각 user 메시지 + 그 뒤 (다음 user 직전까지의) assistant 묶음을 turn 으로 그룹핑.
    const turnByUserId = new Map<string, typeof msgs>();
    for (let i = firstUserIdx; i < msgs.length; i++) {
      if (msgs[i].role !== 'user') continue;
      let end = msgs.length;
      for (let j = i + 1; j < msgs.length; j++) {
        if (msgs[j].role === 'user') {
          end = j;
          break;
        }
      }
      turnByUserId.set(msgs[i].id, msgs.slice(i, end));
    }
    // 새 순서대로 turn 펼치기. 누락된 user id 가 있으면 안전을 위해 원래 순서를 따라 부족분 보충.
    const seen = new Set<string>();
    const nextOrder: typeof msgs = [...leading];
    for (const uid of orderedUserIds) {
      const turn = turnByUserId.get(uid);
      if (!turn || seen.has(uid)) continue;
      seen.add(uid);
      nextOrder.push(...turn);
    }
    for (const [uid, turn] of turnByUserId) {
      if (seen.has(uid)) continue;
      nextOrder.push(...turn);
    }
    // 이동된 user 메시지 id 추출 — 이전 user 순서와 새 순서를 비교해 위치가 달라진 것만.
    const prevUserOrder = msgs.filter((m) => m.role === 'user').map((m) => m.id);
    const movedUserIds = orderedUserIds.filter(
      (id, i) => prevUserOrder[i] !== id,
    );
    // 이동된 user 의 turn 에 속한 메시지 id 전부 수집 → unfold 애니메이션 대상.
    const animateIds: string[] = [];
    for (const uid of movedUserIds) {
      const turn = turnByUserId.get(uid);
      if (!turn) continue;
      for (const m of turn) animateIds.push(m.id);
    }
    // 로컬 상태 즉시 반영 (낙관적 업데이트). 동시에 unfolding 마킹으로 새 위치에선 접힌 상태로 첫 paint.
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, messages: nextOrder } : c)),
    );
    if (animateIds.length > 0) {
      setUnfoldingMessageIds((prev) => {
        const next = new Set(prev);
        for (const id of animateIds) next.add(id);
        return next;
      });
      // double-RAF — 첫 번째에서 접힌 상태가 paint, 두 번째에서 펼침 트랜지션 발화.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setUnfoldingMessageIds((prev) => {
            const next = new Set(prev);
            for (const id of animateIds) next.delete(id);
            return next;
          });
        });
      });
    }
    // 백엔드에 reorder 요청 — 실패해도 로컬은 유지되니 콘솔만 남김.
    const orderedIds = nextOrder.map((m) => m.id);
    void fetch(
      `${API_URL}/conversations/${convId}/messages/reorder`,
      {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds }),
      },
    ).catch((e) => {
      console.error('[reorder] failed', e);
    });
  }

  // 실제 메시지 제거 + 백엔드 DELETE — 애니메이션 없음 (즉시 사라짐).
  // turn 삭제 버튼(MessageBubble 내부) 에서 호출. Message Manager 는 deletePairWithAnimation 사용.
  function performDeletePair(userMsgId: string) {
    if (!activeId) return;
    const convId = activeId;
    let removedIds: string[] = [];
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const idx = c.messages.findIndex((m) => m.id === userMsgId);
        if (idx < 0) return c;
        let endIdx = c.messages.length;
        for (let i = idx + 1; i < c.messages.length; i++) {
          if (c.messages[i].role === 'user') {
            endIdx = i;
            break;
          }
        }
        removedIds = c.messages.slice(idx, endIdx).map((m) => m.id);
        return {
          ...c,
          messages: [
            ...c.messages.slice(0, idx),
            ...c.messages.slice(endIdx),
          ],
          updatedAt: Date.now(),
        };
      }),
    );
    setCollapsedTurns((prev) => {
      const next = new Set(prev);
      next.delete(userMsgId);
      return next;
    });
    // 백엔드에서도 삭제
    if (removedIds.length > 0) {
      void fetch(`${API_URL}/conversations/${convId}/messages`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: removedIds }),
      }).catch(() => {});
    }
  }

  // Message Manager 에서 호출 — 먼저 deletingMessageIds 에 추가해 접힘 애니메이션이
  // 재생되고, transition duration(300ms) 후 실제 제거. isHiddenByCollapse 와 같은
  // grid-template-rows 트랜지션을 재사용.
  function deletePairConfirmed(userMsgId: string) {
    if (!activeId) return;
    const conv = conversationsRef.current.find((c) => c.id === activeId);
    if (!conv) return;
    const idx = conv.messages.findIndex((m) => m.id === userMsgId);
    if (idx < 0) return;
    let endIdx = conv.messages.length;
    for (let i = idx + 1; i < conv.messages.length; i++) {
      if (conv.messages[i].role === 'user') {
        endIdx = i;
        break;
      }
    }
    const targetIds = conv.messages.slice(idx, endIdx).map((m) => m.id);
    // 1) 접힘 모션 트리거.
    setDeletingMessageIds((prev) => {
      const next = new Set(prev);
      for (const id of targetIds) next.add(id);
      return next;
    });
    // 2) 트랜지션이 끝난 뒤 실제 제거 + 잔여 플래그 정리.
    window.setTimeout(() => {
      performDeletePair(userMsgId);
      setDeletingMessageIds((prev) => {
        const next = new Set(prev);
        for (const id of targetIds) next.delete(id);
        return next;
      });
    }, 320);
  }

  // 인-버블 휴지통 버튼도 Message Manager 와 동일하게 전용 confirm 모달 + 접힘 애니메이션 경로 사용.
  function deleteTurn(userMsgId: string) {
    requestDeletePair(userMsgId);
  }

  function createFolder(kind: 'thread' | 'chat' = 'thread') {
    const base = t('sidebar.folderDefault');
    // 기본 이름 충돌은 같은 kind 안에서만 검사 — 두 섹션 이름이 우연히 겹쳐도 무관.
    const existing = new Set(
      folders.filter((f) => (f.kind ?? 'thread') === kind).map((f) => f.name),
    );
    let name = base;
    let n = 2;
    while (existing.has(name)) {
      name = `${base} ${n++}`;
    }
    const f: Folder = {
      id: uuidv7(),
      name,
      kind,
      expanded: true,
      createdAt: Date.now(),
    };
    setFolders((prev) => [...prev, f]);
    void fetch(`${API_URL}/folders`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(f),
    }).catch(() => {});
  }

  function renameFolder(id: string, name: string) {
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name } : f)),
    );
    void fetch(`${API_URL}/folders/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    }).catch(() => {});
  }

  function deleteFolder(id: string) {
    setConversations((prev) =>
      prev.map((c) => (c.folderId === id ? { ...c, folderId: null } : c)),
    );
    setFolders((prev) => prev.filter((f) => f.id !== id));
    void fetch(`${API_URL}/folders/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    }).catch(() => {});
  }

  function toggleFolder(id: string) {
    let nextExpanded = false;
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id !== id) return f;
        nextExpanded = !f.expanded;
        return { ...f, expanded: nextExpanded };
      }),
    );
    void fetch(`${API_URL}/folders/${id}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expanded: nextExpanded }),
    }).catch(() => {});
  }

  function moveConversation(convId: string, folderId: string | null) {
    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, folderId } : c)),
    );
    void fetch(`${API_URL}/conversations/${convId}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderId }),
    }).catch(() => {});
  }

  async function send(
    text: string,
    images: string[] = [],
    imageNames: string[] = [],
    useVision = false,
  ) {
    // AI 응답 중(로컬 또는 다른 thread 의 원격 스트림)이면 전송 차단 — 전역 중지 상태.
    if (pending || streamingConvIds.size > 0 || !active) return;
    if (!text.trim() && images.length === 0) return;

    // 스트림 시작 시점의 conversation id 를 고정 — 사용자가 도중에 다른 thread/Dashboard
    // 로 이동해도 이 thread 에만 메시지가 쓰이도록 (백그라운드 처리).
    const targetConvId = active.id;
    const targetThreadTitle = active.title;
    const patchConv = (updater: (c: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === targetConvId ? updater(c) : c)),
      );
    };

    // user message id 를 미리 발급 — 첨부 이미지 업로드 폴더명으로 사용.
    const userMsgId = uuidv7();

    // 이미지가 있으면 디스크에 업로드 → URL 로 치환. 실패 시 base64 그대로 (호환).
    let storedImages = images;
    if (images.length > 0) {
      try {
        const upRes = await fetch(`${API_URL}/attachments/upload`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messageId: userMsgId,
            files: images.map((dataUrl, i) => ({
              name: imageNames[i] || `image-${i + 1}.jpg`,
              dataUrl,
            })),
          }),
        });
        if (upRes.ok) {
          const j = (await upRes.json()) as {
            files: { name: string; url: string }[];
          };
          if (j.files?.length === images.length) {
            storedImages = j.files.map((f) => `${API_URL}${f.url}`);
          }
        }
      } catch (e) {
        console.warn('attachment upload failed', e);
      }
    }

    const userMsg: Message = {
      id: userMsgId,
      role: 'user',
      content: text,
      images: storedImages.length ? storedImages : undefined,
      imageNames: imageNames.length ? imageNames : undefined,
      time: nowTime(),
    };
    const botId = uuidv7();
    const botMsg: Message = {
      id: botId,
      role: 'assistant',
      content: '',
      thinking: '',
      time: nowTime(),
      visionContext: images.length > 0 || useVision,
    };

    const baseMessages = active.messages;
    const isFirstUserMsg =
      baseMessages.filter((m) => m.role === 'user').length === 0;
    const autoTitle = isFirstUserMsg
      ? text.trim().slice(0, 30) ||
        (images.length ? t('sidebar.imageConv') : t('sidebar.newChat'))
      : null;

    // 사용자가 chat 위쪽을 보고 있다가 send 했더라도 자기 발화한 메시지가 보여야 하므로
    // 자동 스크롤 effect 의 거리 가드를 한 번만 우회.
    forceScrollOnNextUpdateRef.current = true;
    patchConv((c) => ({
      ...c,
      title: autoTitle ?? c.title,
      messages: [...c.messages, userMsg, botMsg],
      updatedAt: Date.now(),
    }));
    setFreshIds((prev) => {
      const next = new Set(prev);
      next.add(userMsg.id);
      return next;
    });
    setTimeout(() => {
      setFreshIds((prev) => {
        if (!prev.has(userMsg.id)) return prev;
        const next = new Set(prev);
        next.delete(userMsg.id);
        return next;
      });
    }, 700);

    // 챗봇이 기억하는 컨텍스트는 대화별로 마지막 MEMORY_SIZE개 메시지로 제한.
    const history = [...baseMessages, userMsg]
      .slice(-MEMORY_SIZE)
      .map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.images && m.images.length
          ? { images: m.images.map(stripDataUrl) }
          : {}),
      }));

    setPending(true);
    setLiveMessageId(botId);
    localStreamingIdRef.current = botId; // 이 탭이 발신자 — 자기 미러 이벤트 무시용
    setLiveTokRate(null);
    let accumulatedContent = '';
    let streamStartedAt = 0;
    let lastRateUpdate = 0;

    // SSE chunk 들을 rAF 단위(~60fps)로 모아 한 번에 patchConv → 매 chunk re-render 방지.
    // content/thinking 은 누적 후 frame 마다 flush; 다른 필드(sources/pages 등)는 즉시 업데이트되어도
    // 독립된 필드라 ordering 문제 없음.
    let pendingContent = '';
    let pendingThinking = '';
    let pendingClearStatus = false;
    let flushHandle: number | null = null;
    const flushStream = () => {
      if (flushHandle !== null) {
        cancelAnimationFrame(flushHandle);
        flushHandle = null;
      }
      if (!pendingContent && !pendingThinking && !pendingClearStatus) return;
      const addedContent = pendingContent;
      const addedThinking = pendingThinking;
      const clearStatus = pendingClearStatus;
      pendingContent = '';
      pendingThinking = '';
      pendingClearStatus = false;
      patchConv((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === botId
            ? {
                ...m,
                content: addedContent ? m.content + addedContent : m.content,
                thinking: addedThinking
                  ? (m.thinking ?? '') + addedThinking
                  : m.thinking,
                status: clearStatus ? undefined : m.status,
              }
            : m,
        ),
        updatedAt: Date.now(),
      }));
    };
    const scheduleFlush = () => {
      if (flushHandle === null) {
        flushHandle = requestAnimationFrame(flushStream);
      }
    };

    // 스트리밍 abort 용 컨트롤러 — Stop 버튼이나 페이지 떠날 때 사용.
    const ctrl = new AbortController();
    streamAbortRef.current = ctrl;
    // Stop 시 현재 turn의 메시지를 제거할 수 있도록 ids 저장
    streamMsgIdsRef.current = {
      convId: active.id,
      userId: userMsg.id,
      botId,
    };

    // (URL 자동 감지 + 비전 분석만 사용 — 별도의 검색 토글/사전 평가 없음)

    // 스트림 시작 전에 conversation 을 서버에 보장 → 백엔드가 user/assistant 메시지를 즉시 DB 에 저장 가능.
    try {
      await ensureConversationOnServer(active);
    } catch (e) {
      console.warn('[stream] ensure conversation failed', e);
    }

    try {
      const res = await fetch(`${API_URL}/chat/stream`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          // endpoint/apiKey 는 백엔드가 'ai' 설정의 Reasoning/Vision 그룹에서 직접 해석.
          // 프론트는 모델 override(대화별 active.model 우선)만 전달.
          messages: history,
          model: active.model || reasoningCfg.model || undefined,
          visionModel: visionCfg.model || undefined,
          useVision,
          tavilyTopRead,
          locale: lang,
          // 백엔드가 스트림 시작 시점에 user 메시지 + assistant placeholder 를 DB 저장하고,
          // 종료 시 최종 content/thinking 을 업데이트 → 프론트가 disconnect 해도 유실 안 됨.
          kind: active.kind ?? 'thread',
          persist: {
            conversationId: targetConvId,
            userMessage: {
              id: userMsg.id,
              content: userMsg.content,
              images: storedImages.length ? storedImages : undefined,
              imageNames: imageNames.length ? imageNames : undefined,
            },
            assistantMessageId: botId,
          },
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      outer: while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const evt of events) {
          const line = evt.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') break outer;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let json: any;
          try {
            json = JSON.parse(payload);
          } catch (e) {
            console.error('parse error', e, payload);
            continue;
          }
          // 백엔드가 생성 중 에러를 { error } 이벤트로 보냄 — inner try 에서 throw 하면
          // 아래 catch 가 "parse error" 로 삼켜버리므로, 바깥 catch 로 전달되도록 여기서 throw.
          // errorCode 가 있으면 Error 에 실어 바깥 catch 가 메시지에 함께 저장(언어 전환 반응용).
          if (json.error) {
            const e = new Error(String(json.error));
            if (json.errorCode)
              (e as Error & { code?: string }).code = String(json.errorCode);
            throw e;
          }
          try {
            if (json.type === 'thinking' && json.text) {
              pendingThinking += json.text;
              scheduleFlush();
            } else if (json.type === 'content' && json.text) {
              accumulatedContent += json.text;
              const now = Date.now();
              if (streamStartedAt === 0) streamStartedAt = now;
              if (now - lastRateUpdate > 180) {
                const elapsed = (now - streamStartedAt) / 1000;
                if (elapsed > 0.05) {
                  setLiveTokRate(accumulatedContent.length / elapsed);
                }
                lastRateUpdate = now;
              }
              pendingContent += json.text;
              pendingClearStatus = true;
              scheduleFlush();
            } else if (json.type === 'search' && Array.isArray(json.results)) {
              const rawImgs: unknown[] = Array.isArray(json.images)
                ? json.images
                : [];
              const imgs: SearchImage[] = rawImgs
                .map((it) => {
                  if (typeof it === 'string') return { url: it };
                  if (
                    it &&
                    typeof it === 'object' &&
                    'url' in it &&
                    typeof (it as { url: unknown }).url === 'string'
                  ) {
                    const o = it as {
                      url: string;
                      sourceTitle?: string;
                      sourceUrl?: string;
                    };
                    return {
                      url: o.url,
                      sourceTitle: o.sourceTitle,
                      sourceUrl: o.sourceUrl,
                    };
                  }
                  return null;
                })
                .filter((x): x is SearchImage => !!x);
              patchConv((c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === botId
                    ? {
                        ...m,
                        sources: json.results as Source[],
                        searchImages: imgs.length ? imgs : undefined,
                      }
                    : m,
                ),
                updatedAt: Date.now(),
              }));
            } else if (json.type === 'pages' && Array.isArray(json.pages)) {
              const pages = (json.pages as unknown[])
                .map((p) => {
                  if (!p || typeof p !== 'object') return null;
                  const o = p as Record<string, unknown>;
                  if (typeof o.url !== 'string') return null;
                  const rawImgs = Array.isArray(o.images)
                    ? (o.images as unknown[])
                    : [];
                  const images = rawImgs
                    .map((it): ReadPageImage | null => {
                      if (!it || typeof it !== 'object') return null;
                      const r = it as Record<string, unknown>;
                      if (typeof r.src !== 'string') return null;
                      const alt =
                        typeof r.alt === 'string' ? r.alt : undefined;
                      const kind =
                        r.kind === 'youtube' || r.kind === 'x' || r.kind === 'image'
                          ? r.kind
                          : undefined;
                      const linkUrl =
                        typeof r.linkUrl === 'string' ? r.linkUrl : undefined;
                      const out: ReadPageImage = { src: r.src };
                      if (alt) out.alt = alt;
                      if (kind) out.kind = kind;
                      if (linkUrl) out.linkUrl = linkUrl;
                      if (r.analyzing === true) out.analyzing = true;
                      return out;
                    })
                    .filter((x): x is ReadPageImage => x !== null);
                  return {
                    url: o.url,
                    title: typeof o.title === 'string' ? o.title : undefined,
                    chars: typeof o.chars === 'number' ? o.chars : 0,
                    ok: o.ok === true,
                    images: images.length > 0 ? images : undefined,
                  } as ReadPage;
                })
                .filter((x): x is ReadPage => !!x);
              patchConv((c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === botId
                    ? { ...m, readPages: pages.length ? pages : undefined }
                    : m,
                ),
                updatedAt: Date.now(),
              }));
            } else if (
              json.type === 'page_timeout' &&
              typeof json.url === 'string'
            ) {
              // 페이지 추출 타임아웃 — 실시간으로 readPages에 추가해 취소선 표시.
              const timedUrl = json.url as string;
              patchConv((c) => ({
                ...c,
                messages: c.messages.map((m) => {
                  if (m.id !== botId) return m;
                  const existing = m.readPages ?? [];
                  if (existing.some((p) => p.url === timedUrl)) return m;
                  const source = m.sources?.find((s) => s.url === timedUrl);
                  return {
                    ...m,
                    readPages: [
                      ...existing,
                      {
                        url: timedUrl,
                        title: source?.title,
                        chars: 0,
                        ok: false,
                      } as ReadPage,
                    ],
                  };
                }),
                updatedAt: Date.now(),
              }));
            } else if (
              json.type === 'image_analyzing_start' &&
              typeof json.pageUrl === 'string' &&
              typeof json.src === 'string'
            ) {
              const pageUrl = json.pageUrl as string;
              const src = json.src as string;
              patchConv((c) => ({
                ...c,
                messages: c.messages.map((m) => {
                  if (m.id !== botId || !m.readPages) return m;
                  const nextPages = m.readPages.map((p) => {
                    if (p.url !== pageUrl || !p.images) return p;
                    const nextImages = p.images.map((img) =>
                      img.src === src ? { ...img, analyzing: true } : img,
                    );
                    return { ...p, images: nextImages };
                  });
                  return { ...m, readPages: nextPages };
                }),
                updatedAt: Date.now(),
              }));
            } else if (
              json.type === 'image_analysis' &&
              typeof json.pageUrl === 'string' &&
              Array.isArray(json.analyses)
            ) {
              const pageUrl = json.pageUrl as string;
              const analyses = (json.analyses as unknown[])
                .map((it) => {
                  if (!it || typeof it !== 'object') return null;
                  const o = it as Record<string, unknown>;
                  if (typeof o.src !== 'string') return null;
                  return {
                    src: o.src,
                    relevant: o.relevant === true,
                    description:
                      typeof o.description === 'string' ? o.description : '',
                  };
                })
                .filter(
                  (x): x is { src: string; relevant: boolean; description: string } =>
                    !!x,
                );
              patchConv((c) => ({
                ...c,
                messages: c.messages.map((m) => {
                  if (m.id !== botId || !m.readPages) return m;
                  const nextPages = m.readPages.map((p) => {
                    if (p.url !== pageUrl || !p.images) return p;
                    const lookup = new Map(analyses.map((a) => [a.src, a]));
                    const nextImages = p.images.map((img) => {
                      const a = lookup.get(img.src);
                      if (!a) return img;
                      return {
                        ...img,
                        analyzing: false,
                        analysis: {
                          relevant: a.relevant,
                          description: a.description,
                        },
                      };
                    });
                    return { ...p, images: nextImages };
                  });
                  return { ...m, readPages: nextPages };
                }),
                updatedAt: Date.now(),
              }));
            } else if (json.type === 'status' && json.text) {
              patchConv((c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === botId ? { ...m, status: json.text } : m,
                ),
                updatedAt: Date.now(),
              }));
            } else if (json.type === 'ai_done') {
              // AI 발화 완료 — 입력창 즉시 열기. 해시태그 SSE 는 이후에 도착.
              flushStream();
              setPending(false);
              setLiveMessageId(null);
              setLiveTokRate(null);
            } else if (json.type === 'hashtags' && Array.isArray(json.tags)) {
              // 백엔드가 답변 직후 생성/병합한 hashtag 를 push — 우측 패널 실시간 갱신.
              const incoming = (json.tags as unknown[]).filter(
                (t): t is string => typeof t === 'string',
              );
              const targetId =
                typeof json.conversationId === 'string'
                  ? json.conversationId
                  : targetConvId;
              setConversations((prev) =>
                prev.map((c) =>
                  c.id === targetId ? { ...c, hashtags: incoming } : c,
                ),
              );
            } else if (json.type === 'metric') {
              patchConv((c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === botId
                    ? {
                        ...m,
                        metric: {
                          tokens: json.tokens,
                          durationMs: json.durationMs,
                          tokensPerSec: json.tokensPerSec,
                          promptTokens: json.promptTokens,
                        },
                      }
                    : m,
                ),
                updatedAt: Date.now(),
              }));
            }
          } catch (e) {
            console.error('stream part error', e, payload);
          }
        }
      }
    } catch (err) {
      // 사용자 Stop으로 인한 abort는 정상 종료 — 에러 메시지 표시하지 않음.
      const isAbort =
        err instanceof DOMException && err.name === 'AbortError';
      if (!isAbort) {
        const message = err instanceof Error ? err.message : t('common.errorOccurred');
        const errorCode = (err as Error & { code?: string })?.code;
        // 에러 직전 버퍼에 남은 부분 콘텐츠/상태가 finally 의 flushStream() 에서
        // 에러 메시지 뒤에 덧붙거나 status 가 되살아나지 않도록 펜딩 버퍼를 비운다.
        pendingContent = '';
        pendingThinking = '';
        pendingClearStatus = false;
        patchConv((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === botId
              ? {
                  ...m,
                  content: message,
                  isError: true,
                  errorCode,
                  // 진행 상태(예: "Extracting top 8 pages…") 표시 제거.
                  status: undefined,
                }
              : m,
          ),
        }));
      }
    } finally {
      flushStream();
      streamAbortRef.current = null;
      streamMsgIdsRef.current = null;
      localStreamingIdRef.current = null;
      setPending(false);
      setLiveMessageId(null);
      setLiveTokRate(null);
      // 메시지 백엔드 영속 (해시태그/후속질문 생성과 무관하게 우선 저장).
      // 백그라운드(다른 thread/Dashboard 로 이동 후 완료) 저장 디버깅 위해 명시적 에러 로깅.
      void (async () => {
        try {
          // 다음 microtask 까지 대기 → React 가 마지막 setConversations 를 커밋해 ref 가 최신이 되도록.
          await new Promise((r) => setTimeout(r, 0));
          const latest = conversationsRef.current.find(
            (c) => c.id === targetConvId,
          );
          const src = latest ?? active;
          await ensureConversationOnServer(src);
          const userM = src.messages.find((m) => m.id === userMsg.id);
          const botM = src.messages.find((m) => m.id === botId);
          const toSave: Message[] = [];
          if (userM) toSave.push(userM);
          if (botM) toSave.push(botM);
          if (toSave.length === 0) {
            console.warn(
              '[persist] no messages found in ref',
              { convId: targetConvId, userMsgId: userMsg.id, botId },
            );
            return;
          }
          await persistMessages(targetConvId, toSave);
        } catch (e) {
          console.error('[persist] background save failed', e);
        }
      })();
      // Chat 종류는 follow-up 등 메타 자동 생성 건너뜀.
      // hashtag 생성은 백엔드 /chat/stream 의 finally 에서 Thread 단위로 conversation.hashtags 에 저장.
      if ((active.kind ?? 'thread') === 'thread') {
        // 후속 질문 생성에 직전 turn 컨텍스트(최근 6개)도 같이 전달.
        // user msg와 bot msg를 제외한 이전 대화를 history 로 보낸다.
        const followupHistory = active.messages
          .filter((m) => m.id !== userMsg.id && m.id !== botId)
          .slice(-6)
          .map((m) => ({ role: m.role, content: m.content }));
        void generateFollowupsFor(
          botId,
          active.id,
          text,
          accumulatedContent,
          followupHistory,
          active.model || reasoningCfg.model || undefined,
        );
      }
      // 완료 알림 — 사용자가 응답이 도착한 thread 를 직접 보고 있으면 noisy 하므로 생략.
      // 다른 thread/Dashboard 로 이동한 경우에만 토스트로 알림.
      if (activeIdRef.current !== targetConvId) {
        const finalConv = conversationsRef.current.find(
          (c) => c.id === targetConvId,
        );
        const finalTitle = finalConv?.title || targetThreadTitle || 'Thread';
        setToasts((prev) => [
          ...prev,
          {
            id: uuidv7(),
            threadId: targetConvId,
            threadTitle: finalTitle,
            message: t('toast.replyDone'),
          },
        ]);
      }
    }
  }

  async function generateFollowupsFor(
    messageId: string,
    convId: string,
    userMessage: string,
    assistantReply: string,
    history: Array<{ role: 'user' | 'assistant'; content: string }>,
    model?: string,
  ) {
    if (!assistantReply.trim() || assistantReply.trim().length < 20) return;

    const setGenerating = (v: boolean) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId ? { ...m, followupGenerating: v } : m,
                ),
              }
            : c,
        ),
      );
    };

    // Step 1: 생성 시작 placeholder (메모리 only — followup 은 영속하지 않음).
    setGenerating(true);

    // 30초 타임아웃 — 응답이 안 오거나 hang 되면 abort 해서 stuck 상태 방지.
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);

    try {
      const res = await fetch(`${API_URL}/chat/followups`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage, assistantReply, history, model }),
        signal: controller.signal,
      });
      if (!res.ok) {
        setGenerating(false);
        return;
      }
      const json = (await res.json()) as {
        question?: string;
        options: string[];
      };
      if (!Array.isArray(json.options) || json.options.length === 0) {
        setGenerating(false);
        return;
      }

      // Step 2: 메모리에만 followup 반영 — DB 저장 없음 (페이지 떠나면 사라짐).
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId
                    ? {
                        ...m,
                        followup: {
                          question: json.question,
                          options: json.options,
                        },
                        followupGenerating: false,
                      }
                    : m,
                ),
              }
            : c,
        ),
      );
    } catch {
      setGenerating(false);
    } finally {
      window.clearTimeout(timeout);
    }
  }

  // 메시지 PATCH 의 raw 헬퍼 — 명시적 content/thinking/metadata 로 전송, 404 면 backoff 재시도.
  async function patchMessageRaw(
    convId: string,
    msgId: string,
    content: string,
    thinking: string | null,
    metadata: Record<string, unknown>,
  ): Promise<boolean> {
    const body = JSON.stringify({ content, thinking, metadata });
    const delays = [0, 500, 1500, 3000];
    for (const wait of delays) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        const res = await fetch(
          `${API_URL}/conversations/${convId}/messages/${msgId}`,
          {
            method: 'PATCH',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body,
          },
        );
        if (res.ok) return true;
        if (res.status !== 404) return false;
      } catch {
        // 다음 시도로
      }
    }
    return false;
  }

  // ─── memo(MessageItem) 최적화용 stable 콜백 ───────────────────────────────
  // 아래 함수들은 렌더마다 새 참조가 생성된다. ref 에 최신 버전을 저장해두고
  // useCallback([], []) 으로 감싼 stable wrapper 를 MessageItem 에 내려보내면
  // streaming 중 ChatRoom 이 re-render 되어도 non-live MessageItem 들이 bailout 한다.
  // (ref 업데이트는 render 중 동기 수행 → 항상 최신 클로저를 가리킴)
  const _rmImg = removeMessageImage;
  const _roImg = reorderMessageImages;
  const _upImg = uploadEditImage;
  const _delTurn = deleteTurn;
  const _toggleCollapse = toggleTurnCollapse;
  const _editContent = editUserMessageContent;
  const _pinImg = togglePinImage;
  const _rotImg = rotateImage;
  const _attachImg = attachImageFromUrl;
  const _send = send;
  const _stableRmImg = useRef(_rmImg);
  const _stableRoImg = useRef(_roImg);
  const _stableUpImg = useRef(_upImg);
  const _stableDelTurn = useRef(_delTurn);
  const _stableToggleCollapse = useRef(_toggleCollapse);
  const _stableEditContent = useRef(_editContent);
  const _stablePinImg = useRef(_pinImg);
  const _stableRotImg = useRef(_rotImg);
  const _stableAttachImg = useRef(_attachImg);
  const _stableSend = useRef(_send);
  _stableRmImg.current = _rmImg;
  _stableRoImg.current = _roImg;
  _stableUpImg.current = _upImg;
  _stableDelTurn.current = _delTurn;
  _stableToggleCollapse.current = _toggleCollapse;
  _stableEditContent.current = _editContent;
  _stablePinImg.current = _pinImg;
  _stableRotImg.current = _rotImg;
  _stableAttachImg.current = _attachImg;
  _stableSend.current = _send;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRmImg = useCallback((id: string, url: string) => _stableRmImg.current(id, url), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRoImg = useCallback((id: string, urls: string[]) => _stableRoImg.current(id, urls), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableUpImg = useCallback((id: string, dataUrl: string, fileName: string, sourceUrl?: string) => _stableUpImg.current(id, dataUrl, fileName, sourceUrl), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableDelTurn = useCallback((id: string) => _stableDelTurn.current(id), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableToggleCollapse = useCallback((id: string) => _stableToggleCollapse.current(id), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableEditContent = useCallback((id: string, content: string) => _stableEditContent.current(id, content), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stablePinImg = useCallback((id: string, url: string | null) => _stablePinImg.current(id, url), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableRotImg = useCallback((id: string, url: string, deg: number): Promise<void> => _stableRotImg.current(id, url, deg), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableAttachImg = useCallback((url: string) => _stableAttachImg.current(url), []);
  const stableOpenArtifact = useCallback((a: Artifact) => setActiveArtifact(a), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableFollowup = useCallback((text: string) => void _stableSend.current(text, [], []), []);
  const stableSetMsgRef = useCallback((id: string, el: HTMLDivElement | null) => {
    messageRefs.current.set(id, el);
  }, []);
  // ─────────────────────────────────────────────────────────────────────────

  if (!authChecked) {
    return <div className="h-dvh w-screen bg-background" />;
  }
  if (!user) {
    // /login 으로 이동 — 실제 리다이렉트는 아래 useEffect 가 담당.
    return <div className="h-dvh w-screen bg-background" />;
  }

  return (
    <div className="flex h-dvh w-screen overflow-hidden bg-background">
      {/* 사이드바 wrapper.
          데스크톱(md+): 인라인 패널 — w-72 / w-0 토글, transform translate 애니메이션.
          모바일(< md): 페이지 전환 방식 — 열리면 화면 전체를 채우고 main 이 사라짐.
                         닫히면 완전히 hidden → main 이 화면 가득. */}
      <div
        aria-hidden={!sidebarOpen}
        className={cn(
          'shrink-0 overflow-hidden bg-background',
          // 모바일 — 메인 페이지처럼 화면 전체 차지 (오버레이 아님)
          sidebarOpen ? 'block h-full w-full' : 'hidden',
          // 데스크톱 — 인라인 패널 (mobile 클래스 override)
          'md:relative md:z-auto md:block md:h-screen md:transition-[width] md:duration-300 md:ease-out',
          sidebarOpen ? 'md:w-72' : 'md:w-0',
        )}
      >
        <div
          className={cn(
            'h-full w-full md:absolute md:inset-y-0 md:left-0 md:w-72 md:transition-transform md:duration-300 md:ease-out',
            sidebarOpen ? 'md:translate-x-0' : 'md:-translate-x-full',
          )}
        >
          <Sidebar
            conversations={conversations}
            folders={folders}
            activeId={activeId}
            view={view}
            onSelectDashboard={() => {
              setView('dashboard');
              if (typeof window !== 'undefined' && window.innerWidth < 768) {
                setSidebarOpen(false);
              }
            }}
            onSelect={(id) => {
              setActiveId(id);
              setView('thread');
              // 모바일 — thread 선택 시 사이드바 자동 닫기 (full-screen overlay 였음).
              if (typeof window !== 'undefined' && window.innerWidth < 768) {
                setSidebarOpen(false);
              }
            }}
            onNew={() => {
              newConversation();
              setView('thread');
              if (typeof window !== 'undefined' && window.innerWidth < 768) {
                setSidebarOpen(false);
              }
            }}
            onNewChat={() => {
              newChat();
              setView('thread');
              if (typeof window !== 'undefined' && window.innerWidth < 768) {
                setSidebarOpen(false);
              }
            }}
            onDelete={(id) => {
              const c = conversations.find((cc) => cc.id === id);
              setPendingDelete({
                kind: 'conversation',
                id,
                name: c?.title || t('sidebar.newChat'),
              });
            }}
            onRename={renameConversation}
            onMove={moveConversation}
            onPin={togglePinConversation}
            pinnedOrder={pinnedOrder}
            onReorderPinned={reorderPinned}
            onCreateFolder={createFolder}
            onRenameFolder={renameFolder}
            onDeleteFolder={(id) => {
              const f = folders.find((ff) => ff.id === id);
              const hasItems = conversations.some(
                (cc) => cc.folderId === id,
              );
              if (!hasItems) {
                // 빈 폴더는 확인 없이 즉시 삭제.
                deleteFolder(id);
                return;
              }
              setPendingDelete({
                kind: 'folder',
                id,
                name: f?.name ?? '',
              });
            }}
            onToggleFolder={toggleFolder}
            onCollapse={() => setSidebarOpen(false)}
            user={user}
            onLogin={() => {
              window.location.href = '/login';
            }}
            onLogout={handleLogout}
            onOpenSettings={() => {
              // Next router.push 대신 window.history.pushState 로만 URL 갱신.
              // Next 페이지 전환이 일어나지 않아 ChatRoom 이 unmount/remount 안됨.
              setSettingsOpen(true);
              if (typeof window !== 'undefined') {
                window.history.pushState({}, '', '/settings');
              }
            }}
            onOpenAbout={() => setAboutOpen(true)}
            hasMoreConversations={hasMoreConvs}
            loadingMoreConversations={loadingMoreConvs}
            onLoadMoreConversations={loadMoreConversations}
          />
        </div>
      </div>

      {/* 모바일: 사이드바가 열려 있으면 main 전체 숨김 (페이지 전환 방식). 데스크톱은 항상 표시. */}
      <main className={cn(
        'relative min-w-0 min-h-0 flex-1 flex-col bg-background',
        sidebarOpen ? 'hidden md:flex' : 'flex',
      )}>
        {view === 'dashboard' ? (
          <DashboardPanel
            conversations={conversations}
            folders={folders}
            onSelectThread={(id) => {
              setActiveId(id);
              setView('thread');
            }}
            sidebarOpen={sidebarOpen}
            onExpandSidebar={() => setSidebarOpen(true)}
          />
        ) : (
        <>
        <header className="flex h-[68px] shrink-0 items-center gap-3 border-b border-border px-4">
          {/* 사이드바 토글 — 항상 표시되며 open/close 상태에 따라 아이콘 바뀜.
              우측 Summary 토글과 동일한 사이즈(h-9 w-9, icon h-4 w-4) 로 대칭 배치. */}
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0"
            onClick={() => setSidebarOpen((v) => !v)}
            title={
              sidebarOpen ? t('sidebar.collapse') : t('sidebar.expand')
            }
            aria-pressed={sidebarOpen}
          >
            {sidebarOpen ? (
              <PanelLeftClose className="h-4 w-4" />
            ) : (
              <PanelLeftOpen className="h-4 w-4" />
            )}
          </Button>
          <div className="min-w-0 flex-1">
            {editingTitle && active ? (
              <input
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  const next = titleDraft.trim();
                  if (next && next !== active.title) {
                    renameConversation(active.id, next);
                  }
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.currentTarget as HTMLInputElement).blur();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    setEditingTitle(false);
                  }
                }}
                className="w-full truncate rounded-sm bg-transparent px-1 -mx-1 text-[17px] font-semibold outline-none ring-2 ring-primary/40 focus:ring-primary"
                placeholder={t('header.newChat')}
              />
            ) : (
              <div
                className={cn(
                  'truncate text-[17px] font-semibold',
                  active && 'cursor-text rounded-sm px-1 -mx-1 hover:bg-accent/30',
                )}
                onClick={() => {
                  if (!active) return;
                  setTitleDraft(active.title || '');
                  setEditingTitle(true);
                }}
                title={
                  active ? '클릭해서 제목 수정' : undefined
                }
              >
                {active?.title || t('header.newChat')}
              </div>
            )}
            {/* 스크롤로 viewport top 을 지나친 user 헤딩을 대제목 밑에 sub-line 으로 표시.
                Thread 모드 전용 + 첫 헤딩 이상 스크롤된 경우만 노출.
                앞에 ↳ 화살표로 하위 뎁스(대제목의 자식) 시각화. */}
            {headerSubheading && (
              <div className="mt-0.5 flex items-center gap-1 truncate text-[12.5px] leading-tight text-muted-foreground">
                <span aria-hidden className="shrink-0 text-primary/70">↳</span>
                <span className="shrink-0 font-semibold text-primary tabular-nums">
                  {headerSubheading.ordinal}.
                </span>
                <span className="truncate">{headerSubheading.content}</span>
              </div>
            )}
          </div>
          {/* 우측 Summary/TagCloud 패널 토글 — 모바일에선 패널 자체가 hidden 이므로 버튼도 숨김. */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-9 w-9 shrink-0 md:inline-flex"
            onClick={() => setTagCloudOpen((v) => !v)}
            disabled={!active}
            title={tagCloudOpen ? 'Summary 닫기' : 'Summary 열기'}
            aria-pressed={tagCloudOpen}
          >
            {tagCloudOpen ? (
              <PanelRightClose className="h-4 w-4" />
            ) : (
              <PanelRightOpen className="h-4 w-4" />
            )}
          </Button>

        </header>

        <div className="relative flex-1 overflow-hidden">
        {/* 우측 부유 점프 버튼 — 최상단/최하단 즉시 이동. 입력창(아래) 가리지 않도록 bottom 여유. */}
        <div className="pointer-events-none absolute bottom-28 right-4 z-20 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => {
              const el = scrollRef.current;
              if (!el) return;
              programmaticScrollRef.current = Date.now() + 600;
              el.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            title={t('chat.scrollTop')}
            aria-label={t('chat.scrollTop')}
            className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={scrollToBottom}
            title={t('chat.scrollBottom')}
            aria-label={t('chat.scrollBottom')}
            className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </div>
        <div
          className="h-full overflow-y-auto overflow-x-clip touch-pan-y"
          ref={scrollRef}
        >
          <div
            ref={scrollContentRef}
            className={cn(
              // pb-28: 입력창이 absolute 로 떠 있으므로 마지막 메시지가 가려지지 않게 여유.
              // 모바일은 좌우 padding 축소(px-3) — 화면이 좁아 가독성 우선.
              'px-3 pb-28 pt-5 transition-[max-width] duration-300 ease-out md:pl-4 md:pr-6',
              // 좌·우 모든 패널이 접혀 있으면 채팅 본문이 공간에 더 자연스럽게 퍼지도록 폭 확대.
              // 모든 패널 상태에서 동일한 채팅 폭 유지 — 사이드바 열기/닫기로 채팅 본문 폭이 흔들리지 않게.
              'max-w-4xl',
            )}
          >
            <div>
              {!active?.messagesLoaded && (
                <div className="flex flex-col gap-8 animate-pulse pt-2">
                  <div className="flex justify-end pr-2">
                    <div className="h-10 w-2/5 rounded-2xl bg-muted" />
                  </div>
                  <div className="flex flex-col gap-2 pl-2">
                    <div className="h-4 w-3/4 rounded bg-muted" />
                    <div className="h-4 w-1/2 rounded bg-muted" />
                    <div className="h-4 w-2/3 rounded bg-muted" />
                  </div>
                  <div className="flex justify-end pr-2">
                    <div className="h-10 w-1/3 rounded-2xl bg-muted" />
                  </div>
                  <div className="flex flex-col gap-2 pl-2">
                    <div className="h-4 w-4/5 rounded bg-muted" />
                    <div className="h-4 w-3/5 rounded bg-muted" />
                    <div className="h-4 w-1/2 rounded bg-muted" />
                    <div className="h-4 w-2/3 rounded bg-muted" />
                  </div>
                  <div className="flex justify-end pr-2">
                    <div className="h-10 w-1/4 rounded-2xl bg-muted" />
                  </div>
                </div>
              )}
              {(() => {
                const allMsgs = active?.messages ?? [];
                if (allMsgs.length === 0) return null;
                // 점진적 렌더 — renderLimit 까지만 렌더(나머지는 스켈레톤). 스트리밍 중엔 전체 렌더.
                const effLimit = pending
                  ? Number.POSITIVE_INFINITY
                  : renderLimit;
                const msgs =
                  effLimit >= allMsgs.length
                    ? allMsgs
                    : allMsgs.slice(0, effLimit);
                const moreToRender = msgs.length < allMsgs.length;
                // 메시지를 turn 단위(user heading + 그 이후 assistant 들) 로 묶어 각 turn 을 <section> 으로 감쌈.
                // 효과: sticky user 헤딩의 containing block 이 turn 으로 한정 → 다음 user heading 이 viewport top
                // 으로 들어오기 시작하면 이전 sticky 가 자연스럽게 위로 밀려 사라짐 (겹침 방지).
                const renderMessage = (m: Message, idx: number) => {
                const isCollapsibleUser =
                  m.role === 'user' && turnHasResponse.has(m.id);
                const isDeleting = deletingMessageIds.has(m.id);
                const isUnfolding = unfoldingMessageIds.has(m.id);
                const isHiddenByCollapse =
                  hiddenIds.has(m.id) || isDeleting || isUnfolding;
                const isCollapsedSelf =
                  isCollapsibleUser && collapsedTurns.has(m.id);
                const responsesCount =
                  isCollapsibleUser ? hiddenCountByTurn.get(m.id) ?? 0 : 0;
                const precedingUser =
                  m.role === 'assistant' && idx > 0
                    ? msgs[idx - 1]
                    : null;
                const precedingUserImages =
                  precedingUser?.role === 'user' &&
                  precedingUser.images &&
                  precedingUser.images.length > 0
                    ? precedingUser.images
                    : undefined;
                const precedingUserImageNames =
                  precedingUser?.role === 'user'
                    ? precedingUser.imageNames
                    : undefined;
                const deleteTurnId =
                  m.role === 'user'
                    ? m.id
                    : msgs.slice(0, idx).reverse().find((mm) => mm.role === 'user')?.id;
                return (
                  <MessageItem
                    key={m.id}
                    m={m}
                    deleteTurnId={deleteTurnId}
                    isHiddenByCollapse={isHiddenByCollapse}
                    isCollapsedSelf={isCollapsedSelf}
                    responsesCount={responsesCount}
                    precedingUserImages={precedingUserImages}
                    precedingUserImageNames={precedingUserImageNames}
                    convKind={active?.kind ?? 'thread'}
                    userOrdinal={userOrdinalByMsgId.get(m.id)}
                    activeArtifactId={activeArtifact?.id ?? null}
                    attachedSourceUrls={attachedSourceUrls}
                    isFresh={freshIds.has(m.id)}
                    isLive={m.id === liveMessageId}
                    autoEdit={m.id === autoEditId}
                    isCollapsed={isCollapsibleUser && collapsedTurns.has(m.id)}
                    isGreeting={
                      m.role === 'assistant' &&
                      msgs.slice(0, idx).every((mm) => mm.role !== 'user')
                    }
                    onEditContent={stableEditContent}
                    onPinImage={stablePinImg}
                    onRotateImage={stableRotImg}
                    onOpenArtifact={stableOpenArtifact}
                    onAttachImage={stableAttachImg}
                    onFollowup={stableFollowup}
                    onRemoveImageById={stableRmImg}
                    onReorderImagesById={stableRoImg}
                    onUploadEditImageById={stableUpImg}
                    onDeleteTurnById={stableDelTurn}
                    onToggleTurnCollapse={stableToggleCollapse}
                    setMsgRef={stableSetMsgRef}
                  />
                );
                };
                // 그룹화: 첫 user 메시지 이전은 leading (greeting 등), 이후엔 각 user 가 새 turn 의 시작.
                const elements: React.ReactNode[] = [];
                let firstUser = msgs.findIndex((mm) => mm.role === 'user');
                if (firstUser === -1) firstUser = msgs.length;
                for (let i = 0; i < firstUser; i++) {
                  elements.push(renderMessage(msgs[i], i));
                }
                let i = firstUser;
                while (i < msgs.length) {
                  const start = i;
                  i++;
                  while (i < msgs.length && msgs[i].role !== 'user') i++;
                  const turnMsgs: Array<{ msg: Message; idx: number }> = [];
                  for (let j = start; j < i; j++) {
                    turnMsgs.push({ msg: msgs[j], idx: j });
                  }
                  elements.push(
                    <section
                      key={`turn-${msgs[start].id}`}
                      className="relative"
                    >
                      {turnMsgs.map(({ msg, idx: j }) => renderMessage(msg, j))}
                    </section>,
                  );
                }
                // 아직 렌더 안 한 뒤쪽 메시지가 있으면 스켈레톤으로 표시 (점진적으로 채워짐).
                if (moreToRender) {
                  elements.push(
                    <div
                      key="render-skeleton"
                      aria-hidden
                      className="flex flex-col gap-8 animate-pulse pt-4 opacity-70"
                    >
                      <div className="flex flex-col gap-2 pl-2">
                        <div className="h-4 w-3/4 rounded bg-muted" />
                        <div className="h-4 w-1/2 rounded bg-muted" />
                        <div className="h-4 w-2/3 rounded bg-muted" />
                      </div>
                      <div className="flex justify-end pr-2">
                        <div className="h-9 w-1/3 rounded-2xl bg-muted" />
                      </div>
                      <div className="flex flex-col gap-2 pl-2">
                        <div className="h-4 w-4/5 rounded bg-muted" />
                        <div className="h-4 w-3/5 rounded bg-muted" />
                      </div>
                    </div>,
                  );
                }
                return elements;
              })()}
              {/* '직접 작성' 프리뷰 실루엣 — 버튼 2초 hover 시, 작성하게 될 제목/본문 영역을
                  본문 하단에 고스트(실루엣)로 미리 보여준다. (마우스가 벗어나면 사라짐) */}
              {isThread && manualPreview && (
                <div
                  aria-hidden
                  className="animate-in fade-in slide-in-from-bottom-2 duration-300 pb-2 pl-2 pt-8"
                >
                  {/* 제목 영역 실루엣 */}
                  <div className="mb-4 h-9 w-2/3 animate-pulse rounded-lg border-2 border-dashed border-primary/40 bg-primary/5" />
                  {/* 본문(AI 답변) 영역 실루엣 */}
                  <div className="animate-pulse space-y-3 rounded-xl border-2 border-dashed border-border bg-muted/30 p-4">
                    <div className="h-4 w-11/12 rounded bg-muted" />
                    <div className="h-4 w-5/6 rounded bg-muted" />
                    <div className="h-4 w-3/4 rounded bg-muted" />
                    <div className="h-4 w-4/5 rounded bg-muted" />
                    <div className="h-4 w-2/3 rounded bg-muted" />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
        </div>

        {/* 입력창은 chat 영역 위로 떠 있는 형태. wrapper 자체는 여전히 투명·pointer-events-none 이지만
            그 위에 background→transparent 그라데이션 페이드를 깔아, 뒤로 스크롤되는 컨텐츠(References 등)가
            라운드 버튼에 의해 sharp 하게 잘려보이지 않고 부드럽게 사라지도록 한다. */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 z-30 flex min-h-[68px] items-end transition-opacity duration-200',
            isScrolling ? 'opacity-0' : 'opacity-100',
          )}
        >
          {/* 전체 가로 그라데이션 음영 — 입력창 아래 영역을 부드럽게 덮음 */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-background via-background/80 to-transparent" />
          <div
            className={cn(
              'relative w-full px-3 pb-2 transition-[max-width] duration-300 ease-out md:pl-4 md:pr-6',
              'max-w-4xl',
            )}
          >
            {/* 모바일은 pl-8 indent 제거 — 화면이 좁아 입력창 너비를 최대 확보. */}
            <div className="pointer-events-auto md:pl-8">
              <InputBar
                ref={inputBarRef}
                onSend={send}
                // AI 응답 중(로컬 또는 다른 thread/기기의 원격 스트림)이면 어느 메뉴에 있어도 중지 상태.
                disabled={pending || streamingConvIds.size > 0}
                isStreaming={pending || streamingConvIds.size > 0}
                onStop={stopStreaming}
                liveTokRate={liveTokRate}
                onAttachedChange={handleAttachedChange}
                isThread={isThread}
                onManualPreview={handleManualPreview}
                onManualCreate={handleManualCreate}
              />
            </div>
          </div>
        </div>
        </>
        )}
      </main>

      {/* Artifact 미리보기 패널 (Mermaid/SVG) — 모바일에선 숨김. */}
      <div
        aria-hidden={!activeArtifact}
        className={cn(
          'hidden md:relative md:block md:h-screen md:shrink-0 md:overflow-hidden md:transition-[width] md:duration-300 md:ease-out',
          activeArtifact ? 'md:w-[480px]' : 'md:w-0',
        )}
      >
        <div
          className={cn(
            'absolute inset-y-0 left-0 w-[480px] transition-transform duration-300 ease-out',
            activeArtifact ? 'translate-x-0' : 'translate-x-full',
          )}
        >
          {mountedArtifact && (
            <ArtifactPanel
              artifact={mountedArtifact}
              onClose={() => {
                setActiveArtifact(null);
              }}
            />
          )}
        </div>
      </div>

      {/* Dashboard 화면에선 우측 패널 자체를 안 보이게 (사용자의 tagCloudOpen 선호는 유지 → 다시 thread 로 돌아오면 그대로 열림).
          모바일에선 항상 hidden — 화면이 좁아 thread/chat 만 표시. */}
      <div
        aria-hidden={!tagCloudOpen || view === 'dashboard'}
        className={cn(
          'hidden md:relative md:block md:h-screen md:shrink-0 md:overflow-hidden md:transition-[width] md:duration-300 md:ease-out',
          tagCloudOpen && view !== 'dashboard' ? 'md:w-[360px]' : 'md:w-0',
        )}
      >
        <div
          className={cn(
            'absolute inset-y-0 left-0 w-[360px] transition-transform duration-300 ease-out',
            tagCloudOpen && view !== 'dashboard'
              ? 'translate-x-0'
              : 'translate-x-full',
          )}
        >
          <ThreadDetailPanel
            questions={userQuestions}
            activeQuestionId={visibleUserMessageId}
            onSelectQuestion={(id) => scrollToMessage(id)}
            onReorderQuestions={reorderQuestions}
            onDeleteQuestion={requestDeletePair}
            onEditQuestion={editUserMessageContent}
            threads={conversations.map((c) => {
              // 1) 서버에서 받은 누적 해시태그 (페이지 새로고침 직후에도 사용 가능)
              // 2) 로컬에 로드된 메시지의 hashtag (방금 사용자가 추가한 최신 데이터 반영)
              // 둘을 union 하여 양쪽 케이스 모두 커버.
              const seen = new Set<string>();
              const out: string[] = [];
              const push = (t: string) => {
                const k = t.toLowerCase();
                if (seen.has(k)) return;
                seen.add(k);
                out.push(t);
              };
              // hashtags 는 conversation 컬럼 단일 출처 — 사용자가 × 한 태그는 이미 제거됨.
              for (const t of c.hashtags ?? []) push(t);
              return { id: c.id, title: c.title, hashtags: out };
            })}
            activeThreadId={activeId}
            activeKind={active?.kind ?? 'thread'}
            onSelectThread={(id) => setActiveId(id)}
            threadHashtags={threadHashtags}
            onExcludeHashtag={toggleExcludedHashtag}
            onAddHashtag={addHashtag}
          />
        </div>
      </div>


      <DeleteMessagePairConfirmModal
        open={pairDeletePending !== null}
        questionPreview={pairDeletePending?.content ?? ''}
        hasPairedAnswer={pairDeletePending?.hasPairedAnswer ?? false}
        onCancel={() => setPairDeletePending(null)}
        onConfirm={() => {
          const target = pairDeletePending;
          setPairDeletePending(null);
          if (target) deletePairConfirmed(target.userMsgId);
        }}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          // 직접 입력한 /settings 가 아니면 history.back() 으로 이전 URL 복원.
          // history 가 짧으면 pushState 로 / 로 이동.
          if (typeof window !== 'undefined') {
            if (window.history.length > 1) window.history.back();
            else window.history.pushState({}, '', '/');
          }
        }}
        user={user}
        onUserUpdated={(u) => setUser(u)}
        reasoningCfg={reasoningCfg}
        visionCfg={visionCfg}
        onChangeAiGroup={updateAiGroup}
      />

      <AboutModal
        open={aboutOpen}
        onClose={() => setAboutOpen(false)}
      />

      <Toaster
        toasts={toasts}
        onClick={(threadId) => {
          setActiveId(threadId);
          setView('thread');
          setToasts((prev) => prev.filter((tt) => tt.threadId !== threadId));
        }}
        onDismiss={(id) =>
          setToasts((prev) => prev.filter((tt) => tt.id !== id))
        }
      />

      <PinLimitModal open={pinLimitOpen} onClose={() => setPinLimitOpen(false)} />

      <DeleteConfirmModal
        open={!!pendingDelete}
        itemName={pendingDelete?.name ?? ''}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (!pendingDelete) return;
          if (pendingDelete.kind === 'conversation') {
            deleteConversation(pendingDelete.id);
          } else {
            deleteFolder(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
      />

      <SaveConfirmModal
        open={saveConfirmOpen}
        saving={savingState}
        onCancel={() => setSaveConfirmOpen(false)}
        onSaveAndContinue={async () => {
          setSavingState(true);
          const ok = await saveToServer();
          setSavingState(false);
          if (ok) {
            setSaveConfirmOpen(false);
            void doLogout();
          } else {
            // 저장 실패 시 모달 유지 — 사용자에게 결정권.
            window.alert(t('error.partialSaveFailed'));
          }
        }}
        onContinueWithoutSaving={() => {
          setSaveConfirmOpen(false);
          void doLogout();
        }}
      />
    </div>
  );
}
