'use client';

import { useMemo, useState } from 'react';
import { FileText, List as ListIcon, Navigation, Network } from 'lucide-react';
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
  // 관련 문서 그래프용. 모든 thread 의 (id, title, 누적 hashtag 집합).
  threads?: RelatedThreadInput[];
  // 현재 thread id — 그래프 중심 노드.
  activeThreadId?: string | null;
  // thread 클릭 시 이동.
  onSelectThread?: (id: string) => void;
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
  threads,
  activeThreadId,
  onSelectThread,
}: Props) {
  const { t } = useI18n();
  // 마지막으로 클릭한 질문 id — 타임라인 노란색 하이라이트.
  // 외부 activeQuestionId(스크롤 동기화) 가 들어오면 그것을 우선 사용.
  const [clickedQuestionId, setClickedQuestionId] = useState<string | null>(
    null,
  );
  const selectedQuestionId = activeQuestionId ?? clickedQuestionId;
  // 사용자 조절 가능한 임계값 — 기본 3, 1~10 범위.
  const [relatedThreshold, setRelatedThreshold] = useState<number>(
    RELATED_THRESHOLD_DEFAULT,
  );
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
  return (
    <aside className="flex h-screen w-[360px] shrink-0 flex-col border-l border-border bg-sidebar">
      {/* History — 패널 세로의 고정 비율 (절반). 리스트는 자체 스크롤. 닫기 버튼은 History 헤더에 통합. */}
      <div className="flex min-h-0 basis-1/2 shrink-0 grow-0 flex-col overflow-hidden border-b border-border">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-border/60 h-10 bg-secondary/50 px-4 text-[11px] font-medium tracking-wider text-muted-foreground">
          <Navigation className="h-3 w-3 text-primary" />
          <span>{t('panel.messageNavigator')} · {questions.length}</span>
        </div>
        {questions.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-muted-foreground">
            아직 질문이 없습니다.
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <ol className="relative my-3 ml-7 mr-3">
              {/* 타임라인 세로 선 — primary 톤 그라디언트로 시작과 끝이 자연스럽게 흐려짐.
                  첫 노드 위 / 마지막 노드 아래 안쪽으로만 그어지도록 top-3 bottom-3. */}
              <span
                aria-hidden
                className="pointer-events-none absolute left-0 top-3 bottom-3 w-px -translate-x-1/2 bg-gradient-to-b from-primary/60 via-primary/40 to-primary/20"
              />
              {questions.map((q, i) => {
                const isLast = i === questions.length - 1;
                const isSelected = selectedQuestionId === q.id;
                return (
                  <li
                    key={q.id}
                    className={cn(
                      // padding 대신 margin 으로 간격 처리 — pb 가 들어가면 li 의 padding box
                      // 중심과 flex content box 중심이 어긋나 번호 원과 본문 텍스트가 미세하게 어긋남.
                      'relative flex items-center pl-5',
                      i > 0 && 'mt-2',
                    )}
                  >
                    {/* 타임라인 노드 — 인덱스 번호가 박힌 작은 원.
                        선택됨 > 마지막 > 일반 순으로 스타일 우선순위. */}
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-0 top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-[9.5px] font-semibold tabular-nums shadow-sm transition-colors',
                        isSelected
                          ? 'border-primary bg-primary text-primary-foreground ring-2 ring-primary/40'
                          : isLast
                            ? 'border-primary bg-background text-primary ring-2 ring-primary/30'
                            : 'border-primary/70 bg-background text-primary',
                      )}
                    >
                      {i + 1}
                    </span>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => {
                            setClickedQuestionId(q.id);
                            onSelectQuestion?.(q.id);
                          }}
                          className={cn(
                            'group flex w-full min-w-0 max-w-full items-center rounded-md px-2 py-1 text-left transition-colors',
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
                      </TooltipTrigger>
                      <TooltipContent
                        side="left"
                        align="center"
                        className="max-w-xs whitespace-pre-wrap break-words text-[12px] leading-relaxed"
                      >
                        {q.content || `질문 ${i + 1}`}
                      </TooltipContent>
                    </Tooltip>
                  </li>
                );
              })}
            </ol>
          </ScrollArea>
        )}
      </div>

      {/* Related Documents — 현재 thread 와 hashtag 3개 이상 공유하는 다른 thread 들.
          History 가 패널의 절반을 고정으로 차지하므로 여기는 남은 절반을 flex-1 로 차지.
          내부에 Thread Graph / List 두 탭. 기본은 Thread Graph. */}
      {activeThread && (
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 h-10 bg-secondary/50 px-4 text-[11px] font-medium tracking-wider text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <FileText className="h-3 w-3 text-primary" />
          <span>{t('panel.relatedDocuments')} · {related.length}</span>
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
          해시태그가 {threshold}개 이상 일치하는 다른 thread 가 없습니다.
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
