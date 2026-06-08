// 한 번 본 이미지의 보조 상태(가로/세로, 로딩 완료, 깨짐) 를 localStorage 에
// 캐시해서 conversation 전환/새로고침 시에도 layout shift / 애니메이션 재실행 / 재시도 없이
// 즉시 동일 모양으로 보여주기 위한 작은 LRU 캐시.
//
// 이미지 binary 자체는 브라우저 HTTP cache 가 처리. 여기선 URL 별 메타만 저장한다.

const STORAGE_KEY = 'stella-img-cache';
const MAX_ENTRIES = 1000;

export interface ImageState {
  orient?: 'landscape' | 'portrait';
  // 자연 가로/세로 비율(naturalWidth / naturalHeight) — 팝콘 카드를 실제 비율대로 그릴 때 사용.
  ratio?: number;
  // 자연 픽셀 크기 — 확대 뷰가 첫 렌더부터 최종 크기로 그리도록(열 때 리사이즈 깜빡임 방지).
  natW?: number;
  natH?: number;
  invalid?: boolean;
  loaded?: boolean;
  // LRU eviction 용 — 최근 접근 시각.
  seenAt: number;
}

type Cache = Record<string, ImageState>;

let memCache: Cache | null = null;

function loadAll(): Cache {
  if (memCache) return memCache;
  if (typeof window === 'undefined') {
    memCache = {};
    return memCache;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    memCache = raw ? (JSON.parse(raw) as Cache) : {};
  } catch {
    memCache = {};
  }
  return memCache;
}

function persist(cache: Cache): void {
  if (typeof window === 'undefined') return;
  // LRU — 한도 초과 시 오래된 항목부터 evict.
  const entries = Object.entries(cache);
  if (entries.length > MAX_ENTRIES) {
    entries.sort((a, b) => (a[1].seenAt ?? 0) - (b[1].seenAt ?? 0));
    const keep = entries.slice(entries.length - MAX_ENTRIES);
    cache = Object.fromEntries(keep);
    memCache = cache;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // quota / private mode — 무시.
  }
}

export function getImageState(url: string): ImageState | undefined {
  if (!url) return undefined;
  return loadAll()[url];
}

export function setImageState(url: string, patch: Partial<ImageState>): void {
  if (!url) return;
  const cache = loadAll();
  const prev = cache[url] ?? { seenAt: Date.now() };
  cache[url] = { ...prev, ...patch, seenAt: Date.now() };
  persist(cache);
}

// 마운트 시점에 한 번 호출 — 주어진 URL 들의 캐시된 상태를 모아 반환.
export function hydrateImageStates(
  urls: string[],
): Map<string, ImageState> {
  const cache = loadAll();
  const out = new Map<string, ImageState>();
  for (const u of urls) {
    const s = cache[u];
    if (s) out.set(u, s);
  }
  return out;
}
