'use client';

import { useEffect, useRef, useState } from 'react';
import { Code2, Eye, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { Artifact } from '@/lib/artifacts';

type Tab = 'preview' | 'code';

function artifactLabel(kind: Artifact['kind']) {
  if (kind === 'mermaid') return 'Mermaid 다이어그램';
  return 'SVG 그래픽';
}

export default function ArtifactPanel({
  artifact,
  onClose,
}: {
  artifact: Artifact;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>('preview');

  return (
    <aside className="flex h-screen w-[480px] shrink-0 flex-col border-l border-border bg-sidebar">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-col leading-tight">
          <span className="text-sm font-semibold">
            {artifactLabel(artifact.kind)}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            #{artifact.index + 1} · {artifact.messageId.slice(0, 8)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <div className="mr-1 flex items-center rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => setTab('preview')}
              className={cn(
                'flex items-center gap-1 rounded-sm px-2 py-1 text-xs transition-colors',
                tab === 'preview'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Eye className="h-3 w-3" />
              미리보기
            </button>
            <button
              type="button"
              onClick={() => setTab('code')}
              className={cn(
                'flex items-center gap-1 rounded-sm px-2 py-1 text-xs transition-colors',
                tab === 'code'
                  ? 'bg-secondary text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Code2 className="h-3 w-3" />
              코드
            </button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            title="닫기"
            className="h-8 w-8"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <ScrollArea className="flex-1">
        {tab === 'preview' ? (
          <div className="p-5">
            {artifact.kind === 'mermaid' ? (
              <MermaidView code={artifact.code} />
            ) : (
              <SvgView code={artifact.code} />
            )}
          </div>
        ) : (
          <pre className="m-4 rounded-md border border-border bg-[#073642] p-4 text-[12.5px] leading-relaxed text-zinc-100">
            <code>{artifact.code}</code>
          </pre>
        )}
      </ScrollArea>
    </aside>
  );
}

export { MermaidView, SvgView };

function SvgView({ code }: { code: string }) {
  return (
    <div
      className="flex w-full items-center justify-center overflow-auto p-4 [&_svg]:max-w-full [&_svg]:h-auto"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: code }}
    />
  );
}

function MermaidView({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          securityLevel: 'loose',
          themeVariables: {
            background: '#1f1714',
            primaryColor: '#2b2018',
            primaryTextColor: '#f0e6dd',
            primaryBorderColor: '#c9854a',
            lineColor: '#b59a87',
            secondaryColor: '#3a2b22',
            tertiaryColor: '#15100d',
          },
        });
        const id = `m-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, code);
        if (cancelled) return;
        if (ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : '렌더 실패';
        setError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[12.5px] text-destructive-foreground">
        Mermaid 렌더 오류: {error}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="flex w-full items-center justify-center overflow-auto [&_svg]:max-w-full [&_svg]:h-auto"
    />
  );
}
