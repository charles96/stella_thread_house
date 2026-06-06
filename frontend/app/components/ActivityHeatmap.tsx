'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { useI18n, type Lang } from '@/lib/i18n';

interface ActivityCell {
  date: string;
  count: number;
}

interface Props {
  data: ActivityCell[];
  title?: string;
}

const WEEKS = 53;
const DAYS_PER_WEEK = 7;

// 0–4 단계로 정규화해 색상 클래스에 매핑. GitHub 의 5단계 컨트리뷰션 색상 체계.
function level(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 10) return 3;
  return 4;
}

const levelClasses: Record<0 | 1 | 2 | 3 | 4, string> = {
  0: 'bg-secondary/60',
  1: 'bg-primary/25',
  2: 'bg-primary/45',
  3: 'bg-primary/70',
  4: 'bg-primary',
};

function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildWeeks(today: Date): { date: Date; key: string }[][] {
  // 일요일 시작 / 토요일 끝 주 단위로 정렬. 끝주는 오늘이 포함된 주의 토요일.
  const end = new Date(today);
  end.setHours(0, 0, 0, 0);
  const dow = end.getDay();
  end.setDate(end.getDate() + (6 - dow));
  const start = new Date(end);
  start.setDate(end.getDate() - (WEEKS * DAYS_PER_WEEK - 1));

  const weeks: { date: Date; key: string }[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < WEEKS; w++) {
    const week: { date: Date; key: string }[] = [];
    for (let d = 0; d < DAYS_PER_WEEK; d++) {
      const dt = new Date(cursor);
      week.push({ date: dt, key: dateKey(dt) });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function monthLabel(idx: number, lang: Lang): string {
  const tables: Record<Lang, string[]> = {
    ko: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
    en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    ja: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    zh: ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    id: ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'],
    fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
    de: ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'],
  };
  return (tables[lang] ?? tables.en)[idx];
}

function dowLabel(idx: number, lang: Lang): string {
  // 0=일, 1=월, ... 6=토. 일·수·금만 표기 (GitHub 도 격행 표기).
  const tables: Record<Lang, string[]> = {
    ko: ['일', '월', '화', '수', '목', '금', '토'],
    en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    ja: ['日', '月', '火', '水', '木', '金', '土'],
    zh: ['日', '一', '二', '三', '四', '五', '六'],
    id: ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'],
    fr: ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'],
    de: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'],
  };
  return (tables[lang] ?? tables.en)[idx];
}

export default function ActivityHeatmap({ data, title }: Props) {
  const { t, lang } = useI18n();
  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);
  const weeks = useMemo(() => buildWeeks(today), [today]);
  const countByDate = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of data) m.set(r.date, r.count);
    return m;
  }, [data]);

  // 월 라벨 — 각 주의 첫번째 날(=일요일) 기준으로, 해당 주에 새 달이 시작되면 월 라벨을 그 컬럼 위에 표시.
  const monthLabels = useMemo(() => {
    const labels: { weekIdx: number; label: string }[] = [];
    let lastMonth = -1;
    weeks.forEach((week, idx) => {
      const firstOfWeek = week[0].date.getMonth();
      if (firstOfWeek !== lastMonth) {
        labels.push({ weekIdx: idx, label: monthLabel(firstOfWeek, lang) });
        lastMonth = firstOfWeek;
      }
    });
    return labels;
  }, [weeks, lang]);

  const totalCount = useMemo(
    () => data.reduce((acc, r) => acc + r.count, 0),
    [data],
  );

  return (
    <section className="w-full">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-foreground">
          {title ?? t('dashboard.heatmap.title')}
        </h2>
        <span className="text-[11.5px] text-muted-foreground">
          {totalCount} {t('dashboard.heatmap.contributions')}
        </span>
      </div>

      <div className="w-full pb-1">
        {/* 월 라벨 — 좌측 요일 라벨 영역(22px + 4px margin)만큼 들여쓰고
            각 주 컬럼은 flex-1 로 균등 분배되어 컨테이너 폭에 맞춰 자동 축소. */}
        <div className="mb-1 flex h-3 text-[10px] text-muted-foreground">
          <div className="mr-1 w-[22px] shrink-0" />
          <div className="flex flex-1 gap-[2px]">
            {weeks.map((_, i) => {
              const m = monthLabels.find((ml) => ml.weekIdx === i);
              return (
                <div key={i} className="min-w-0 flex-1 truncate">
                  {m ? <span>{m.label}</span> : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-stretch gap-[2px]">
          {/* 요일 라벨 — 일·수·금만 표기. flex-1 로 셀 행 높이와 자동 일치 (cross-axis stretch). */}
          <div className="mr-1 flex w-[22px] shrink-0 flex-col gap-[2px] text-[10px] leading-none text-muted-foreground">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => (
              <div key={d} className="flex flex-1 items-center">
                {d === 0 || d === 2 || d === 4 ? dowLabel(d, lang) : ''}
              </div>
            ))}
          </div>

          {/* 53 주 컬럼 — flex-1 로 컨테이너 폭에 맞춰 자동 축소 (가로 스크롤 방지). */}
          <div className="flex flex-1 gap-[2px]">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex min-w-0 flex-1 flex-col gap-[2px]">
                {week.map((day) => {
                  const c = countByDate.get(day.key) ?? 0;
                  const lv = level(c);
                  const isFuture = day.date > today;
                  // 371 셀 — Radix Tooltip 대신 native title 로 무게 절감.
                  const titleText = isFuture
                    ? ''
                    : `${day.key} · ${c} ${t('dashboard.heatmap.contributions')}`;
                  return (
                    <div
                      key={day.key}
                      title={titleText}
                      className={cn(
                        'aspect-[2/3] w-full rounded-[2px] transition-colors',
                        levelClasses[lv],
                        isFuture && 'opacity-0',
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* 범례 — Less ▢▢▢▢▢ More */}
        <div className="mt-2 flex items-center justify-end gap-1 text-[10.5px] text-muted-foreground">
          <span>{t('dashboard.heatmap.less')}</span>
          {([0, 1, 2, 3, 4] as const).map((l) => (
            <div
              key={l}
              className={cn('h-[9px] w-[9px] rounded-sm', levelClasses[l])}
            />
          ))}
          <span>{t('dashboard.heatmap.more')}</span>
        </div>
      </div>
    </section>
  );
}
