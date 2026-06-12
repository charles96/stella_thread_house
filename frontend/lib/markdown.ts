// CommonMark의 emphasis(*..*, **..**) 규칙은 닫는 마커 양쪽이 letter면 강조를 풀고,
// punctuation 판정에 ASCII만 본다. 한글(Lo)은 letter로 잡혀 right-flanking이 깨진다.
//   "이건 **'물에서 자라는 토란'**입니다."  ← 닫는 ** 뒤가 한글 → 강조 실패
//
// ZWSP/word-joiner 같은 보이지 않는 문자는 unicode whitespace도 punctuation도 아니라
// CommonMark 알고리즘을 만족시키지 못한다. 그래서 한글이 인접한 강조 토큰만
// 직접 <strong>/<em> HTML로 치환하고, ReactMarkdown은 rehype-raw로 그대로 렌더한다.
//
// 코드 펜스(```...```)와 인라인 코드(`..`)는 보호한다.

const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const PROTECT_RE = /(```[\s\S]*?```|`[^`\n]+?`)/g;

function isAdjacentToHangul(
  outerPrev: string,
  outerNext: string,
  inner: string,
): boolean {
  return (
    HANGUL.test(outerPrev) ||
    HANGUL.test(outerNext) ||
    HANGUL.test(inner.charAt(0) ?? '') ||
    HANGUL.test(inner.charAt(inner.length - 1) ?? '')
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function patch(segment: string): string {
  // ** ... ** (strong)
  let out = segment.replace(
    /\*\*([^*\n]+?)\*\*/g,
    (match, inner: string, offset: number, original: string) => {
      const prev = original.charAt(offset - 1);
      const next = original.charAt(offset + match.length);
      if (isAdjacentToHangul(prev, next, inner)) {
        return `<strong>${escapeHtml(inner)}</strong>`;
      }
      return match;
    },
  );
  // * ... * (em) — ** 와 겹치지 않도록 lookahead/lookbehind
  out = out.replace(
    /(?<!\*)\*([^*\n]+?)\*(?!\*)/g,
    (match, inner: string, offset: number, original: string) => {
      const prev = original.charAt(offset - 1);
      const next = original.charAt(offset + match.length);
      if (isAdjacentToHangul(prev, next, inner)) {
        return `<em>${escapeHtml(inner)}</em>`;
      }
      return match;
    },
  );
  return out;
}

// 웹 페이지 제목 등에 종종 HTML 엔티티(&middot; &amp; &#39; &nbsp; …)가 디코딩되지 않은
// 채로 들어온다. 텍스트(React children)로만 렌더하는 값에 적용해 원래 기호로 환원한다.
// SSR 안전(순수 함수, DOM 비의존). 알 수 없는 named 엔티티는 그대로 둔다.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  bull: '•',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  minus: '−',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
  deg: '°',
  sect: '§',
  para: '¶',
  dagger: '†',
  Dagger: '‡',
  times: '×',
  divide: '÷',
  euro: '€',
  pound: '£',
  cent: '¢',
  yen: '¥',
};

export function decodeHtmlEntities(input: string): string {
  if (!input || input.indexOf('&') === -1) return input;
  return input.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (match, body: string) => {
      if (body[0] === '#') {
        const hex = body[1] === 'x' || body[1] === 'X';
        const code = parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
        if (Number.isNaN(code) || code < 0 || code > 0x10ffff) return match;
        try {
          return String.fromCodePoint(code);
        } catch {
          return match;
        }
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

// 스트리밍 중(아직 도착 중인 부분 마크다운)에는 닫히지 않은 토큰이 raw 로 번쩍여 "깨져"
// 보인다. 완료 전 마지막 부분의 미완성 구조를 임시로 보정해 부드럽게 렌더한다.
//   - 구분행(---) 이 아직 안 온 표 머리글 → 표가 완성될 때까지 그 줄들을 잠시 숨김
//     (도착 전 `| A | B |` 가 raw 파이프로 번쩍이는 현상 방지)
//   - 닫히지 않은 강조 토큰(**, ~~) → 임시로 닫아 강조로 렌더
// 이미 완성된(스트리밍이 끝난) 마크다운에는 사실상 no-op 이므로, isLive 일 때만 적용하면
// 최종 렌더는 기존과 동일하다.
export function healStreamingMarkdown(text: string): string {
  if (!text) return text;

  // 열린 코드 펜스(```) 안쪽이면 그 내부는 코드로 안전하게 렌더되므로 손대지 않는다.
  const fenceCount = (text.match(/^```/gm) || []).length;
  if (fenceCount % 2 === 1) return text;

  let out = text;

  // 끝부분이 '표 행으로 보이는 줄'(파이프 2개 이상)들로 이어지는데 그 블록 안에 구분행이
  // 아직 없으면, 표가 완성될 때까지 그 줄들을 숨긴다.
  const lines = out.split('\n');
  const pipes = (s: string) => (s.match(/\|/g) || []).length;
  let tail = lines.length;
  while (tail > 0 && pipes(lines[tail - 1]) >= 2) tail--;
  if (tail < lines.length) {
    const block = lines.slice(tail);
    const hasDelim = block.some((l) => {
      const t = l.trim();
      return /-{3,}/.test(t) && /^[\s|:\-]+$/.test(t);
    });
    if (!hasDelim) out = lines.slice(0, tail).join('\n').replace(/\n+$/, '');
  }

  // 닫히지 않은 강조 토큰 보정 — 완성된 코드 영역(``` / `..`)은 제외하고 카운트.
  const bare = out.replace(PROTECT_RE, '');
  if (((bare.match(/\*\*/g) || []).length) % 2 === 1) out += '**';
  if (((bare.match(/~~/g) || []).length) % 2 === 1) out += '~~';

  return out;
}

export function fixKoreanEmphasis(text: string): string {
  if (!text) return text;
  const parts: string[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = PROTECT_RE.exec(text))) {
    parts.push(patch(text.slice(last, m.index)));
    parts.push(m[0]);
    last = m.index + m[0].length;
  }
  parts.push(patch(text.slice(last)));
  return parts.join('');
}

// 모델이 표 중간 줄을 4칸 이상 들여쓰면 markdown 파서가 그 줄을 indented code block 으로
// 인식해 표가 깨진다 (그 줄만 코드블록, 그 아래 행들은 paragraph 가 됨). 보호된 코드 펜스
// 외부에서 `|` 로 시작하는 표 행으로 보이는 줄은 leading whitespace 를 제거해 들여쓰기로 인한
// 코드블록 잡힘을 방지.
export function dedentTableRows(text: string): string {
  if (!text || text.indexOf('|') < 0) return text;
  // ``` 코드 펜스 안쪽은 건드리지 않는다.
  const lines = text.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    // 들여쓰기 + `|` 로 시작 + 다른 `|` 가 한 줄에 또 있으면 표 행으로 간주.
    const m = line.match(/^(\s+)(\|.*\|.*)$/);
    if (m) lines[i] = m[2];
  }
  return lines.join('\n');
}

// 모델이 한 줄에 합쳐서 뱉은 망가진 마크다운 표를 행 단위로 복구.
// 예: "| 헤더1 | 헤더2 | | :--- ability | :--- | | a | b | | c | d |"
// → 각 행을 줄바꿈으로 분리하고, 정렬 행에 끼어든 영문 단어 제거.
export function normalizeFlattenedTables(text: string): string {
  if (!text || text.indexOf('|') < 0) return text;
  return text
    .split('\n')
    .map((line) => {
      // 한 줄에 파이프가 아주 많고, 정렬 마커(:---|--- 등)를 포함하는 경우만 후보.
      const pipes = line.match(/\|/g)?.length ?? 0;
      if (pipes < 6) return line;
      if (!/\|\s*:?-{3,}/.test(line)) return line;

      // 정렬 셀에 끼어든 비정렬 토큰 제거 — `:--- ability` → `:---`
      const sanitized = line.replace(
        /\|\s*(:?)\s*-{3,}\s*[^|]*?(?=\|)/g,
        (_match, colon: string) =>
          colon === ':' ? '| :--- ' : '| --- ',
      );

      // 셀 토큰화 — 시작/끝 빈 토큰 제외 + 행 사이 `||` 로 인한 내부 빈 토큰도 제거.
      // (예: `... col3 | | :---` 는 행 경계라 빈 셀이 아님)
      const raw = sanitized.split('|');
      const trimmed = raw.slice(
        raw[0]?.trim() === '' ? 1 : 0,
        raw[raw.length - 1]?.trim() === '' ? -1 : raw.length,
      );
      const cells = trimmed.filter((c) => c.trim() !== '');

      // 정렬 행 위치로 column 수 추정.
      const sepIdx = cells.findIndex((t) => /^\s*:?-{3,}:?\s*$/.test(t));
      if (sepIdx < 1) return line;
      const colCount = sepIdx;
      if (cells.length < colCount * 2) return line;

      const rows: string[] = [];
      for (let i = 0; i + colCount <= cells.length; i += colCount) {
        const row = cells
          .slice(i, i + colCount)
          .map((c) => c.trim())
          .join(' | ');
        rows.push(`| ${row} |`);
      }
      // 표 앞뒤 빈 줄 보장 (gfm 파서 안정성).
      return ['', ...rows, ''].join('\n');
    })
    .join('\n');
}

// 본문의 `[1]`, `[1, 2, 6]` 같은 인라인 인용을 References 패널의 인덱스 배지와 동일한
// 스타일의 작은 배지로 변환. 코드 펜스/인라인 코드 안쪽은 보호. ReactMarkdown 의 rehype-raw
// 가 <span> 을 그대로 렌더하므로 Tailwind 클래스가 적용된다.
const CITE_BADGE_CLASS =
  'inline-flex h-4 min-w-[18px] items-center justify-center rounded-sm border border-primary/40 bg-primary/10 px-1 mx-0.5 align-middle font-mono text-[10.5px] tabular-nums leading-none text-primary';

const CITE_RE = /\[(\d+(?:\s*,\s*\d+)+|\d+)\]/g;

// rehype-raw 는 우리가 의도적으로 주입한 태그(fixKoreanEmphasis 의 <strong>/<em>,
// styleCitations 의 <span>)만 실제 엘리먼트로 렌더해야 한다. 그런데 모델이 본문에 쓴
// `<Ruby>`(앨범 제목), `<태그>` 같은 '태그처럼 생긴 텍스트'가 그대로 흘러가면 rehype-raw 가
// 이를 실제 HTML 로 파싱한다. 특히 `<ruby>` 등 실존 인라인 엘리먼트가 닫히지 않은 채 열리면
// 뒤따르는 리스트/헤딩/문단을 전부 자기 자식으로 삼켜 마크다운이 통째로 "풀려" 보인다.
// (스트리밍 중 닫는 `**` 가 도착하기 전, fixKoreanEmphasis 가 아직 escape 하지 못한 구간에서
//  특히 자주 발생.) → 주입한 태그만 화이트리스트로 남기고, 그 외 태그꼴 문자열의 <,> 를
// 엔티티로 이스케이프해 평범한 텍스트로 렌더되게 한다. 코드 영역은 PROTECT_RE 로 보호.
// 반드시 fixKoreanEmphasis/styleCitations 이후(가장 바깥)에 호출해야 주입 태그를 보존한다.
const ALLOWED_TAG_RE = /^<\/?(?:strong|em|span)(?:\s[^<>]*)?>$/i;
const TAGLIKE_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/g;

export function escapeStrayTags(text: string): string {
  if (!text || text.indexOf('<') === -1) return text;
  const parts = text.split(PROTECT_RE); // 코드 영역(``` / `..`)은 홀수 인덱스 — 건드리지 않음.
  return parts
    .map((p, i) => {
      if (i % 2 === 1) return p;
      return p.replace(TAGLIKE_RE, (tag) =>
        ALLOWED_TAG_RE.test(tag)
          ? tag
          : tag.replace(/</g, '&lt;').replace(/>/g, '&gt;'),
      );
    })
    .join('');
}

export function styleCitations(text: string): string {
  if (!text) return text;
  // 코드 영역(``` 블록 / 인라인 `..`)을 보호하고 그 외에서만 치환.
  const parts = text.split(PROTECT_RE);
  return parts
    .map((p, i) => {
      // PROTECT_RE 가 capturing group 이므로 홀수 인덱스가 보호 영역.
      if (i % 2 === 1) return p;
      return p.replace(CITE_RE, (_match, group: string) => {
        const nums = group.split(/\s*,\s*/).filter(Boolean);
        return nums
          .map((n) => `<span class="${CITE_BADGE_CLASS}">${n}</span>`)
          .join('');
      });
    })
    .join('');
}
