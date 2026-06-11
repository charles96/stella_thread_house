type Locale = 'ko' | 'en' | 'ja' | 'zh' | 'id' | 'fr' | 'de';

const MSGS = {
  ko: {
    tavilyUnavailable: 'Tavily 사용 불가 — 검색 없이 응답합니다',
    urlDetect: (n: number) => `URL 감지 — 페이지 ${n}개 직접 읽는 중…`,
    botBlocked: '봇 차단 감지 — Tavily 로 본문 가져오는 중…',
    urlAllFailed: 'URL 페이지 읽기에 모두 실패했습니다',
    urlError: (msg: string) => `URL 처리 실패: ${msg}`,
    analyzing: '검색 의도 분석 중…',
    searchingMulti: (n: number, queries: string) =>
      `Tavily 웹 검색 (${n}건) — ${queries}`,
    searchingSingle: (q: string) => `Tavily 웹 검색 중 — "${q}"`,
    noResults: '검색 결과 없음',
    extractingPages: (n: number) =>
      `Tavily 결과 상위 ${n}개 페이지 본문 추출 중…`,
  },
  en: {
    tavilyUnavailable: 'Tavily unavailable — responding without search',
    urlDetect: (n: number) => `URL detected — reading ${n} page${n === 1 ? '' : 's'}…`,
    botBlocked: 'Bot block detected — fetching content via Tavily…',
    urlAllFailed: 'All URL pages failed to load',
    urlError: (msg: string) => `URL error: ${msg}`,
    analyzing: 'Analyzing search intent…',
    searchingMulti: (n: number, queries: string) =>
      `Tavily web search (${n} quer${n === 1 ? 'y' : 'ies'}) — ${queries}`,
    searchingSingle: (q: string) => `Searching the web — "${q}"`,
    noResults: 'No search results found',
    extractingPages: (n: number) =>
      `Extracting top ${n} page${n === 1 ? '' : 's'} from Tavily results…`,
  },
  ja: {
    tavilyUnavailable: 'Tavily 利用不可 — 検索なしで回答します',
    urlDetect: (n: number) => `URL検出 — ${n}ページを読み込み中…`,
    botBlocked: 'ボットブロック検出 — Tavilyで本文取得中…',
    urlAllFailed: 'URLページの読み込みがすべて失敗しました',
    urlError: (msg: string) => `URL処理失敗: ${msg}`,
    analyzing: '検索意図を分析中…',
    searchingMulti: (n: number, queries: string) =>
      `Tavily ウェブ検索 (${n}件) — ${queries}`,
    searchingSingle: (q: string) => `ウェブ検索中 — "${q}"`,
    noResults: '検索結果なし',
    extractingPages: (n: number) =>
      `Tavily結果上位${n}ページの本文を抽出中…`,
  },
  zh: {
    tavilyUnavailable: 'Tavily 不可用 — 将在不搜索的情况下回答',
    urlDetect: (n: number) => `检测到URL — 正在读取 ${n} 个页面…`,
    botBlocked: '检测到机器人拦截 — 正在通过Tavily获取内容…',
    urlAllFailed: 'URL页面读取全部失败',
    urlError: (msg: string) => `URL处理失败: ${msg}`,
    analyzing: '正在分析搜索意图…',
    searchingMulti: (n: number, queries: string) =>
      `Tavily网络搜索 (${n}条) — ${queries}`,
    searchingSingle: (q: string) => `正在搜索网络 — "${q}"`,
    noResults: '没有搜索结果',
    extractingPages: (n: number) => `正在提取Tavily结果前${n}个页面内容…`,
  },
  id: {
    tavilyUnavailable: 'Tavily tidak tersedia — menjawab tanpa pencarian',
    urlDetect: (n: number) => `URL terdeteksi — membaca ${n} halaman…`,
    botBlocked: 'Deteksi blokir bot — mengambil konten via Tavily…',
    urlAllFailed: 'Semua halaman URL gagal dibaca',
    urlError: (msg: string) => `Gagal memproses URL: ${msg}`,
    analyzing: 'Menganalisis maksud pencarian…',
    searchingMulti: (n: number, queries: string) =>
      `Pencarian web Tavily (${n} kueri) — ${queries}`,
    searchingSingle: (q: string) => `Mencari di web — "${q}"`,
    noResults: 'Tidak ada hasil pencarian',
    extractingPages: (n: number) =>
      `Mengekstrak ${n} halaman teratas dari hasil Tavily…`,
  },
  fr: {
    tavilyUnavailable: 'Tavily indisponible — réponse sans recherche',
    urlDetect: (n: number) =>
      `URL détectée — lecture de ${n} page${n === 1 ? '' : 's'}…`,
    botBlocked: 'Blocage de bot détecté — récupération du contenu via Tavily…',
    urlAllFailed: 'Échec du chargement de toutes les pages URL',
    urlError: (msg: string) => `Erreur d'URL : ${msg}`,
    analyzing: 'Analyse de l\'intention de recherche…',
    searchingMulti: (n: number, queries: string) =>
      `Recherche web Tavily (${n} requête${n === 1 ? '' : 's'}) — ${queries}`,
    searchingSingle: (q: string) => `Recherche sur le web — « ${q} »`,
    noResults: 'Aucun résultat de recherche',
    extractingPages: (n: number) =>
      `Extraction des ${n} première${n === 1 ? '' : 's'} page${n === 1 ? '' : 's'} des résultats Tavily…`,
  },
  de: {
    tavilyUnavailable: 'Tavily nicht verfügbar — Antwort ohne Suche',
    urlDetect: (n: number) =>
      `URL erkannt — ${n} Seite${n === 1 ? '' : 'n'} werden gelesen…`,
    botBlocked: 'Bot-Blockierung erkannt — Inhalt wird über Tavily abgerufen…',
    urlAllFailed: 'Alle URL-Seiten konnten nicht geladen werden',
    urlError: (msg: string) => `URL-Fehler: ${msg}`,
    analyzing: 'Suchabsicht wird analysiert…',
    searchingMulti: (n: number, queries: string) =>
      `Tavily-Websuche (${n} Anfrage${n === 1 ? '' : 'n'}) — ${queries}`,
    searchingSingle: (q: string) => `Websuche — „${q}"`,
    noResults: 'Keine Suchergebnisse',
    extractingPages: (n: number) =>
      `Top-${n}-Seite${n === 1 ? '' : 'n'} aus den Tavily-Ergebnissen werden extrahiert…`,
  },
} as const;

export function statusMsg(locale: string | undefined) {
  const l: Locale =
    locale && (locale as Locale) in MSGS ? (locale as Locale) : 'ko';
  return MSGS[l];
}
