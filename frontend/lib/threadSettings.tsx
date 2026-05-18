'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';

export const HASHTAG_THRESHOLD_DEFAULT = 3;
export const HASHTAG_THRESHOLD_MIN = 1;
export const HASHTAG_THRESHOLD_MAX = 10;

export const TAVILY_TOP_READ_DEFAULT = 3;
export const TAVILY_TOP_READ_MIN = 1;
export const TAVILY_TOP_READ_MAX = 10;

const API_URL = '/api';

// localStorage는 API 응답 전까지 UI 깜빡임을 막는 캐시로만 사용.
const STORAGE = 'stella-thread-settings-v2';

interface StoredSettings {
  hashtagThreshold?: number;
  tavilyTopRead?: number;
}

interface Ctx {
  hashtagThreshold: number;
  setHashtagThreshold: (n: number) => void;
  tavilyTopRead: number;
  setTavilyTopRead: (n: number) => void;
}

const ThreadSettingsCtx = createContext<Ctx>({
  hashtagThreshold: HASHTAG_THRESHOLD_DEFAULT,
  setHashtagThreshold: () => {},
  tavilyTopRead: TAVILY_TOP_READ_DEFAULT,
  setTavilyTopRead: () => {},
});

function readLocalCache(): StoredSettings {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (raw) return JSON.parse(raw) as StoredSettings;
  } catch {
    // ignore
  }
  return {};
}

function writeLocalCache(patch: Partial<StoredSettings>) {
  try {
    const prev = readLocalCache();
    localStorage.setItem(STORAGE, JSON.stringify({ ...prev, ...patch }));
  } catch {
    // ignore
  }
}

async function fetchRemoteSettings(): Promise<StoredSettings> {
  try {
    const res = await fetch(`${API_URL}/auth/settings`, {
      credentials: 'include',
    });
    if (!res.ok) return {};
    return (await res.json()) as StoredSettings;
  } catch {
    return {};
  }
}

async function patchRemoteSettings(patch: StoredSettings): Promise<void> {
  try {
    await fetch(`${API_URL}/auth/settings`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
  } catch {
    // ignore — localStorage already updated
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function ThreadSettingsProvider({ children }: { children: ReactNode }) {
  // 초기값은 localStorage 캐시 → API 응답으로 덮어씀 (깜빡임 방지).
  const cache = readLocalCache();
  const [hashtagThreshold, setHashtagThresholdState] = useState(
    cache.hashtagThreshold != null
      ? clamp(cache.hashtagThreshold, HASHTAG_THRESHOLD_MIN, HASHTAG_THRESHOLD_MAX)
      : HASHTAG_THRESHOLD_DEFAULT,
  );
  const [tavilyTopRead, setTavilyTopReadState] = useState(
    cache.tavilyTopRead != null
      ? clamp(cache.tavilyTopRead, TAVILY_TOP_READ_MIN, TAVILY_TOP_READ_MAX)
      : TAVILY_TOP_READ_DEFAULT,
  );

  // 마운트 시 서버 설정 fetch — 서버 기본값 및 다른 기기에서 변경된 값 반영.
  useEffect(() => {
    fetchRemoteSettings().then((s) => {
      if (s.hashtagThreshold != null) {
        const v = clamp(s.hashtagThreshold, HASHTAG_THRESHOLD_MIN, HASHTAG_THRESHOLD_MAX);
        setHashtagThresholdState(v);
        writeLocalCache({ hashtagThreshold: v });
      }
      if (s.tavilyTopRead != null) {
        const v = clamp(s.tavilyTopRead, TAVILY_TOP_READ_MIN, TAVILY_TOP_READ_MAX);
        setTavilyTopReadState(v);
        writeLocalCache({ tavilyTopRead: v });
      }
    });
  }, []);

  function setHashtagThreshold(n: number) {
    const v = clamp(n, HASHTAG_THRESHOLD_MIN, HASHTAG_THRESHOLD_MAX);
    setHashtagThresholdState(v);
    writeLocalCache({ hashtagThreshold: v });
    void patchRemoteSettings({ hashtagThreshold: v });
  }

  function setTavilyTopRead(n: number) {
    const v = clamp(n, TAVILY_TOP_READ_MIN, TAVILY_TOP_READ_MAX);
    setTavilyTopReadState(v);
    writeLocalCache({ tavilyTopRead: v });
    void patchRemoteSettings({ tavilyTopRead: v });
  }

  return (
    <ThreadSettingsCtx.Provider
      value={{ hashtagThreshold, setHashtagThreshold, tavilyTopRead, setTavilyTopRead }}
    >
      {children}
    </ThreadSettingsCtx.Provider>
  );
}

export function useThreadSettings() {
  return useContext(ThreadSettingsCtx);
}
