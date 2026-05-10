export type ArtifactKind = 'mermaid' | 'svg';

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  code: string;
  index: number;
  messageId: string;
}

const FENCE_RE = /```(mermaid|svg)\s*\n([\s\S]*?)```/gi;
const RAW_SVG_RE = /<svg[\s\S]*?<\/svg>/gi;

function normalizeKind(raw: string): ArtifactKind {
  const k = raw.toLowerCase();
  if (k === 'mermaid') return 'mermaid';
  return 'svg';
}

export function extractArtifacts(
  content: string,
  messageId: string,
): Artifact[] {
  if (!content) return [];
  const out: Artifact[] = [];
  let m: RegExpExecArray | null;

  let i = 0;
  while ((m = FENCE_RE.exec(content))) {
    const kind = normalizeKind(m[1]);
    const code = m[2].trim();
    if (!code) continue;
    out.push({ id: `${messageId}-${i}`, kind, code, index: i, messageId });
    i++;
  }
  FENCE_RE.lastIndex = 0;

  let r: RegExpExecArray | null;
  while ((r = RAW_SVG_RE.exec(content))) {
    const code = r[0];
    if (out.some((a) => a.code === code)) continue;
    out.push({
      id: `${messageId}-${i}`,
      kind: 'svg',
      code,
      index: i,
      messageId,
    });
    i++;
  }
  RAW_SVG_RE.lastIndex = 0;

  return out;
}
