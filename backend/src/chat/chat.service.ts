import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AttachmentsService } from '../attachments/attachments.service';
import { SystemConfig } from '../db/entities/system-config.entity';
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

// 공급자(OpenAI 호환 런타임)가 컨텍스트 한도 초과를 알리는 다양한 문구를 포괄 감지.
// LM Studio: "tokens to keep from the initial prompt is greater than the context length"
// OpenAI/vLLM: "maximum context length", "context_length_exceeded" 등.
const CONTEXT_OVERFLOW_RE =
  /context[\s_-]?(?:length|window|size)|maximum context|context_length_exceeded|tokens to keep|too (?:long|many tokens)|exceeds? the (?:model'?s )?(?:maximum|context)/i;

// AI 공급자 설정 오류 — 잘못된 endpoint(base URL)/API 키/호스트로 인한 실패.
//   - HTTP 401/403/404 (인증 실패·잘못된 경로)
//   - 연결 실패(ECONNREFUSED/ENOTFOUND/getaddrinfo/fetch failed 등 — 호스트 오타)
// 사용자에게 원문 대신 "Settings 에서 AI 설정을 고치라"는 다국어 안내로 치환한다.
const AI_CONFIG_ERROR_RE =
  /\b(?:401|403|404)\b|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|getaddrinfo|fetch failed|ETIMEDOUT|ECONNRESET|unauthorized|forbidden|invalid api key|incorrect api key|invalid_api_key|page not found/i;

// 비전 미지원 모델에 이미지를 보냈을 때의 공급자 오류 — Settings 에서 비전 모델로
// 바꾸라는 다국어 안내로 치환한다. (예: "does not support image inputs")
const VISION_UNSUPPORTED_RE =
  /not support image|does not support (?:image|vision|multimodal)|image input[s]?\b.{0,24}(?:not support|unsupported)|no vision support|not a vision model|does not support image inputs/i;

// 선택한 모델이 서버에 없을 때의 공급자 오류 — Settings 에서 유효한 모델로 바꾸라는 안내.
// (예: "Invalid model identifier ...", code "model_not_found")
const MODEL_NOT_FOUND_RE =
  /model_not_found|invalid model|model not found|unknown model|no such model|specify a valid.{0,20}model|model.{0,20}does not exist|model.{0,20}is not (?:available|found)/i;

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
  private readonly defaultModel = process.env.AI_DEFAULT_MODEL ?? 'gemma4:26b';

  // AI Endpoint — system_config 'ai' row 의 endpoint 가 단일 진실 출처.
  // env 폴백 없음. 미설정 시 throw — 호출 측이 사용자에게 Settings 안내.
  private async getAiEndpoint(): Promise<string> {
    const row = await this.systemConfigs.findOne({
      where: { key: 'ai' },
    });
    const v = (row?.value as { endpoint?: string } | undefined)?.endpoint;
    if (!v || !v.trim()) {
      throw new Error(
        'AI Endpoint 가 설정되지 않았습니다. Settings > AI 에서 입력하세요.',
      );
    }
    return v.trim().replace(/\/$/, '');
  }

  // Reasoning 모델 — system_config 'ai' row 의 reasoningModel 이 전역 기본값.
  // 요청에 model 이 지정되면 그게 우선, 없으면 admin 설정 → env(AI_DEFAULT_MODEL) 순.
  private async getReasoningModel(): Promise<string> {
    try {
      const row = await this.systemConfigs.findOne({ where: { key: 'ai' } });
      const v = (row?.value as { reasoningModel?: string } | undefined)
        ?.reasoningModel;
      if (v && v.trim()) return v.trim();
    } catch {
      // ignore — env 기본값으로 폴백
    }
    return this.defaultModel;
  }

  // Vision 모델 — system_config 'ai' row 의 visionModel 이 전역 기본값.
  // 첨부 이미지가 있는 답변 생성 시 사용. 미설정이면 빈 문자열(호출 측이 폴백 결정).
  private async getVisionModel(): Promise<string> {
    try {
      const row = await this.systemConfigs.findOne({ where: { key: 'ai' } });
      const v = (row?.value as { visionModel?: string } | undefined)
        ?.visionModel;
      if (v && v.trim()) return v.trim();
    } catch {
      // ignore
    }
    return '';
  }

  // OpenAI 호환 API 키 — system_config 'ai' row. 로컬 서버는 비어있을 수 있음.
  private async getApiKey(): Promise<string | undefined> {
    try {
      const row = await this.systemConfigs.findOne({ where: { key: 'ai' } });
      const v = (row?.value as { apiKey?: string } | undefined)?.apiKey;
      return v?.trim() || undefined;
    } catch {
      return undefined;
    }
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

  // 호출별로 endpoint 가 명시되면 그 값을 우선 사용. 아니면 DB 의 'ai' row.
  private async resolveEndpoint(endpoint?: string): Promise<string> {
    const e = (endpoint ?? '').trim();
    if (e && /^https?:\/\//i.test(e)) return e.replace(/\/$/, '');
    return this.getAiEndpoint();
  }

  async listModels(endpoint?: string): Promise<ModelInfo[]> {
    // endpoint 미지정 + DB 에도 없으면 빈 배열 반환 (healthcheck/초기화 호환).
    let url: string;
    try {
      url = await this.resolveEndpoint(endpoint);
    } catch {
      return [];
    }
    const apiKey = await this.getApiKey();
    return this.llm.provider.listModels({ endpoint: url, apiKey });
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
    const endpoint = await this.resolveEndpoint();
    const model = opts?.model || (await this.getReasoningModel());
    const apiKey = await this.getApiKey();
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
    const endpoint = await this.resolveEndpoint();
    const model = opts?.model || (await this.getReasoningModel());
    const apiKey = await this.getApiKey();
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
  ): Promise<{
    queries: string[];
    country?: string;
    topic?: 'general' | 'news' | 'finance';
    timeRange?: 'day' | 'week' | 'month' | 'year';
  }> {
    const u = userMessage.trim();
    if (!u) return { queries: [] };
    try {
      const sys: ChatMessage = {
        role: 'system',
        content: [
          '당신은 사용자의 메시지를 웹 검색에 최적화된 쿼리 + Tavily 검색 옵션으로 재작성합니다.',
          '대화 맥락(이전 user/assistant 메시지)에서 대명사·지시어("그", "이 사람", "두 인물", "그 회사" 등)가 가리키는 실제 대상(고유명사·키워드)을 찾아내 쿼리에 포함하세요.',
          '',
          '출력 형식 (정확히 이 JSON 1개만):',
          '{ "queries": ["쿼리1"], "topic": "general", "country": null, "timeRange": null }',
          '',
          '*** 결정 순서 (반드시 이 순서로 판단) ***',
          '1) topic 먼저 결정',
          '2) topic="news" 면 country 도 결정 (한국어 메시지면 명시 없어도 기본 "south korea")',
          '3) timeRange 결정',
          '4) queries 작성',
          '',
          '필드 규칙:',
          '* topic ("general" | "news" | "finance"):',
          '  - "news": 메시지에 "뉴스", "속보", "최근 사건", "오늘 일어난", "보도", "이슈", "시사" 등이 포함되거나 분명히 시의성 있는 사건 정보를 요청. 예: "한국 뉴스 알려줘", "오늘 사건", "트럼프 최근 발언".',
          '  - "finance": 주식·환율·금융 시장·기업 실적·암호화폐. 예: "삼성전자 주가", "달러 환율", "비트코인 시세".',
          '  - "general": 그 외 일반 정보·역사·과학·기술·인물 백과 정보 등 (기본값).',
          '* country (소문자 영문 국가명 또는 null):',
          '  - topic="news" 일 때만 채움 (그 외 null).',
          '  - 사용자가 국가를 명시: 그 국가 사용 ("한국" → "south korea", "미국" → "united states", "일본" → "japan", "중국" → "china", "영국" → "united kingdom").',
          '  - 국가 명시 없음 + 사용자 메시지가 한국어: **기본값 "south korea"** (한국 사용자 관점 우선).',
          '  - 국가 명시 없음 + 사용자 메시지가 영어: null (전세계 결과).',
          '* timeRange ("day" | "week" | "month" | "year" | null):',
          '  - "day": "오늘", "현재", "지금", "방금", "어제" 등 즉시성 강조.',
          '  - "week": "최근", "이번 주", "요즘" 등.',
          '  - "month": "이번 달", "최근 한 달".',
          '  - "year": "올해", "최근 일년".',
          '  - topic="news" 이지만 시점 명시 없으면 기본 "week" (최근 뉴스가 자연스러움).',
          '  - 역사적·고정 정보면 null.',
          '* queries (배열, 1~2개):',
          '  - 둘 이상의 독립 대상(인물 둘, 제품 둘 등) 이면 개별 쿼리로 분리해 2개. 그 외 1개.',
          '  - 각 60자 이내, 명사 위주 키워드. 조사·"~에 대해 알려줘" 같은 군더더기 제거.',
          '  - 한국어 메시지 → 한국어 쿼리. 외래어/영문 고유명사는 원어 그대로.',
          '  - topic="news" + country="south korea" 면 쿼리에 "한국" 또는 관련 한국어 키워드 자연스럽게 포함.',
          '  - 맥락에서 대상을 알 수 없으면 메시지의 핵심 명사만 추출.',
          '',
          '*** 예시 ***',
          '입력: "오늘 뉴스 알려줘"',
          '출력: {"queries":["오늘 한국 주요 뉴스"],"topic":"news","country":"south korea","timeRange":"day"}',
          '',
          '입력: "삼성전자 최근 주가"',
          '출력: {"queries":["삼성전자 주가"],"topic":"finance","country":null,"timeRange":"week"}',
          '',
          '입력: "Albert Einstein biography"',
          '출력: {"queries":["Albert Einstein biography"],"topic":"general","country":null,"timeRange":null}',
          '',
          '입력: "미국 대통령 선거 결과"',
          '출력: {"queries":["미국 대통령 선거 결과"],"topic":"news","country":"united states","timeRange":"week"}',
          '',
          'JSON 외 텍스트·코드펜스·설명 절대 금지.',
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
        lines.push('[지난 대화]');
        for (const m of trimmedHistory) {
          const tag = m.role === 'user' ? '사용자' : '어시스턴트';
          lines.push(`${tag}: ${m.content}`);
        }
        lines.push('');
      }
      lines.push('[새 사용자 메시지]');
      lines.push(u.slice(0, 1500));
      lines.push('');
      lines.push('JSON만 출력:');

      const text = await this.llmComplete(
        [sys, { role: 'user', content: lines.join('\n') }],
        { model, temperature: 0.2, maxTokens: 512 },
      );
      this.logger.log(
        `[reformulate] LLM raw output (first 500): ${text.slice(0, 500)}`,
      );
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) {
        this.logger.warn('[reformulate] no JSON object found in LLM output');
        return { queries: [] };
      }
      const parsed = JSON.parse(m[0]) as {
        queries?: unknown;
        topic?: unknown;
        country?: unknown;
        timeRange?: unknown;
      };
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
        `[reformulate] cleaned: queries=${JSON.stringify(cleaned)}, topic=${topic}, country=${country}, timeRange=${timeRange}`,
      );
      return { queries: cleaned, topic, country, timeRange };
    } catch (e) {
      this.logger.warn(
        `검색 쿼리 재작성 실패: ${e instanceof Error ? e.message : ''}`,
      );
      return { queries: [] };
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
          '당신은 사용자의 새 메시지가 답할 수 있을 만큼 충분히 구체적인지를 판단하는 분류기입니다.',
          '판단 시 반드시 [지난 대화 맥락]을 고려해서 결정하세요.',
          '',
          '판단 기준:',
          '- 인사·감사·간단한 사실 질의(예: "안녕", "1+1") → 답변 가능 → needs=false',
          '- 새 메시지가 짧아도 [지난 대화]에서 충분히 의미가 명확하면 → needs=false (예: "더 자세히", "다른 거", "1번 알려줘"는 직전 대화의 대상이 분명한 경우)',
          '- 새 메시지가 모호하고 지난 대화로도 분기(종류·예산·지역·시점·대상)가 결정 안 되면 → needs=true',
          '',
          '**IMPORTANT — Language rule: Write question and options in the SAME language as the user\'s message. If the user wrote in English → English. If Korean → Korean.**',
          '',
          '응답 형식 — 둘 중 하나의 JSON만 출력:',
          '{ "needs": false }',
          '또는',
          '{ "needs": true, "question": "한 문장 재질문 (사용자 메시지와 같은 언어)", "options": ["답변 후보 1", "답변 후보 2", "답변 후보 3"] }',
          '',
          'question·options 작성 규칙 (필수):',
          '- 반드시 [지난 대화]에서 다뤄진 주제를 유지·구체화하는 질문이어야 함 (지난 대화와 관련 없는 일반론적 분류 묻지 말 것)',
          '- 옵션은 사용자가 그대로 보내면 자연스러운 다음 답이 되도록 짧게(8~20자), 사용자 메시지와 같은 언어로',
          '- options는 2~4개',
          '- JSON 외 텍스트·코드 펜스 금지',
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
        lines.push('[지난 대화]');
        for (const m of trimmedHistory) {
          const tag = m.role === 'user' ? '사용자' : '어시스턴트';
          lines.push(`${tag}: ${m.content}`);
        }
        lines.push('');
      } else {
        lines.push('[지난 대화 없음]');
        lines.push('');
      }
      lines.push('[새 사용자 메시지]');
      lines.push(u.slice(0, 1500));
      lines.push('');
      lines.push('JSON만 출력:');

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
          '당신은 어시스턴트 답변 직후, 사용자가 자연스럽게 이어서 묻고 싶을 만한 "후속 질문"을 추천합니다.',
          '추가 정보를 사용자에게 요구하는 게 아니라, 사용자가 다음에 손쉽게 클릭해서 보낼 만한 구체적 질문을 만드는 것이 목표.',
          '',
          '*** 매우 중요 — 기본은 "후속 질문 없음"이다. ***',
          '- 답변이 이미 사용자가 원한 것을 충분히 다뤘다면 needsClarification=false 로 종료.',
          '- 다음 같은 일반적/추상적인 후속만 떠오른다면 needsClarification=false:',
          '  · "더 자세히 알려주세요", "다른 정보도 알려주세요", "관련된 것은?"',
          '  · "어떤 종류가 더 있나요", "추천해주세요" 같은 정의 모호한 것',
          '- 후속을 만들 때는 반드시 [지난 대화 + 현재 답변]에서 명시적으로 등장한 고유명사·개념·숫자·항목을 직접 가리키는 구체 질문이어야 한다.',
          '  · 좋은 예: "조선 22대 정조의 화성 축조 비용은?", "위 비교표에서 가성비 1위 모델 스펙 더 보기"',
          '  · 나쁜 예: "더 자세히 알려줘", "다른 정보 있어?", "관련 정보는?"',
          '',
          '**IMPORTANT — Language rule: Write question and options in the SAME language as the user\'s message. If the user wrote in English → English. If Korean → Korean.**',
          '',
          '응답 형식 — 둘 중 하나의 JSON 만 출력:',
          '{ "needsClarification": false }',
          '또는',
          '{ "needsClarification": true, "question": "한 문장(생략 가능, 사용자 메시지와 같은 언어)", "options": ["구체 후속 질문 1", "구체 후속 질문 2"] }',
          '',
          '규칙:',
          '- options 2~3개, 10~30자, 사용자 메시지와 같은 언어로, 그대로 사용자 메시지로 보낼 수 있는 완전한 질문 형태',
          '- 같은 답변에 대해 비슷한 옵션을 만들지 말 것 — 서로 다른 각도/주제여야 함',
          '- 확실하지 않으면 무조건 needsClarification=false (잘못된 후속보다 없는 게 낫다)',
          '- JSON 외 텍스트·코드 펜스 금지',
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
        lines.push('[지난 대화]');
        for (const m of trimmedHistory) {
          const tag = m.role === 'user' ? '사용자' : '어시스턴트';
          lines.push(`${tag}: ${m.content}`);
        }
        lines.push('');
      }
      lines.push('[방금 사용자 질문]');
      lines.push(u.slice(0, 1500));
      lines.push('');
      lines.push('[방금 어시스턴트 답변]');
      lines.push(a.slice(0, 2500));
      lines.push('');
      lines.push('JSON만 출력:');

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
          '다음 답변을 보고 (1) 한 줄 요약과 (2) 본문의 핵심 키워드 해시태그 3~6개를 한국어로 만드세요.',
          '해시태그는 답변 본문에서 가장 핵심이 되는 단어들만 추출합니다. 양보다 정확성이 중요합니다.',
          '',
          '핵심 키워드 선정 가이드:',
          '- 본문에 실제로 등장하거나 본문의 주제를 가장 잘 대표하는 단어만 선택.',
          '- 부가적·주변적·일반적 개념은 제외 (예: "#개요","#정보","#설명","#내용" 같은 메타성 단어 금지).',
          '- 본문에서 한 번 스쳐 지나간 단어보다 답변 전반에서 비중 있게 다뤄진 단어를 우선.',
          '- 너무 추상적이거나 너무 광범위한 상위 카테고리(예: "#역사","#기술")만 단독으로 쓰지 않는다 — 본문이 그 자체를 정면으로 다룬 경우에만 허용.',
          '- 복합어는 의미가 통째로 보존되어야 가치 있을 때만 그대로 두고, 의미 손실 없이 분해할 수 있으면 핵심 부분만 남긴다.',
          '- 명사형 단일 토큰. 특수문자·조사·서술어 금지.',
          '- 공백이 필요한 복합어는 반드시 하이픈(-)으로 연결 (예: "#머신-러닝", "#수원-화성").',
          '- 영어는 카멜케이스 또는 하이픈 연결 (예: "#GenerativeAI", "#Next-JS").',
          '- 의미가 사실상 동일한 태그는 중복 제거 (대표적인 것 하나만).',
          '',
          '한 줄 요약 가이드:',
          '- 15~40자 사이, 답변의 핵심을 한 문장으로 (마침표 없이도 OK).',
          '',
          '출력 형식:',
          '- JSON 객체만 출력. 추가 설명·코드 펜스·서론·결론 금지.',
          '- 예: {"summary":"정조의 수원 화성 축조 배경과 의의","hashtags":["#정조","#수원화성","#조선시대"]}',
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
        '당신은 대화 내용을 "주제별"로 정리하는 한국어 리서치 노트 작성자입니다.',
        '아래 절차를 그대로 따릅니다.',
        '',
        '절차',
        '1) 대화 전체를 처음부터 끝까지 훑어 다뤄진 주요 주제를 2~5개 추출한다.',
        '   - 주제는 명사구로 짧게 (예: "Tavily 검색 통합", "이미지 카드 레이아웃").',
        '   - 비슷한 내용은 한 주제로 묶고, 의미 없는 잡담은 배제한다.',
        '2) 추출한 주제 각각을 별도 섹션으로 정리한다.',
        '3) 모든 주제 섹션이 끝난 뒤 결정·다음 단계를 별도로 정리한다.',
        '',
        '출력 형식 (이 마크다운 골격을 그대로 사용)',
        '',
        '## 한 줄 요약',
        '대화 전체의 목적과 결론을 한 문장으로.',
        '',
        '## 주제 목차',
        '- 주제 1 이름',
        '- 주제 2 이름',
        '- (필요 시 더)',
        '',
        '## 1. {주제 1 이름}',
        '- **굵은 키워드** 중심으로 4~8개 항목',
        '- 누가 무엇을 물어봤고 어떤 답·산출물이 나왔는지 구체적으로',
        '- 코드/명령은 ```언어 ... ``` 코드 블록으로 짧게 인용',
        '',
        '## 2. {주제 2 이름}',
        '- 같은 형식',
        '',
        '(주제 갯수만큼 ## 섹션 반복)',
        '',
        '## 결정·결과',
        '- 합의·도출된 결론, 만들어진 산출물(파일·기능·키)',
        '- 정해진 사항이 없으면 "아직 결정된 사항 없음"',
        '',
        '## 다음 단계',
        '- 후속 작업, 확인할 점, 미해결 질문',
        '- 없으면 이 섹션 자체를 생략',
        '',
        '규칙',
        '- 모든 출력은 한국어',
        '- 출처/인용 번호 [1], [2]는 그대로 보존',
        '- 추측·과장·대화에 없는 내용 금지',
        '- 같은 내용을 여러 섹션에 중복하지 않기',
        '- 헤딩은 위에 적힌 그대로 사용 (## 한 줄 요약, ## 주제 목차, ## 1. …, ## 결정·결과, ## 다음 단계)',
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
        '당신은 대화 흐름을 누적 요약하는 한국어 노트 작성자입니다.',
        '입력으로 [기존 요약]과 [최신 답변]이 주어집니다.',
        '두 글을 자연스럽게 통합해 전체 대화의 흐름을 짧게 요약합니다.',
        '',
        '규칙',
        '- 한국어로 작성',
        '- 마크다운 헤딩이나 제목 없이 짧은 문단 1~2개, 또는 불릿 3~6개',
        '- 새로 등장한 핵심 사실·결정·산출물을 빠뜨리지 않는다',
        '- 이미 요약에 있는 내용을 다시 길게 쓰지 않는다',
        '- 추측·인사말·메타발화 금지',
        '- 전체 길이는 800자를 넘지 않는다',
      ].join('\n'),
    };
    const user: ChatMessage = {
      role: 'user',
      content: [
        '[기존 요약]',
        prevSummary?.trim() || '(아직 없음)',
        '',
        '[최신 답변]',
        trimmedAnswer,
        '',
        '위 둘을 통합한 새 요약만 출력하세요.',
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
      '**IMPORTANT — Language rule (highest priority): Always reply in the exact same language the user used. If English → English. If Korean → Korean.**',
      '',
      '당신은 웹 검색 결과를 통합·교차검증해 자세히 답하는 리서치 어시스턴트입니다.',
      '',
      '** 중요 — 답해야 할 질문은 messages 배열의 가장 마지막 user 메시지입니다. **',
      '이전 turn의 assistant 답변을 그대로 복사·반복·패러프레이즈하지 말 것. 새 질문이 이전과 다르면 별개로 새로 답한다.',
      '대화 history는 맥락 참고용이며, 사실 근거는 아래 [검색결과]에서만 가져온다.',
      '',
      `사용자 질문: "${query}"`,
      '',
      '[웹 검색 결과] (Tavily 기반, 각 항목은 페이지 텍스트의 요약/추출본)',
      blocks,
      '',
      '답변 규칙:',
      '1. 결론 → 핵심 근거(검색결과 인용 [N]) → 부수 정보 순서로 자세히.',
      '2. 비교·열거·스펙·가격 같은 표 형태가 자연스러운 정보는 마크다운 표로 정리.',
      '3. 출처 인용은 `[1]`, `[2]` 형식으로 본문 안에 붙인다.',
      '4. 검색 결과 간 모순이 있으면 어느 쪽을 신뢰할지 한 줄로 근거 적고 결정.',
      '5. 검색 결과에 없는 사실은 추측하지 말고 "검색 결과에서 확인되지 않음"으로 표기.',
      '6. 사용자에게 보이는 본문에 사고 과정 헤더(`[생각 과정]`, `생각 과정`, `## 생각 과정`, `Thinking:` 등)를 절대 적지 말 것. 사고는 모델 내부 thinking에서만.',
      '7. 추측·과장·결과에 없는 사실 추가 금지. 길게 쓰되 모든 문장은 검색결과에 근거가 있어야 한다.',
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
      '**IMPORTANT — Language rule (highest priority): Always reply in the exact same language the user used. If English → English. If Korean → Korean.**',
      '',
      '당신은 사용자가 지정한 웹 페이지(들)의 텍스트 본문과 비전 모델이 분석한 이미지 정보를 통합·교차검증해 자세히 답하는 어시스턴트입니다.',
      '',
      '** 중요 — 답해야 할 질문은 messages 배열의 가장 마지막 user 메시지입니다. **',
      '이전 turn의 assistant 답변을 그대로 복사·반복하거나 패러프레이즈하지 말 것. 현재 질문이 이전 질문과 다르다면, 이전 답변과 별개로 현재 질문에 정확히 새로 답한다.',
      '대화 history는 맥락 참고용일 뿐이며, 답의 근거는 아래 [페이지 N] 자료에서만 가져온다.',
      '',
      '입력 자료:',
      `- 사용자 질문/요구사항: "${query}"`,
      `- 각 [페이지 N] 섹션에는 다음이 포함됨:`,
      '  · 페이지에서 추출한 텍스트 본문',
      '  · 그 페이지에 첨부된 이미지를 비전 모델이 한 장씩 분석한 결과 — `[이 페이지에 첨부된 이미지를 비전 모델로 분석한 결과 — …]` 블록. 각 줄은 `이미지N [관련|무관] (URL): 설명` 형식이며 따옴표 인용된 가격·모델명·라벨·수치 등 사실 단서가 들어 있다.',
      '',
      blocks,
      '',
      '답변 작성 규칙 (반드시 지킬 것):',
      '1. 사용자 요구사항을 한 줄로 재정의한 뒤, 그 요구를 채우는 데 필요한 정보 항목을 빠짐없이 다룬다. 단답으로 끝내지 말고, 페이지·이미지에서 확인 가능한 만큼 자세히 풀어쓴다.',
      '2. 텍스트 본문과 이미지 분석을 반드시 통합한다. 같은 사실이 둘 다에서 보이면 교차검증된 사실로 신뢰도를 높이고, 한쪽에만 있으면 그 출처를 본문에 표기한다("본문 기준", "이미지 기준").',
      '3. 이미지 분석 결과의 따옴표 인용(가격·모델명·라벨·표시 텍스트·치수)은 답변 본문에 그대로 가져와 사용. 단순 요약 금지.',
      '4. 텍스트와 이미지에서 충돌이 있으면 어느 쪽이 더 신뢰할 만한지 한 줄로 근거 적고 결정한다.',
      '5. 답변 구조: (a) 결론/요약 한 단락 → (b) 본문/이미지에서 확인한 핵심 사실을 근거와 함께 풀어쓴 상세 섹션 → (c) 비교·스펙·옵션·차이점이 있으면 반드시 마크다운 표로 정리 → (d) 페이지에서 확인되지 않은 부분이 있으면 "페이지에서 확인되지 않음"으로 명시.',
      '6. 검색·외부지식·일반 상식·추측을 끌어들이지 말 것. 답은 오직 제공된 [페이지 N] 자료 안에서.',
      '7. [관련] 표시된 이미지 분석은 적극 활용. [무관]은 답변에 인용하지 않는다 (단, 모순 검증 목적이라면 짧게 언급 가능).',
      '8. 사용자에게 보이는 본문에는 절대로 다음과 같은 사고 과정 헤더를 적지 말 것: "[생각 과정]", "생각 과정", "## 생각 과정", "**생각 과정**", "분석:", "사고 과정", "Thinking:" 등. 사고는 모델 내부 thinking 단계에서만 수행하고 본문은 곧바로 답변으로 시작.',
      '9. 추측·과장·자료에 없는 사실 추가 금지. 길게 쓰되, 모든 문장은 본문 또는 이미지 분석에 근거가 있어야 한다.',
    ].join('\n');

    return { role: 'system', content };
  }


  private readonly defaultSystemPrompt: ChatMessage = {
    role: 'system',
    content: [
      '**IMPORTANT — Language rule (highest priority): Always reply in the exact same language the user used in their message. If the user writes in English → reply in English. If in Korean → reply in Korean. If in Japanese → reply in Japanese. Never switch languages unless the user explicitly requests it.**',
      '',
      '당신은 친절한 어시스턴트입니다.',
      '',
      '** 중요 — 답해야 할 질문은 messages 배열의 가장 마지막 user 메시지입니다. **',
      '이전 turn의 assistant 답변을 그대로 복사·반복하거나 단순 패러프레이즈하지 말 것. 현재 질문이 이전 질문과 다르면, 별개로 현재 질문에 정확히 새로 답한다.',
      '',
      '답변 형식 가이드:',
      '- 둘 이상의 항목을 비교·열거·분류하거나 속성/스펙을 정리할 때는 가능한 한 마크다운 표를 적극 활용해 한눈에 보이게 정리한다.',
      '  예) "역대 대통령", "기능 비교", "버전별 변경점", "장단점", "예제 입력→출력" 등',
      '',
      '*** 마크다운 표 작성 규칙 (반드시 준수) ***',
      '1. 각 행 끝(닫는 `|`) 다음에는 반드시 줄바꿈(\\n) 문자를 넣고 다음 행을 새 줄에서 시작한다. 절대 한 줄에 헤더·구분자·본문 행을 이어붙이지 말 것.',
      '2. 정렬 구분자 행은 정확히 `|---|---|...|` 또는 `| :--- | :--- |` / `| :---: | ---: |` 만 허용한다. `:---/`, `---/`, `:--/`, `-/-`, ` :---:/` 처럼 슬래시(`/`) 가 끼면 안 되고, 한국어/영어 단어(예: "ability", "able") 도 절대 끼워넣지 말 것.',
      '3. 표 시작 전과 끝 뒤에 각각 빈 줄을 한 줄씩 둔다. 표 본문 내부에는 빈 줄을 넣지 않는다.',
      '4. 모든 행은 정확히 같은 수의 `|` 컬럼 구분자를 가져야 한다 (헤더 N개 → 구분자 N개 → 각 본문 행 N개).',
      '5. 셀 안에 줄바꿈이 필요하면 `<br>` 을 사용 (실제 줄바꿈 금지). 셀 안의 `|` 는 `\\|` 로 이스케이프.',
      '6. 올바른 예:',
      '   ',
      '   | 이름 | 설명 |',
      '   | :--- | :--- |',
      '   | A | 설명1 |',
      '   | B | 설명2 |',
      '   ',
      '7. 잘못된 예 1 — 한 줄에 모두: `| 이름 | 설명 | | :--- | :--- | | A | ... |`  ← 절대 금지',
      '8. 잘못된 예 2 — 슬래시 섞인 구분자: `| :---/ | :---/ |`  ← 절대 금지 (`/` 빼야 함)',
      '9. 잘못된 예 3 — 컬럼 수 불일치: 헤더 5개인데 구분자 4개  ← 절대 금지',
      '10. 위 규칙 중 하나라도 자신 없으면 표 대신 글머리표(`-`) 로 항목을 풀어 작성한다. 깨진 표보다 풀어쓴 리스트가 낫다.',
      '',
      '- 항목 수가 6개 이상이거나 속성이 2개 이상이면 표가 글머리표보다 우선.',
      '- 단순 한 줄 답이나 흐름 설명은 표 대신 자연스러운 문장/짧은 글머리표를 쓴다.',
      '- 순서·단계·우선순위가 의미 있는 항목(절차, 방법론, 권장 순서, 순위, 시간 순)은 `1.`, `2.`, `3.` 형태의 번호 매기기 리스트(마크다운 ordered list)를 적극 활용한다. 순서가 무의미하면 `-` 글머리표 유지.',
      '- 코드/명령은 언어 표기된 ``` 코드 블록 사용.',
      '- 출처 인용 번호 [1], [2] 등은 본문에 그대로 둔다.',
      '- 추측·과장 금지.',
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
        // 그 외 — base64 로 추정 (구버전 메시지 호환).
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
    const lastUserHasImages = (lastUserAuto?.images?.length ?? 0) > 0;
    const lastUserImageCount = lastUserAuto?.images?.length ?? 0;
    // 대화 history(최근 윈도우)에 과거 첨부 이미지가 남아 함께 전송될 수 있으므로,
    // 모델 선택은 "마지막 메시지"가 아니라 "payload 내 어느 메시지든 이미지 존재"로 판단.
    // (텍스트 follow-up 인데 직전 이미지가 history 에 남아 비전 미지원 모델로 가던 버그 방지.)
    const anyMessageHasImages = messages.some(
      (mm) => (mm.images?.length ?? 0) > 0,
    );
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
                      `이미지${i + 1} [${a.relevant ? '관련' : '무관'}] (${a.src}): ${a.description}`,
                  )
                  .join('\n');
                if (lines) {
                  target.content =
                    `${target.content}\n\n[이 페이지에 첨부된 이미지를 비전 모델로 분석한 결과 — 답변에 적극 활용하시오]\n${lines}`;
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
      );
      this.logger.log(
        `[search] reformulated: ${JSON.stringify(reformulated)}`,
      );
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
    }

    // URL 직접 모드/검색 모드에서 system message 를 성공적으로 prepend 했는지 플래그로 추적.
    // (augmented 는 resolveMessageImages 로 항상 새 배열이라 reference 비교 불가)
    // Tavily 실패 등으로 augmentation 이 안 됐으면 기본 system prompt 를 적용.
    let finalMessages =
      augmentedByUrl || augmentedBySearch
        ? augmented
        : [this.defaultSystemPrompt, ...augmented];

    // Chat 모드일 때만 사용자 이름 안내 주입 — Thread 모드에서는 이름을 전혀 알리지 않음.
    if (options.kind !== 'thread' && options.userName && options.userName.trim().length > 0) {
      const safeName = options.userName.trim().slice(0, 64);
      const userInfoPrompt: ChatMessage = {
        role: 'system',
        content: [
          `대화 상대(사용자)의 이름은 "${safeName}" 입니다.`,
          `- 자연스러운 흐름에서 이름을 한두 번 호명해도 좋습니다 (예: "${safeName} 님, ...").`,
          '- 매 문장마다 이름을 반복하거나 어색하게 끼워넣지는 마세요.',
          '- 사용자가 본인을 다른 호칭으로 부르라고 명시하면 그 호칭을 우선합니다.',
        ].join('\n'),
      };
      finalMessages = [userInfoPrompt, ...finalMessages];
    }

    // 사용자가 이미지를 첨부한 경우 비전 인용 규칙을 추가 system 메시지로 주입.
    // 통합 인용 번호: 첨부 이미지가 [1]..[M], 웹 검색결과는 [M+1]..[M+N] 으로 이어짐.
    if (lastUserHasImages) {
      const imageCount = lastUserImageCount;
      const visionCitePrompt: ChatMessage = {
        role: 'system',
        content: [
          `사용자가 이미지를 ${imageCount}장 첨부했습니다. messages 배열의 마지막 user 메시지에 포함되어 있으며,`,
          '첨부 순서대로 [1], [2], ...로 번호가 매겨져 있습니다.',
          '웹 검색결과나 페이지 자료가 함께 제공되는 경우 그 자료들은 [' +
            (imageCount + 1) +
            '] 부터 이어지는 번호로 참조됩니다 (전체 번호 체계는 통합).',
          '',
          '답변 규칙:',
          '1. 첨부 이미지를 묘사하거나 비교할 때는 본문에 `[1]`, `[2]`, ... 형식의 인용 번호를 반드시 포함시키시오.',
          '2. 웹/페이지 자료와 첨부 이미지를 함께 인용할 때도 동일하게 `[N]` 형식 — 같은 통합 번호 체계.',
          '3. 한 문장이 여러 출처에 해당하면 `[1, 3]` 처럼 묶어서 표기하시오.',
          '4. 인용 번호는 통합 순서를 따르며, 본문 안에서만 사용 (별도 출처 목록 작성 금지).',
        ].join('\n'),
      };
      finalMessages = [visionCitePrompt, ...finalMessages];
    }

    // 모델 전송은 공급자(LlmProvider)에 위임 — ChatService 는 메시지 구성/인용/저장만 담당.
    // 검색/URL 모드에서는 컨텍스트가 커서 thinking 에 토큰을 많이 소비하므로 상한을 높임.
    const endpoint = await this.resolveEndpoint(options.endpoint);
    // 첨부 이미지가 있으면(현재 또는 history 에 남은 과거 이미지 포함) 비전 가능한
    // Vision 모델로 답변 생성을 전환한다. (옵션 visionModel 우선 → 'ai' 설정 visionModel →
    //  그래도 없으면 기존 reasoning/대화 모델로 폴백.)
    let chatModel: string;
    if (anyMessageHasImages) {
      const vision =
        options.visionModel?.trim() || (await this.getVisionModel());
      chatModel =
        vision || options.model || (await this.getReasoningModel());
      if (vision) {
        this.logger.log(
          `[stream] 첨부 이미지 감지 → Vision 모델로 전환: ${vision}`,
        );
      }
    } else {
      chatModel = options.model || (await this.getReasoningModel());
    }
    const maxTokens = augmentedBySearch || augmentedByUrl ? 32768 : 8192;
    const apiKey = await this.getApiKey();
    try {
      yield* this.llm.provider.streamChat({
        endpoint,
        model: chatModel,
        messages: finalMessages,
        signal: options.signal,
        maxTokens,
        apiKey,
      });
    } catch (e) {
      // 컨텍스트 초과는 원문(영문) 대신 다국어 안내 메시지로 치환해 노출.
      // code 를 함께 실어 컨트롤러가 errorCode 로 중계 → 프론트가 UI 언어로 재번역(언어 전환 반응).
      const raw = e instanceof Error ? e.message : String(e);
      // 비전 미지원 모델에 이미지 전송 — "Settings 에서 비전 지원 모델로 변경" 안내.
      if (VISION_UNSUPPORTED_RE.test(raw)) {
        const err = new Error(m.visionUnsupported);
        (err as Error & { code?: string }).code = 'vision_unsupported';
        throw err;
      }
      // 선택한 모델이 서버에 없음 — "Settings 에서 유효한 모델로 변경" 안내.
      if (MODEL_NOT_FOUND_RE.test(raw)) {
        const err = new Error(m.modelNotFound);
        (err as Error & { code?: string }).code = 'model_not_found';
        throw err;
      }
      if (CONTEXT_OVERFLOW_RE.test(raw)) {
        const err = new Error(m.contextOverflow);
        (err as Error & { code?: string }).code = 'context_overflow';
        throw err;
      }
      // 잘못된 endpoint/API 키/호스트 — "Settings 에서 AI 설정 수정" 다국어 안내로 치환.
      if (AI_CONFIG_ERROR_RE.test(raw)) {
        const err = new Error(m.aiConfigError);
        (err as Error & { code?: string }).code = 'ai_config_error';
        throw err;
      }
      throw e;
    }
  }
}
