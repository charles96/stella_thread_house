'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

// 'auto' = 브라우저 기본 (Intl.DateTimeFormat 의 resolvedOptions().timeZone).
// 그 외엔 IANA 타임존 명 (e.g. 'Asia/Seoul').
export type Timezone = 'auto' | string;

const STORAGE = 'stella-timezone';

// 흔히 쓰는 타임존 큐레이션 — 필요 시 더 추가. UI 드롭다운에 노출.
export const COMMON_TIMEZONES = [
  'auto',
  'UTC',
  'Asia/Seoul',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Jakarta',
  'Asia/Bangkok',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
] as const;

interface Ctx {
  timezone: Timezone;
  setTimezone: (tz: Timezone) => void;
  // resolvedTz — 'auto' 면 브라우저 기본으로 풀어서 반환. 항상 IANA 명.
  resolvedTz: string;
  // 표시용 헬퍼 — Date | string | number 입력을 현재 timezone 기준 locale string 으로.
  formatDate: (input: Date | string | number | null | undefined) => string;
}

const TzCtx = createContext<Ctx>({
  timezone: 'auto',
  setTimezone: () => {},
  resolvedTz: 'UTC',
  formatDate: () => '',
});

export function TimezoneProvider({ children }: { children: ReactNode }) {
  const [timezone, setTimezoneState] = useState<Timezone>('auto');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE);
      if (saved) setTimezoneState(saved as Timezone);
    } catch {
      // ignore
    }
  }, []);

  function setTimezone(tz: Timezone) {
    setTimezoneState(tz);
    try {
      localStorage.setItem(STORAGE, tz);
    } catch {
      // ignore
    }
  }

  const resolvedTz = useMemo(() => {
    if (timezone !== 'auto') return timezone;
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  }, [timezone]);

  const formatDate = useMemo(() => {
    return (input: Date | string | number | null | undefined) => {
      if (input == null) return '';
      const d = input instanceof Date ? input : new Date(input);
      if (Number.isNaN(d.getTime())) return '';
      try {
        return new Intl.DateTimeFormat(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: resolvedTz,
        }).format(d);
      } catch {
        return d.toLocaleString();
      }
    };
  }, [resolvedTz]);

  return (
    <TzCtx.Provider value={{ timezone, setTimezone, resolvedTz, formatDate }}>
      {children}
    </TzCtx.Provider>
  );
}

export function useTimezone() {
  return useContext(TzCtx);
}
