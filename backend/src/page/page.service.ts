import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfig } from '../db/entities/system-config.entity';
import { LlmService } from '../llm/llm.service';
import type { ChatMessage } from '../chat/chat.service';

export interface PageImage {
  src: string;
  alt?: string;
  // 'image' (기본), 'youtube', 'x' — scatter 카드에서 오버레이 표시용.
  kind?: 'image' | 'youtube' | 'x';
  // youtube/x 처럼 클릭 시 외부 페이지로 가야 하는 경우의 원본 URL
  linkUrl?: string;
}

export interface PageExtractResult {
  url: string;
  finalUrl: string;
  status: number;
  title?: string;
  ogTags: Record<string, string>;
  text: string;
  images: PageImage[];
  bytes: number;
}

export interface PageTitleContentResult {
  url: string;
  finalUrl: string;
  title?: string;
  ogTags: Record<string, string>;
  content: string;
  model: string;
  originalChars: number;
  filteredChars: number;
}

const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

// 단순한 브라우저 흉내 헤더만 사용. 너무 많은 헤더(Sec-Fetch-*, Sec-Ch-Ua-* 등)는
// 오히려 일부 사이트의 휴리스틱에 봇 패턴으로 잡히는 경우가 있어 최소 셋으로 유지.
function browserLikeHeaders(targetUrl: string): Record<string, string> {
  let isMobile = false;
  try {
    const u = new URL(targetUrl);
    isMobile = /^m\.|\bm-/i.test(u.host);
  } catch {
    // ignore
  }
  const ua = isMobile ? MOBILE_UA : DESKTOP_UA;
  return {
    'User-Agent': ua,
    Accept:
      'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.7',
  };
}

const STRIPPED_BLOCK_TAGS = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'svg',
  'canvas',
  'nav',
  'header',
  'footer',
  'aside',
  'form',
  'button',
  'select',
  'textarea',
  'label',
  'menu',
  'dialog',
];

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m);
}

function detectCharset(contentType: string, html: string): string | null {
  const m1 = /charset=([^;]+)/i.exec(contentType);
  if (m1) return m1[1].trim().replace(/['"]/g, '').toLowerCase();
  const m2 = /<meta[^>]+charset=["']?([\w-]+)/i.exec(html);
  if (m2) return m2[1].trim().toLowerCase();
  return null;
}

function getAttr(tag: string, name: string): string | undefined {
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  if (!m) return undefined;
  return m[2] ?? m[3] ?? m[4];
}

function resolveUrl(base: string, ref: string): string {
  try {
    return new URL(ref, base).toString();
  } catch {
    return ref;
  }
}

function sliceSection(html: string, tag: string): string {
  const open = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(html);
  if (!open) return '';
  const start = open.index + open[0].length;
  const close = new RegExp(`</${tag}\\s*>`, 'i').exec(html.slice(start));
  if (!close) return html.slice(start);
  return html.slice(start, start + close.index);
}

// 태그의 열린 부분을 매칭하면서 attribute 값 안의 `>` 도 안전하게 처리한다.
// (`<tag (key="v>v"|key='v>v'|other)*>` 형태)
const TAG_OPEN_INNER = `(?:[^>"']|"[^"]*"|'[^']*')*`;

function stripBlocks(html: string): string {
  let out = html;
  for (const tag of STRIPPED_BLOCK_TAGS) {
    const re = new RegExp(
      `<${tag}\\b${TAG_OPEN_INNER}>[\\s\\S]*?</${tag}\\s*>`,
      'gi',
    );
    out = out.replace(re, ' ');
    const selfClose = new RegExp(
      `<${tag}\\b${TAG_OPEN_INNER}/?>`,
      'gi',
    );
    out = out.replace(selfClose, ' ');
  }
  out = out.replace(/<!--[\s\S]*?-->/g, ' ');
  return out;
}

function htmlToText(html: string): string {
  // 따옴표 안 `>` 를 안전하게 다루며 모든 시작/종료 태그를 제거.
  const tagRe = new RegExp(`<\\/?[a-zA-Z][a-zA-Z0-9-]*${TAG_OPEN_INNER}\\/?>`, 'g');
  const stripped = html
    .replace(tagRe, ' ')
    // 위에서 매칭되지 않은 `<...>` (예: 비정상 마크업) 도 제거
    .replace(/<[^>]*>/g, ' ');
  const decoded = decodeEntities(stripped);
  // JSON 으로 인코딩된 데이터가 본문에 새는 경우 흔한 이스케이프 시퀀스를 정리.
  const unescaped = decoded
    .replace(/\\u[0-9a-fA-F]{4}/g, (m) =>
      String.fromCodePoint(parseInt(m.slice(2), 16)),
    )
    .replace(/\\\\/g, '') // 임시 보호
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\//g, '/')
    .replace(/\\[ntrf]/g, ' ')
    .replace(//g, '\\');
  return unescaped.replace(/\s+/g, ' ').trim();
}

function extractImages(bodyHtml: string, baseUrl: string): PageImage[] {
  const out: PageImage[] = [];
  const seen = new Set<string>();
  const re = /<img\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bodyHtml)) !== null) {
    const tag = m[0];
    const rawSrc =
      getAttr(tag, 'src') ??
      getAttr(tag, 'data-src') ??
      getAttr(tag, 'data-original');
    if (!rawSrc) continue;
    if (rawSrc.startsWith('data:')) continue;
    // src에 &amp; 같은 HTML entity가 그대로 남아 있으면 브라우저가 URL로 잘못 해석.
    // (Instagram embed 페이지가 대표 케이스 — 서명 매개변수 깨짐)
    const src = decodeEntities(rawSrc.trim());
    const abs = resolveUrl(baseUrl, src);
    if (!/^https?:\/\//i.test(abs)) continue;
    if (seen.has(abs)) continue;
    seen.add(abs);
    const alt = getAttr(tag, 'alt');
    out.push(alt ? { src: abs, alt: decodeEntities(alt) } : { src: abs });
  }
  return out;
}

// Instagram CDN 이미지 URL이 "현재 게시물의 이미지"인지 판단.
// embed 페이지에는 게시물 외에도 프로필 사진/추천 게시물이 섞여 있는데:
//   1) efg(base64) 의 vencode_tag 가 명시적이면 그것으로 판정
//      - CAROUSEL_ITEM            → 유지 (현재 게시물 캐러셀)
//      - FEED / profile_pic       → 제외
//      - regular_photo            → stp 사이즈 보고 결정
//   2) efg 가 없거나 모호하면 stp 파라미터의 사이즈 토큰으로 판정
//      - p<W>x<H>  (preview, 보통 1080x1080) → 현재 게시물 본 이미지로 간주
//      - s<W>x<H>  (square thumbnail, 150·240·320 등) → 프로필/추천 썸네일로 간주
function isCurrentInstagramPostImage(imgUrl: string): boolean {
  // Tavily search 가 반환하는 SEO 크롤러 이미지 — Instagram 이 google 봇용으로 노출.
  // 게시물 본 이미지 그대로라 통과시킴.
  if (/^https?:\/\/lookaside\.instagram\.com\/seo\//i.test(imgUrl)) {
    return true;
  }
  const efgMatch = imgUrl.match(/[?&]efg=([^&]+)/);
  let efgTag = '';
  if (efgMatch) {
    try {
      const decoded = Buffer.from(
        decodeURIComponent(efgMatch[1]),
        'base64',
      ).toString('utf8');
      const json = JSON.parse(decoded) as { vencode_tag?: string };
      efgTag = json.vencode_tag ?? '';
    } catch {
      // ignore — fall through to stp 분석
    }
  }
  if (efgTag.includes('CAROUSEL_ITEM')) return true;
  if (efgTag.includes('profile_pic')) return false;
  // FEED.xpids....regular_photo — Tavily 가 추출한 게시물 본 이미지에도 이 태그가 붙음.
  // 단, "FEED" 만 단독으로 있는 작은 그리드 썸네일은 통과시키지 않도록 stp 사이즈로 한 번 더 거름.
  // (s150x150 같은 소형 썸네일은 아래 stp 분기에서 reject)

  const stpMatch = imgUrl.match(/[?&]stp=([^&]+)/);
  if (stpMatch) {
    const stp = decodeURIComponent(stpMatch[1]);
    if (/(?:^|[_.])p\d{3,}x\d{3,}/.test(stp)) return true;
    // 소형 썸네일(s150x150 등) 은 reject — 100~199 픽셀 정사각.
    if (/(?:^|[_.])s1[0-9]{2}x1[0-9]{2}\b/.test(stp)) return false;
    // 그 외 stp (s640x640 / e35 / dst-jpg 등) 은 게시물 본 이미지로 간주.
    return true;
  }
  // stp 정보 없으면 efg 의 'regular_photo' 또는 'FEED' 신호로 통과.
  if (
    efgTag.includes('regular_photo') ||
    efgTag.includes('FEED') ||
    efgTag.includes('STORY')
  ) {
    return true;
  }
  return false;
}

// Instagram 게시물 URL → shortcode 추출.
// 지원되는 경로 패턴:
//   /p/<id>, /reel/<id>, /reels/<id>, /tv/<id>
//   /<username>/p/<id>, /<username>/reel/<id> 등 — 사용자명이 prefix로 붙은 형태
function parseInstagramShortcode(u: URL): string | null {
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (host !== 'instagram.com') return null;
  const m = u.pathname.match(
    /(?:^|\/)(p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?/,
  );
  return m ? m[2] : null;
}

// 네이버 블로그는 본문이 mainFrame iframe 안에 들어 있어, PC URL
// (blog.naver.com/{blogId}/{logNo})을 그냥 fetch 하면 본문 없는 빈 껍데기만 온다.
// 모바일 URL(m.blog.naver.com/{blogId}/{logNo})은 본문/OG 태그를 직접 내려주므로
// 그쪽으로 치환해서 가져온다. (URL 직접 모드/검색 모드 양쪽 모두 적용)
// 매칭 시 모바일 URL 문자열, 아니면 null.
function parseNaverBlogMobileUrl(u: URL): string | null {
  const host = u.hostname.toLowerCase();
  if (host !== 'blog.naver.com' && host !== 'm.blog.naver.com') return null;
  // 형식 1: /{blogId}/{logNo}
  const m = u.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)\/?$/);
  if (m) return `https://m.blog.naver.com/${m[1]}/${m[2]}`;
  // 형식 2: /PostView.naver?blogId=..&logNo=..  /  형식 3: /{blogId}?logNo=..
  const blogId =
    u.searchParams.get('blogId') ??
    u.pathname.match(/^\/([A-Za-z0-9_-]+)\/?$/)?.[1];
  const logNo = u.searchParams.get('logNo');
  if (blogId && logNo && /^\d+$/.test(logNo)) {
    return `https://m.blog.naver.com/${blogId}/${logNo}`;
  }
  return null;
}

function parseYoutubeUrl(u: URL): { videoId: string } | null {
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const idRe = /^[A-Za-z0-9_-]{6,15}$/;
  if (host === 'youtube.com') {
    if (u.pathname === '/watch') {
      const v = u.searchParams.get('v');
      if (v && idRe.test(v)) return { videoId: v };
    }
    const m = u.pathname.match(/^\/(embed|shorts)\/([A-Za-z0-9_-]{6,15})/);
    if (m) return { videoId: m[2] };
  }
  if (host === 'youtu.be') {
    const m = u.pathname.match(/^\/([A-Za-z0-9_-]{6,15})/);
    if (m) return { videoId: m[1] };
  }
  return null;
}

function extractYoutubeAndX(html: string): PageImage[] {
  const out: PageImage[] = [];
  const seen = new Set<string>();

  // YouTube: youtube.com/embed/<id>, youtube.com/watch?v=<id>, youtu.be/<id>
  const ytRe =
    /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:embed\/|watch\?[^"'\s<>]*v=)|youtu\.be\/)([A-Za-z0-9_-]{6,15})/gi;
  let m: RegExpExecArray | null;
  while ((m = ytRe.exec(html)) !== null) {
    const id = m[1];
    const key = `yt:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      src: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      alt: 'YouTube',
      kind: 'youtube',
      linkUrl: `https://www.youtube.com/watch?v=${id}`,
    });
  }

  // X / Twitter status: twitter.com/<user>/status/<id>, x.com/<user>/status/<id>
  const xRe =
    /https?:\/\/(?:www\.|mobile\.)?(?:twitter\.com|x\.com)\/[A-Za-z0-9_]{1,20}\/status\/(\d{8,25})/gi;
  while ((m = xRe.exec(html)) !== null) {
    const id = m[1];
    const url = m[0].replace(/^http:/, 'https:');
    const key = `x:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      // X는 공개 썸네일 URL이 없어 빈 src + linkUrl만 채움.
      // 프론트는 src가 비어 있으면 X 로고 placeholder 카드를 그린다.
      src: '',
      alt: 'X',
      kind: 'x',
      linkUrl: url,
    });
  }

  return out;
}

function parseVisionVerdict(text: string): {
  relevant: boolean;
  description: string;
} {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  let relevant = false;
  let description = '';
  for (const line of lines) {
    const m1 = /^관련\s*[:：]\s*(yes|no|예|아니오)/i.exec(line);
    if (m1) {
      relevant = /^(yes|예)/i.test(m1[1]);
      continue;
    }
    const m2 = /^(설명|description)\s*[:：]\s*(.+)$/i.exec(line);
    if (m2) {
      description = m2[2].trim().slice(0, 240);
      continue;
    }
    if (!description) description = line.slice(0, 240);
  }
  return { relevant, description };
}

function extractMetaTags(headHtml: string): {
  title?: string;
  ogTags: Record<string, string>;
} {
  const ogTags: Record<string, string> = {};
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(headHtml)) !== null) {
    const tag = m[0];
    const key = getAttr(tag, 'property') ?? getAttr(tag, 'name');
    if (!key) continue;
    const lower = key.toLowerCase();
    if (!/^(og:|twitter:|article:|fb:)/.test(lower)) continue;
    const content = getAttr(tag, 'content');
    if (content == null) continue;
    if (ogTags[lower]) continue;
    ogTags[lower] = decodeEntities(content);
  }

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(headHtml);
  const title = titleMatch
    ? decodeEntities(titleMatch[1].replace(/\s+/g, ' ').trim())
    : undefined;

  return { title, ogTags };
}

export interface PageImageAnalysis {
  src: string;
  alt?: string;
  relevant: boolean;
  description: string;
  error?: string;
}

export interface PageWithImageAnalysisResult extends PageTitleContentResult {
  imageAnalyses: PageImageAnalysis[];
  imageAnalysisModel: string;
}

@Injectable()
export class PageService {
  constructor(
    @InjectRepository(SystemConfig)
    private readonly systemConfigs: Repository<SystemConfig>,
    private readonly llm: LlmService,
  ) {}

  private readonly logger = new Logger(PageService.name);

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

  // 공급자(OpenAI 호환)를 통한 1회성 완성(제목추출·비전) — content 만 누적(thinking 제외).
  // signal 로 타임아웃/중단 전파.
  private async llmComplete(
    messages: ChatMessage[],
    opts: {
      model: string;
      temperature?: number;
      maxTokens?: number;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    const endpoint = await this.getAiEndpoint();
    const apiKey = await this.getApiKey();
    let content = '';
    for await (const part of this.llm.provider.streamChat({
      endpoint,
      model: opts.model,
      messages,
      apiKey,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      think: false,
      signal: opts.signal,
    })) {
      if (part.type === 'content') content += part.text;
    }
    return content.trim();
  }
  private readonly defaultModel =
    process.env.AI_DEFAULT_MODEL ?? 'gemma4:26b';
  private readonly visionModel =
    process.env.AI_VISION_MODEL ?? process.env.AI_DEFAULT_MODEL ?? 'gemma4:26b';

  // AI Endpoint — system_config 'ai' row 가 단일 진실 출처. env 폴백 없음.
  private async getAiEndpoint(): Promise<string> {
    const row = await this.systemConfigs.findOne({ where: { key: 'ai' } });
    const v = (row?.value as { endpoint?: string } | undefined)?.endpoint;
    if (!v || !v.trim()) {
      throw new Error('AI Endpoint 가 설정되지 않았습니다.');
    }
    return v.trim().replace(/\/$/, '');
  }

  // Vision 모델 — system_config 'ai' row 의 visionModel 이 전역 기본값.
  // 호출 측이 model 을 지정하면 그게 우선, 없으면 admin 설정 → env 순.
  private async getVisionModel(): Promise<string> {
    try {
      const row = await this.systemConfigs.findOne({ where: { key: 'ai' } });
      const v = (row?.value as { visionModel?: string } | undefined)
        ?.visionModel;
      if (v && v.trim()) return v.trim();
    } catch {
      // ignore — env 기본값으로 폴백
    }
    return this.visionModel;
  }
  private readonly imageAnalyzeMaxCount = Number(
    process.env.PAGE_IMAGE_ANALYZE_COUNT ?? 4,
  );
  private readonly imageAnalyzeTimeoutMs = Number(
    process.env.PAGE_IMAGE_ANALYZE_TIMEOUT_MS ?? 180_000,
  );
  private readonly titleExtractInputLimit = Number(
    process.env.PAGE_TITLE_EXTRACT_INPUT_LIMIT ?? 8_000,
  );
  private readonly titleExtractTimeoutMs = Number(
    process.env.PAGE_TITLE_EXTRACT_TIMEOUT_MS ?? 600_000,
  );
  // 외부 이미지를 그대로 스트리밍하기 위해 fetch 결과를 buffer + contentType 으로 돌려준다.
  // Instagram CDN처럼 `cross-origin-resource-policy: same-origin` 을 박는 호스트 때문에
  // 브라우저에서 직접 <img>로 불러올 수 없는 케이스를 우회하기 위한 프록시.
  async fetchImageBuffer(
    url: string,
    maxBytes = 12 * 1024 * 1024,
  ): Promise<{ buffer: Buffer; contentType: string }> {
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
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let res: globalThis.Response;
    try {
      res = await fetch(parsed.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: { 'User-Agent': DESKTOP_UA, Accept: 'image/*' },
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`이미지 응답 ${res.status}`);
    const ct = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0];
    if (!/^image\//i.test(ct)) throw new Error(`이미지가 아닙니다 (${ct})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error('이미지 크기 초과');
    return { buffer: buf, contentType: ct };
  }

  async extract(url: string, maxBytes = 2_000_000): Promise<PageExtractResult> {
    // 단순 호출자 편의: 진행 단계 무시하고 결과만 반환.
    let result: PageExtractResult | null = null;
    for await (const ev of this.extractWithProgress(url, maxBytes)) {
      if (ev.type === 'result') result = ev.result;
    }
    if (!result) throw new Error('페이지 추출 실패');
    return result;
  }

  // 추출 진행 단계를 실시간으로 yield 하는 async generator.
  // - { type: 'stage', stage: 'fetch' } : 일반 fetch 시도 시작
  // - { type: 'stage', stage: 'tavily' } : Tavily extract 폴백 시작 (외부 API)
  // - { type: 'result', result } : 최종 결과 (이걸로 종료)
  async *extractWithProgress(
    url: string,
    maxBytes = 2_000_000,
    { skipTavilyFallback = false } = {},
  ): AsyncGenerator<
    | { type: 'stage'; stage: 'fetch' | 'tavily' }
    | { type: 'result'; result: PageExtractResult }
  > {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('지원하지 않는 프로토콜입니다');
    }

    // YouTube URL은 transcript + oEmbed 메타데이터 경로로 분기.
    const yt = parseYoutubeUrl(u);
    if (yt) {
      yield { type: 'stage', stage: 'fetch' };
      const ytResult = await this.extractYoutube(u, yt.videoId);
      yield { type: 'result', result: ytResult };
      return;
    }

    // Instagram 게시물은 일반 페이지가 봇 차단되므로 /embed/captioned/ 임베드 페이지를 fetch.
    // 공개 게시물이면 OG 태그(이미지/설명) + 캡션이 정상 추출된다.
    const igShortcode = parseInstagramShortcode(u);
    // 네이버 블로그는 PC URL 이 빈 iframe 껍데기라 모바일 URL 로 치환해 본문을 받는다.
    const naverMobileUrl = igShortcode ? null : parseNaverBlogMobileUrl(u);
    const fetchUrl = igShortcode
      ? new URL(
          `https://www.instagram.com/p/${igShortcode}/embed/captioned/`,
        )
      : naverMobileUrl
        ? new URL(naverMobileUrl)
        : u;

    yield { type: 'stage', stage: 'fetch' };
    let fetchResult: PageExtractResult | null = null;
    let fetchError: unknown = null;
    try {
      fetchResult = await this.extractViaFetch(fetchUrl, maxBytes);
    } catch (e) {
      fetchError = e;
    }

    // Instagram 인 경우 결과 마지막에 한 번만 필터를 통일 적용 — fetch / browser 둘 다 커버.
    const finalizeIg = (r: PageExtractResult): PageExtractResult => {
      if (!igShortcode) return r;
      r.url = u.toString();
      r.finalUrl = u.toString();
      const filtered = r.images.filter((img) =>
        isCurrentInstagramPostImage(img.src),
      );
      if (filtered.length > 0) {
        r.images = filtered;
      } else {
        const ogImage = r.ogTags['og:image'];
        r.images = ogImage ? [{ src: ogImage }] : [];
      }
      return r;
    };

    // IG 필터 적용 후, 네이버는 모바일 URL 로 받아왔어도 결과 url 은 원본으로 표기.
    const finalize = (r: PageExtractResult): PageExtractResult => {
      const fr = finalizeIg(r);
      if (naverMobileUrl) {
        fr.url = u.toString();
        fr.finalUrl = u.toString();
      }
      return fr;
    };

    if (fetchResult && !this.looksBlocked(fetchResult)) {
      yield { type: 'result', result: finalize(fetchResult) };
      return;
    }

    // Tavily 폴백 — JS 차단 사이트(Instagram, X 등) 대응.
    // skipTavilyFallback=true 면 건너뜀 (검색 결과 경로: extract API hang 방지).
    // 키가 없으면 무시하고 다음 단계로.
    try {
      const tavilyKey = await this.getTavilyKey();
      if (tavilyKey && !skipTavilyFallback) {
        this.logger.log(
          `fetch ${fetchResult ? 'blocked' : 'failed'} → tavily extract: ${u.toString()}`,
        );
        yield { type: 'stage', stage: 'tavily' };
        // res.json() 이 AbortSignal을 무시하는 경우를 대비해 독립 타임아웃으로 강제 중단.
        const tavilyResult = await Promise.race([
          this.extractViaTavily(u),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('tavily extract timeout')), 30_000),
          ),
        ]);
        yield { type: 'result', result: finalize(tavilyResult) };
        return;
      }
    } catch (e) {
      this.logger.warn(
        `tavily 폴백 실패: ${e instanceof Error ? e.message : String(e)}`,
      );
      // tavily 도 실패하면 아래 fetchResult 폴백 또는 에러.
    }

    // 모든 폴백 실패 — fetch 결과라도 있으면 반환, 없으면 에러.
    if (fetchResult) {
      yield { type: 'result', result: finalize(fetchResult) };
      return;
    }
    throw fetchError instanceof Error
      ? fetchError
      : new Error('페이지 추출 실패');
  }

  // YouTube 영상: oEmbed로 제목/채널, youtube-transcript로 자막 가져오기.
  // 일반 페이지 fetch 와 달리 자바스크립트 렌더링된 description은 가져오지 않는다 — 자막이 더 풍부.
  private async extractYoutube(
    u: URL,
    videoId: string,
  ): Promise<PageExtractResult> {
    let title = '';
    let author = '';
    try {
      const r = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(u.toString())}&format=json`,
        { signal: AbortSignal.timeout(8_000) },
      );
      if (r.ok) {
        const j = (await r.json()) as { title?: string; author_name?: string };
        title = j.title ?? '';
        author = j.author_name ?? '';
      }
    } catch (e) {
      this.logger.warn(
        `YouTube oEmbed 실패: ${e instanceof Error ? e.message : ''}`,
      );
    }

    let transcript = '';
    let transcriptError: string | null = null;
    try {
      const mod = (await import('youtube-transcript')) as {
        YoutubeTranscript: {
          fetchTranscript: (
            id: string,
            opts?: { lang?: string },
          ) => Promise<{ text: string }[]>;
        };
      };
      // 한국어 우선, 실패 시 자동(영어 등) 트랙으로 폴백.
      let segments: { text: string }[] | null = null;
      for (const lang of ['ko', undefined]) {
        try {
          segments = await mod.YoutubeTranscript.fetchTranscript(videoId, lang ? { lang } : undefined);
          if (segments && segments.length > 0) break;
        } catch (inner) {
          if (lang === undefined) throw inner;
        }
      }
      if (segments && segments.length > 0) {
        transcript = segments
          .map((s) => decodeEntities(s.text).trim())
          .filter((t) => t.length > 0)
          .join(' ');
      }
    } catch (e) {
      transcriptError = e instanceof Error ? e.message : String(e);
      this.logger.warn(`YouTube transcript 실패 (${videoId}): ${transcriptError}`);
    }

    const sections: string[] = [];
    if (title) sections.push(`[제목] ${title}`);
    if (author) sections.push(`[채널] ${author}`);
    if (transcript) {
      // 너무 긴 자막은 잘라낸다 — 100k chars로 캡.
      const capped =
        transcript.length > 100_000
          ? transcript.slice(0, 100_000) + ' …(이하 생략)'
          : transcript;
      sections.push(`[자막]\n${capped}`);
    } else {
      sections.push(
        transcriptError
          ? `[자막을 가져올 수 없음: ${transcriptError}]`
          : '[자막 트랙이 없는 영상입니다]',
      );
    }

    const text = sections.join('\n\n');

    return {
      url: u.toString(),
      finalUrl: u.toString(),
      status: 200,
      title: title || `YouTube ${videoId}`,
      ogTags: {
        ...(title ? { 'og:title': title } : {}),
        'og:type': 'video',
        'og:site_name': 'YouTube',
      },
      text,
      images: [
        {
          src: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
          alt: title || `YouTube ${videoId}`,
          kind: 'youtube',
          linkUrl: `https://www.youtube.com/watch?v=${videoId}`,
        },
      ],
      bytes: Buffer.byteLength(text, 'utf8'),
    };
  }

  private async extractViaFetch(
    u: URL,
    maxBytes: number,
  ): Promise<PageExtractResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);

    let res: globalThis.Response;
    try {
      res = await fetch(u.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: ctrl.signal,
        headers: browserLikeHeaders(u.toString()),
      });
    } finally {
      clearTimeout(timer);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      throw new Error(`HTML 응답이 아닙니다 (content-type: ${contentType})`);
    }

    const buf = Buffer.from(await res.arrayBuffer());
    const truncated = buf.subarray(0, maxBytes);
    let html = truncated.toString('utf-8');
    const charset = detectCharset(contentType, html);
    if (charset && charset !== 'utf-8' && charset !== 'utf8') {
      try {
        html = new TextDecoder(charset).decode(truncated);
      } catch {
        // fall back to utf-8
      }
    }
    return this.parseHtmlToResult(
      u.toString(),
      res.url || u.toString(),
      res.status,
      html,
      buf.length,
    );
  }

  // Tavily key — system_config 'tavily' row 가 단일 출처. env 폴백 없음 (부팅 seed 만).
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

  // Tavily /extract — JS 차단/렌더링 사이트(Instagram, X 등) 의 본문/이미지를 가져온다.
  private async extractViaTavily(u: URL): Promise<PageExtractResult> {
    const key = await this.getTavilyKey();
    if (!key) throw new Error('TAVILY_API_KEY 미설정');
    const ctrl = new AbortController();
    // fetch + res.json() 전체에 타임아웃 — body 다운로드 hang 방지.
    const timer = setTimeout(() => ctrl.abort(), 30_000);
    try {
      const res = await fetch('https://api.tavily.com/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify({
          api_key: key,
          urls: [u.toString()],
          extract_depth: 'advanced',
          include_images: true,
        }),
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error(`Tavily extract HTTP ${res.status} ${txt}`);
      }
      const json = (await res.json()) as {
        results?: Array<{
          url?: string;
          raw_content?: string;
          images?: string[];
        }>;
        failed_results?: Array<{ url?: string; error?: string }>;
      };
      const r = json.results?.[0];
      if (!r || !r.raw_content) {
        const fail = json.failed_results?.[0]?.error ?? 'no content';
        throw new Error(`Tavily extract 결과 없음: ${fail}`);
      }
      const text = r.raw_content;
      // Tavily 의 structured images 는 빈약(프로필 1장 등)할 때가 많음.
      // raw_content (markdown) 의 ![alt](url) 패턴을 같이 파싱해 합집합으로 반환.
      const seen = new Set<string>();
      const images: PageImage[] = [];
      const push = (src: string) => {
        if (!src || seen.has(src)) return;
        seen.add(src);
        images.push({ src });
      };
      for (const s of r.images ?? []) push(s);
      const mdRe = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
      let m: RegExpExecArray | null;
      while ((m = mdRe.exec(text)) !== null) push(m[1]);
      return {
        url: u.toString(),
        finalUrl: r.url ?? u.toString(),
        status: 200,
        title: undefined,
        ogTags: {},
        text,
        images,
        bytes: Buffer.byteLength(text, 'utf-8'),
      };
    } finally {
      clearTimeout(timer);
    }
  }


  private parseHtmlToResult(
    requestUrl: string,
    finalUrl: string,
    status: number,
    html: string,
    bytes: number,
  ): PageExtractResult {
    const headHtml = sliceSection(html, 'head');
    const { title, ogTags } = extractMetaTags(headHtml);
    const bodyHtmlRaw = sliceSection(html, 'body') || html;
    const embeds = extractYoutubeAndX(bodyHtmlRaw + '\n' + headHtml);
    const cleanedBody = stripBlocks(bodyHtmlRaw);
    const imageList = extractImages(cleanedBody, finalUrl);
    const text = htmlToText(cleanedBody);
    return {
      url: requestUrl,
      finalUrl,
      status,
      title,
      ogTags,
      text,
      images: [...embeds, ...imageList],
      bytes,
    };
  }

  private looksBlocked(r: PageExtractResult): boolean {
    const title = (r.title ?? '').trim();
    const titleLower = title.toLowerCase();
    if (
      titleLower.includes('just a moment') ||
      titleLower.includes('attention required') ||
      titleLower.includes('access denied') ||
      titleLower.includes('cloudflare')
    ) {
      return true;
    }
    if (
      title.includes('에러페이지') ||
      title.includes('접속이 불가') ||
      title.includes('시스템오류')
    ) {
      return true;
    }
    // 의도치 않은 로그인 강제 리다이렉트 (도메인이 nid.naver.com 등으로 바뀌고
    // 타이틀이 Sign in / 로그인인 경우)도 차단으로 취급.
    if (
      /sign\s*in|로그인/i.test(title) &&
      /^https?:\/\/(?:nid\.|login\.|accounts\.|auth\.)/i.test(r.finalUrl ?? '')
    ) {
      return true;
    }
    if (r.status === 403 || r.status === 429) return true;
    // 본문이 거의 없고 이미지도 없으면 차단/빈 페이지일 가능성 높음.
    const textLen = (r.text ?? '').replace(/\s+/g, '').length;
    if (textLen < 80 && r.images.length === 0) return true;
    return false;
  }

  async extractByTitle(
    url: string,
    options: { model?: string } = {},
  ): Promise<PageTitleContentResult> {
    const page = await this.extract(url);
    const title =
      page.title ||
      page.ogTags['og:title'] ||
      page.ogTags['twitter:title'] ||
      '';
    const model = options.model || this.defaultModel;

    if (!title) {
      throw new Error('페이지 제목을 찾지 못했습니다');
    }
    if (!page.text || page.text.trim().length === 0) {
      throw new Error('페이지 본문이 비어 있습니다');
    }

    const truncated = page.text.slice(0, this.titleExtractInputLimit);
    const content = await this.askModelForTitleContent(model, title, truncated);

    return {
      url: page.url,
      finalUrl: page.finalUrl,
      title,
      ogTags: page.ogTags,
      content,
      model,
      originalChars: page.text.length,
      filteredChars: content.length,
    };
  }

  async extractWithImageAnalysis(
    url: string,
    options: { model?: string; visionModel?: string; maxImages?: number } = {},
  ): Promise<PageWithImageAnalysisResult> {
    const page = await this.extract(url);
    const title =
      page.title ||
      page.ogTags['og:title'] ||
      page.ogTags['twitter:title'] ||
      '';
    if (!title) throw new Error('페이지 제목을 찾지 못했습니다');

    const model = options.model || this.defaultModel;
    const visionModel = options.visionModel || (await this.getVisionModel());
    const maxImages = options.maxImages ?? this.imageAnalyzeMaxCount;

    // 본문 추출과 이미지 분석을 병렬로 실행해 응답 시간 단축.
    const truncated = page.text.slice(0, this.titleExtractInputLimit);
    const candidateImages = page.images
      // src가 비어있는 X embed 등은 제외
      .filter((img) => img.src && /^https?:\/\//i.test(img.src))
      .slice(0, maxImages);

    const [content, imageAnalyses] = await Promise.all([
      this.askModelForTitleContent(model, title, truncated),
      this.analyzeImagesByTitle(title, candidateImages, visionModel),
    ]);

    return {
      url: page.url,
      finalUrl: page.finalUrl,
      title,
      ogTags: page.ogTags,
      content,
      model,
      originalChars: page.text.length,
      filteredChars: content.length,
      imageAnalyses,
      imageAnalysisModel: visionModel,
    };
  }

  async analyzeImagesByTitle(
    title: string,
    images: PageImage[],
    model?: string,
  ): Promise<PageImageAnalysis[]> {
    if (images.length === 0) return [];
    const useModel = model || (await this.getVisionModel());
    const results = await Promise.all(
      images.map(async (img) => {
        try {
          const { base64 } = await this.fetchImageAsBase64(img.src);
          const verdict = await this.askVisionModel(useModel, title, base64, img.alt);
          return {
            src: img.src,
            alt: img.alt,
            relevant: verdict.relevant,
            description: verdict.description,
          };
        } catch (e) {
          return {
            src: img.src,
            alt: img.alt,
            relevant: false,
            description: '',
            error: e instanceof Error ? e.message : '분석 실패',
          };
        }
      }),
    );
    return results;
  }

  private async fetchImageAsBase64(
    url: string,
    maxBytes = 8 * 1024 * 1024,
  ): Promise<{ base64: string; contentType: string }> {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('http/https URL만 허용됩니다');
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15_000);
    let res: globalThis.Response;
    try {
      res = await fetch(u.toString(), {
        headers: {
          'User-Agent': DESKTOP_UA,
          Accept: 'image/*',
        },
        redirect: 'follow',
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) throw new Error(`이미지 응답 ${res.status}`);
    const ct = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0];
    if (!/^image\//i.test(ct)) throw new Error(`이미지 아님 (${ct})`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > maxBytes) throw new Error('이미지 크기 초과');
    return { base64: buf.toString('base64'), contentType: ct };
  }

  private async askVisionModel(
    model: string,
    title: string,
    imageBase64: string,
    alt?: string,
  ): Promise<{ relevant: boolean; description: string }> {
    const system = [
      '당신은 웹 페이지의 첨부 이미지를 자세히 묘사하고 페이지 제목과의 관련성을 판정하는 비전 분석기입니다.',
      '응답 형식 (다른 글자 없이 정확히 두 줄, 두 번째 줄은 줄바꿈 없이 이어 적기):',
      '관련: yes | no',
      '설명: <한국어 220자 이내, 후속 답변에 도움이 되도록 가능한 한 구체적으로>',
      '',
      '설명 작성 지침 (중요):',
      '- 무엇을 보여주는지 (제품/인물/장소/상황/도표 등) 명시.',
      '- 이미지에 보이는 텍스트(가격·모델명·라벨·수치·캡션·로고 글자)는 가능한 한 그대로 따옴표로 인용.',
      '- 제품 이미지라면: 색상, 형태, 소재 느낌, 부착된 라벨/가격표, 사이즈/포장 표기.',
      '- 사진이라면: 인물 수/표정/포즈/배경, 사건이라면 상황 단서.',
      '- 도표/스크린샷이라면: 표시되는 수치·축·결론 한 줄.',
      '- 단순 추측 금지. "보임", "표기됨" 같은 사실 위주 어휘.',
      '',
      '관련 판정:',
      '- 제목 주제와 시각적으로 직접 관련 있으면 yes.',
      '- 단순 로고/아이콘/UI 장식/광고 배너/공유 버튼은 no.',
    ].join('\n');

    const user = `제목: ${title}${alt ? `\n이미지 alt: ${alt}` : ''}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.imageAnalyzeTimeoutMs);
    let text: string;
    try {
      text = await this.llmComplete(
        [
          { role: 'system', content: system },
          { role: 'user', content: user, images: [imageBase64] },
        ],
        { model, temperature: 0.1, signal: ctrl.signal },
      );
    } finally {
      clearTimeout(timer);
    }
    return parseVisionVerdict(text);
  }

  private async askModelForTitleContent(
    model: string,
    title: string,
    text: string,
  ): Promise<string> {
    const system = [
      '당신은 웹 페이지 본문에서 "제목과 직접 관련된 본문 텍스트"만 골라내는 추출기입니다.',
      '규칙:',
      '- 제목이 다루는 주제의 본문(서론·본문·결론, 설명·예시·인용문 등)만 남긴다.',
      '- 메뉴/사이드바/광고/추천 글/관련기사/저작권/태그/SNS 공유/댓글/네비게이션은 제외.',
      '- 원문 표현을 그대로 보존하고 요약·재서술하지 않는다. 문장 순서도 원문 순서를 유지.',
      '- 출력은 본문 텍스트만. 머리말/꼬리말/설명/번호매기기/마크다운 강조 추가 금지.',
      '- 해당하는 본문이 없으면 빈 문자열을 반환.',
    ].join('\n');

    const user = `제목: ${title}\n\n본문:\n${text}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      ctrl.abort();
    }, this.titleExtractTimeoutMs);

    let out = '';
    try {
      out = await this.llmComplete(
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        {
          model,
          temperature: 0.1,
          maxTokens: 8192,
          signal: ctrl.signal,
        },
      );
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new Error(
          `응답 시간 초과 (${this.titleExtractTimeoutMs / 1000}s). PAGE_TITLE_EXTRACT_TIMEOUT_MS 또는 _INPUT_LIMIT 조정 필요`,
        );
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }

    return out.trim();
  }
}
