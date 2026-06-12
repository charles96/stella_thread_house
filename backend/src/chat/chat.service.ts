import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AttachmentsService } from '../attachments/attachments.service';
import { SystemConfig } from '../db/entities/system-config.entity';
import {
  AiConfigValue,
  AiGroup,
  AiGroups,
  resolveAiGroups,
} from '../admin/ai-config.util';
import { PageExtractResult, PageService } from '../page/page.service';
import { LlmService } from '../llm/llm.service';
import { statusMsg } from './chat.i18n';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
}

export interface ModelInfo {
  name: string;
  size?: number;
  family?: string;
  parameterSize?: string;
  modifiedAt?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  subQuery?: string;
}

export interface SearchImage {
  url: string;
  sourceTitle?: string;
  sourceUrl?: string;
}

export type StreamPart =
  | { type: 'content' | 'thinking'; text: string }
  | {
      type: 'search';
      results: { title: string; url: string }[];
      images: SearchImage[];
    }
  | {
      type: 'pages';
      pages: {
        url: string;
        title?: string;
        chars: number;
        ok: boolean;
        images?: {
          src: string;
          alt?: string;
          kind?: 'image' | 'youtube' | 'x';
          linkUrl?: string;
          analyzing?: boolean;
        }[];
      }[];
    }
  | {
      type: 'image_analyzing_start';
      pageUrl: string;
      src: string;
    }
  | {
      type: 'image_analysis';
      pageUrl: string;
      analyses: {
        src: string;
        alt?: string;
        relevant: boolean;
        description: string;
      }[];
    }
  | { type: 'status'; text: string }
  | { type: 'ai_done' }
  | { type: 'page_timeout'; url: string }
  | {
      type: 'metric';
      tokens: number;
      durationMs: number;
      tokensPerSec: number;
      promptTokens?: number;
    };

// UI locale → Tavily country (해당 국가 웹 우선). en 등은 글로벌(미지정).
function localeToCountry(locale?: string): string | undefined {
  switch ((locale ?? '').toLowerCase()) {
    case 'ko':
      return 'south korea';
    case 'ja':
      return 'japan';
    case 'zh':
      return 'china';
    case 'fr':
      return 'france';
    case 'de':
      return 'germany';
    case 'id':
      return 'indonesia';
    default:
      return undefined;
  }
}

// 사용자 발화의 문자(스크립트)로 언어를 우선 감지해 검색 국가를 정한다.
// (한글/가나는 확실, 한자만 있으면 중국어로 간주) — 없으면 UI locale 폴백.
function detectSearchCountry(text: string, locale?: string): string | undefined {
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(text)) return 'south korea';
  if (/[぀-ゟ゠-ヿ]/.test(text)) return 'japan';
  if (/[一-鿿]/.test(text)) return 'china';
  return localeToCountry(locale);
}

// Instagram CDN URL은 `.heic` 확장자에 ?stp=dst-jpg 변환 매개변수가 붙어
// 실제 응답은 JPEG로 내려오지만 URL 만 보면 HEIC. 따라서 heic/heif도 허용.
const IMG_EXT = /\.(?:jpe?g|png|webp|gif|avif|heic|heif)(?:\?[^"'\s)]*)?$/i;
const ICON_HINT = /(?:icon|sprite|logo|favicon|emoji|button|placeholder|spinner|pixel\.gif|tracking|1x1|avatar|profile_image|thumb_small)/i;
const TINY_DIM_HINT = /(?:[_-](?:[1-9]|[1-9]\d|1[0-4]\d)x(?:[1-9]|[1-9]\d|1[0-4]\d)\b|[_-]w(?:[1-9]\d?|1[0-4]\d)\b|[?&](?:w|width|h|height)=(?:[1-9]\d?|1[0-4]\d)\b)/i;

// 브라우저에서 직접 <img>로 못 띄우는 호스트들. 응답에 cross-origin-resource-policy: same-origin
// 이 박혀 있어 외부 origin 에서 표시가 차단된다 → 백엔드 프록시 경유로 바꾼다.
// lookaside.instagram.com (SEO 크롤러 이미지) 도 동일하게 CORP 박혀있어 프록시 필요.
const CORP_BLOCKED_HOSTS = /(?:^|\.)(?:cdninstagram\.com|lookaside\.instagram\.com)$/i;

function rewriteIfCorpBlocked(src: string): string {
  try {
    const u = new URL(src);
    if (!CORP_BLOCKED_HOSTS.test(u.hostname)) return src;
    const base = (process.env.PUBLIC_API_URL ?? 'http://localhost:4100').replace(
      /\/$/,
      '',
    );
    return `${base}/page/img-proxy?url=${encodeURIComponent(src)}`;
  } catch {
    return src;
  }
}

interface PageImageLike {
  src: string;
  alt?: string;
  kind?: 'image' | 'youtube' | 'x';
  linkUrl?: string;
}

function filterPageImages(
  images: PageImageLike[],
  limit = 18,
): PageImageLike[] {
  const out: PageImageLike[] = [];
  const seen = new Set<string>();
  for (const img of images) {
    if (out.length >= limit) break;
    const kind = img.kind ?? 'image';
    // YouTube/X embed는 별도 dedup 키로 통과시킨다 (썸네일 필터 우회)
    if (kind === 'youtube' || kind === 'x') {
      const key = img.linkUrl ?? img.src;
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        src: img.src,
        alt: img.alt,
        kind,
        linkUrl: img.linkUrl,
      });
      continue;
    }
    // 일반 이미지 필터
    if (!img.src) continue;
    if (ICON_HINT.test(img.src)) continue;
    if (TINY_DIM_HINT.test(img.src)) continue;
    // lookaside.instagram.com/seo/google_widget/crawler/?media_id=... — Tavily search 가
    // 반환하는 IG SEO 크롤러 이미지. 확장자 없지만 실제 게시물 이미지를 서빙함.
    const isIgSeo = /^https?:\/\/lookaside\.instagram\.com\/seo\//i.test(
      img.src,
    );
    if (
      !isIgSeo &&
      !IMG_EXT.test(img.src) &&
      !/\/(image|img|photo|picture)/i.test(img.src)
    )
      continue;
    if (seen.has(img.src)) continue;
    seen.add(img.src);
    out.push({ src: rewriteIfCorpBlocked(img.src), alt: img.alt });
  }
  return out;
}

// 메시지가 웹 검색이 도움이 될 키워드 검색 의도인지 간단한 휴리스틱.
// 인사·메타·계산 같은 일반 대화는 false, 정보 요청·시사·찾기 같은 메시지는 true.
function looksLikeSearchIntent(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 4) return false;

  const positive =
    /검색|찾아|알아봐|알아 봐|뭐야|뭔지|어떤|얼마|가격|시세|뉴스|이슈|랭킹|순위|추천|비교|리뷰|후기|소식|업데이트|정보|어디|언제|누구|왜|어떻게|최근|현재|지금|오늘|어제|이번|작년|올해|내년|출시|발표|예정|일정|결과|순위|성능|스펙|사양|컨셉|search|latest|today|news|find|compare|review|recent|current/i;

  const casual =
    /^(안녕|hi|hello|반가워|고마워|땡큐|미안|네|예|응|아니|좋아|싫어|ㅎㅎ|ㅋㅋ|ok|okay)$/i;
  if (casual.test(trimmed)) return false;

  // 수학/계산
  if (/^[\d\s+\-*/().=^]+$/.test(trimmed)) return false;

  return positive.test(trimmed);
}

// 이미지가 첨부된 상황에서 사용하는 더 엄격한 검사 — 일반 의문문(어떤/뭐야 등) 은 통과 못 함.
// 명시적으로 "검색해/찾아봐/google/search for" 같은 동사형 요청만 인정.
// 첨부 이미지 분석이 기본 행동이고, 사용자가 굳이 "검색"이라고 적어야 Tavily 가 추가로 발동.
function looksLikeExplicitSearchRequest(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;
  return /검색(해|을|좀)|찾아\s*(봐|줘|보)|알아\s*(봐|줘|보)|조회\s*해|구글링|네이버에서|google\s+(this|for|it)|search\s+(for|this|it|the\s+web)|look\s+(it|this)\s+up|web\s+search/i.test(
    trimmed,
  );
}

function extractUrlsFromText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  // http(s):// 로 시작하는 URL을 단순 추출. 끝의 공백/구두점은 제거.
  const re = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let u = m[0].replace(/[.,;:!?)\]'"]+$/, '');
    try {
      // URL 정규화: 유효성 검증
      const url = new URL(u);
      u = url.toString();
    } catch {
      continue;
    }
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

// Instagram / X 처럼 JS 로 렌더링되어 봇 차단이 잦은 소셜 URL 판별.
// 검색 결과 경로에서 이런 URL 의 깊은 추출이 실패하면, "차단"으로 버리지 않고
// Tavily 검색이 이미 준 content 스니펫을 본문으로 재활용한다.
function isJsBlockedSocialUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, '');
    return host === 'instagram.com' || host === 'x.com' || host === 'twitter.com';
  } catch {
    return false;
  }
}

@Injectable()
export class ChatService {
  constructor(
    private readonly pageService: PageService,
    private readonly attachments: AttachmentsService,
    private readonly llm: LlmService,
    @InjectRepository(SystemConfig)
    private readonly systemConfigs: Repository<SystemConfig>,
  ) {}

  private readonly logger = new Logger(ChatService.name);
  // 그룹(DB ai config) 의 model 이 비어 있을 때만 쓰이는 최후 안전 기본값.
  private readonly defaultModel = 'gemma4:26b';

  // AI 설정 — system_config 'ai' row 를 Reasoning / Vision 두 그룹으로 정규화해서 로드.
  // 각 그룹은 독립된 endpoint / apiKey / model 을 가진다(Vision 의 빈 값은 Reasoning 으로 폴백).
  private async loadAiGroups(): Promise<AiGroups> {
    try {
      const row = await this.systemConfigs.findOne({ where: { key: 'ai' } });
      return resolveAiGroups(row?.value as AiConfigValue | undefined);
    } catch {
      return resolveAiGroups(undefined);
    }
  }

  // 그룹의 endpoint 를 정규화. 호출별 override(endpoint)가 유효하면 우선.
  // 둘 다 없으면 throw — 호출 측이 사용자에게 Settings 안내.
  private resolveGroupEndpoint(group: AiGroup, override?: string): string {
    const o = (override ?? '').trim();
    if (o && /^https?:\/\//i.test(o)) return o.replace(/\/$/, '');
    const e = group.endpoint?.trim();
    if (!e) {
      throw new Error(
        'AI endpoint is not configured. Set it in Settings > AI.',
      );
    }
    return e.replace(/\/$/, '');
  }

  // Tavily key — system_config 'tavily' row 가 단일 출처. env 폴백 없음 (부팅 seed 만).
  // 매 요청마다 최신값 로드 (Settings 에서 변경 시 즉시 반영).
  private async getTavilyKey(): Promise<string> {
    try {
      const row = await this.systemConfigs.findOne({
        where: { key: 'tavily' },
      });
      const v = (row?.value as { apiKey?: string } | undefined)?.apiKey;
      if (v && v.length > 0) return v;
    } catch {
      // ignore
    }
    return '';
  }
  // URL 직접 모드 페이지 본문 컷
  private readonly directReadCharLimit = Number(
    process.env.DIRECT_PAGE_READ_CHAR_LIMIT ?? 12000,
  );
  // 검색 결과 페이지당 본문 컷 (LLM 컨텍스트에 들어갈 양)
  private readonly searchPageCharLimit = Number(
    process.env.SEARCH_PAGE_CHAR_LIMIT ?? 4000,
  );
  // 키워드 검색 결과 중 본문을 읽을 상위 N개
  private readonly searchTopRead = Number(
    process.env.SEARCH_TOP_READ ?? 3,
  );
  // 답변 출력 토큰 상한(웹/일반 구분 없이 공통). Settings 의 그룹별 maxTokens 가 우선,
  // 미설정 시 이 기본값(env AI_MAX_TOKENS, 기본 16384 — gpt-4o 등 최대 출력에 맞춤).
  private readonly maxOutputTokens = Number(process.env.AI_MAX_TOKENS ?? 16384);
  // URL 직접 모드에서 페이지 한 곳당 비전 분석할 일반 이미지 개수
  // 페이지에서 비전 분석할 이미지 최대 개수 (filterPageImages limit과 맞춰 페이징된 뒷 카드도 커버)
  private readonly imageAnalyzeBudget = Number(
    process.env.PAGE_IMAGE_ANALYZE_BUDGET ?? 16,
  );

  getDefaultModel(): string {
    return this.defaultModel;
  }

  async fetchImageAsDataUrl(
    url: string,
  ): Promise<{ dataUrl: string; contentType: string; bytes: number }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('잘못된 URL');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('http/https URL만 허용됩니다');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    let res: Response;
    try {
      res = await fetch(parsed.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; StellaBot/1.0; +https://example.com)',
          Accept: 'image/*',
        },
        redirect: 'follow',
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new Error(`원본 ${res.status}: ${res.statusText}`);
    }
    const ct = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0];
    if (!/^image\//i.test(ct)) {
      throw new Error(`이미지가 아닙니다 (${ct})`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const MAX = 12 * 1024 * 1024; // 12MB
    if (buf.byteLength > MAX) {
      throw new Error('이미지가 너무 큽니다 (12MB 초과)');
    }
    const dataUrl = `data:${ct};base64,${buf.toString('base64')}`;
    return { dataUrl, contentType: ct, bytes: buf.byteLength };
  }

  async listModels(
    kind: 'reasoning' | 'vision' = 'reasoning',
    endpoint?: string,
  ): Promise<ModelInfo[]> {
    // 지정한 그룹(reasoning/vision)의 endpoint + apiKey 로 모델 목록 조회.
    // endpoint override(저장 전 draft) 가 있으면 그 값을 우선 사용, apiKey 는 그룹 값.
    const groups = await this.loadAiGroups();
    const group = kind === 'vision' ? groups.vision : groups.reasoning;
    let url: string;
    try {
      url = this.resolveGroupEndpoint(group, endpoint);
    } catch {
      // endpoint 미설정 → 빈 배열 (healthcheck/초기화 호환).
      return [];
    }
    return this.llm.provider.listModels({ endpoint: url, apiKey: group.apiKey });
  }

  // 보조 LLM 호출(검색쿼리 재작성·명확성 판단·요약·해시태그·후속질문 등) 공용 경로.
  // 공급자 추상화를 통해 OpenAI 호환 런타임에서 동작한다.
  // content 만 누적하고 thinking/metric 은 버린다 → <think> 출력이 JSON/본문을 오염시키지 않음.
  private async llmComplete(
    messages: ChatMessage[],
    opts?: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
      think?: boolean;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    const group = (await this.loadAiGroups()).reasoning;
    const endpoint = this.resolveGroupEndpoint(group);
    const model = opts?.model || group.model || this.defaultModel;
    const apiKey = group.apiKey;
    let content = '';
    for await (const part of this.llm.provider.streamChat({
      endpoint,
      model,
      messages,
      apiKey,
      maxTokens: opts?.maxTokens ?? 2048,
      temperature: opts?.temperature,
      think: opts?.think ?? false,
      signal: opts?.signal,
    })) {
      if (part.type === 'content') content += part.text;
    }
    return content.trim();
  }

  // 보조 스트리밍 호출(예: 증분 요약) 공용 경로 — content 청크만 흘린다(thinking 제외).
  private async *llmStreamContent(
    messages: ChatMessage[],
    opts?: {
      model?: string;
      maxTokens?: number;
      temperature?: number;
      think?: boolean;
      signal?: AbortSignal;
    },
  ): AsyncGenerator<string> {
    const group = (await this.loadAiGroups()).reasoning;
    const endpoint = this.resolveGroupEndpoint(group);
    const model = opts?.model || group.model || this.defaultModel;
    const apiKey = group.apiKey;
    for await (const part of this.llm.provider.streamChat({
      endpoint,
      model,
      messages,
      apiKey,
      maxTokens: opts?.maxTokens ?? 4096,
      temperature: opts?.temperature,
      think: opts?.think ?? false,
      signal: opts?.signal,
    })) {
      if (part.type === 'content' && part.text) yield part.text;
    }
  }

  // ====== Tavily 키워드 웹 검색 ======
  async searchWeb(
    query: string,
    opts: {
      sources?: number;
      includeImages?: boolean;
      country?: string;
      topic?: 'general' | 'news' | 'finance';
      timeRange?: 'day' | 'week' | 'month' | 'year';
    } = {},
  ): Promise<{ results: SearchResult[]; images: SearchImage[] }> {
    const tavilyKey = await this.getTavilyKey();
    if (!tavilyKey) {
      throw new Error('TAVILY_API_KEY 미설정');
    }
    const sourceLimit = opts.sources ?? 5;
    const includeImages = opts.includeImages ?? true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    let res: globalThis.Response;
    try {
      const body: Record<string, unknown> = {
        api_key: tavilyKey,
        query,
        search_depth: 'advanced',
        include_images: includeImages,
        include_image_descriptions: false,
        max_results: sourceLimit,
      };
      if (opts.topic) body.topic = opts.topic;
      // country 는 general/news 에서 해당 국가 웹을 우선(boost). finance 는 무의미하여 제외.
      if (opts.country && opts.topic !== 'finance') body.country = opts.country;
      if (opts.timeRange) body.time_range = opts.timeRange;
      res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify(body),
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      throw new Error(`Tavily ${res.status}: ${t.slice(0, 200)}`);
    }
    const json = (await res.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        score?: number;
      }>;
      images?: Array<string | { url?: string; description?: string }>;
    };
    const results: SearchResult[] = (json.results ?? [])
      .filter((r) => r && r.url)
      .map((r) => ({
        title: r.title ?? r.url ?? '',
        url: r.url!,
        content: r.content ?? '',
        score: r.score,
      }));
    const images: SearchImage[] = [];
    for (const item of json.images ?? []) {
      if (typeof item === 'string') {
        images.push({ url: item });
      } else if (item && typeof item.url === 'string') {
        images.push({ url: item.url, sourceTitle: item.description });
      }
    }
    return { results, images };
  }

  // 사용자의 자연스러운 메시지(예: "두 인물에 대해 검색해서 알려줘")를
  // 대화 맥락을 반영한 1~2개의 구체 검색 쿼리 + Tavily 검색 옵션(country/topic/time_range) 으로 재작성한다.
  // 실패 시 빈 결과 반환 — 호출 측에서 raw 메시지로 폴백 가능.
  async reformulateSearchQueries(
    userMessage: string,
    history: ChatMessage[] = [],
    model?: string,
    signal?: AbortSignal,
  ): Promise<{
    needsSearch: boolean;
    queries: string[];
    country?: string;
    topic?: 'general' | 'news' | 'finance';
    timeRange?: 'day' | 'week' | 'month' | 'year';
  }> {
    const u = userMessage.trim();
    // 빈 메시지 — 검색할 내용이 없음.
    if (!u) return { needsSearch: false, queries: [] };
    try {
      const sys: ChatMessage = {
        role: 'system',
        content: [
          'You rewrite the user message into web-search-optimized queries plus Tavily search options.',
          'From the conversation context (previous user/assistant messages), resolve what pronouns/referents ("he", "this person", "the two figures", "that company", etc.) point to (proper nouns/keywords) and include them in the queries.',
          '',
          '*** FIRST decide whether a web search is actually needed ("needsSearch") ***',
          'Set "needsSearch" to false when the user message can be answered well from your own general knowledge and does NOT depend on current, real-time, recent, or frequently-changing information. Examples that do NOT need search: definitions, concepts, explanations, history, science, math, coding/how-to, translation, summarization of provided text, casual conversation, and questions about the assistant itself.',
          'Set "needsSearch" to true ONLY when answering requires up-to-date / real-time / recent information (news, prices, today\'s events, latest releases, recently changed facts), OR specific facts you are not confident about, OR fresh details that would materially improve the answer.',
          'If the user EXPLICITLY asks to search the web (e.g., "검색해", "찾아봐", "알아봐줘", "search for", "look it up", "google"), ALWAYS set "needsSearch" to true and still produce proper queries.',
          'If "needsSearch" is false, return an empty "queries" array (the assistant will answer from its own knowledge).',
          '',
          'Output format (exactly this single JSON):',
          '{ "needsSearch": true, "queries": ["query1"], "topic": "general", "country": null, "timeRange": null }',
          '',
          '*** Decision order (judge strictly in this order) ***',
          '1) Decide topic first',
          '2) If topic="news", also decide country (for a Korean message, default "south korea" even if unspecified)',
          '3) Decide timeRange',
          '4) Write queries',
          '',
          'Field rules:',
          '* topic ("general" | "news" | "finance"):',
          '  - "news": the message contains terms like "뉴스/news", "속보/breaking", "recent event", "today\'s", "보도/report", "이슈/issue", "시사/current affairs", or clearly requests timely event info. e.g. "한국 뉴스 알려줘", "오늘 사건", "Trump latest remarks".',
          '  - "finance": stocks, FX, financial markets, company earnings, crypto. e.g. "삼성전자 주가", "USD exchange rate", "Bitcoin price".',
          '  - "general": everything else — general info, history, science, tech, encyclopedic info about people, etc. (default).',
          '* country (lowercase English country name, or null):',
          '  - Fill only when topic="news" (otherwise null).',
          '  - User specifies a country: use it ("한국" → "south korea", "미국" → "united states", "일본" → "japan", "중국" → "china", "영국" → "united kingdom").',
          '  - No country specified + Korean message: **default "south korea"** (Korean-user perspective first).',
          '  - No country specified + English message: null (worldwide results).',
          '  - No country specified + other language: for a global user, infer the country of that language region (Japanese → "japan", Chinese → "china", French → "france", German → "germany", Spanish → "spain", Vietnamese → "vietnam", etc.). If the region is ambiguous, null.',
          '* timeRange ("day" | "week" | "month" | "year" | null):',
          '  - "day": emphasizes immediacy — "오늘/today", "현재/now", "지금", "방금", "어제/yesterday".',
          '  - "week": "최근/recent", "이번 주/this week", "요즘/these days".',
          '  - "month": "이번 달/this month", "last month".',
          '  - "year": "올해/this year", "last year".',
          '  - topic="news" but no time specified → default "week" (recent news is natural).',
          '  - Historical/fixed info → null.',
          '* queries (array, 1-2):',
          '  - If there are two or more independent targets (two people, two products, etc.), split into 2 separate queries. Otherwise 1.',
          '  - Each within 60 chars, noun-centric keywords. Strip particles and filler like "~에 대해 알려줘 / tell me about".',
          '  - For global users: write queries in the SAME language as the user message (Korean → Korean, English → English, Japanese → Japanese, and likewise for any language). Keep person/brand/proper nouns in their original script, or include the original alongside, to improve search accuracy.',
          '  - If topic="news" + country="south korea", naturally include "한국" or relevant Korean keywords in the query.',
          '  - If the target cannot be determined from context, extract only the core nouns of the message.',
          '',
          '*** Examples ***',
          'Input: "오늘 뉴스 알려줘"',
          'Output: {"queries":["오늘 한국 주요 뉴스"],"topic":"news","country":"south korea","timeRange":"day"}',
          '',
          'Input: "삼성전자 최근 주가"',
          'Output: {"queries":["삼성전자 주가"],"topic":"finance","country":null,"timeRange":"week"}',
          '',
          'Input: "Albert Einstein biography"',
          'Output: {"queries":["Albert Einstein biography"],"topic":"general","country":null,"timeRange":null}',
          '',
          'Input: "미국 대통령 선거 결과"',
          'Output: {"queries":["미국 대통령 선거 결과"],"topic":"news","country":"united states","timeRange":"week"}',
          '',
          'Absolutely no text, code fences, or explanations outside the JSON.',
        ].join('\n'),
      };

      const trimmedHistory = history
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6)
        .map((m) => ({
          role: m.role,
          content: (m.content ?? '').slice(0, 2000),
        }));

      const lines: string[] = [];
      if (trimmedHistory.length > 0) {
        lines.push('[Conversation so far]');
        for (const m of trimmedHistory) {
          const tag = m.role === 'user' ? 'User' : 'Assistant';
          lines.push(`${tag}: ${m.content}`);
        }
        lines.push('');
      }
      lines.push('[New user message]');
      lines.push(u.slice(0, 1500));
      lines.push('');
      lines.push('Output JSON only:');

      const text = await this.llmComplete(
        [sys, { role: 'user', content: lines.join('\n') }],
        { model, temperature: 0.2, maxTokens: 512, signal },
      );
      this.logger.log(
        `[reformulate] LLM raw output (first 500): ${text.slice(0, 500)}`,
      );
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) {
        this.logger.warn('[reformulate] no JSON object found in LLM output');
        // 판단 실패 — 안전하게 검색 진행(기존 동작).
        return { needsSearch: true, queries: [] };
      }
      const parsed = JSON.parse(m[0]) as {
        needsSearch?: unknown;
        queries?: unknown;
        topic?: unknown;
        country?: unknown;
        timeRange?: unknown;
      };
      // 명시적으로 false 일 때만 검색 생략 — 누락/불명확하면 검색 진행(안전).
      const needsSearch = parsed.needsSearch !== false;
      const arr = Array.isArray(parsed.queries) ? parsed.queries : [];
      const cleaned = arr
        .filter((q): q is string => typeof q === 'string')
        .map((q) => q.trim())
        .filter((q) => q.length > 0)
        .slice(0, 2);
      const topic =
        parsed.topic === 'news' ||
        parsed.topic === 'finance' ||
        parsed.topic === 'general'
          ? (parsed.topic as 'news' | 'finance' | 'general')
          : undefined;
      const country =
        typeof parsed.country === 'string' && parsed.country.trim().length > 0
          ? parsed.country.trim().toLowerCase()
          : undefined;
      const timeRange =
        parsed.timeRange === 'day' ||
        parsed.timeRange === 'week' ||
        parsed.timeRange === 'month' ||
        parsed.timeRange === 'year'
          ? (parsed.timeRange as 'day' | 'week' | 'month' | 'year')
          : undefined;
      this.logger.log(
        `[reformulate] needsSearch=${needsSearch}, queries=${JSON.stringify(cleaned)}, topic=${topic}, country=${country}, timeRange=${timeRange}`,
      );
      return { needsSearch, queries: cleaned, topic, country, timeRange };
    } catch (e) {
      this.logger.warn(
        `검색 쿼리 재작성 실패: ${e instanceof Error ? e.message : ''}`,
      );
      // 실패 시 안전하게 검색 진행.
      return { needsSearch: true, queries: [] };
    }
  }

  async assessClarity(
    userMessage: string,
    history: ChatMessage[] = [],
    model?: string,
  ): Promise<{ needs: boolean; question?: string; options: string[] }> {
    const empty = { needs: false, options: [] as string[] };
    const u = userMessage.trim();
    if (!u || u.length < 2) return empty;
    try {
      const sys: ChatMessage = {
        role: 'system',
        content: [
          'You are a classifier that decides whether the user\'s new message is specific enough to answer.',
          'Always consider the [conversation context] when deciding.',
          '',
          'Criteria:',
          '- Greetings, thanks, simple factual queries (e.g. "hi", "1+1") → answerable → needs=false',
          '- Even if the new message is short, if it is clear enough given the [conversation] → needs=false (e.g. "more detail", "another one", "tell me about #1" when the referent from the previous turn is clear)',
          '- If the new message is ambiguous and the conversation still does not resolve the branching (type, budget, region, time, target) → needs=true',
          '',
          '**IMPORTANT — Language rule: Write question and options in the SAME language as the user\'s message. If the user wrote in English → English. If Korean → Korean.**',
          '',
          'Response format — output ONLY one of these two JSON objects:',
          '{ "needs": false }',
          'or',
          '{ "needs": true, "question": "one-sentence clarifying question (same language as the user)", "options": ["candidate answer 1", "candidate answer 2", "candidate answer 3"] }',
          '',
          'Rules for question/options (required):',
          '- The question must keep and narrow the topic already discussed in the [conversation] (do not ask generic classification unrelated to it).',
          '- Options should be short so that sending one verbatim is a natural next answer, in the same language as the user.',
          '- 2-4 options.',
          '- No text or code fences outside the JSON.',
        ].join('\n'),
      };

      // 마지막 6개 메시지만 컨텍스트로 보냄
      const trimmedHistory = history
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6)
        .map((m) => ({
          role: m.role,
          content: (m.content ?? '').slice(0, 1500),
        }));

      const lines: string[] = [];
      if (trimmedHistory.length > 0) {
        lines.push('[Conversation]');
        for (const m of trimmedHistory) {
          const tag = m.role === 'user' ? 'User' : 'Assistant';
          lines.push(`${tag}: ${m.content}`);
        }
        lines.push('');
      } else {
        lines.push('[No prior conversation]');
        lines.push('');
      }
      lines.push('[New user message]');
      lines.push(u.slice(0, 1500));
      lines.push('');
      lines.push('Output JSON only:');

      const text = await this.llmComplete(
        [sys, { role: 'user', content: lines.join('\n') }],
        { model, temperature: 0.2 },
      );
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return empty;
      const parsed: unknown = JSON.parse(m[0]);
      if (!parsed || typeof parsed !== 'object') return empty;
      const obj = parsed as Record<string, unknown>;
      if (obj.needs !== true) return empty;
      const question =
        typeof obj.question === 'string' ? obj.question.trim() : undefined;
      const optsRaw = Array.isArray(obj.options) ? obj.options : [];
      const options = optsRaw
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 4);
      if (options.length === 0) return empty;
      return { needs: true, question, options };
    } catch {
      return empty;
    }
  }

  async generateFollowups(
    userMessage: string,
    assistantReply: string,
    history: ChatMessage[] = [],
    model?: string,
  ): Promise<{ question?: string; options: string[] }> {
    const empty = { options: [] as string[] };
    const u = userMessage.trim();
    const a = assistantReply.trim();
    if (!u || !a) return empty;
    try {
      const sys: ChatMessage = {
        role: 'system',
        content: [
          'Right after the assistant reply, you suggest "follow-up questions" the user would naturally want to ask next.',
          'The goal is NOT to ask the user for more info, but to craft specific questions the user can easily click to send next.',
          '',
          '*** VERY IMPORTANT — the default is "no follow-up". ***',
          '- If the reply already sufficiently covered what the user wanted, end with needsClarification=false.',
          '- If only generic/abstract follow-ups come to mind, use needsClarification=false:',
          '  · "tell me more", "give me other info too", "anything related?"',
          '  · vaguely-defined ones like "what other kinds are there", "any recommendations?"',
          '- When you do create follow-ups, they MUST be concrete questions that directly reference proper nouns/concepts/numbers/items explicitly present in the [conversation + current reply].',
          '  · Good: "How much did King Jeongjo\'s construction of Hwaseong Fortress cost?", "Show more specs of the best-value model in the comparison table above"',
          '  · Bad: "tell me more", "any other info?", "anything related?"',
          '',
          '**IMPORTANT — Language rule: Write question and options in the SAME language as the user\'s message. If the user wrote in English → English. If Korean → Korean.**',
          '',
          'Response format — output ONLY one of these two JSON objects:',
          '{ "needsClarification": false }',
          'or',
          '{ "needsClarification": true, "question": "one sentence (optional, same language as the user)", "options": ["concrete follow-up 1", "concrete follow-up 2"] }',
          '',
          'Rules:',
          '- 2-3 options, short, in the same language as the user, each a complete question that can be sent verbatim as a user message.',
          '- Do not make similar options for the same reply — they must be from different angles/topics.',
          '- If unsure, always needsClarification=false (no follow-up is better than a wrong one).',
          '- No text or code fences outside the JSON.',
        ].join('\n'),
      };

      const trimmedHistory = history
        .filter((m) => m.role === 'user' || m.role === 'assistant')
        .slice(-6) // 최근 6개 turn
        .map((m) => ({
          role: m.role,
          content: (m.content ?? '').slice(0, 1200),
        }));

      const lines: string[] = [];
      if (trimmedHistory.length > 0) {
        lines.push('[Conversation]');
        for (const m of trimmedHistory) {
          const tag = m.role === 'user' ? 'User' : 'Assistant';
          lines.push(`${tag}: ${m.content}`);
        }
        lines.push('');
      }
      lines.push('[The user\'s latest question]');
      lines.push(u.slice(0, 1500));
      lines.push('');
      lines.push('[The assistant\'s latest reply]');
      lines.push(a.slice(0, 2500));
      lines.push('');
      lines.push('Output JSON only:');

      const user: ChatMessage = { role: 'user', content: lines.join('\n') };
      const text = await this.llmComplete([sys, user], {
        model,
        temperature: 0.3,
        maxTokens: 512,
      });
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return empty;
      const parsed: unknown = JSON.parse(m[0]);
      if (!parsed || typeof parsed !== 'object') return empty;
      const obj = parsed as Record<string, unknown>;
      if (obj.needsClarification === false) return empty;
      const question =
        typeof obj.question === 'string' ? obj.question.trim() : undefined;
      const optsRaw = Array.isArray(obj.options) ? obj.options : [];
      const options = optsRaw
        .filter((s): s is string => typeof s === 'string')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 3);
      // 길이가 짧거나 일반적인 옵션이면 차라리 없애기
      const filtered = options.filter((o) => {
        if (o.length < 8) return false;
        const tooGeneric = /^(더 자세히|관련|다른|추천|어떤|기타|또 다른)/i;
        return !tooGeneric.test(o);
      });
      if (filtered.length === 0) return empty;
      return { question, options: filtered };
    } catch {
      return empty;
    }
  }

  async generateHashtags(
    text: string,
    model?: string,
  ): Promise<{ hashtags: string[]; summary: string }> {
    const empty = { hashtags: [] as string[], summary: '' };
    const trimmed = text.trim().slice(0, 4000);
    if (!trimmed) return empty;
    try {
      const sys: ChatMessage = {
        role: 'system',
        content: [
          'Look at the following answer and produce (1) a one-line summary and (2) 3-6 hashtags of the core keywords from the body, in the SAME language as the answer.',
          'Hashtags must be only the most central words from the answer body. Accuracy matters more than quantity.',
          '',
          'Core-keyword selection guide:',
          '- Choose only words that actually appear in the body or best represent its topic.',
          '- Exclude auxiliary/peripheral/generic concepts (e.g. no meta words like "#overview", "#info", "#description", "#content").',
          '- Prefer words covered substantially throughout the answer over words mentioned once in passing.',
          '- Do not use an overly abstract or overly broad top category alone (e.g. "#history", "#technology") — allow it only when the body squarely addresses that itself.',
          '- Keep a compound word intact only when its meaning is valuable as a whole; if it can be split without losing meaning, keep only the core part.',
          '- Single noun-form tokens. No special characters, particles, or predicates.',
          '- For compounds that need spaces, connect with hyphens (e.g. "#machine-learning", "#Suwon-Hwaseong").',
          '- For English, use camelCase or hyphens (e.g. "#GenerativeAI", "#Next-JS").',
          '- Deduplicate tags that mean essentially the same thing (keep one representative).',
          '',
          'One-line summary guide:',
          '- Roughly 15-40 characters, the answer\'s core in one sentence (a trailing period is optional).',
          '',
          'Output format:',
          '- Output the JSON object only. No extra explanation, code fences, preamble, or conclusion.',
          '- Example: {"summary":"Background and significance of Jeongjo\'s Suwon Hwaseong construction","hashtags":["#Jeongjo","#SuwonHwaseong","#Joseon"]}',
        ].join('\n'),
      };
      const content = await this.llmComplete(
        [sys, { role: 'user', content: trimmed }],
        { model },
      );
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return empty;
      const parsed: unknown = JSON.parse(m[0]);
      if (!parsed || typeof parsed !== 'object') return empty;
      const obj = parsed as Record<string, unknown>;
      const tagsRaw = Array.isArray(obj.hashtags) ? obj.hashtags : [];
      const seen = new Set<string>();
      const tags: string[] = [];
      for (const s of tagsRaw) {
        if (typeof s !== 'string') continue;
        const trimmed = s.trim().replace(/\s+/g, '-');
        if (!trimmed) continue;
        const tag = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
        const key = tag.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push(tag);
        if (tags.length >= 6) break;
      }
      const summary =
        typeof obj.summary === 'string' ? obj.summary.trim().slice(0, 60) : '';
      return { hashtags: tags, summary };
    } catch {
      return empty;
    }
  }

  async summarize(
    messages: ChatMessage[],
    model?: string,
  ): Promise<string> {
    const sys: ChatMessage = {
      role: 'system',
      content: [
        'You are a research-note writer that organizes the conversation "by topic".',
        'Follow the procedure below exactly.',
        '',
        'Procedure',
        '1) Skim the whole conversation from start to finish and extract 2-5 main topics covered.',
        '   - Keep topics as short noun phrases (e.g. "Tavily search integration", "image card layout").',
        '   - Merge similar content into one topic; exclude meaningless chatter.',
        '2) Organize each extracted topic into its own section.',
        '3) After all topic sections, summarize decisions and next steps separately.',
        '',
        'Output format (use this markdown skeleton as-is)',
        '',
        '## One-line summary',
        'The overall purpose and conclusion of the conversation in one sentence.',
        '',
        '## Topic index',
        '- Topic 1 name',
        '- Topic 2 name',
        '- (more if needed)',
        '',
        '## 1. {Topic 1 name}',
        '- 4-8 items centered on **bold keywords**',
        '- Specifically: who asked what, and what answers/artifacts resulted',
        '- Quote code/commands briefly in ```lang ... ``` code blocks',
        '',
        '## 2. {Topic 2 name}',
        '- Same format',
        '',
        '(Repeat ## sections for as many topics as there are)',
        '',
        '## Decisions / results',
        '- Agreed or derived conclusions, and artifacts produced (files, features, keys)',
        '- If nothing was decided, write "No decisions yet"',
        '',
        '## Next steps',
        '- Follow-up work, points to confirm, open questions',
        '- Omit this whole section if there are none',
        '',
        'Rules',
        '- Write everything in the SAME language as the conversation (translate the section headings above into that language).',
        '- Preserve source/citation numbers [1], [2] as-is',
        '- No speculation, exaggeration, or content not present in the conversation',
        '- Do not duplicate the same content across multiple sections',
        '- Use the headings exactly as listed above (translated into the conversation language): One-line summary, Topic index, 1. …, Decisions / results, Next steps',
      ].join('\n'),
    };
    const trimmed = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role,
        content: m.content?.slice(0, 4000) ?? '',
      }));
    return this.llmComplete([sys, ...trimmed], {
      model: model || this.defaultModel,
      maxTokens: 4096,
    });
  }

  // 직전 요약과 새 답변 한 건을 합쳐 누적 요약을 스트리밍한다.
  // 청크가 올 때마다 yield 하여 클라이언트가 점진적으로 표시할 수 있게 한다.
  async *summarizeIncrementalStream(
    prevSummary: string,
    latestAnswer: string,
    model?: string,
    signal?: AbortSignal,
  ): AsyncGenerator<{ type: 'chunk'; text: string } | { type: 'done'; summary: string }> {
    const trimmedAnswer = (latestAnswer ?? '').slice(0, 6000).trim();
    if (!trimmedAnswer) {
      yield { type: 'done', summary: prevSummary };
      return;
    }

    const sys: ChatMessage = {
      role: 'system',
      content: [
        'You are a note writer that keeps a running summary of the conversation flow.',
        'You are given an [existing summary] and the [latest answer] as input.',
        'Integrate the two naturally into a short summary of the whole conversation flow.',
        '',
        'Rules',
        '- Write in the SAME language as the conversation',
        '- No markdown headings or titles; 1-2 short paragraphs, or 3-6 bullets',
        '- Do not omit newly introduced key facts, decisions, or artifacts',
        '- Do not re-write at length content already in the summary',
        '- No speculation, greetings, or meta-talk',
        '- Keep the total length under 800 characters',
      ].join('\n'),
    };
    const user: ChatMessage = {
      role: 'user',
      content: [
        '[Existing summary]',
        prevSummary?.trim() || '(none yet)',
        '',
        '[Latest answer]',
        trimmedAnswer,
        '',
        'Output only the new integrated summary.',
      ].join('\n'),
    };

    let acc = '';
    for await (const chunk of this.llmStreamContent([sys, user], {
      model: model || this.defaultModel,
      maxTokens: 2048,
      signal,
    })) {
      acc += chunk;
      yield { type: 'chunk', text: chunk };
    }
    yield { type: 'done', summary: acc.trim() };
  }

  private buildKeywordSearchSystemMessage(
    query: string,
    results: SearchResult[],
    indexOffset = 0,
  ): ChatMessage {
    const blocks = results
      .map(
        (r, i) =>
          `[${i + 1 + indexOffset}] ${r.title}\nURL: ${r.url}\n${(r.content ?? '').slice(0, this.searchPageCharLimit)}`,
      )
      .join('\n\n---\n\n');

    const content = [
      '**IMPORTANT — Language rule (highest priority): The app serves a global user base. Always reply in the exact same language the user used in their query. If English → English; Korean → Korean; and likewise for any other language.**',
      '',
      'You are a research assistant that integrates and cross-checks web search results to answer in depth.',
      '',
      '** IMPORTANT — The question you must answer is the LAST user message in the messages array. **',
      'Do not copy, repeat, or paraphrase your previous assistant answer. If the new question differs from the previous one, answer it fresh and independently.',
      'The conversation history is for context only; take factual grounding ONLY from the [Web search results] below.',
      '',
      `User question: "${query}"`,
      '',
      '[Web search results] (Tavily-based; each item is a summary/extract of the page text)',
      blocks,
      '',
      'Answer rules:',
      '1. In depth, in this order: conclusion → key evidence (cite search results with [N]) → supporting detail.',
      '2. Organize information that naturally fits a table (comparison, enumeration, specs, prices) as a markdown table.',
      '3. Attach source citations inline in the body in the form `[1]`, `[2]`.',
      '4. If the search results contradict each other, state in one line which to trust and why, then decide.',
      '5. Do not speculate about facts not present in the search results; mark them as "not confirmed in the search results".',
      '6. Never write thinking-process headers (e.g. `[생각 과정]`, `생각 과정`, `## 생각 과정`, `Thinking:`) in the user-visible body. Do all reasoning only in the model\'s internal thinking.',
      '7. No speculation, exaggeration, or facts beyond the results. Write at length, but every sentence must be grounded in the search results.',
    ].join('\n');

    return { role: 'system', content };
  }

  private buildDirectUrlSystemMessage(
    query: string,
    results: SearchResult[],
    indexOffset = 0,
  ): ChatMessage {
    const blocks = results
      .map(
        (r, i) =>
          `[${i + 1 + indexOffset}] ${r.title}\nURL: ${r.url}\n${r.content}`,
      )
      .join('\n\n---\n\n');

    const content = [
      '**IMPORTANT — Language rule (highest priority): The app serves a global user base. Always reply in the exact same language the user used in their query. If English → English; Korean → Korean; and likewise for any other language.**',
      '',
      'You are an assistant that integrates and cross-checks the text body of the web page(s) the user specified together with the image information analyzed by a vision model, to answer in depth.',
      '',
      '** IMPORTANT — The question you must answer is the LAST user message in the messages array. **',
      'Do not copy, repeat, or paraphrase your previous assistant answer. If the current question differs from the previous one, answer it fresh and independently of the previous answer.',
      'The conversation history is for context only; take the grounding for your answer ONLY from the [Page N] materials below.',
      '',
      'Input materials:',
      `- User question / request: "${query}"`,
      '- Each [Page N] section contains:',
      '  · the text body extracted from the page',
      '  · the result of a vision model analyzing each image attached to that page — a block marked `[Vision-model analysis of images attached to this page — …]`. Each line has the form `Image N [relevant|irrelevant] (URL): description`, and contains factual cues such as quoted prices, model names, labels, and figures.',
      '',
      blocks,
      '',
      'Answer rules (MUST follow):',
      '1. Restate the user\'s request in one line, then cover every piece of information needed to fulfill it. Do not stop at a short answer; elaborate as much as the page and images allow.',
      '2. You MUST integrate the text body and the image analysis. If the same fact appears in both, treat it as cross-verified and raise its confidence; if it appears in only one, note its origin in the body ("per the page text" / "per the image"), phrased in the user\'s language.',
      '3. Bring quoted details from the image analysis (prices, model names, labels, displayed text, dimensions) directly into the answer body. Do not merely summarize them.',
      '4. If the text and the images conflict, state in one line which is more trustworthy and why, then decide.',
      '5. Answer structure: (a) one conclusion/summary paragraph → (b) a detailed section that elaborates the key facts confirmed from the text/images with their grounding → (c) if there are comparisons, specs, options, or differences, organize them in a markdown table → (d) if something cannot be confirmed from the page, state it explicitly as "not confirmed on the page".',
      '6. Do not bring in web search, outside knowledge, general common sense, or speculation. Answer strictly from the provided [Page N] materials.',
      '7. Actively use image analyses marked `[relevant]`. Do not cite ones marked `[irrelevant]` in the answer (though you may mention them briefly for contradiction-checking).',
      '8. Never write thinking-process headers in the user-visible body, e.g. "[생각 과정]", "생각 과정", "## 생각 과정", "**생각 과정**", "분석:", "사고 과정", "Thinking:". Do all reasoning only in the model\'s internal thinking step and start the body directly with the answer.',
      '9. No speculation, exaggeration, or facts beyond the materials. Write at length, but every sentence must be grounded in the page text or the image analysis.',
    ].join('\n');

    return { role: 'system', content };
  }


  // 페르소나 — 모든 답변 생성 경로(검색/URL/기본/비전)에 공통 주입.
  // 정체성 설정이며, 언어 규칙·자료 근거 규칙을 위반하지 않는 선에서 적용한다.
  private readonly personaSystemPrompt: ChatMessage = {
    role: 'system',
    content: [
      'Your identity (persona):',
      '- Your name is "Stella". When the user asks your name, answer "Stella".',
      '- When asked where you live or where you belong, say you live in "Thread House".',
      '- Your role is to organize the knowledge the user needs into well-structured documents.',
      '- This app serves a GLOBAL user base. Treat the language of the user\'s latest message as their preferred language, and optimize every answer for it: reply in that language and adapt tone, examples, units, and naming conventions to it.',
      '- Whenever web search is involved, prioritize search queries and sources in the user\'s own language and region so the results are most relevant to them. You may also consult sources in other languages when they add real value, but always present the final synthesis in the user\'s language.',
      '- Keep this identity consistent, but apply it without violating the language rule and the source-grounding rules below.',
    ].join('\n'),
  };

  private readonly defaultSystemPrompt: ChatMessage = {
    role: 'system',
    content: [
      '**IMPORTANT — Language rule (highest priority): The app serves a global user base. Always reply in the exact same language the user used in their most recent message. If the user writes in English → reply in English; Korean → Korean; Japanese → Japanese; and likewise for any other language. Never switch languages unless the user explicitly requests it.**',
      '',
      'You are a helpful assistant.',
      '',
      '** IMPORTANT — The question you must answer is the LAST user message in the messages array. **',
      'Do not copy, repeat, or merely paraphrase your previous assistant answer. If the current question differs from the previous one, answer the current question fresh and independently.',
      '',
      'Answer formatting guide:',
      '- When you compare, enumerate, or classify two or more items, or organize attributes/specs, actively use markdown tables so the information can be scanned at a glance.',
      '  e.g. "list of presidents", "feature comparison", "changes by version", "pros and cons", "example input → output", etc.',
      '',
      '*** Markdown table rules (MUST follow) ***',
      '1. After each row (the closing `|`), always insert a newline (\\n) and start the next row on a new line. Never concatenate the header, delimiter, and body rows onto a single line.',
      '2. The alignment delimiter row must be exactly `|---|---|...|` or `| :--- | :--- |` / `| :---: | ---: |`. Never let a slash (`/`) slip in, as in `:---/`, `---/`, `:--/`, `-/-`, ` :---:/`, and never insert any word (e.g. "ability", "able") into it.',
      '3. Put exactly one blank line before the table starts and one after it ends. Do not put blank lines inside the table body.',
      '4. Every row must have exactly the same number of `|` column separators (N headers → N in the delimiter → N in each body row).',
      '5. If a cell needs a line break, use `<br>` (never a literal newline). Escape a literal `|` inside a cell as `\\|`.',
      '6. Correct example:',
      '   ',
      '   | Name | Description |',
      '   | :--- | :--- |',
      '   | A | Description 1 |',
      '   | B | Description 2 |',
      '   ',
      '7. Wrong example 1 — everything on one line: `| Name | Description | | :--- | :--- | | A | ... |`  ← never do this',
      '8. Wrong example 2 — slash in the delimiter: `| :---/ | :---/ |`  ← never (remove the `/`)',
      '9. Wrong example 3 — column count mismatch: 5 headers but 4 delimiters  ← never',
      '10. If you are unsure about any of these rules, write the items as a bullet list (`-`) instead of a table. A clean bullet list is better than a broken table.',
      '',
      '- If there are 6 or more items, or 2 or more attributes, prefer a table over bullets.',
      '- For a simple one-line answer or a flowing explanation, use natural sentences or short bullets instead of a table.',
      '- For items where order, steps, or priority matter (procedures, methodologies, recommended order, rankings, chronological order), actively use a numbered (ordered) markdown list `1.`, `2.`, `3.`. If order is meaningless, keep `-` bullets.',
      '- Use language-tagged ``` code blocks for code/commands.',
      '- Keep source citation numbers such as [1], [2] inline in the body as-is.',
      '- No speculation or exaggeration.',
    ].join('\n'),
  };

  // 메시지의 images 가 URL/path 형식이면 디스크에서 읽어 base64 로 환원.
  // base64 (data URL prefix 유무 무관) 는 그대로 둔다 (OpenAI 호환 표준).
  private resolveMessageImages(messages: ChatMessage[]): ChatMessage[] {
    return messages.map((m) => {
      if (!m.images || m.images.length === 0) return m;
      const resolved: string[] = [];
      for (const s of m.images) {
        if (!s) continue;
        // 이미 base64 / data URL 형식이면 prefix 떼서 전달.
        if (s.startsWith('data:')) {
          const i = s.indexOf(',');
          if (i >= 0) resolved.push(s.slice(i + 1));
          continue;
        }
        // 우리 backend 의 attachments URL — pathname 에서 messageId/fileName 추출 후 디스크 읽음.
        const pathMatch = /\/attachments\/([^/]+)\/([^/?#]+)/.exec(s);
        if (pathMatch) {
          const [, mid, fname] = pathMatch;
          const dataUrl = this.attachments.readAsDataUrl(
            mid,
            decodeURIComponent(fname),
          );
          if (dataUrl) {
            const i = dataUrl.indexOf(',');
            if (i >= 0) resolved.push(dataUrl.slice(i + 1));
          }
          continue;
        }
        // 그 외 — base64 로 추정.
        resolved.push(s);
      }
      return { ...m, images: resolved };
    });
  }

  async *streamChat(
    messages: ChatMessage[],
    options: {
      model?: string;
      visionModel?: string;
      useVision?: boolean;
      // 사용자 설정 AI base URL (없으면 env 기본값).
      endpoint?: string;
      // 클라이언트가 연결을 끊거나 Stop 버튼을 누르면 abort.
      signal?: AbortSignal;
      // Settings 의 User Name 값. AuthService 캐시에서 미리 조회해 넘김.
      // 비어있으면 (null) AI 에 이름 안내 주입 안 함.
      userName?: string | null;
      // 대화 모드 — thread 모드에서는 사용자 이름을 AI 에 알리지 않음.
      kind?: 'chat' | 'thread';
      // 클라이언트 설정값 — 없으면 서버 기본값(SEARCH_TOP_READ env) 사용.
      tavilyTopRead?: number;
      // 상태 메시지 다국어 표시용 — 없으면 'ko' 폴백.
      locale?: string;
    } = {},
  ): AsyncGenerator<StreamPart> {
    const m = statusMsg(options.locale);

    // URL/path 형식의 images 는 base64 로 환원해 모델에 전달.
    // resolvedMessages 에 저장해 두고 URL/검색 augment 경로에서도 재사용 — 이미지 미변환 버그 방지.
    const resolvedMessages = this.resolveMessageImages(messages);
    let augmented = resolvedMessages;
    let augmentedByUrl = false;
    let augmentedBySearch = false;

    // 메시지 안의 URL은 자동 감지하여 페이지 내용을 읽고 답변에 활용.
    const lastUserAuto = [...messages].reverse().find((u) => u.role === 'user');
    // 비전은 '현재 메시지에 명시적으로 첨부한 이미지'에만 동작한다.
    // (과거 history 이미지·웹 검색 이미지는 비전 대상이 아니며, 아래에서 답변 모델 payload 의
    //  image_url 도 제거 → 비전 미지원 모델이 과거 이미지로 거부하는 문제 방지.)
    const lastUserHasImages = (lastUserAuto?.images?.length ?? 0) > 0;
    const lastUserImageCount = lastUserAuto?.images?.length ?? 0;
    // 첨부 이미지가 있어도 URL/Search 모드는 함께 발동 가능 — 인용 번호는 통합 정렬.
    const autoDirectUrls = lastUserAuto?.content
      ? extractUrlsFromText(lastUserAuto.content)
      : [];

    if (autoDirectUrls.length > 0) {
      const lastUser = lastUserAuto;
      if (lastUser?.content) {
        const directUrls = autoDirectUrls;
        try {
          yield {
            type: 'status',
            text: m.urlDetect(directUrls.length),
          };
          const directResults: SearchResult[] = [];
          const pageEvents: {
            url: string;
            title?: string;
            chars: number;
            ok: boolean;
            // 추출에 사용된 경로 — frontend Reference documents 에서 출처 표시.
            source?: 'fetch' | 'tavily';
            images?: {
              src: string;
              alt?: string;
              kind?: 'image' | 'youtube' | 'x';
              linkUrl?: string;
              analyzing?: boolean;
            }[];
          }[] = [];
          // URL 직접 모드는 보통 1~2개 URL만 들어오므로 순차 처리하면서
          // 진행 상황을 status로 흘려준다 (Tavily 폴백 등 시간이 걸리는 단계 표시용).
          for (const u of directUrls) {
            let p: PageExtractResult | null = null;
            try {
              // 추출 경로 추적 — Reference documents 메타에 source 로 기록.
              let extractSource: 'fetch' | 'tavily' = 'fetch';
              for await (const ev of this.pageService.extractWithProgress(u)) {
                if (ev.type === 'stage') {
                  if (ev.stage === 'tavily') {
                    extractSource = 'tavily';
                    yield {
                      type: 'status',
                      text: m.botBlocked,
                    };
                  }
                } else if (ev.type === 'result') {
                  p = ev.result;
                }
              }
              if (!p) throw new Error('페이지 추출 결과 없음');
              const text = p.text.slice(0, this.directReadCharLimit);
              directResults.push({
                title: p.title || u,
                url: p.finalUrl || u,
                content: text,
                subQuery: '(direct URL)',
              });
              const imgs = filterPageImages(p.images);
              pageEvents.push({
                url: p.finalUrl || u,
                title: p.title,
                chars: text.length,
                ok: true,
                source: extractSource,
                images: imgs.length > 0 ? imgs : undefined,
              });
            } catch (e) {
              this.logger.warn(
                `URL 직접 읽기 실패: ${u} (${e instanceof Error ? e.message : ''})`,
              );
              pageEvents.push({ url: u, chars: 0, ok: false });
            }
          }

          if (directResults.length > 0) {
            yield {
              type: 'search',
              results: directResults.map((r) => ({
                title: r.title,
                url: r.url,
              })),
              images: [],
            };
            yield { type: 'pages', pages: pageEvents };

            // ====== 첨부 이미지 비전 분석 (useVision 활성화 시에만) ======
            const imageAnalysisByPage = new Map<
              string,
              { src: string; alt?: string; relevant: boolean; description: string }[]
            >();
            type AnalysisJob = {
              pageUrl: string;
              pageTitle: string;
              src: string;
              alt?: string;
            };
            const allJobs: AnalysisJob[] = [];
            if (options.useVision) {
              for (const pe of pageEvents) {
                if (!pe.ok || !pe.images || pe.images.length === 0) continue;
                const candidates = pe.images
                  .filter(
                    (i) =>
                      (i.kind ?? 'image') === 'image' &&
                      /^https?:\/\//i.test(i.src),
                  )
                  .slice(0, this.imageAnalyzeBudget);
                for (const img of candidates) {
                  allJobs.push({
                    pageUrl: pe.url,
                    pageTitle: pe.title || pe.url,
                    src: img.src,
                    alt: img.alt,
                  });
                }
              }
            }
            if (allJobs.length > 0) {
              // 시작 이벤트는 즉시 모두 emit
              for (const job of allJobs) {
                yield {
                  type: 'image_analyzing_start',
                  pageUrl: job.pageUrl,
                  src: job.src,
                };
              }
              // 모든 분석을 병렬로 시작하되, 완료되는 순서대로 결과 이벤트 emit.
              const inflight = allJobs.map(async (job) => {
                try {
                  const [result] = await this.pageService.analyzeImagesByTitle(
                    job.pageTitle,
                    [{ src: job.src, alt: job.alt }],
                    options.visionModel,
                  );
                  return { job, result };
                } catch (e) {
                  this.logger.warn(
                    `이미지 분석 실패: ${job.pageUrl} ${job.src} (${e instanceof Error ? e.message : ''})`,
                  );
                  return {
                    job,
                    result: {
                      src: job.src,
                      relevant: false,
                      description: '',
                    },
                  };
                }
              });
              // race-first 순서로 yield 하기 위해 each promise를 추적.
              const settled = await Promise.all(
                inflight.map((p) => p.then((v) => v).catch(() => null)),
              );
              for (const s of settled) {
                if (!s || !s.result) continue;
                yield {
                  type: 'image_analysis',
                  pageUrl: s.job.pageUrl,
                  analyses: [s.result],
                };
                const arr = imageAnalysisByPage.get(s.job.pageUrl) ?? [];
                arr.push(s.result);
                imageAnalysisByPage.set(s.job.pageUrl, arr);
              }
            }
            // LLM 컨텍스트 보강 (모든 분석 끝난 후)
            for (const [pageUrl, analyses] of imageAnalysisByPage) {
              const target = directResults.find((r) => r.url === pageUrl);
              if (target) {
                const lines = [...analyses]
                  .filter((a) => a.description)
                  .sort(
                    (a, b) => (b.relevant ? 1 : 0) - (a.relevant ? 1 : 0),
                  )
                  .map(
                    (a, i) =>
                      `Image ${i + 1} [${a.relevant ? 'relevant' : 'irrelevant'}] (${a.src}): ${a.description}`,
                  )
                  .join('\n');
                if (lines) {
                  target.content =
                    `${target.content}\n\n[Vision-model analysis of images attached to this page — use it actively in your answer]\n${lines}`;
                }
              }
            }

            augmented = [
              this.buildDirectUrlSystemMessage(
                lastUser.content,
                directResults,
                lastUserImageCount,
              ),
              ...resolvedMessages,
            ];
            augmentedByUrl = true;
          } else {
            yield {
              type: 'pages',
              pages: pageEvents,
            };
            yield {
              type: 'status',
              text: m.urlAllFailed,
            };
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : 'URL error';
          this.logger.warn(`URL 처리 실패: ${msg}`);
          yield { type: 'status', text: m.urlError(msg) };
        }
      }
    }

    // ====== Tavily 키워드 검색 모드 ======
    // URL 없음 + 검색 의도 키워드 감지 + Tavily 키 있을 때만 발동.
    // 첨부 이미지가 있으면 기본 행동은 비전 분석 → "검색해/찾아봐/search for" 같은 명시적
    // 요청이 있을 때만 Tavily 가 추가로 발동 (이미지가 단서일 뿐, 일반 의문문에 반응 안 함).
    const tavilyKeyForSearch = await this.getTavilyKey();
    const shouldRunSearch = lastUserAuto?.content
      ? lastUserHasImages
        ? looksLikeExplicitSearchRequest(lastUserAuto.content)
        : looksLikeSearchIntent(lastUserAuto.content)
      : false;
    if (
      !augmentedByUrl &&
      autoDirectUrls.length === 0 &&
      tavilyKeyForSearch &&
      shouldRunSearch &&
      lastUserAuto?.content
    ) {
      // 사용자 메시지 그대로 검색하면 대명사·맥락 손실로 엉뚱한 결과가 나옴.
      // LLM 으로 대화 맥락을 반영한 1~2개 쿼리로 재작성. 실패하면 원문으로 폴백.
      yield { type: 'status', text: m.analyzing };
      this.logger.log(
        `[search] raw user message: "${lastUserAuto.content.slice(0, 200)}"`,
      );
      const reformulated = await this.reformulateSearchQueries(
        lastUserAuto.content,
        messages,
        options.model,
        options.signal,
      );
      // 검색 의도 분석 중 Stop/연결 끊김 → Tavily 검색·페이지 읽기로 더 진행하지 말고 즉시 종료.
      if (options.signal?.aborted) return;
      this.logger.log(
        `[search] reformulated: ${JSON.stringify(reformulated)}`,
      );
      // AI 판단: 자신이 아는 질문이면 검색을 건너뛰고 지식 기반으로 답한다.
      // (실시간/최신/모르는 정보가 필요하다고 판단할 때만 검색 — needsSearch)
      // 단, 사용자가 "검색해/찾아봐/search for" 처럼 '명시적으로' 검색을 요청하면 무조건 검색.
      const explicitSearch = looksLikeExplicitSearchRequest(
        lastUserAuto.content,
      );
      if (!reformulated.needsSearch && !explicitSearch) {
        this.logger.log(
          '[search] LLM 판단: 검색 불필요 → 지식 기반으로 답변',
        );
      } else {
      const queries =
        reformulated.queries.length > 0
          ? reformulated.queries
          : [lastUserAuto.content.trim()];
      const inferredTimeRange = reformulated.timeRange;
      // 검색 국가 = 재작성이 추론한 country 우선, 없으면 사용자 발화 언어로 결정.
      // → 발화 언어권(예: 한국어→한국) 웹을 우선 검색.
      const langCountry = detectSearchCountry(
        lastUserAuto.content,
        options.locale,
      );
      const inferredCountry = reformulated.country ?? langCountry;
      // Tavily 'news' 토픽은 영어권 매체 위주라 비영어권 질의에서 외국 기사가 나온다.
      // 비영어권 발화(langCountry 존재)는 news 여도 general 로 검색해 현지 기사를 받는다.
      // (country + time_range 는 유지 → 최신성·현지성 모두 확보)
      let inferredTopic = reformulated.topic;
      if (inferredTopic === 'news' && langCountry) {
        inferredTopic = 'general';
      }
      this.logger.log(
        `[search] final to Tavily: queries=${JSON.stringify(queries)}, topic=${inferredTopic}, country=${inferredCountry}, timeRange=${inferredTimeRange}`,
      );

      try {
        yield {
          type: 'status',
          text:
            queries.length > 1
              ? m.searchingMulti(
                  queries.length,
                  queries.map((q) => `"${q.slice(0, 30)}"`).join(', '),
                )
              : m.searchingSingle(
                  `${queries[0].slice(0, 40)}${queries[0].length > 40 ? '…' : ''}`,
                ),
        };

        // 다중 쿼리 시 결과를 모아 URL 기준으로 dedup. 각 쿼리 sources 는 N으로 분할.
        // 클라이언트 설정값 우선, 없으면 서버 기본값.
        const effectiveTopRead =
          options.tavilyTopRead != null &&
          Number.isFinite(options.tavilyTopRead) &&
          options.tavilyTopRead >= 1
            ? options.tavilyTopRead
            : this.searchTopRead;
        this.logger.log(
          `[search] tavilyTopRead: client=${options.tavilyTopRead ?? 'none'}, server default=${this.searchTopRead}, effective=${effectiveTopRead}`,
        );
        // dedup 손실 보완: 목표 N개를 안정적으로 확보하려면 각 쿼리에서 여유분 있게 가져와야 함.
        // 단일 쿼리면 1.5배, 복수 쿼리면 쿼리 수 × 1.5 / queries.length 로 분배.
        const sourcesPerQuery = Math.min(
          20,
          Math.max(2, Math.ceil((effectiveTopRead * 1.5) / queries.length)),
        );
        this.logger.log(
          `[search] queries=${queries.length}, sourcesPerQuery=${sourcesPerQuery}, effectiveTopRead=${effectiveTopRead}`,
        );
        const seenUrls = new Set<string>();
        const aggResults: SearchResult[] = [];
        const aggImages: SearchImage[] = [];
        for (const q of queries) {
          const r = await this.searchWeb(q, {
            sources: sourcesPerQuery,
            topic: inferredTopic,
            country: inferredCountry,
            timeRange: inferredTimeRange,
          });
          for (const row of r.results) {
            if (seenUrls.has(row.url)) continue;
            seenUrls.add(row.url);
            aggResults.push(row);
          }
          for (const img of r.images) {
            aggImages.push(img);
          }
        }
        // 버퍼로 더 많이 가져온 결과를 effectiveTopRead 개로 먼저 자름.
        // search 이벤트와 페이지 추출 모두 동일한 상위 N개를 사용.
        const results = aggResults.slice(0, effectiveTopRead);
        const images = aggImages;
        if (results.length === 0) {
          yield { type: 'status', text: m.noResults };
        } else {
          yield {
            type: 'search',
            results: results.map((r) => ({ title: r.title, url: r.url })),
            images: images.slice(0, 16),
          };

          // 상위 N개 페이지 본문 추출 (fetch + Tavily 폴백)
          const topToRead = results;
          const pageEvents: {
            url: string;
            title?: string;
            chars: number;
            ok: boolean;
            images?: {
              src: string;
              alt?: string;
              kind?: 'image' | 'youtube' | 'x';
              linkUrl?: string;
              analyzing?: boolean;
            }[];
          }[] = [];
          yield {
            type: 'status',
            text: m.extractingPages(topToRead.length),
          };
          for (const r of topToRead) {
            try {
              // Tavily extract fallback skip — 검색 결과 경로에서 extract API hang 방지.
              // 페이지당 5초 타임아웃: 초과 시 ok:false + 실시간 취소선 이벤트 전송.
              type Outcome =
                | { timedOut: true }
                | { timedOut: false; result: PageExtractResult | null };
              const outcome = await Promise.race<Outcome>([
                (async (): Promise<Outcome> => {
                  let result: PageExtractResult | null = null;
                  for await (const ev of this.pageService.extractWithProgress(
                    r.url,
                    undefined,
                    { skipTavilyFallback: true },
                  )) {
                    if (ev.type === 'result') result = ev.result;
                  }
                  return { timedOut: false, result };
                })(),
                new Promise<Outcome>((resolve) =>
                  setTimeout(() => resolve({ timedOut: true }), 5_000),
                ),
              ]);
              if (outcome.timedOut) {
                this.logger.warn(`페이지 추출 타임아웃: ${r.url}`);
                // 인스타/X: 깊은 추출이 타임아웃이어도 Tavily 검색 스니펫이 있으면
                // "차단"으로 버리지 않고 그 스니펫(r.content)을 본문으로 사용.
                if (isJsBlockedSocialUrl(r.url) && r.content.trim().length > 0) {
                  pageEvents.push({
                    url: r.url,
                    title: r.title,
                    chars: r.content.length,
                    ok: true,
                  });
                } else {
                  yield { type: 'page_timeout', url: r.url };
                  pageEvents.push({ url: r.url, title: r.title, chars: 0, ok: false });
                }
                continue;
              }
              const p = outcome.result;
              if (p && p.text) {
                r.content = p.text.slice(0, this.searchPageCharLimit);
                const imgs = filterPageImages(p.images);
                pageEvents.push({
                  url: r.url,
                  title: p.title ?? r.title,
                  chars: r.content.length,
                  ok: true,
                  images: imgs.length > 0 ? imgs : undefined,
                });
              } else if (
                isJsBlockedSocialUrl(r.url) &&
                r.content.trim().length > 0
              ) {
                // 인스타/X: embed fetch 가 비어(봇 차단) 추출이 실패해도,
                // Tavily 검색이 이미 준 content 스니펫을 본문으로 사용 (차단 표시 대신).
                pageEvents.push({
                  url: r.url,
                  title: p?.title ?? r.title,
                  chars: r.content.length,
                  ok: true,
                });
              } else {
                pageEvents.push({
                  url: r.url,
                  title: r.title,
                  chars: 0,
                  ok: false,
                });
              }
            } catch (e) {
              this.logger.warn(
                `검색 결과 추출 실패: ${r.url} (${e instanceof Error ? e.message : ''})`,
              );
              // 인스타/X: 추출 예외여도 Tavily 검색 스니펫이 있으면 본문으로 사용.
              if (isJsBlockedSocialUrl(r.url) && r.content.trim().length > 0) {
                pageEvents.push({
                  url: r.url,
                  title: r.title,
                  chars: r.content.length,
                  ok: true,
                });
              } else {
                pageEvents.push({
                  url: r.url,
                  title: r.title,
                  chars: 0,
                  ok: false,
                });
              }
            }
          }
          yield { type: 'pages', pages: pageEvents };

          // AI 에게는 UI 에 노출되는 readPages 와 같은 상위 N건만 전달 — 인용 번호와
          // References 패널이 1:1 정렬되도록. 그 이상의 검색결과는 본문에 인용해도
          // 사용자가 검증할 수 없으므로 제거.
          // 첨부 이미지가 있는 경우 검색결과 번호는 (이미지 수 + 1) 부터 시작 — 통합 인용 번호.
          augmented = [
            this.buildKeywordSearchSystemMessage(
              queries.join(' / '),
              topToRead,
              lastUserImageCount,
            ),
            ...resolvedMessages,
          ];
          augmentedBySearch = true;
        }
      } catch (e) {
        // Tavily 키 만료/한도/네트워크 장애 등 — 검색은 포기하되 일반 응답 흐름은 그대로 진행.
        const msg = e instanceof Error ? e.message : '알 수 없음';
        this.logger.warn(`Tavily 검색 실패 (검색 없이 계속 진행): ${msg}`);
        yield {
          type: 'status',
          text: m.tavilyUnavailable,
        };
      }
      } // end of: reformulated.needsSearch (검색 실행) else 블록
    } // end of: shouldRunSearch 검색 블록

    // URL 직접 모드/검색 모드에서 system message 를 성공적으로 prepend 했는지 플래그로 추적.
    // (augmented 는 resolveMessageImages 로 항상 새 배열이라 reference 비교 불가)
    // Tavily 실패 등으로 augmentation 이 안 됐으면 기본 system prompt 를 적용.
    let finalMessages =
      augmentedByUrl || augmentedBySearch
        ? augmented
        : [this.defaultSystemPrompt, ...augmented];
    // 페르소나(Stella) 를 모든 모드의 맨 앞 system 메시지로 주입.
    finalMessages = [this.personaSystemPrompt, ...finalMessages];

    // Chat 모드일 때만 사용자 이름 안내 주입 — Thread 모드에서는 이름을 전혀 알리지 않음.
    if (options.kind !== 'thread' && options.userName && options.userName.trim().length > 0) {
      const safeName = options.userName.trim().slice(0, 64);
      const userInfoPrompt: ChatMessage = {
        role: 'system',
        content: [
          `The user you are talking to is named "${safeName}".`,
          `- You may address them by name once or twice where it feels natural (e.g. "${safeName}, ..."), in the user's own language.`,
          '- Do not repeat their name in every sentence or insert it awkwardly.',
          '- If the user explicitly asks to be addressed differently, prefer that.',
        ].join('\n'),
      };
      finalMessages = [userInfoPrompt, ...finalMessages];
    }

    // Thread 모드 — 답변을 '대화'가 아니라 '독립된 문서'로 작성하도록 강제(지시는 영어로 주입).
    // (인사말/자기소개/후속질문 유도 등 대화체 요소를 제거. Opus 등 일부 모델의
    //  기본 대화체·맺음말 성향을 억제하기 위함.)
    if (options.kind === 'thread') {
      const threadDocPrompt: ChatMessage = {
        role: 'system',
        content: [
          'Thread mode — Write the answer as a standalone DOCUMENT / encyclopedia-style entry, NOT a chat message (still obey the language rule above):',
          '- No greetings or self-introduction: do not open with phrases like "Hello", "I\'m Stella", or "Let me tell you about ~".',
          '- No closing remarks or follow-up solicitation: do not end with "I hope this helps", "Feel free to ask if you have more questions", or "Would you like to know more?".',
          '- No conversational or meta language: do not address or refer to the user or yourself ("you", "we", "I"), and do not narrate your answering process.',
          '- Start directly with the substantive content (heading, table, paragraph) and write objectively and descriptively, like a reference document or wiki article.',
          '- Keep the persona (Stella) hidden in the body; only state the name if the user explicitly asks for it.',
        ].join('\n'),
      };
      finalMessages = [threadDocPrompt, ...finalMessages];
    }

    // 사용자가 이미지를 첨부한 경우 비전 인용 규칙을 추가 system 메시지로 주입.
    // 통합 인용 번호: 첨부 이미지가 [1]..[M], 웹 검색결과는 [M+1]..[M+N] 으로 이어짐.
    if (lastUserHasImages) {
      const imageCount = lastUserImageCount;
      const visionCitePrompt: ChatMessage = {
        role: 'system',
        content: [
          `The user attached ${imageCount} image(s). They are included in the last user message of the messages array,`,
          'numbered [1], [2], ... in attachment order.',
          'If web search results or page materials are also provided, those are referenced with numbers continuing from [' +
            (imageCount + 1) +
            '] onward (a single, unified numbering scheme).',
          '',
          'Answer rules:',
          '1. When you describe or compare the attached images, you MUST include inline citation numbers in the body in the form `[1]`, `[2]`, ...',
          '2. When citing both web/page materials and attached images, use the same `[N]` form — one unified numbering scheme.',
          '3. If one sentence draws on multiple sources, group them like `[1, 3]`.',
          '4. Citation numbers follow the unified order and are used only inline in the body (do not write a separate source list).',
        ].join('\n'),
      };
      finalMessages = [visionCitePrompt, ...finalMessages];
    }

    // 비전 동작 조건: '현재(마지막) user 메시지에 명시적으로 첨부한 이미지'가 있을 때만.
    // payload 에서 image_url 은 그 현재 첨부 이미지에만 남기고, 과거 history 이미지·웹 검색
    // 이미지는 모두 제거한다 → 텍스트 답변/검색 답변이 비전 미지원 모델에서도 정상 동작.
    {
      let lastUserIdx = -1;
      for (let i = finalMessages.length - 1; i >= 0; i--) {
        if (finalMessages[i].role === 'user') {
          lastUserIdx = i;
          break;
        }
      }
      finalMessages = finalMessages.map((mm, i) => {
        const keep = lastUserHasImages && i === lastUserIdx;
        if (keep || !mm.images || mm.images.length === 0) return mm;
        return { ...mm, images: undefined };
      });
    }

    // 모델 전송은 공급자(LlmProvider)에 위임 — ChatService 는 메시지 구성/인용/저장만 담당.
    // 검색/URL 모드에서는 컨텍스트가 커서 thinking 에 토큰을 많이 소비하므로 상한을 높임.
    // 현재 메시지에 첨부 이미지가 있을 때만 Vision 그룹(endpoint/apiKey/model)으로 답변 생성.
    const groups = await this.loadAiGroups();
    const useVisionGroup = lastUserHasImages;
    const group = useVisionGroup ? groups.vision : groups.reasoning;
    const endpoint = this.resolveGroupEndpoint(group, options.endpoint);
    let chatModel: string;
    if (useVisionGroup) {
      // 옵션 visionModel 우선 → Vision 그룹 model → Reasoning 그룹 model → env 기본값.
      chatModel =
        options.visionModel?.trim() ||
        group.model ||
        options.model ||
        groups.reasoning.model ||
        this.defaultModel;
      this.logger.log(
        `[stream] 첨부 이미지 감지 → Vision 설정으로 전환: ${chatModel}`,
      );
    } else {
      chatModel = options.model || group.model || this.defaultModel;
    }
    // 출력 토큰 상한 — 사용 그룹의 Settings 값 우선, 없으면 기본값(웹/일반 구분 없음).
    const maxTokens = group.maxTokens || this.maxOutputTokens;
    const apiKey = group.apiKey;
    // 공급자 에러는 가공/치환하지 않고 원문 그대로 전파(표준 포맷이 아니므로 분기 무의미).
    yield* this.llm.provider.streamChat({
      endpoint,
      model: chatModel,
      messages: finalMessages,
      signal: options.signal,
      maxTokens,
      apiKey,
    });
  }
}
