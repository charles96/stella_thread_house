'use client';

import {
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderDot as FolderDotIcon,
  FolderInput,
  FolderOpen as FolderOpenIcon,
  FolderPlus,
  GripVertical,
  Info,
  LayoutDashboard,
  LogIn,
  LogOut,
  MessageSquare,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings as SettingsIcon,
  Star,
  Trash2,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import type { AuthUser, Conversation, Folder } from './ChatRoom';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { version } from '../../package.json';

// 사이드바 내 conversation 드래그 식별용 커스텀 MIME. kind 별로 분리해
// thread 폴더에 chat 을 떨어뜨리는 등 cross-kind 드롭을 원천 차단.
const DRAG_MIME_THREAD = 'application/x-stella-thread-id';
const DRAG_MIME_CHAT = 'application/x-stella-chat-id';
function dragMime(kind: 'thread' | 'chat'): string {
  return kind === 'chat' ? DRAG_MIME_CHAT : DRAG_MIME_THREAD;
}

interface Props {
  conversations: Conversation[];
  folders: Folder[];
  activeId: string | null;
  view: 'dashboard' | 'thread';
  onSelectDashboard: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onNewChat: () => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onPin: (id: string) => void;
  pinnedOrder: string[];
  onReorderPinned: (orderedIds: string[]) => void;
  onCreateFolder: (kind: 'thread' | 'chat') => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onToggleFolder: (id: string) => void;
  onCollapse: () => void;
  user: AuthUser | null;
  onLogin: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  hasMoreConversations?: boolean;
  loadingMoreConversations?: boolean;
  onLoadMoreConversations?: () => void;
}

function relativeTime(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(ts).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
  });
}

export default function Sidebar({
  conversations,
  folders,
  activeId,
  view,
  onSelectDashboard,
  onSelect,
  onNew,
  onNewChat,
  onDelete,
  onRename,
  onMove,
  onPin,
  pinnedOrder,
  onReorderPinned,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onCollapse,
  user,
  onLogin,
  onLogout,
  onOpenSettings,
  onOpenAbout,
  hasMoreConversations = false,
  loadingMoreConversations = false,
  onLoadMoreConversations,
}: Props) {
  const { t } = useI18n();

  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !onLoadMoreConversations || !hasMoreConversations) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) onLoadMoreConversations(); },
      { threshold: 0.1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMoreConversations, onLoadMoreConversations]);

  // 터치 기기에서는 draggable 이 첫 탭을 "드래그 선택"으로 처리해 두 번 탭해야 클릭되는 문제가 있음.
  // 마운트 후 터치 지원 여부를 감지해 드래그를 비활성화.
  const [canDrag, setCanDrag] = useState(true);
  useEffect(() => {
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) setCanDrag(false);
  }, []);

  const threadFolders = useMemo(
    () => folders.filter((f) => (f.kind ?? 'thread') === 'thread'),
    [folders],
  );
  const chatFolders = useMemo(
    () => folders.filter((f) => f.kind === 'chat'),
    [folders],
  );
  const threadFolderIds = useMemo(
    () => new Set(threadFolders.map((f) => f.id)),
    [threadFolders],
  );
  const chatFolderIds = useMemo(
    () => new Set(chatFolders.map((f) => f.id)),
    [chatFolders],
  );
  // 각 섹션은 자기 kind 의 폴더만 본다 — conversation 의 folderId 가 다른 kind 폴더를 가리키면
  // 그 섹션의 루트(미분류)로 떨어진다.
  const threads = useMemo(
    () => conversations.filter((c) => (c.kind ?? 'thread') === 'thread'),
    [conversations],
  );
  const chats = useMemo(
    () => conversations.filter((c) => c.kind === 'chat'),
    [conversations],
  );
  const rootThreads = useMemo(
    () => threads.filter((c) => !c.folderId || !threadFolderIds.has(c.folderId)),
    [threads, threadFolderIds],
  );
  const rootChats = useMemo(
    () => chats.filter((c) => !c.folderId || !chatFolderIds.has(c.folderId)),
    [chats, chatFolderIds],
  );

  // 폴더별 아이템 — inline filter O(n·m) 을 Map 사전 계산 O(n+m) 으로 대체.
  const threadItemsByFolder = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const f of threadFolders) map.set(f.id, []);
    for (const c of threads) {
      if (c.folderId && map.has(c.folderId)) map.get(c.folderId)!.push(c);
    }
    return map;
  }, [threadFolders, threads]);

  const chatItemsByFolder = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const f of chatFolders) map.set(f.id, []);
    for (const c of chats) {
      if (c.folderId && map.has(c.folderId)) map.get(c.folderId)!.push(c);
    }
    return map;
  }, [chatFolders, chats]);

  const pinnedConvs = useMemo(() => {
    const pinned = conversations.filter((c) => c.pinned);
    return [...pinned].sort((a, b) => {
      const ai = pinnedOrder.indexOf(a.id);
      const bi = pinnedOrder.indexOf(b.id);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [conversations, pinnedOrder]);
  const [pinnedDraggingId, setPinnedDraggingId] = useState<string | null>(null);
  const [pinnedDragOverId, setPinnedDragOverId] = useState<string | null>(null);

  // Threads / Chat 탭 — 한 번에 한 섹션만 노출. 활성 conversation 의 kind 가
  // 바뀌면 (예: 다른 탭의 conversation 을 Dashboard 에서 클릭) 해당 탭으로 자동 전환.
  const [convTab, setConvTab] = useState<'thread' | 'chat'>('thread');
  const activeKind = useMemo(
    () => (activeId ? conversations.find((c) => c.id === activeId)?.kind ?? 'thread' : null),
    [activeId, conversations],
  );
  useEffect(() => {
    if (activeKind) setConvTab(activeKind);
  }, [activeKind]);

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground md:w-72">
      <div className="flex h-[68px] shrink-0 items-center gap-3 border-b border-border px-4">
        <img src="/logo.svg" alt="Stella" className="h-9 w-9 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="font-doodle text-xl font-semibold">Stella's Thread House</span>
          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <a
              href="https://github.com/charles96/stella_thread_house"
              target="_blank"
              rel="noopener noreferrer"
              className="flex transition-colors hover:text-foreground"
              onClick={(e) => e.stopPropagation()}
              aria-label="GitHub"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5" aria-hidden>
                <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
              </svg>
            </a>
            <span className="opacity-40">·</span>
            <span>v{version}</span>
          </div>
        </div>
        {/* 사이드바 접기 버튼은 메인 헤더(chat 제목 좌측)로 이동 — 여기서는 제거. */}
      </div>

      {/* 모바일에선 Dashboard 미노출 — 사용자는 thread/chat/settings 만 접근. */}
      <button
        type="button"
        onClick={onSelectDashboard}
        className={cn(
          'mx-3 mt-3 flex items-center gap-2 rounded-md px-2 py-3 text-left text-[14px] transition-colors md:py-1.5 md:text-sm',
          view === 'dashboard'
            ? 'bg-accent text-accent-foreground'
            : 'hover:bg-accent/50',
        )}
      >
        <LayoutDashboard className="h-4 w-4 text-primary" />
        <span>{t('dashboard.title')}</span>
      </button>

      {/* Pinned — Dashboard 아래에 고정 노출. 드래그로 순서 변경 가능. */}
      {pinnedConvs.length > 0 && (
        <div className="mx-3 mt-2">
          <div className="mb-1 flex items-center gap-1 px-1">
            <Pin className="h-3 w-3 text-primary" />
            <span className="text-[11px] font-medium text-muted-foreground">
              {t('sidebar.pinned')}
            </span>
          </div>
          <div className="flex max-h-36 flex-col gap-1 overflow-y-auto md:max-h-48 md:gap-0.5">
            {pinnedConvs.map((c) => (
              <div
                key={c.id}
                draggable={canDrag}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', c.id);
                  setPinnedDraggingId(c.id);
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (pinnedDragOverId !== c.id) setPinnedDragOverId(c.id);
                }}
                onDragLeave={() => {
                  if (pinnedDragOverId === c.id) setPinnedDragOverId(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const srcId = e.dataTransfer.getData('text/plain');
                  setPinnedDraggingId(null);
                  setPinnedDragOverId(null);
                  if (!srcId || srcId === c.id) return;
                  const ids = pinnedConvs.map((p) => p.id);
                  const next = ids.filter((x) => x !== srcId);
                  const targetIdx = next.indexOf(c.id);
                  if (targetIdx >= 0) next.splice(targetIdx, 0, srcId);
                  onReorderPinned(next);
                }}
                onDragEnd={() => {
                  setPinnedDraggingId(null);
                  setPinnedDragOverId(null);
                }}
                onClick={() => {
                  onSelect(c.id);
                  setConvTab(c.kind ?? 'thread');
                }}
                className={cn(
                  'group/pin flex w-full cursor-pointer select-none items-center gap-2 overflow-hidden rounded-md px-2 py-3 text-[14px] transition-colors md:cursor-grab md:gap-1 md:py-0.5 md:text-[13px]',
                  c.id === activeId
                    ? 'sidebar-title-no-fade bg-accent text-accent-foreground'
                    : 'sidebar-title-fade-hover text-foreground hover:bg-accent/50',
                  pinnedDraggingId === c.id && 'opacity-40',
                  pinnedDragOverId === c.id && pinnedDraggingId !== c.id
                    ? 'ring-1 ring-primary/60 bg-primary/10'
                    : '',
                )}
                title={c.title}
              >
                {c.kind === 'chat' ? (
                  <MessageSquare className="h-3.5 w-3.5 shrink-0 text-primary" fill="currentColor" stroke="none" />
                ) : (
                  <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-primary" />
                )}
                <span className="sidebar-title-fade min-w-0 flex-1 overflow-hidden whitespace-nowrap">{c.title || t('sidebar.newChat')}</span>
                <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground/40 opacity-0 group-hover/pin:opacity-100" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Threads / Chat 탭 — Dashboard 탭과 톤 통일: 활성 탭만 하단 primary 언더라인. */}
      <div className="mx-2 mt-3 flex items-center gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setConvTab('thread')}
          className={cn(
            '-mb-px border-b-2 px-3 py-3 text-[14px] font-medium transition-colors md:py-1.5 md:text-[12px]',
            convTab === 'thread'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t('sidebar.conversations')}
        </button>
        <button
          type="button"
          onClick={() => setConvTab('chat')}
          className={cn(
            '-mb-px border-b-2 px-3 py-3 text-[14px] font-medium transition-colors md:py-1.5 md:text-[12px]',
            convTab === 'chat'
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t('sidebar.tab.chats')}
        </button>
      </div>

      {/* New / Folder 버튼 — 스크롤 영역 밖 고정 */}
      <div className="shrink-0 px-3 pb-1.5 pt-2">
        {convTab === 'thread' ? (
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-10 justify-start gap-1.5 bg-secondary/40 px-2 hover:bg-secondary md:h-7"
              onClick={onNew}
              title={t('sidebar.newChat')}
            >
              <Plus className="h-3.5 w-3.5 text-primary" />
              <span className="truncate text-[14px] md:text-[12px]">{t('sidebar.newChat')}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 justify-start gap-1.5 bg-secondary/40 px-2 hover:bg-secondary md:h-7"
              onClick={() => onCreateFolder('thread')}
              title={t('sidebar.folder')}
            >
              <FolderPlus className="h-3.5 w-3.5 text-primary" />
              <span className="truncate text-[14px] md:text-[12px]">{t('sidebar.folder')}</span>
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-10 justify-start gap-1.5 bg-secondary/40 px-2 hover:bg-secondary md:h-7"
              onClick={onNewChat}
              title={t('sidebar.newChatConv')}
            >
              <Plus className="h-3.5 w-3.5 text-primary" />
              <span className="truncate text-[14px] md:text-[12px]">{t('sidebar.newChatConv')}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-10 justify-start gap-1.5 bg-secondary/40 px-2 hover:bg-secondary md:h-7"
              onClick={() => onCreateFolder('chat')}
              title={t('sidebar.folder')}
            >
              <FolderPlus className="h-3.5 w-3.5 text-primary" />
              <span className="truncate text-[14px] md:text-[12px]">{t('sidebar.folder')}</span>
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col px-2 pb-3 pt-1">
          {convTab === 'thread' ? (
            <>
              {threadFolders.map((folder) => {
                const items = threadItemsByFolder.get(folder.id) ?? [];
                return (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    items={items}
                    folders={threadFolders}
                    kind="thread"
                    activeId={activeId}
                    canDrag={canDrag}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onRename={onRename}
                    onMove={onMove}
                    onPin={onPin}
                    onRenameFolder={onRenameFolder}
                    onDeleteFolder={onDeleteFolder}
                    onToggleFolder={onToggleFolder}
                  />
                );
              })}

              {rootThreads.length === 0 && threadFolders.length === 0 && (
                <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                  {t('sidebar.empty')}
                </div>
              )}

              <RootDropZone kind="thread" onDropConv={(id) => onMove(id, null)}>
                {rootThreads.map((c) => (
                  <ConversationRow
                    key={c.id}
                    c={c}
                    active={c.id === activeId}
                    folders={threadFolders}
                    canDrag={canDrag}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onRename={onRename}
                    onMove={onMove}
                    onPin={onPin}
                  />
                ))}
              </RootDropZone>
            </>
          ) : (
            <>
              {chatFolders.map((folder) => {
                const items = chatItemsByFolder.get(folder.id) ?? [];
                return (
                  <FolderRow
                    key={folder.id}
                    folder={folder}
                    items={items}
                    folders={chatFolders}
                    kind="chat"
                    activeId={activeId}
                    canDrag={canDrag}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onRename={onRename}
                    onMove={onMove}
                    onPin={onPin}
                    onRenameFolder={onRenameFolder}
                    onDeleteFolder={onDeleteFolder}
                    onToggleFolder={onToggleFolder}
                  />
                );
              })}

              {rootChats.length === 0 && chatFolders.length === 0 && (
                <div className="px-3 py-2 text-center text-xs text-muted-foreground">
                  {t('sidebar.empty')}
                </div>
              )}

              <RootDropZone kind="chat" onDropConv={(id) => onMove(id, null)}>
                {rootChats.map((c) => (
                  <ConversationRow
                    key={c.id}
                    c={c}
                    active={c.id === activeId}
                    folders={chatFolders}
                    canDrag={canDrag}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    onRename={onRename}
                    onMove={onMove}
                    onPin={onPin}
                  />
                ))}
              </RootDropZone>
            </>
          )}
        </div>

        {/* 무한 스크롤 sentinel */}
        {hasMoreConversations && (
          <div ref={loadMoreSentinelRef} className="h-4 w-full shrink-0" />
        )}
        {loadingMoreConversations && (
          <div className="flex items-center justify-center py-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        )}
      </ScrollArea>

      <div className="flex h-[68px] shrink-0 items-center border-t border-border px-3">
        {user ? (
          <div className="flex w-full items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Avatar className="h-8 w-8 shrink-0">
                    {user.picture && (
                      <AvatarImage src={user.picture} alt={user.name ?? user.email} />
                    )}
                    <AvatarFallback className="text-xs">
                      {(user.name ?? user.email).charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 leading-tight">
                    <div className="truncate text-[13px] font-medium">
                      {user.name ?? user.email}
                    </div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {user.email}
                    </div>
                  </div>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="top"
                className="w-56"
              >
                <DropdownMenuItem onSelect={onOpenSettings} className="gap-2">
                  <SettingsIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('menu.settings')}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenAbout} className="gap-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>{t('menu.about')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={onLogout}
              title={t('sidebar.logout')}
            >
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button
            variant="outline"
            className="w-full justify-start gap-2"
            onClick={onLogin}
          >
            <LogIn className="h-4 w-4 text-primary" />
            {t('sidebar.googleLogin')}
          </Button>
        )}
      </div>
    </aside>
  );
}

function FolderRow({
  folder,
  items,
  folders,
  kind,
  activeId,
  canDrag,
  onSelect,
  onDelete,
  onRename,
  onMove,
  onPin,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
}: {
  folder: Folder;
  items: Conversation[];
  folders: Folder[];
  kind: 'thread' | 'chat';
  activeId: string | null;
  canDrag: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onPin: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onToggleFolder: (id: string) => void;
}) {
  const mime = dragMime(kind);
  const { t } = useI18n();
  const [dragOver, setDragOver] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const commitRef = useRef<() => void>(() => {});
  commitRef.current = () => {
    const next = (inputRef.current?.value ?? draft).trim();
    if (next && next !== folder.name) onRenameFolder(folder.id, next);
    setEditing(false);
  };

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    function onMouseDown(e: MouseEvent) {
      if (!rowRef.current?.contains(e.target as Node)) {
        commitRef.current();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [editing]);

  return (
    <div ref={rowRef} className="flex flex-col">
      <div
        className={cn(
          'sidebar-title-fade-hover group flex w-full cursor-pointer select-none items-center gap-2 overflow-hidden rounded-md px-2 py-2.5 text-[14px] transition-colors hover:bg-accent/40 md:gap-1 md:py-0.5 md:text-sm',
          dragOver && 'bg-primary/15 ring-1 ring-primary',
          editing && 'bg-primary/10 ring-1 ring-primary/50',
        )}
        onClick={() => {
          if (editing) return;
          onToggleFolder(folder.id);
        }}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes(mime)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (!dragOver) setDragOver(true);
          }
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          if (!e.dataTransfer.types.includes(mime)) return;
          e.preventDefault();
          setDragOver(false);
          const id = e.dataTransfer.getData(mime);
          if (id) onMove(id, folder.id);
        }}
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200',
            folder.expanded && 'rotate-90',
          )}
        />
        {folder.expanded ? (
          <FolderOpenIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
        ) : items.length > 0 ? (
          <FolderDotIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
        ) : (
          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
        )}
        <div className={cn("min-w-0 flex-1 overflow-hidden", !editing && "sidebar-title-fade")}>
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitRef.current();
                } else if (e.key === 'Escape') {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              placeholder={t('sidebar.folderRename')}
              className={cn(
                'block w-full min-w-0 truncate bg-transparent p-0 text-[13px] font-medium text-foreground caret-primary outline-none',
                'placeholder:text-muted-foreground/60',
              )}
            />
          ) : (
            <span
              className="block overflow-hidden whitespace-nowrap text-[13px] font-medium"
              title={folder.name}
            >
              {folder.name}
            </span>
          )}
        </div>
        <span
          className={cn(
            'shrink-0 text-[11px] text-muted-foreground',
            editing && 'hidden',
          )}
        >
          {items.length}
        </span>
        {!editing && (
          <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 has-[[data-state=open]]:opacity-100">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-5 w-5 hover:bg-transparent data-[state=open]:bg-transparent"
                  onClick={(e) => e.stopPropagation()}
                  title={t('sidebar.more')}
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenuItem
                  onSelect={() => {
                    setDraft(folder.name);
                    window.setTimeout(() => setEditing(true), 160);
                  }}
                  className="gap-2"
                >
                  <Pencil className="h-3 w-3" />
                  <span>{t('sidebar.rename')}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => onDeleteFolder(folder.id)}
                  className="gap-2 text-red-500 focus:bg-red-500/10 focus:text-red-500"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>{t('sidebar.delete')}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      <div
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-in-out',
          folder.expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="ml-3 overflow-hidden">
          {items.length === 0 && (
            <div className="px-3 py-2 pl-3 text-[11.5px] text-muted-foreground">
              {t('sidebar.empty.folder')}
            </div>
          )}
          {items.map((c, i) => {
            const isLast = i === items.length - 1;
            return (
              <div key={c.id} className="relative pl-3">
                {/* 세로선 — 마지막 항목은 가로 커넥터 지점(중앙)까지만 그어 L 모양 형성 */}
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none absolute left-0 w-px bg-border',
                    isLast ? 'top-0 h-1/2' : 'inset-y-0',
                  )}
                />
                {/* 가로 커넥터 — 세로선에서 제목 앞까지 */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-0 top-1/2 h-px w-3 -translate-y-1/2 bg-border"
                />
                <ConversationRow
                  c={c}
                  active={c.id === activeId}
                  folders={folders}
                  canDrag={canDrag}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onRename={onRename}
                  onMove={onMove}
                  onPin={onPin}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// 루트(미분류) 영역 드롭 타겟. 폴더 안 대화를 드래그해서 떨어뜨리면 folderId=null 로 이동.
// kind 가 일치하는 드래그만 허용 — thread root 에 chat 을 떨어뜨리는 cross-kind 이동을 차단.
function RootDropZone({
  children,
  kind,
  onDropConv,
}: {
  children: React.ReactNode;
  kind: 'thread' | 'chat';
  onDropConv: (id: string) => void;
}) {
  const mime = dragMime(kind);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(mime)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (!over) setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes(mime)) return;
        e.preventDefault();
        setOver(false);
        const id = e.dataTransfer.getData(mime);
        if (id) onDropConv(id);
      }}
      className={cn(
        'flex flex-col gap-0.5 rounded-md transition-colors',
        // 빈 영역에도 드롭이 가능하도록 최소 높이 확보.
        'min-h-[1.5rem]',
        over && 'bg-primary/10 ring-1 ring-primary/40',
      )}
    >
      {children}
    </div>
  );
}

function ConversationRow({
  c,
  active,
  folders,
  canDrag,
  onSelect,
  onDelete,
  onRename,
  onMove,
  onPin,
}: {
  c: Conversation;
  active: boolean;
  folders: Folder[];
  canDrag: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onMove: (id: string, folderId: string | null) => void;
  onPin: (id: string) => void;
}) {
  const { t } = useI18n();
  const [dragging, setDragging] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const commitRef = useRef<() => void>(() => {});
  commitRef.current = () => {
    const next = (inputRef.current?.value ?? draft).trim();
    if (next && next !== c.title) onRename(c.id, next);
    setEditing(false);
  };

  useLayoutEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!editing) return;
    function onMouseDown(e: MouseEvent) {
      if (!rowRef.current?.contains(e.target as Node)) {
        commitRef.current();
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [editing]);

  return (
    <div
      ref={rowRef}
      onClick={() => {
        if (editing) return;
        onSelect(c.id);
      }}
      draggable={canDrag && !editing}
      onDragStart={(e) => {
        // kind 별 MIME 으로 — 다른 섹션 폴더는 자기 MIME 만 listen 하므로 자동으로 거부됨.
        e.dataTransfer.setData(dragMime(c.kind ?? 'thread'), c.id);
        e.dataTransfer.effectAllowed = 'move';
        setDragging(true);
      }}
      onDragEnd={() => setDragging(false)}
      className={cn(
        'group flex w-full cursor-pointer select-none items-center gap-2 overflow-hidden rounded-md px-2 py-2.5 text-[14px] transition-colors md:gap-1 md:py-0.5 md:text-sm',
        active ? 'sidebar-title-no-fade bg-accent text-accent-foreground' : 'sidebar-title-fade-hover hover:bg-accent/50',
        dragging && 'opacity-50',
        // 편집 중에도 행 높이를 그대로 유지하기 위해 layout 영향 없는 ring/bg만 사용.
        editing && 'bg-primary/10 ring-1 ring-primary/50',
      )}
      title={editing ? undefined : `${c.title || t('sidebar.newChat')} · ${relativeTime(c.updatedAt)}`}
    >
      {c.kind === 'chat' ? (
        <MessageSquare
          className="h-3.5 w-3.5 shrink-0 text-primary"
          fill="currentColor"
          stroke="none"
        />
      ) : (
        <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-primary" />
      )}
      <div className={cn("min-w-0 flex-1 overflow-hidden", !editing && !active && "sidebar-title-fade")}>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitRef.current();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setEditing(false);
              }
            }}
            placeholder={t('sidebar.renamePrompt')}
            // padding/border 없이 span 자리에 그대로 들어가야 행 높이 변동이 없다.
            // 시각적 단세는 행 wrapper 의 bg/ring 으로 처리.
            className={cn(
              'block w-full min-w-0 truncate bg-transparent p-0 text-[13px] font-medium text-foreground caret-primary outline-none',
              'placeholder:text-muted-foreground/60',
            )}
          />
        ) : (
          <span
            className="block overflow-hidden whitespace-nowrap text-[14px] md:text-[13px]"
            title={c.title || t('sidebar.newChat')}
          >
            {c.title || t('sidebar.newChat')}
          </span>
        )}
      </div>
      {!editing && (
        <div className={cn('flex shrink-0 gap-0.5 transition-opacity has-[[data-state=open]]:opacity-100 md:opacity-0 md:group-hover:opacity-100', active && 'md:opacity-100')}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 hover:bg-transparent data-[state=open]:bg-transparent md:h-5 md:w-5"
                onClick={(e) => e.stopPropagation()}
                title={t('sidebar.more')}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onClick={(e) => e.stopPropagation()}
            >
              <DropdownMenuItem
                onSelect={() => onPin(c.id)}
                className="gap-2"
              >
                {c.pinned ? (
                  <PinOff className="h-3 w-3" />
                ) : (
                  <Pin className="h-3 w-3" />
                )}
                <span>{c.pinned ? t('sidebar.unpin') : t('sidebar.pin')}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  setDraft(c.title || '');
                  window.setTimeout(() => setEditing(true), 160);
                }}
                className="gap-2"
              >
                <Pencil className="h-3 w-3" />
                <span>{t('sidebar.rename')}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="flex items-center gap-1.5">
                <FolderInput className="h-3 w-3" />
                {t('sidebar.moveTo')}
              </DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => onMove(c.id, null)}
                className="gap-2"
              >
                <span className="text-muted-foreground">
                  {t('sidebar.uncategorized')}
                </span>
                {(!c.folderId || c.folderId === null) && (
                  <span className="ml-auto text-primary">●</span>
                )}
              </DropdownMenuItem>
              {folders.length === 0 && (
                <div className="px-2 py-1 text-[11.5px] text-muted-foreground">
                  {t('sidebar.noFolders')}
                </div>
              )}
              {folders.map((f) => (
                <DropdownMenuItem
                  key={f.id}
                  onSelect={() => onMove(c.id, f.id)}
                  className="gap-2"
                >
                  <FolderIcon className="h-3 w-3 text-primary" />
                  <span className="truncate">{f.name}</span>
                  {c.folderId === f.id && (
                    <span className="ml-auto text-primary">●</span>
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => onDelete(c.id)}
                className="gap-2 text-red-500 focus:bg-red-500/10 focus:text-red-500"
              >
                <Trash2 className="h-3 w-3" />
                <span>{t('sidebar.delete')}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
