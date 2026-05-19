'use client';

import { useEffect, useState } from 'react';
import { useMemo } from 'react';
import {
  Activity as ActivityIcon,
  Folder as FolderIcon,
  Hash,
  LayoutDashboard,
  MessageSquare,
  MessageSquareText,
  Network,
  PanelLeftOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LucideIcon } from 'lucide-react';
import type { Conversation, Folder } from './ChatRoom';
import { cn } from '@/lib/utils';
import { useI18n, type Lang } from '@/lib/i18n';
import { useThreadSettings } from '@/lib/threadSettings';
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Sector,
  Tooltip as RTooltip,
} from 'recharts';
import ThreadGraph from './ThreadGraph';
import ActivityHeatmap from './ActivityHeatmap';

const API_URL = '/api';

interface Props {
  conversations: Conversation[];
  folders: Folder[];
  onSelectThread: (id: string) => void;
  // 사이드바가 접혀 있을 때 헤더에 펼치기 버튼 노출 — Dashboard 화면에서도 사이드바를 다시 열 수 있게.
  sidebarOpen?: boolean;
  onExpandSidebar?: () => void;
}

interface GraphData {
  nodes: { id: string; label: string; type: 'thread' | 'hashtag'; tagCount?: number }[];
  edges: { a: string; b: string }[];
}

interface ActivityCell {
  date: string;
  count: number;
}

interface ActivityResponse {
  thread: ActivityCell[];
  chat: ActivityCell[];
}

const GRAPH_THRESHOLD_DEFAULT = 2;
const GRAPH_THRESHOLD_MIN = 1;
const GRAPH_THRESHOLD_MAX = 10;

function relativeTime(ts: number, lang: Lang): string {
  // Intl 로케일 태그 — 지원 언어 매핑.
  const localeTag = (
    {
      ko: 'ko-KR',
      en: 'en-US',
      ja: 'ja-JP',
      zh: 'zh-CN',
      id: 'id-ID',
    } as const
  )[lang];
  const rtf = new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' });
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return rtf.format(0, 'minute');
  if (m < 60) return rtf.format(-m, 'minute');
  const h = Math.floor(m / 60);
  if (h < 24) return rtf.format(-h, 'hour');
  const d = Math.floor(h / 24);
  if (d < 7) return rtf.format(-d, 'day');
  return new Date(ts).toLocaleDateString(localeTag, {
    month: 'short',
    day: 'numeric',
  });
}

export default function DashboardPanel({
  conversations,
  folders,
  onSelectThread,
  sidebarOpen = true,
  onExpandSidebar,
}: Props) {
  const { t, lang } = useI18n();
  const { hashtagThreshold: settingThreshold } = useThreadSettings();
  const sortedDesc = [...conversations].sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
  const recentThreads = sortedDesc
    .filter((c) => (c.kind ?? 'thread') === 'thread')
    .slice(0, 5);
  const recentChats = sortedDesc
    .filter((c) => c.kind === 'chat')
    .slice(0, 5);
  const folderById = new Map(folders.map((f) => [f.id, f]));

  // 그래프 데이터는 별도 endpoint 에서 fetch — conversation 메시지 hashtag 를 백엔드 집계.
  // conversation 변경 시(생성/삭제/제목변경 등) 다시 가져와 최신 상태 유지.
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [activity, setActivity] = useState<ActivityResponse>({
    thread: [],
    chat: [],
  });
  const [threshold, setThreshold] = useState(GRAPH_THRESHOLD_DEFAULT);
  useEffect(() => {
    setThreshold(settingThreshold);
  }, [settingThreshold]);
  const convsKey = conversations.map((c) => c.id).join('|');
  // activity 는 threshold 와 무관하므로 별도 effect 로 분리.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/conversations/activity?days=365`,
          { credentials: 'include' },
        );
        if (res.ok) {
          const data = (await res.json()) as ActivityResponse;
          if (!cancelled) setActivity(data);
        }
      } catch {
        // 무시
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [convsKey]);
  // graph 는 conversation 변경 + threshold 변경 시 재요청.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${API_URL}/conversations/graph?threshold=${threshold}`,
          { credentials: 'include' },
        );
        if (res.ok) {
          const data = (await res.json()) as GraphData;
          if (!cancelled) setGraph(data);
        }
      } catch {
        // 무시
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [convsKey, threshold]);

  // hashtag 통계 — thread 종류만 집계 (chat 은 hashtag 없음).
  // 소스: conversation.hashtags (서버가 모든 메시지의 hashtag 합집합을 컬럼으로 관리).
  //   m.hashtags(메시지 단위)를 읽으면 메시지가 부분 로드된 대화가 누락되므로 c.hashtags 사용.
  // 누적: 해당 태그가 등장한 thread 수 내림차순 (한 thread 안에서 중복 태그는 1회 카운트).
  // 최근: 해당 태그를 포함한 thread 중 가장 최신 updatedAt 기준.
  const { cumulativeTopHashtags, recentTopHashtags } = useMemo(() => {
    const stat = new Map<
      string,
      { display: string; count: number; lastUsedAt: number }
    >();
    for (const c of conversations) {
      if ((c.kind ?? 'thread') !== 'thread') continue;
      for (const tag of c.hashtags ?? []) {
        const key = tag.toLowerCase();
        const prev = stat.get(key);
        if (prev) {
          prev.count += 1;
          if (c.updatedAt > prev.lastUsedAt) prev.lastUsedAt = c.updatedAt;
        } else {
          stat.set(key, { display: tag, count: 1, lastUsedAt: c.updatedAt });
        }
      }
    }
    const list = Array.from(stat.values());
    return {
      cumulativeTopHashtags: [...list]
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      recentTopHashtags: [...list]
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
        .slice(0, 10),
    };
  }, [conversations]);

  const [tab, setTab] = useState<'general' | 'graph'>('general');

  const tabs: {
    key: 'general' | 'graph';
    label: string;
    Icon: LucideIcon;
  }[] = [
    {
      key: 'general',
      label: t('dashboard.tab.general'),
      Icon: ActivityIcon,
    },
    {
      key: 'graph',
      label: t('dashboard.tab.graph'),
      Icon: Network,
    },
  ];

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-6 py-4">
        {!sidebarOpen && onExpandSidebar && (
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 h-8 w-8 shrink-0"
            onClick={onExpandSidebar}
            title={t('sidebar.expand')}
          >
            <PanelLeftOpen className="h-4 w-4" />
          </Button>
        )}
        <LayoutDashboard className="h-5 w-5 text-primary" />
        <h1 className="text-base font-semibold">{t('dashboard.title')}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-4">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={cn(
              'flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === tb.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            <tb.Icon className="h-3.5 w-3.5 text-primary" />
            <span>{tb.label}</span>
          </button>
        ))}
      </div>
      <div className="w-full px-6 py-6">
        {tab === 'general' && (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <RecentList
                title={t('dashboard.recentThreads')}
                count={t('dashboard.recentCount')}
                items={recentThreads}
                folderById={folderById}
                lang={lang}
                onSelect={onSelectThread}
                emptyText={t('dashboard.empty')}
                fallbackTitle={t('sidebar.newChat')}
                kind="thread"
              />
              <RecentList
                title={t('dashboard.recentChats')}
                count={t('dashboard.recentCount')}
                items={recentChats}
                folderById={folderById}
                lang={lang}
                onSelect={onSelectThread}
                emptyText={t('dashboard.empty')}
                fallbackTitle={t('sidebar.newChatConv')}
                kind="chat"
              />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <section className="rounded-lg border border-border bg-card p-4">
                <ActivityHeatmap
                  data={activity.thread}
                  title={t('dashboard.heatmap.titleThread')}
                />
              </section>
              <section className="rounded-lg border border-border bg-card p-4">
                <ActivityHeatmap
                  data={activity.chat}
                  title={t('dashboard.heatmap.titleChat')}
                />
              </section>
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <HashtagsPieCard
                title={t('dashboard.hashtags.cumulativeTitle')}
                items={cumulativeTopHashtags.map((h) => ({
                  display: h.display,
                  value: h.count,
                  caption: t('dashboard.hashtags.threadCount').replace(
                    '{n}',
                    String(h.count),
                  ),
                }))}
                emptyText={t('dashboard.hashtags.cumulativeEmpty')}
              />
              <HashtagsPieCard
                title={t('dashboard.hashtags.recentTitle')}
                items={recentTopHashtags.map((h) => ({
                  display: h.display,
                  value: h.count,
                  caption: relativeTime(h.lastUsedAt, lang),
                }))}
                emptyText={t('dashboard.hashtags.recentEmpty')}
              />
            </div>

          </>
        )}

        {tab === 'graph' && (
          <>
            {/* 탭 바로 아래 설명 — Thread Graph 가 무엇을 보여주는지 한 줄로 안내. */}
            <p className="mb-3 text-[12.5px] leading-relaxed text-muted-foreground">
              {t('dashboard.graph.description')}
            </p>
            {/* Threshold 조절 — 공유 해시태그 N개 이상일 때만 노드 사이에 edge 그림. */}
            <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
              <label
                htmlFor="graph-threshold"
                className="text-[12.5px] text-foreground"
              >
                {t('dashboard.graphThreshold.label')}
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    setThreshold((v) => Math.max(GRAPH_THRESHOLD_MIN, v - 1))
                  }
                  disabled={threshold <= GRAPH_THRESHOLD_MIN}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-sm hover:bg-accent disabled:opacity-50"
                  aria-label="decrease"
                >
                  −
                </button>
                <input
                  id="graph-threshold"
                  type="number"
                  min={GRAPH_THRESHOLD_MIN}
                  max={GRAPH_THRESHOLD_MAX}
                  value={threshold}
                  onChange={(e) => {
                    const v = parseInt(e.target.value, 10);
                    if (!Number.isFinite(v)) return;
                    const clamped = Math.max(
                      GRAPH_THRESHOLD_MIN,
                      Math.min(GRAPH_THRESHOLD_MAX, v),
                    );
                    setThreshold(clamped);
                  }}
                  className="h-7 w-12 rounded-md border border-border bg-background px-2 text-center text-[12.5px] tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <button
                  type="button"
                  onClick={() =>
                    setThreshold((v) => Math.min(GRAPH_THRESHOLD_MAX, v + 1))
                  }
                  disabled={threshold >= GRAPH_THRESHOLD_MAX}
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background text-sm hover:bg-accent disabled:opacity-50"
                  aria-label="increase"
                >
                  +
                </button>
              </div>
            </div>

            {graph && graph.nodes.length > 0 ? (
              <ThreadGraph
                nodes={graph.nodes}
                edges={graph.edges}
                onSelectNode={onSelectThread}
              />
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-secondary/30 p-6 text-center text-xs text-muted-foreground">
                {t('dashboard.empty')}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RecentList({
  title,
  count,
  items,
  folderById,
  lang,
  onSelect,
  emptyText,
  fallbackTitle,
  kind,
}: {
  title: string;
  count: string;
  items: Conversation[];
  folderById: Map<string, Folder>;
  lang: Lang;
  onSelect: (id: string) => void;
  emptyText: string;
  fallbackTitle: string;
  kind: 'thread' | 'chat';
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <span className="text-[11.5px] text-muted-foreground">{count}</span>
      </div>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-secondary/30 p-4 text-center text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border bg-card">
          {items.map((c, i) => {
            const folder = c.folderId ? folderById.get(c.folderId) : null;
            return (
              <li
                key={c.id}
                className={cn(i > 0 && 'border-t border-border/60')}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="group flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-accent/40"
                >
                  {/* 폴더가 지정된 conversation 은 thread/chat 모두 폴더 prefix 표시.
                      좌측 사이드바와 동일하게 lucide Folder 아이콘 + primary 색. */}
                  {folder && (
                    <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <FolderIcon className="h-3.5 w-3.5 text-primary" />
                      <span className="max-w-[140px] truncate">{folder.name}</span>
                      <span aria-hidden className="text-muted-foreground/60">
                        ›
                      </span>
                    </span>
                  )}
                  {kind === 'chat' ? (
                    <MessageSquare className="h-3.5 w-3.5 shrink-0 text-primary" />
                  ) : (
                    <MessageSquareText className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground group-hover:text-primary">
                    {c.title || fallbackTitle}
                  </span>
                  <span className="shrink-0 text-[10.5px] text-muted-foreground">
                    {relativeTime(c.updatedAt, lang)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface PieHashtagItem {
  display: string;
  value: number;
  caption: string;
}

// 10 색 고정 팔레트 — chocolate dark theme 와 어우러지도록 채도/명도 통일.
const PIE_PALETTE = [
  'hsl(20 75% 60%)',
  'hsl(200 70% 60%)',
  'hsl(110 50% 55%)',
  'hsl(280 60% 65%)',
  'hsl(340 70% 62%)',
  'hsl(50 80% 60%)',
  'hsl(170 55% 50%)',
  'hsl(0 65% 60%)',
  'hsl(220 55% 65%)',
  'hsl(150 50% 50%)',
];

// hover 시 활성화된 슬라이스의 모양 — 외곽이 살짝 커지고 stroke 강조.
function HashtagActiveShape(props: {
  cx?: number;
  cy?: number;
  innerRadius?: number;
  outerRadius?: number;
  startAngle?: number;
  endAngle?: number;
  fill?: string;
}) {
  const {
    cx = 0,
    cy = 0,
    innerRadius = 0,
    outerRadius = 0,
    startAngle = 0,
    endAngle = 0,
    fill = '#fff',
  } = props;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 6}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      stroke="hsl(var(--foreground))"
      strokeWidth={1.5}
    />
  );
}

function HashtagsPieCard({
  title,
  items,
  emptyText,
}: {
  title: string;
  items: PieHashtagItem[];
  emptyText: string;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  // recharts 가 0 value 슬라이스를 그리지 않으므로 균등분할 케이스 대비.
  const total = items.reduce((s, it) => s + Math.max(0, it.value), 0);
  const data = items.map((it, i) => ({
    name: it.display,
    value: total > 0 ? Math.max(0, it.value) : 1,
    caption: it.caption,
    color: PIE_PALETTE[i % PIE_PALETTE.length],
  }));
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
        <Hash className="h-4 w-4 text-primary" />
        <span>{title}</span>
        {items.length > 0 && (
          <span className="text-[11.5px] font-normal text-muted-foreground">
            · {items.length}
          </span>
        )}
      </div>
      {items.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          {emptyText}
        </div>
      ) : (
        <div className="flex items-center gap-4">
          {/* recharts PieChart — activeIndex 로 슬라이스 하이라이트, legend hover 와 양방향 동기화. */}
          <div className="flex shrink-0 flex-col items-center">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">
              Hashtag
            </div>
            <div className="h-36 w-36">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={28}
                  outerRadius={62}
                  paddingAngle={data.length > 1 ? 1 : 0}
                  stroke="hsl(var(--background))"
                  strokeWidth={1}
                  activeIndex={activeIndex ?? undefined}
                  activeShape={HashtagActiveShape}
                  isAnimationActive={false}
                  onMouseEnter={(_, idx) => setActiveIndex(idx)}
                  onMouseLeave={() => setActiveIndex(null)}
                >
                  {data.map((d, i) => (
                    <Cell key={d.name + i} fill={d.color} />
                  ))}
                </Pie>
                <RTooltip
                  cursor={false}
                  // 기본 formatter/labelFormatter 가 Pie 에선 잘 안 먹어 직접 content 로 렌더.
                  content={({
                    active,
                    payload,
                  }: {
                    active?: boolean;
                    payload?: Array<{
                      payload?: { name: string; value: number; caption?: string };
                    }>;
                  }) => {
                    if (!active || !payload || payload.length === 0)
                      return null;
                    const p = payload[0].payload;
                    if (!p) return null;
                    return (
                      <div className="rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px] shadow-md">
                        <div className="font-medium text-foreground">
                          #{String(p.name).replace(/^#+/, '')}
                        </div>
                        {p.caption && (
                          <div className="text-[11px] text-muted-foreground">
                            {p.caption}
                          </div>
                        )}
                      </div>
                    );
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            </div>
          </div>
          {/* 범례 — 항목 hover 시 activeIndex 동기화 → 파이에서 해당 슬라이스 하이라이트. */}
          <ul className="flex min-w-0 flex-1 flex-col gap-1 text-[12px]">
            {data.map((d, i) => (
              <li
                key={d.name + i}
                onPointerEnter={() => setActiveIndex(i)}
                onPointerLeave={() =>
                  setActiveIndex((cur) => (cur === i ? null : cur))
                }
                className={cn(
                  'flex cursor-default items-center gap-1.5 truncate rounded-sm px-1 transition-colors',
                  activeIndex === i
                    ? 'bg-accent/60 text-foreground'
                    : 'text-foreground',
                )}
                title={`${d.name} · ${d.caption}`}
              >
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{
                    backgroundColor: d.color,
                    outline:
                      activeIndex === i
                        ? '2px solid hsl(var(--foreground))'
                        : 'none',
                    outlineOffset: 1,
                  }}
                />
                <span className="truncate">
                  #{d.name.replace(/^#+/, '')}
                </span>
                <span className="ml-auto whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                  {d.caption}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
