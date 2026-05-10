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
