'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  FileText,
  GripVertical,
  Hash,
  List as ListIcon,
  ListTree,
  Network,
  Pencil,
  X,
} from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useI18n } from '@/lib/i18n';
import RelatedThreadsGraph, {
  type RelatedNode,
} from './RelatedThreadsGraph';

export interface QuestionEntry {
  id: string;
  content: string;
  // 같은 turn 의 AI 답변 메시지 id — 함께 삭제/이동 대상.
  pairAssistantId?: string;
}

// 관련 문서 그래프 입력용 — Conversation 의 최소 형태.
export interface RelatedThreadInput {
  id: string;
  title: string;
  hashtags: string[];
}

interface Props {
  questions: QuestionEntry[];
  // 현재 viewport 에 보이는 user 메시지 id — 외부(스크롤 추적)에서 주입. 네비게이터 하이라이트 동기화.
  activeQuestionId?: string | null;
  onSelectQuestion?: (id: string) => void;
  // 사용자가 드래그 앤 드롭으로 질문 순서를 바꿨을 때 호출. orderedIds = 새 순서의 user 메시지 id 배열.
  onReorderQuestions?: (orderedIds: string[]) => void;
  // 질문(과 짝지어진 답변) 삭제 요청. 호출 측에서 confirm 모달 띄움.
  onDeleteQuestion?: (id: string) => void;
  // 질문 본문(content) 수정 요청 — 백엔드 PATCH + 로컬 state 갱신은 호출 측 책임.
  onEditQuestion?: (id: string, content: string) => void;
  // 관련 문서 그래프용. 모든 thread 의 (id, title, 누적 hashtag 집합).
  threads?: RelatedThreadInput[];
  // 현재 thread id — 그래프 중심 노드.
  activeThreadId?: string | null;
  // 현재 thread 의 kind — 'chat' 이면 Hashtag 탭 / Related Documents 섹션을 통째로 숨김.
  activeKind?: 'thread' | 'chat';
  // thread 클릭 시 이동.
  onSelectThread?: (id: string) => void;
  // 현재 thread 의 통합 해시태그 — 패널 하단 Hashtags 섹션에 표시.
  threadHashtags?: string[];
  // Edit 모드에서 사용자가 × 클릭한 태그 — 호출자가 conversation.hashtags 에서 제거 + excludedHashtags 에 추가.
  onExcludeHashtag?: (tag: string) => void;
  // Edit 모드에서 사용자가 새로 입력한 태그 — 호출자가 conversation.hashtags 에 union + excludedHashtags 에서 제거.
  onAddHashtag?: (tag: string) => void;
}

// 두 해시태그 셋의 교집합 — 정렬된 배열로 반환 (UI 일관성).
function intersectTags(a: string[], b: string[]): string[] {
  const sb = new Set(b.map((t) => t.toLowerCase()));
  const out = new Set<string>();
  for (const t of a) {
    if (sb.has(t.toLowerCase())) out.add(t);
  }
  return Array.from(out).sort();
}

const RELATED_THRESHOLD_DEFAULT = 3;
const RELATED_THRESHOLD_MIN = 1;
const RELATED_THRESHOLD_MAX = 10;

export default function TagCloudPanel({
  questions,
  activeQuestionId,
  onSelectQuestion,
  onReorderQuestions,
  onDeleteQuestion,
  onEditQuestion,
  threads,
  activeThreadId,
  activeKind = 'thread',
  onSelectThread,
  threadHashtags,
  onExcludeHashtag,
  onAddHashtag,
}: Props) {
  const isChatKind = activeKind === 'chat';
  const { t } = useI18n();
  // 마지막으로 클릭한 질문 id — 타임라인 노란색 하이라이트.
  // 외부 activeQuestionId(스크롤 동기화) 가 들어오면 그것을 우선 사용.
  const [clickedQuestionId, setClickedQuestionId] = useState<string | null>(
    null,
  );
  const selectedQuestionId = activeQuestionId ?? clickedQuestionId;
  // 드래그 앤 드롭 상태 — 끌고 있는 항목 index, 호버 중인 drop target index.
  // overPosition: 호버 항목의 위/아래 중 어느 쪽에 삽입될지 (cursor Y 기준).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [overPosition, setOverPosition] = useState<'before' | 'after' | null>(
    null,
  );
  const reorderEnabled = !!onReorderQuestions;
  // 편집 중인 질문 id + 임시 draft 텍스트. id 가 null 이면 모든 항목이 read-only.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState('');
  const editingRef = useRef<HTMLTextAreaElement>(null);
  // 편집 시작 시 textarea 에 focus + caret 끝으로.
  useEffect(() => {
    if (!editingId) return;
    const el = editingRef.current;
    if (!el) return;
    el.focus();
    const v = el.value;
    el.setSelectionRange(v.length, v.length);
  }, [editingId]);
  function startEdit(id: string, current: string) {
    setEditingId(id);
    setEditingDraft(current);
  }
  function commitEdit() {
    if (!editingId) return;
    const next = editingDraft.trim();
    const original = questions.find((q) => q.id === editingId)?.content ?? '';
    if (next && next !== original.trim()) {
      onEditQuestion?.(editingId, next);
    }
    setEditingId(null);
    setEditingDraft('');
  }
  function cancelEdit() {
    setEditingId(null);
    setEditingDraft('');
  }
  // 사용자 조절 가능한 임계값 — 기본 3, 1~10 범위.
  const [relatedThreshold, setRelatedThreshold] = useState<number>(
    RELATED_THRESHOLD_DEFAULT,
  );
  // Detail 섹션의 내부 탭 — 'toc' (목차) / 'hashtags' (해시태그).
  const [detailTab, setDetailTab] = useState<'toc' | 'hashtags'>('toc');
  // chat kind 로 전환되면 Hashtags 탭이 사라지므로 강제로 toc 으로 복귀.
  useEffect(() => {
    if (isChatKind && detailTab === 'hashtags') setDetailTab('toc');
  }, [isChatKind, detailTab]);
  // 현재 thread 와 hashtag 가 relatedThreshold 개 이상 일치하는 다른 thread 들 추출.
  const { activeThread, related, sharedTagsMap } = useMemo(() => {
    if (!threads || !activeThreadId) {
      return {
        activeThread: null as RelatedThreadInput | null,
        related: [] as RelatedNode[],
        sharedTagsMap: new Map<string, string[]>(),
      };
    }
    const me = threads.find((t) => t.id === activeThreadId) ?? null;
    if (!me) {
      return {
        activeThread: null,
        related: [],
        sharedTagsMap: new Map<string, string[]>(),
      };
    }
    const r: RelatedNode[] = [];
    const m = new Map<string, string[]>();
    for (const t of threads) {
      if (t.id === me.id) continue;
      const shared = intersectTags(me.hashtags, t.hashtags);
      if (shared.length >= relatedThreshold) {
        r.push({ id: t.id, title: t.title, shared: shared.length });
        m.set(t.id, shared);
      }
    }
    // shared 많은 순 정렬.
    r.sort((a, b) => b.shared - a.shared);
    return { activeThread: me, related: r, sharedTagsMap: m };
  }, [threads, activeThreadId, relatedThreshold]);
  const hashtagsAvailable =
    !!onAddHashtag || (threadHashtags && threadHashtags.length > 0);
  return (
    <aside className="flex h-screen w-[360px] shrink-0 flex-col border-l border-border bg-sidebar">
      {/* Detail — 'Detail' 헤더 아래에 [목차/해시태그] 탭 내장. 활성 탭에 따라 본문 영역이 교체됨.
          Detail / Related Documents 두 섹션이 1:1 로 화면을 나눠 가짐. */}
      <div className="flex min-h-0 basis-0 flex-1 flex-col overflow-hidden border-b border-border">
        {/* 섹션 헤더 — Detail */}
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 h-10 bg-secondary/50 px-4 text-[11px] font-medium tracking-wider text-muted-foreground">
          <ListTree className="h-3 w-3 text-primary" />
          <span>{t('panel.detail')}</span>
        </div>
        {/* 탭 스트립 — Table of Contents / Hashtags */}
        <div className="flex shrink-0 border-b border-border/60 px-2">
          <button
            type="button"
            onClick={() => setDetailTab('toc')}
            className={cn(
              'flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium transition-colors',
              detailTab === 'toc'
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <ListTree className="h-3 w-3" />
            <span>
              {t('panel.messageManager')}
            </span>
          </button>
          {!isChatKind && hashtagsAvailable && (
            <button
              type="button"
              onClick={() => setDetailTab('hashtags')}
              className={cn(
                'flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium transition-colors',
                detailTab === 'hashtags'
                  ? 'border-b-2 border-primary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Hash className="h-3 w-3" />
              <span>
                {t('panel.hashtags')}
              </span>
            </button>
          )}
        </div>
        {detailTab === 'toc' && questions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
            아직 질문이 없습니다.
          </div>
        ) : detailTab === 'toc' ? (
          <ScrollArea className="min-h-0 flex-1">
            <ol
              className="relative my-3 ml-7 mr-3"
              // li 들 사이의 mt-2 갭 영역은 li 의 hit-test 박스 밖 → 그 위에서 drop 해도 li onDrop 이 안 잡힘.
              // ol 레벨에서 cursor Y 와 가장 가까운 li 를 찾아 overIndex/overPosition 을 갱신 + drop 처리.
              onDragOver={(e) => {
                if (!reorderEnabled || dragIndex === null) return;
                const lis = Array.from(
                  e.currentTarget.querySelectorAll<HTMLLIElement>(
                    ':scope > li',
                  ),
                );
                if (lis.length === 0) return;
                let bestI = -1;
                let bestDist = Infinity;
                let bestPos: 'before' | 'after' = 'before';
                lis.forEach((li, idx) => {
                  const rect = li.getBoundingClientRect();
                  const midY = rect.top + rect.height / 2;
                  const dist = Math.abs(e.clientY - midY);
                  if (dist < bestDist) {
                    bestDist = dist;
                    bestI = idx;
                    bestPos = e.clientY < midY ? 'before' : 'after';
                  }
                });
                if (bestI < 0) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (overIndex !== bestI) setOverIndex(bestI);
                if (overPosition !== bestPos) setOverPosition(bestPos);
              }}
              onDrop={(e) => {
                if (
                  !reorderEnabled ||
                  dragIndex === null ||
                  overIndex === null
                )
                  return;
                e.preventDefault();
                const from = dragIndex;
                let to =
                  overPosition === 'after' ? overIndex + 1 : overIndex;
                // 원본 위치 from 보다 뒤로 옮길 때 splice 후 한 칸 당겨짐 보정.
                if (to > from) to -= 1;
                setDragIndex(null);
                setOverIndex(null);
                setOverPosition(null);
                if (from === to) return;
                const next = questions.map((qq) => qq.id);
                const [moved] = next.splice(from, 1);
                next.splice(to, 0, moved);
                onReorderQuestions?.(next);
                // 옮긴 항목을 선택 표시 + 채팅 본문에서 해당 위치로 스크롤.
                // 스크롤은 unfold 애니메이션(reorder 시 옮긴 메시지가 잠깐 height:0)이 끝난 뒤에 실행 —
                // 즉시 호출하면 scrollIntoView 가 0-height 위치를 기준으로 잡혀 엉뚱한 자리로 감.
                setClickedQuestionId(moved);
                window.setTimeout(() => {
                  onSelectQuestion?.(moved);
                }, 400);
              }}
            >
              {/* 타임라인 세로 선 — primary 톤 그라디언트로 시작과 끝이 자연스럽게 흐려짐.
                  첫 노드 위 / 마지막 노드 아래 안쪽으로만 그어지도록 top-3 bottom-3. */}
              <span
                aria-hidden
                className="pointer-events-none absolute left-0 top-3 bottom-3 w-px -translate-x-1/2 bg-gradient-to-b from-primary/60 via-primary/40 to-primary/20"
              />
              {questions.map((q, i) => {
                const isLast = i === questions.length - 1;
                const isSelected = selectedQuestionId === q.id;
                const isDragging = dragIndex === i;
                const isDropTarget =
                  overIndex === i && dragIndex !== null;
                // 자기 자신 위에 drop 해도 위치가 안 바뀌는 경우 indicator 숨김.
                // before: 호버 i 의 바로 위, after: 호버 i 의 바로 아래.
                // dragIndex 가 i 또는 i+1 이면 before 는 no-op, dragIndex 가 i 또는 i-1 이면 after 는 no-op.
                const showBefore =
                  isDropTarget &&
                  overPosition === 'before' &&
                  dragIndex !== i &&
                  dragIndex !== i - 1;
                const showAfter =
                  isDropTarget &&
                  overPosition === 'after' &&
                  dragIndex !== i &&
                  dragIndex !== i + 1;
                return (
                  <li
                    key={q.id}
                    draggable={reorderEnabled && editingId !== q.id}
                    onDragStart={(e) => {
                      if (!reorderEnabled || editingId === q.id) return;
                      setDragIndex(i);
                      // Firefox 호환 — dataTransfer 에 뭐라도 넣어줘야 drag 시작됨.
                      try {
                        e.dataTransfer.setData('text/plain', q.id);
                      } catch {
                        // ignore
                      }
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => {
                      setDragIndex(null);
                      setOverIndex(null);
                      setOverPosition(null);
                    }}
                    className={cn(
                      // padding 대신 margin 으로 간격 처리 — pb 가 들어가면 li 의 padding box
                      // 중심과 flex content box 중심이 어긋나 번호 원과 본문 텍스트가 미세하게 어긋남.
                      'group/q relative flex items-center rounded-md pl-5 transition-colors',
                      i > 0 && 'mt-2',
                      isDragging && 'opacity-40',
                      // 드롭 대상 hover 시 살짝만 강조 — 명확한 indicator 는 위/아래 가로선이 담당.
                      isDropTarget &&
                        dragIndex !== i &&
                        'bg-accent/30',
                    )}
                  >
                    {/* 삽입 위치 표시 가로선 — 호버 항목의 위 또는 아래. 양 끝에 점으로 마커. */}
                    {showBefore && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -top-1 left-5 right-2 flex items-center"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
                        <span className="h-0.5 flex-1 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
                      </span>
                    )}
                    {showAfter && (
                      <span
                        aria-hidden
                        className="pointer-events-none absolute -bottom-1 left-5 right-2 flex items-center"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
                        <span className="h-0.5 flex-1 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]" />
                      </span>
                    )}
                    {/* 타임라인 노드 — 번호 텍스트 대신 작은 도트.
                        선택 = 큰 도트 + 글로우, 마지막 = 중간 도트 + ring, 일반 = 작은 dim 도트. */}
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full transition-all',
                        isSelected
                          ? 'h-3 w-3 bg-primary shadow-[0_0_8px_hsl(var(--primary))]'
                          : isLast
                            ? 'h-2.5 w-2.5 bg-primary ring-2 ring-primary/30'
                            : 'h-2 w-2 bg-primary/60',
                      )}
                    />
                    {/* 드래그 핸들 시각 표시 — 실제 draggable 은 <li> 전체에 걸어 행 전체가 드래그 이미지가 됨.
                        Sidebar 의 쓰레드 드래그와 동일 패턴. */}
                    {reorderEnabled && (
                      <span
                        aria-hidden
                        className="mr-0.5 flex h-6 w-4 cursor-grab items-center justify-center text-muted-foreground/50 opacity-0 transition-opacity group-hover/q:opacity-100 active:cursor-grabbing"
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </span>
                    )}
                    {/* 풍선도움말(Tooltip) 은 드래그 시 hover 와 충돌해 드롭 표시를 가림 →
                        네이티브 title 속성으로 대체 (드래그 동작 방해 없음). */}
                    {editingId === q.id ? (
                      <div
                        className="flex min-w-0 flex-1 items-start gap-1 px-1 py-0.5"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <textarea
                          ref={editingRef}
                          value={editingDraft}
                          onChange={(e) => setEditingDraft(e.target.value)}
                          onKeyDown={(e) => {
                            // Enter 확정 / Shift+Enter 줄바꿈 / Esc 취소.
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              commitEdit();
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              cancelEdit();
                            }
                          }}
                          rows={Math.min(
                            6,
                            Math.max(1, editingDraft.split('\n').length),
                          )}
                          className="min-w-0 flex-1 resize-none rounded-md border border-primary/40 bg-background px-2 py-1 text-[12.5px] leading-snug text-foreground shadow-sm outline-none ring-2 ring-primary/30 focus:ring-primary/60"
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            commitEdit();
                          }}
                          title="저장 (Enter)"
                          aria-label="저장"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-primary hover:bg-primary/15"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelEdit();
                          }}
                          title="취소 (Esc)"
                          aria-label="취소"
                          className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setClickedQuestionId(q.id);
                          onSelectQuestion?.(q.id);
                        }}
                        title={q.content || `질문 ${i + 1}`}
                        className={cn(
                          'group flex min-w-0 flex-1 items-center rounded-md px-2 py-1 text-left transition-colors',
                          'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          isSelected && 'bg-primary/15',
                        )}
                      >
                        <span
                          className={cn(
                            'block min-w-0 flex-1 truncate text-[12.5px] leading-snug group-hover:text-primary',
                            isSelected
                              ? 'font-semibold text-primary'
                              : 'text-foreground',
                          )}
                        >
                          {q.content || `질문 ${i + 1}`}
                        </span>
                      </button>
                    )}
                    {/* 편집 버튼 — hover 시 노출. 편집 중인 항목엔 숨김(인라인 컨트롤이 대신). */}
                    {onEditQuestion && editingId !== q.id && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(q.id, q.content);
                        }}
                        title="질문 편집"
                        aria-label="질문 편집"
                        className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-[opacity,colors] hover:bg-primary/10 hover:text-primary focus-visible:opacity-100 group-hover/q:opacity-100"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    )}
                    {/* 삭제 버튼 — hover 시 노출. 질문+답변을 함께 제거 (호출자가 confirm 모달 띄움). */}
                    {onDeleteQuestion && editingId !== q.id && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteQuestion(q.id);
                        }}
                        title="질문과 답변 삭제"
                        aria-label="질문과 답변 삭제"
                        className="ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-[opacity,colors] hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/q:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        ) : (
          // Hashtags 탭 — 기존 HashtagsSection 내부 본문만 그대로 재사용.
          // (자체 헤더 줄 없이 Detail 의 탭 헤더가 라벨 역할)
          <HashtagsTabContent
            tags={threadHashtags ?? []}
            onExclude={onExcludeHashtag}
            onAdd={onAddHashtag}
          />
        )}
      </div>

      {/* Related Documents — 현재 thread 와 hashtag 3개 이상 공유하는 다른 thread 들.
          내부에 Thread Graph / List 두 탭. 기본은 Thread Graph.
          chat kind 는 hashtag 자체를 안 만들기에 섹션 전체를 숨김. */}
      {!isChatKind && activeThread && (
        <RelatedDocumentsSection
          activeThread={activeThread}
          related={related}
          sharedTagsMap={sharedTagsMap}
          onSelectThread={onSelectThread}
          threshold={relatedThreshold}
          onChangeThreshold={setRelatedThreshold}
        />
      )}
    </aside>
  );
}

// Detail 의 Hashtags 탭 본문 — 자체 섹션 헤더 없이 (Detail 탭 스트립이 라벨 담당).
// Edit 토글 버튼은 본문 우상단에 inline.
function HashtagsTabContent({
  tags,
  onExclude,
  onAdd,
}: {
  tags: string[];
  onExclude?: (tag: string) => void;
  onAdd?: (tag: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const canEdit = !!(onExclude || onAdd);
  // 표시는 알파벳/가나다 순으로 정렬 — '#' 접두사 무시 + 대소문자 무시 로 자연스러운 순서.
  const sortedTags = useMemo(
    () =>
      [...tags].sort((a, b) =>
        a.replace(/^#+/, '').localeCompare(b.replace(/^#+/, ''), undefined, {
          sensitivity: 'base',
          numeric: true,
        }),
      ),
    [tags],
  );

  function commitAdd() {
    if (!onAdd) return;
    const raw = draft.trim();
    if (!raw) return;
    // # 접두사가 없으면 자동 부여 — 일관된 표시 형식.
    const normalized = raw.startsWith('#') ? raw : `#${raw}`;
    onAdd(normalized);
    setDraft('');
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {canEdit && (
        <div className="mb-2 flex justify-end">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10.5px] font-medium tracking-normal transition-colors',
              editing
                ? 'bg-primary text-primary-foreground'
                : 'border border-border bg-background hover:bg-accent',
            )}
            title={editing ? '편집 종료' : '해시태그 편집'}
          >
            {editing ? 'Done' : 'Edit'}
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1">
        {sortedTags.map((tag, i) => (
            <span
              key={i}
              className="inline-flex shrink-0 items-center gap-0.5 rounded-sm border border-primary/30 bg-primary/10 px-1.5 py-[1px] text-[11px] font-medium text-primary"
              title={tag}
            >
              {tag}
              {editing && onExclude && (
                <button
                  type="button"
                  onClick={() => onExclude(tag)}
                  className="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-sm text-primary/70 hover:bg-destructive/15 hover:text-destructive"
                  title="이 태그 배제"
                  aria-label="이 태그 배제"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
        {editing && onAdd && (
          <div className="mt-2 flex items-center gap-1.5">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                // IME 조합 중(한글) Enter 는 조합 확정용이라 무시. 그렇지 않으면 조합 확정 + commit 두 번 발생 → 부분 입력값까지 추가됨.
                if (e.key !== 'Enter') return;
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                e.preventDefault();
                commitAdd();
              }}
              placeholder="#태그 입력"
              className="min-w-0 flex-1 rounded-sm border border-input bg-background px-2 py-0.5 text-[11px] outline-none focus:ring-1 focus:ring-primary/50"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              onClick={commitAdd}
              disabled={!draft.trim()}
              className="rounded-sm border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-40 disabled:hover:bg-primary/10 disabled:hover:text-primary"
            >
              Add
            </button>
          </div>
        )}
    </div>
  );
}

function RelatedDocumentsSection({
  activeThread,
  related,
  sharedTagsMap,
  onSelectThread,
  threshold,
  onChangeThreshold,
}: {
  activeThread: RelatedThreadInput;
  related: RelatedNode[];
  sharedTagsMap: Map<string, string[]>;
  onSelectThread?: (id: string) => void;
  threshold: number;
  onChangeThreshold: (next: number) => void;
}) {
  const { t } = useI18n();
  const [tab, setTab] = useState<'graph' | 'list'>('graph');
  return (
    <div className="flex min-h-0 basis-0 flex-1 flex-col overflow-hidden border-b border-border">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 h-10 bg-secondary/50 px-4 text-[11px] font-medium tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <FileText className="h-3 w-3 text-primary" />
          <span>{t('panel.relatedDocuments')}</span>
        </span>
        {/* 임계값 — 공유 해시태그가 N개 이상일 때만 연결로 간주. */}
        <span
          className="flex items-center gap-1 normal-case tracking-normal"
          title="공유 해시태그 임계값"
        >
          <span className="text-[10.5px] text-muted-foreground/80">≥</span>
          <button
            type="button"
            onClick={() =>
              onChangeThreshold(Math.max(RELATED_THRESHOLD_MIN, threshold - 1))
            }
            disabled={threshold <= RELATED_THRESHOLD_MIN}
            className="flex h-5 w-5 items-center justify-center rounded-sm border border-border bg-background text-[12px] leading-none hover:bg-accent disabled:opacity-50"
            aria-label="decrease"
          >
            −
          </button>
          <span className="w-4 text-center tabular-nums text-[11.5px] font-medium text-foreground">
            {threshold}
          </span>
          <button
            type="button"
            onClick={() =>
              onChangeThreshold(Math.min(RELATED_THRESHOLD_MAX, threshold + 1))
            }
            disabled={threshold >= RELATED_THRESHOLD_MAX}
            className="flex h-5 w-5 items-center justify-center rounded-sm border border-border bg-background text-[12px] leading-none hover:bg-accent disabled:opacity-50"
            aria-label="increase"
          >
            +
          </button>
        </span>
      </div>
      {/* 탭 헤더 — 기본 Thread Graph 선택. */}
      <div className="flex shrink-0 border-b border-border/60 px-2">
        <button
          type="button"
          onClick={() => setTab('graph')}
          className={cn(
            'flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium transition-colors',
            tab === 'graph'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Network className="h-3 w-3" />
          <span>{t('panel.tab.graph')}</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('list')}
          className={cn(
            'flex items-center gap-1 px-2 py-1.5 text-[11px] font-medium transition-colors',
            tab === 'list'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <ListIcon className="h-3 w-3" />
          <span>{t('panel.tab.list')}</span>
        </button>
      </div>
      {related.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-muted-foreground">
          {t('panel.relatedDocuments.empty').replace('{n}', String(threshold))}
        </div>
      ) : tab === 'graph' ? (
        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          <RelatedThreadsGraph
            active={{ id: activeThread.id, title: activeThread.title }}
            related={related}
            onSelect={(id) => onSelectThread?.(id)}
            sharedTagsMap={sharedTagsMap}
          />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          <ul className="px-2 py-2">
            {related.map((r, i) => {
              const tags = sharedTagsMap.get(r.id) ?? [];
              const tagsText = tags
                .map((t) => `#${t.replace(/^#+/, '')}`)
                .join(' ');
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => onSelectThread?.(r.id)}
                    className={cn(
                      'group flex w-full min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors',
                      'hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      i > 0 && 'mt-0.5',
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] leading-snug text-foreground group-hover:text-primary">
                      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate">
                        {r.title || '(제목 없음)'}
                      </span>
                    </span>
                    {tags.length > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="block min-w-0 max-w-full truncate text-[10.5px] text-primary/80">
                            {tagsText}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent
                          side="left"
                          align="center"
                          className="max-w-xs whitespace-pre-wrap break-words text-[11.5px] leading-relaxed"
                        >
                          {tagsText}
                        </TooltipContent>
                      </Tooltip>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
