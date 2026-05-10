'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import MessageBubble from './MessageBubble';
import InputBar, { type InputBarHandle } from './InputBar';
import Sidebar from './Sidebar';
import ArtifactPanel from './ArtifactPanel';
import SettingsModal from './SettingsModal';
import AboutModal from './AboutModal';
import SaveConfirmModal from './SaveConfirmModal';
import TagCloudPanel from './TagCloudPanel';
import DashboardPanel from './DashboardPanel';
import DeleteConfirmModal from './DeleteConfirmModal';
import Toaster, { type Toast } from './Toaster';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Cpu,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { extractArtifacts, type Artifact } from '@/lib/artifacts';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';

export interface ModelInfo {
  name: string;
  parameterSize?: string;
  family?: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  role?: 'admin' | 'member';
  hasPassword?: boolean;
  hasGoogle?: boolean;
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
  // 사용자가 이미지를 첨부했거나 vision 토글이 켜진 상태에서 발생한 봇 응답
  visionContext?: boolean;
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
  // 페이지네이션 상태
  messagesLoaded?: boolean; // 한 번이라도 메시지를 fetch 했는지
  hasMoreMessages?: boolean; // 더 과거 메시지가 DB에 남아있는지
  loadingOlder?: boolean; // 현재 위로 추가 fetch 중
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

export default function ChatRoom() {
  const { t } = useI18n();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // 메인 영역 표시 모드. 기본은 Dashboard. Thread 행 클릭 시 'thread' 로 전환.
  const [view, setView] = useState<'dashboard' | 'thread'>('dashboard');
  // 삭제 확인 모달 — 사용자가 이름을 정확히 입력해야 활성화됨.
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
  const [activeArtifact, setActiveArtifact] = useState<Artifact | null>(null);
  const [mountedArtifact, setMountedArtifact] = useState<Artifact | null>(
    null,
  );
  const [closedArtifactId, setClosedArtifactId] = useState<string | null>(
    null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const [visionModel, setVisionModelState] = useState<string | null>(null);
  const setVisionModel = (m: string) => {
    setVisionModelState(m);
    try {
      localStorage.setItem('stella-vision-model', m);
    } catch {
      // ignore
    }
  };
  useEffect(() => {
    try {
      const saved = localStorage.getItem('stella-vision-model');
      if (saved) setVisionModelState(saved);
    } catch {
      // ignore
    }
  }, []);
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
  // AI Endpoint — backend system_config 'ai' row 가 단일 진실 출처.
  // localStorage / env 폴백 없음. 미설정이면 빈 문자열.
  const [aiEndpoint, setAiEndpoint] = useState<string>('');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/admin/ai`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const j = (await res.json()) as { endpoint?: string };
        if (!cancelled && j.endpoint) setAiEndpoint(j.endpoint);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  const updateAiEndpoint = useCallback((v: string) => {
    setAiEndpoint(v);
    // 입력 즉시 PUT — 디바운스 없이 매 변경마다 저장 (값이 짧고 admin 만 사용).
    fetch(`${API_URL}/admin/ai`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: v.trim() }),
    }).catch(() => {
      // ignore
    });
  }, []);
  // 사용자 발화별 턴(=user msg + 다음 user msg 직전까지의 assistant 응답들) 접힘 상태.
  // user msg id 기준으로 저장. 활성 대화가 바뀌면 자동 비움.
  const [collapsedTurns, setCollapsedTurns] = useState<Set<string>>(
    () => new Set(),
  );
  useEffect(() => {
    setCollapsedTurns(new Set());
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

  // LoginScreen 이 email/password 로그인/가입 성공 후 호출 — /auth/me 재조회로 user state 갱신.
  // (Google SSO 진입은 LoginScreen 안에서 직접 window.location 으로 처리)
  const handleLogin = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/auth/me`, { credentials: 'include' });
      if (!res.ok) {
        setUser(null);
        return;
      }
      const json = (await res.json()) as AuthUser;
      setUser(json);
    } catch {
      setUser(null);
    }
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
  const hydratedRef = useRef(false);
  // 현재 viewport 상단에 가장 가깝게 보이는 user 메시지 id — Message Navigator 하이라이트 동기화용.
  const [visibleUserMessageId, setVisibleUserMessageId] = useState<
    string | null
  >(null);
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

  // Stop 버튼 클릭 시 호출. 진행 중인 stream을 즉시 끊고, 현재 turn의 메시지들도 화면에서 제거.
  const stopStreaming = useCallback(() => {
    streamAbortRef.current?.abort();
    const ids = streamMsgIdsRef.current;
    if (ids) {
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
      streamMsgIdsRef.current = null;
    }
  }, []);
  const messageRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  function scrollToMessage(messageId: string, delay = 0) {
    const doScroll = () => {
      const el = messageRefs.current.get(messageId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    };
    if (delay > 0) setTimeout(doScroll, delay);
    else doScroll();
  }

  async function attachImageFromUrl(url: string) {
    try {
      const res = await fetch(
        `${API_URL}/chat/image-proxy?url=${encodeURIComponent(url)}`,
      );
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.message || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as { dataUrl: string };
      // URL pathname 의 마지막 segment 를 파일명으로 사용 (없으면 빈 문자열).
      const name = (() => {
        try {
          const u = new URL(url);
          const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
          return decodeURIComponent(last);
        } catch {
          return '';
        }
      })();
      inputBarRef.current?.attachImageDataUrls([json.dataUrl], [name]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '오류';
      alert(`이미지 첨부 실패: ${msg}`);
    }
  }

  // AI Endpoint 가 바뀔 때 모델 목록을 재갱신. 실패 시 errorMessage 를 노출 (Settings UI 에서 사용).
  const [aiEndpointError, setAiEndpointError] = useState<string | null>(null);
  const [aiEndpointLoading, setAiEndpointLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setAiEndpointLoading(true);
    setAiEndpointError(null);
    (async () => {
      try {
        const url = aiEndpoint
          ? `${API_URL}/chat/models?endpoint=${encodeURIComponent(aiEndpoint)}`
          : `${API_URL}/chat/models`;
        const res = await fetch(url);
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = (await res.json()) as { message?: string };
            if (j.message) msg = j.message;
          } catch {
            // ignore
          }
          throw new Error(msg);
        }
        const json = (await res.json()) as {
          defaultModel: string;
          models: ModelInfo[];
        };
        if (cancelled) return;
        setModels(json.models);
        setDefaultModel(json.defaultModel);
        setAiEndpointError(null);
      } catch (e) {
        if (cancelled) return;
        console.error('모델 목록 로드 실패', e);
        setModels([]);
        setAiEndpointError(
          e instanceof Error ? e.message : '모델 목록 로드 실패',
        );
      } finally {
        if (!cancelled) setAiEndpointLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [aiEndpoint]);

  // 마운트 시 데이터 로드: 서버에서 conversation 메타 + folder 목록.
  // 메시지는 active thread 가 정해지면 그때 lazy fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [convRes, foldRes] = await Promise.all([
          fetch(`${API_URL}/conversations`, { credentials: 'include' }),
          fetch(`${API_URL}/folders`, { credentials: 'include' }),
        ]);
        if (convRes.ok && foldRes.ok) {
          const sConvs = (await convRes.json()) as Conversation[];
          const sFolds = (await foldRes.json()) as Folder[];
          serverConvsRef.current = new Map(sConvs.map((c) => [c.id, c]));
          serverFoldersRef.current = new Map(sFolds.map((f) => [f.id, f]));
          if (cancelled) return;
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
    lastUrlRef.current = url;
    window.history.pushState({}, '', url);
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
            lastUrlRef.current = `${path}${window.location.search}`;
            return;
          }
        }
        setView('dashboard');
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
    ): Promise<{ msgs: Message[]; hasMore: boolean }> => {
      const qs = new URLSearchParams();
      if (before) qs.set('before', before);
      qs.set('limit', String(MSG_PAGE));
      const res = await fetch(
        `${API_URL}/conversations/${convId}/messages?${qs.toString()}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = (await res.json()) as ServerMessage[];
      const msgs: Message[] = rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        thinking: r.thinking ?? undefined,
        ...(r.metadata ?? {}),
        // 서버 row 의 실제 createdAt 을 항상 사용 — metadata 에 들어있던 예전 짧은 형식(time)을 덮어씀.
        time: formatTime(r.createdAt),
        // 진행 중 플래그는 DB 에 저장되더라도 새로고침 후엔 무의미 → 항상 false 로 초기화.
        // 옛날 데이터에 이 플래그가 박혀 "Creating hashtags..." / "..." 가 영구적으로 남는 버그 방지.
        hashtagsGenerating: false,
        followupGenerating: false,
      })) as Message[];
      // 받아온 row 수가 페이지 가득이면 과거가 더 있을 가능성 있음.
      return { msgs, hasMore: rows.length >= MSG_PAGE };
    },
    [],
  );

  // 활성 thread 가 바뀌고 아직 메시지를 한 번도 fetch 하지 않았으면 최신 페이지를 가져온다.
  useEffect(() => {
    if (!activeId) return;
    const conv = conversations.find((c) => c.id === activeId);
    if (!conv || conv.messagesLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const { msgs, hasMore } = await fetchMessagesPage(activeId, null);
        if (cancelled) return;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  messages: msgs,
                  messagesLoaded: true,
                  hasMoreMessages: hasMore,
                }
              : c,
          ),
        );
      } catch {
        if (cancelled) return;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === activeId
              ? { ...c, messagesLoaded: true, hasMoreMessages: false }
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

  // 스크롤이 상단 근처(< 200px)에 닿으면 더 과거 메시지를 prepend.
  // 추가 도중에 시각적으로 점프하지 않도록 scrollHeight 차이만큼 scrollTop 보정.
  const loadOlderMessages = useCallback(async () => {
    const conv = conversations.find((c) => c.id === activeId);
    const el = scrollRef.current;
    if (!conv || !activeId || !el) return;
    if (!conv.hasMoreMessages || conv.loadingOlder) return;
    if (conv.messages.length === 0) return;
    const oldestId = conv.messages[0].id;
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeId ? { ...c, loadingOlder: true } : c,
      ),
    );
    const prevHeight = el.scrollHeight;
    const prevTop = el.scrollTop;
    try {
      const { msgs, hasMore } = await fetchMessagesPage(activeId, oldestId);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId
            ? {
                ...c,
                messages: [...msgs, ...c.messages],
                hasMoreMessages: hasMore,
                loadingOlder: false,
              }
            : c,
        ),
      );
      // DOM 업데이트 후 scroll 위치 보정
      requestAnimationFrame(() => {
        const after = scrollRef.current;
        if (!after) return;
        after.scrollTop = prevTop + (after.scrollHeight - prevHeight);
      });
    } catch {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeId ? { ...c, loadingOlder: false } : c,
        ),
      );
    }
  }, [conversations, activeId, fetchMessagesPage]);

  // 스크롤 중일 때 입력창을 잠시 숨기기 위한 플래그. scroll 이벤트가 멈추고
  // ~250ms 가 지나면 false 로 복귀.
  const [isScrolling, setIsScrolling] = useState(false);

  // 메시지 영역 스크롤 감지 — 위로 가면 과거 메시지 fetch + 사용자 스크롤 중 표시.
  // 자동 스크롤(프로그래밍)으로 발생한 이벤트는 입력창을 숨기지 않는다.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let stopTimer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (el.scrollTop < 200) void loadOlderMessages();
      // 자동 스크롤 윈도우 안이면 isScrolling 토글 생략.
      if (Date.now() < programmaticScrollRef.current) return;
      setIsScrolling(true);
      if (stopTimer) clearTimeout(stopTimer);
      stopTimer = setTimeout(() => setIsScrolling(false), 250);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (stopTimer) clearTimeout(stopTimer);
    };
  }, [loadOlderMessages]);

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
        const { id: _id, role: _role, content, thinking, ...rest } = m;
        void _id;
        void _role;
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
          // 진행 중 임시 플래그는 DB 에 저장하지 않음.
          // 그렇지 않으면 새로고침 후 무한히 "Creating hashtags..." / "..." 로 남는 버그.
          const {
            id,
            role,
            content,
            thinking,
            hashtagsGenerating: _hg,
            followupGenerating: _fg,
            ...rest
          } = m;
          void _hg;
          void _fg;
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
      // 단, 스트리밍 중에는 References 패널 등 큰 블록이 추가되면 distFromBottom 이 단번에 커져
      // 임계값(120) 을 넘어 자동 스크롤이 끊길 수 있어 임계값을 크게 잡음.
      const distFromBottom =
        el.scrollHeight - el.scrollTop - el.clientHeight;
      const threshold = pending ? 800 : 120;
      if (distFromBottom > threshold) return;
    }
    // 자동 스크롤 시작 — onScroll 핸들러가 isScrolling 을 토글하지 않도록 짧게 표시.
    programmaticScrollRef.current = Date.now() + (jumpInstant ? 50 : 600);
    // 첫 진입(switched / firstLoadAfterMount) 일 땐 마지막 사용자 발화 위치로 스크롤.
    // 이후 답변 내용이 그 아래로 펼쳐지므로 사용자가 자기 질문부터 자연스럽게 읽을 수 있음.
    // 마지막 user 메시지가 없거나 ref 가 아직 마운트되지 않았으면 기존대로 하단 점프 fallback.
    if (jumpInstant) {
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
    el.scrollTo({
      top: el.scrollHeight,
      behavior: jumpInstant ? 'auto' : 'smooth',
    });
    // pending 도 의존 — 스트리밍 종료 후 마지막 렌더에서도 한번 더 따라 내려가도록.
  }, [active?.id, active?.messages, pending]);

  // 스크롤에 따른 "현재 보이는 user 메시지" 추적 — Message Navigator 의 하이라이트 항목과 동기화.
  // viewport 상단(80px 마진) 위에 있고 그 중 가장 viewport top 에 가까운 user 메시지를 선택.
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
      for (const m of userMsgs) {
        const node = messageRefs.current.get(m.id);
        if (!node) continue;
        const r = node.getBoundingClientRect();
        const offset = r.top - containerTop;
        // 메시지 top 이 컨테이너 top 보다 살짝 위(80px) 까지 내려와 있고,
        // 그 중 가장 컨테이너 top 에 가까운 것 선택. → 사용자가 막 읽고 있는 user 발화.
        if (offset <= 80 && offset > bestOffset) {
          bestOffset = offset;
          bestId = m.id;
        }
      }
      // 위로 더 올라가서 첫 user 메시지보다 위에 있으면 첫 항목으로 표시.
      if (bestId === null && userMsgs.length > 0) {
        bestId = userMsgs[0].id;
      }
      setVisibleUserMessageId(bestId);
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
  }, [active?.id, active?.messages]);

  const userQuestions = useMemo(() => {
    if (!active) return [] as { id: string; content: string }[];
    return active.messages
      .filter((m) => m.role === 'user')
      .map((m) => ({
        id: m.id,
        content: (m.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
      }));
  }, [active]);

  // 비전이 처리 중인 user 메시지 id — 가장 최근 user 메시지가 이미지를 가지고 있고
  // 그에 해당하는 assistant 응답이 아직 비어 있을 때.
  const visionInFlightUserId = useMemo<string | null>(() => {
    if (!active) return null;
    const msgs = active.messages;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === 'user') {
        if (!m.images || m.images.length === 0) return null;
        const next = msgs[i + 1];
        // 답변이 아직 안 도착했거나 비어있으면 비전 처리 중으로 본다.
        if (!next || next.role !== 'assistant' || !next.content?.trim()) {
          return m.id;
        }
        return null;
      }
    }
    return null;
  }, [active]);

  const latestArtifact = useMemo<Artifact | null>(() => {
    if (!active) return null;
    for (let i = active.messages.length - 1; i >= 0; i--) {
      const msg = active.messages[i];
      if (msg.role !== 'assistant') continue;
      const arts = extractArtifacts(msg.content, msg.id);
      if (arts.length > 0) return arts[arts.length - 1];
    }
    return null;
  }, [active]);

  // 자동으로 마지막 artifact를 우측 패널에 띄우지 않는다 — 사용자가 인라인
  // 카드를 클릭했을 때만 패널이 열린다. 대화 전환 시 닫힘은 별도 effect에서 처리.

  useEffect(() => {
    setActiveArtifact(null);
    setClosedArtifactId(null);
  }, [activeId]);

  useEffect(() => {
    if (activeArtifact) {
      setMountedArtifact(activeArtifact);
      return;
    }
    const t = setTimeout(() => setMountedArtifact(null), 320);
    return () => clearTimeout(t);
  }, [activeArtifact]);

  function patchActive(updater: (c: Conversation) => Conversation) {
    if (!activeId) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? updater(c) : c)),
    );
  }

  // References 패널의 이미지 카드에서 사용자 제거. 메시지 metadata 의
  // searchImages 와 readPages[].images 둘 다에서 해당 URL 을 필터링하고 backend 에 PATCH.
  function removeMessageImage(messageId: string, url: string) {
    if (!activeId) return;
    let nextMessage: Message | null = null;
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c;
        return {
          ...c,
          messages: c.messages.map((m) => {
            if (m.id !== messageId) return m;
            const nextSearch = (m.searchImages ?? []).filter(
              (img) => img.url !== url,
            );
            const nextReadPages = (m.readPages ?? []).map((p) => ({
              ...p,
              images: (p.images ?? []).filter((i) => i.src !== url),
            }));
            const updated: Message = {
              ...m,
              searchImages: nextSearch.length > 0 ? nextSearch : undefined,
              readPages: nextReadPages,
            };
            nextMessage = updated;
            return updated;
          }),
        };
      }),
    );
    if (!nextMessage) return;
    const m = nextMessage as Message;
    // backend 에 PATCH — content/thinking 은 변경 없음, metadata 만 동기화.
    const { id: _id, role: _role, content, thinking, ...rest } = m;
    void _id;
    void _role;
    void patchMessageRaw(
      activeId,
      messageId,
      content,
      thinking ?? null,
      rest as Record<string, unknown>,
    );
  }

  function newConversation() {
    const c = makeConversation(t('bot.greeting'), 'thread');
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
  }

  function newChat() {
    const c = makeConversation(t('bot.greeting'), 'chat');
    setConversations((prev) => [c, ...prev]);
    setActiveId(c.id);
  }

  // makeConversation의 prev 사용 컨텍스트 — 일반 setState 안에서는 현재 t를
  // 클로저로 잡지만 deleteConversation 안에서 setActiveId 시 새 대화 생성도 같은 t 사용.

  function deleteConversation(id: string) {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      // 마지막 thread 삭제 시 자동으로 새 thread 를 만들지 않고 Dashboard 로 보낸다.
      if (id === activeId) {
        if (next.length > 0) setActiveId(next[0].id);
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

  // user msg id 기준 turn 접힘 토글
  function toggleTurnCollapse(userMsgId: string) {
    setCollapsedTurns((prev) => {
      const next = new Set(prev);
      if (next.has(userMsgId)) next.delete(userMsgId);
      else next.add(userMsgId);
      return next;
    });
  }

  // user msg와 그 다음 user msg 직전까지의 assistant 응답을 모두 삭제
  function deleteTurn(userMsgId: string) {
    if (!activeId) return;
    if (!window.confirm('이 질문과 답변을 모두 삭제할까요?')) return;
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

  function setActiveModel(model: string) {
    if (!activeId) return;
    setConversations((prev) =>
      prev.map((c) => (c.id === activeId ? { ...c, model } : c)),
    );
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

  const activeModel = active?.model ?? defaultModel ?? '';

  async function send(
    text: string,
    images: string[] = [],
    imageNames: string[] = [],
    useVision = false,
  ) {
    if (pending || !active) return;
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
    setLiveTokRate(null);
    let accumulatedContent = '';
    let streamStartedAt = 0;
    let lastRateUpdate = 0;

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

    try {
      const res = await fetch(`${API_URL}/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          messages: history,
          model: active.model || defaultModel || undefined,
          visionModel: visionModel ?? undefined,
          useVision,
          endpoint: aiEndpoint || undefined,
        }),
      });

      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';

        for (const evt of events) {
          const line = evt.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          try {
            const json = JSON.parse(payload);
            if (json.error) throw new Error(json.error);
            if (json.type === 'thinking' && json.text) {
              patchConv((c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === botId
                    ? { ...m, thinking: (m.thinking ?? '') + json.text }
                    : m,
                ),
                updatedAt: Date.now(),
              }));
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
              patchConv((c) => ({
                ...c,
                messages: c.messages.map((m) =>
                  m.id === botId
                    ? {
                        ...m,
                        content: m.content + json.text,
                        status: undefined,
                      }
                    : m,
                ),
                updatedAt: Date.now(),
              }));
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
            console.error('parse error', e, payload);
          }
        }
      }
    } catch (err) {
      // 사용자 Stop으로 인한 abort는 정상 종료 — 에러 메시지 표시하지 않음.
      const isAbort =
        err instanceof DOMException && err.name === 'AbortError';
      if (!isAbort) {
        const message = err instanceof Error ? err.message : '오류 발생';
        patchConv((c) => ({
          ...c,
          messages: c.messages.map((m) =>
            m.id === botId ? { ...m, content: `⚠️ 연결 실패: ${message}` } : m,
          ),
        }));
      }
    } finally {
      streamAbortRef.current = null;
      streamMsgIdsRef.current = null;
      setPending(false);
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
      // Chat 종류는 hashtag/follow-up 등 메타 자동 생성 건너뜀.
      if ((active.kind ?? 'thread') === 'thread') {
        // 응답이 완성된 후 비동기로 해시태그 / 후속 질문 생성 (실패는 무시)
        void generateHashtagsFor(
          botId,
          active.id,
          accumulatedContent,
          active.model || defaultModel || undefined,
        );
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
          active.model || defaultModel || undefined,
        );
      }
      // 완료 알림 — 사용자가 다른 thread/Dashboard 로 갔어도 페이지 어디서든 보임.
      // 이미 활성 thread를 보고 있으면 noisy 하므로 알림 생략.
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

    // Step 1: 생성 시작 placeholder.
    setGenerating(true);

    // 30초 타임아웃 — 응답이 안 오거나 hang 되면 abort 해서 stuck 상태 방지.
    // 타임아웃 시 in-memory 플래그뿐 아니라 DB metadata 에서도 followupGenerating 을 제거.
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    const clearStuckOnBackend = async () => {
      const conv = conversationsRef.current.find((c) => c.id === convId);
      const m = conv?.messages.find((mm) => mm.id === messageId);
      if (!m) return;
      const {
        id: _id,
        role: _role,
        content,
        thinking,
        followupGenerating: _fg,
        ...rest
      } = m;
      void _id;
      void _role;
      void _fg;
      await patchMessageRaw(
        convId,
        messageId,
        content,
        thinking ?? null,
        rest as Record<string, unknown>,
      );
    };

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
        await clearStuckOnBackend();
        return;
      }
      const json = (await res.json()) as {
        question?: string;
        options: string[];
      };
      if (!Array.isArray(json.options) || json.options.length === 0) {
        setGenerating(false);
        await clearStuckOnBackend();
        return;
      }

      // Step 2: 화면 노출 전 백엔드에 먼저 저장.
      const conv = conversationsRef.current.find((c) => c.id === convId);
      const m = conv?.messages.find((mm) => mm.id === messageId);
      if (m) {
        const merged: Message = {
          ...m,
          followup: { question: json.question, options: json.options },
          followupGenerating: undefined,
        };
        const {
          id: _id,
          role: _role,
          content,
          thinking,
          followupGenerating: _fg,
          ...rest
        } = merged;
        void _id;
        void _role;
        void _fg;
        await patchMessageRaw(
          convId,
          messageId,
          content,
          thinking ?? null,
          rest as Record<string, unknown>,
        );
      }

      // Step 3: 저장 후 화면에 followup 노출 + 진행 플래그 끔.
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
      await clearStuckOnBackend();
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

  async function generateHashtagsFor(
    messageId: string,
    convId: string,
    text: string,
    model?: string,
  ) {
    const trimmed = text.trim();
    if (!trimmed || trimmed.length < 10) return;
    // Step 1: 생성 시작 표시 — 답변 옆 hashtag 영역에 "Creating hashtags..." 가 보이도록 플래그 on.
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === messageId ? { ...m, hashtagsGenerating: true } : m,
              ),
            }
          : c,
      ),
    );
    try {
      const res = await fetch(`${API_URL}/chat/hashtags`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed, model }),
      });
      if (!res.ok) {
        clearGenerating();
        return;
      }
      const json = (await res.json()) as {
        hashtags: string[];
        summary?: string;
      };
      const hasTags =
        Array.isArray(json.hashtags) && json.hashtags.length > 0;
      const hasSummary =
        typeof json.summary === 'string' && json.summary.trim().length > 0;
      if (!hasTags && !hasSummary) {
        clearGenerating();
        return;
      }

      // Step 2: 화면 갱신 전에 백엔드에 먼저 영속.
      const conv = conversationsRef.current.find((c) => c.id === convId);
      const m = conv?.messages.find((mm) => mm.id === messageId);
      if (m) {
        const merged: Message = {
          ...m,
          ...(hasTags ? { hashtags: json.hashtags } : {}),
          ...(hasSummary
            ? { replySummary: json.summary?.trim() }
            : {}),
          // 영속 시점에는 진행 플래그가 의미 없으므로 metadata 에 담지 않음.
          hashtagsGenerating: undefined,
        };
        const {
          id: _id,
          role: _role,
          content,
          thinking,
          hashtagsGenerating: _hg,
          ...rest
        } = merged;
        void _id;
        void _role;
        void _hg;
        await patchMessageRaw(
          convId,
          messageId,
          content,
          thinking ?? null,
          rest as Record<string, unknown>,
        );
      }

      // Step 3: 저장 성공 후 화면에 hashtag 노출 + 진행 플래그 끔.
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId
                    ? {
                        ...m,
                        ...(hasTags ? { hashtags: json.hashtags } : {}),
                        ...(hasSummary
                          ? { replySummary: json.summary?.trim() }
                          : {}),
                        hashtagsGenerating: false,
                      }
                    : m,
                ),
              }
            : c,
        ),
      );
    } catch {
      clearGenerating();
    }

    function clearGenerating() {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === messageId
                    ? { ...m, hashtagsGenerating: false }
                    : m,
                ),
              }
            : c,
        ),
      );
    }
  }

  if (!authChecked) {
    return <div className="h-screen w-screen bg-background" />;
  }
  if (!user) {
    // /login 으로 이동 — 실제 리다이렉트는 아래 useEffect 가 담당.
    return <div className="h-screen w-screen bg-background" />;
  }

  return (
    <div className="flex h-screen w-screen bg-background">
      {/* 사이드바 wrapper.
          데스크톱(md+): 인라인 패널 — w-72 / w-0 토글, transform translate 애니메이션.
          모바일(< md): full-screen overlay — 열려있을 때만 화면 전체를 덮고, 닫히면 안 보임.
                         tap 으로 thread 선택 시 자동으로 닫힘 → main 이 화면 가득. */}
      <div
        aria-hidden={!sidebarOpen}
        className={cn(
          'shrink-0 overflow-hidden bg-background',
          // 모바일 — full-screen overlay
          sidebarOpen ? 'fixed inset-0 z-40' : 'hidden',
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
            onSelectDashboard={() => setView('dashboard')}
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
            subtitle="v0.2.0"
            user={user}
            onLogin={() => {
              window.location.href = `${API_URL}/auth/google`;
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
          />
        </div>
      </div>

      <main className="relative flex min-w-0 flex-1 flex-col bg-background">
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
          {!sidebarOpen && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => setSidebarOpen(true)}
              title={t('sidebar.expand')}
            >
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          )}
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
                className="w-full truncate rounded-sm bg-transparent px-1 -mx-1 text-[15px] font-semibold outline-none ring-2 ring-primary/40 focus:ring-primary"
                placeholder={t('header.newChat')}
              />
            ) : (
              <div
                className={cn(
                  'truncate text-[15px] font-semibold',
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
            {active && (active.kind ?? 'thread') === 'thread' && (() => {
              const seen = new Set<string>();
              const tags: string[] = [];
              for (const m of active.messages) {
                if (m.role !== 'assistant' || !m.hashtags) continue;
                for (const tag of m.hashtags) {
                  const key = tag.trim();
                  if (!key || seen.has(key)) continue;
                  seen.add(key);
                  tags.push(key);
                }
              }
              if (tags.length === 0) return null;
              return (
                <div className="mt-0.5 flex flex-wrap items-center gap-1 overflow-hidden text-[11.5px] text-muted-foreground">
                  {tags.slice(0, 12).map((tag, i) => (
                    <span
                      key={i}
                      className="shrink-0 rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-[1px] text-[10.5px] font-medium text-primary"
                      title={tag}
                    >
                      {tag}
                    </span>
                  ))}
                  {tags.length > 12 && (
                    <span
                      className="shrink-0 text-[10.5px] text-muted-foreground"
                      title={tags.slice(12).join(' ')}
                    >
                      +{tags.length - 12}
                    </span>
                  )}
                </div>
              );
            })()}
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
            onClick={() => {
              const el = scrollRef.current;
              if (!el) return;
              programmaticScrollRef.current = Date.now() + 600;
              el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
            }}
            title={t('chat.scrollBottom')}
            aria-label={t('chat.scrollBottom')}
            className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </div>
        <div
          className="h-full overflow-y-auto overflow-x-hidden"
          ref={scrollRef}
        >
          <div
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
              {(active?.messages ?? []).map((m, idx) => {
                const isCollapsibleUser =
                  m.role === 'user' && turnHasResponse.has(m.id);
                const isHiddenByCollapse = hiddenIds.has(m.id);
                const isCollapsedSelf =
                  isCollapsibleUser && collapsedTurns.has(m.id);
                const responsesCount =
                  isCollapsibleUser ? hiddenCountByTurn.get(m.id) ?? 0 : 0;
                // assistant 메시지의 경우 직전 user 메시지의 첨부 이미지를 References 위 영역에 노출.
                const precedingUser =
                  m.role === 'assistant' && idx > 0
                    ? (active?.messages ?? [])[idx - 1]
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
                return (
                  <div
                    key={m.id}
                    ref={(el) => {
                      messageRefs.current.set(m.id, el);
                    }}
                    className="relative"
                  >
                    {/* turn 접힘 시 본문(메시지 버블 영역) 부드럽게 collapse. */}
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
                          onOpenArtifact={(a) => {
                            setActiveArtifact(a);
                            setClosedArtifactId((c) =>
                              c === a.id ? null : c,
                            );
                          }}
                          activeArtifactId={activeArtifact?.id ?? null}
                          onAttachImage={attachImageFromUrl}
                          isFresh={freshIds.has(m.id)}
                          onFollowup={(text) => {
                            void send(text, [], []);
                          }}
                          isCollapsibleTurn={isCollapsibleUser}
                          isCollapsed={
                            isCollapsibleUser && collapsedTurns.has(m.id)
                          }
                          onToggleCollapse={
                            isCollapsibleUser
                              ? () => toggleTurnCollapse(m.id)
                              : undefined
                          }
                          onRemoveImage={(url) =>
                            removeMessageImage(m.id, url)
                          }
                          isVisionInFlight={visionInFlightUserId === m.id}
                          precedingUserImages={precedingUserImages}
                          precedingUserImageNames={precedingUserImageNames}
                          onRemovePrecedingUserImage={
                            precedingUser
                              ? (url) =>
                                  removeMessageImage(precedingUser.id, url)
                              : undefined
                          }
                          onDeleteTurn={
                            m.role === 'user'
                              ? () => deleteTurn(m.id)
                              : undefined
                          }
                        />
                      </div>
                    </div>
                    {/* user msg가 접힌 상태이면 응답 N개 접힘 표시 */}
                    {isCollapsedSelf && responsesCount > 0 && (
                      <button
                        type="button"
                        onClick={() => toggleTurnCollapse(m.id)}
                        className="mt-1 inline-flex items-center gap-1.5 self-start rounded-full border border-border bg-secondary/60 px-2.5 py-0.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-secondary"
                      >
                        <ChevronRight className="h-3 w-3" />
                        <span>{responsesCount}개의 응답이 접힘 — 클릭하여 펼치기</span>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        </div>

        {/* 입력창은 chat 영역 위로 떠 있는 형태. wrapper 자체는 여전히 투명·pointer-events-none 이지만
            그 위에 background→transparent 그라데이션 페이드를 깔아, 뒤로 스크롤되는 컨텐츠(References 등)가
            라운드 버튼에 의해 sharp 하게 잘려보이지 않고 부드럽게 사라지도록 한다. */}
        <div
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 z-10 flex min-h-[68px] items-end transition-opacity duration-200',
            isScrolling ? 'opacity-0' : 'opacity-100',
          )}
        >
          {/* 페이드 마스크 — 입력창 영역(약 96px) 만큼 background 색이 아래에서 위로 옅어진다.
              라운드 버튼(bg-card 불투명)을 가리지 않도록 wrapper bg 가 아니라 별도 absolute 레이어로. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-background via-background/85 to-transparent"
          />
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
                disabled={pending}
                isStreaming={pending}
                onStop={stopStreaming}
                models={models}
                activeModel={activeModel}
                onSelectModel={setActiveModel}
                liveTokRate={liveTokRate}
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
                setClosedArtifactId(activeArtifact?.id ?? mountedArtifact.id);
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
          <TagCloudPanel
            questions={userQuestions}
            activeQuestionId={visibleUserMessageId}
            onSelectQuestion={(id) => scrollToMessage(id)}
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
              for (const t of c.hashtags ?? []) push(t);
              for (const m of c.messages) {
                for (const t of m.hashtags ?? []) push(t);
              }
              return { id: c.id, title: c.title, hashtags: out };
            })}
            activeThreadId={activeId}
            onSelectThread={(id) => setActiveId(id)}
          />
        </div>
      </div>


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
        models={models}
        reasoningModel={activeModel || undefined}
        visionModel={visionModel ?? undefined}
        onSelectReasoningModel={setActiveModel}
        onSelectVisionModel={setVisionModel}
        aiEndpoint={aiEndpoint}
        onChangeAiEndpoint={updateAiEndpoint}
        aiEndpointError={aiEndpointError}
        aiEndpointLoading={aiEndpointLoading}
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
            window.alert('일부 항목 저장에 실패했습니다. 다시 시도하거나 저장하지 않고 진행하세요.');
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
