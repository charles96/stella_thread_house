'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface GraphNode {
  id: string;
  label: string;
  type: 'thread' | 'hashtag';
  tagCount?: number;
}

interface GraphEdge {
  a: string; // thread id (source)
  b: string; // hashtag id (target)
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: boolean;
}

interface Props {
  nodes: GraphNode[];
  edges: GraphEdge[];
  onSelectNode: (id: string) => void;
}

const WIDTH = 960;
const HEIGHT = 600;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;
function threadRadius(degree: number, maxDegree: number): number {
  if (maxDegree <= 0) return 11;
  return 11 + (degree / maxDegree) * 5;
}

function hashtagRadius(degree: number, maxDegree: number): number {
  if (maxDegree <= 0) return 7;
  return 7 + (degree / maxDegree) * 4;
}


export default function ThreadGraph({ nodes, edges, onSelectNode }: Props) {
  const simNodes = useMemo<SimNode[]>(() => {
    const n = nodes.length;
    return nodes.map((nd, i) => {
      const angle = (i / Math.max(1, n)) * Math.PI * 2;
      const r = 180 + (i % 5) * 40;
      return {
        ...nd,
        x: CENTER_X + Math.cos(angle) * r,
        y: CENTER_Y + Math.sin(angle) * r,
        vx: 0,
        vy: 0,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes.map((n) => n.id).join('|')]);

  const idIndex = useMemo(() => {
    const m = new Map<string, number>();
    simNodes.forEach((n, i) => m.set(n.id, i));
    return m;
  }, [simNodes]);

  const degreeByIdx = useMemo(() => {
    const arr = new Array<number>(simNodes.length).fill(0);
    for (const e of edges) {
      const ai = idIndex.get(e.a);
      const bi = idIndex.get(e.b);
      if (ai != null) arr[ai] += 1;
      if (bi != null) arr[bi] += 1;
    }
    return arr;
  }, [simNodes, edges, idIndex]);

  const maxThreadDeg = useMemo(
    () => simNodes.reduce((m, n, i) => n.type === 'thread' ? Math.max(m, degreeByIdx[i] ?? 0) : m, 0),
    [simNodes, degreeByIdx],
  );
  const maxHashtagDeg = useMemo(
    () => simNodes.reduce((m, n, i) => n.type === 'hashtag' ? Math.max(m, degreeByIdx[i] ?? 0) : m, 0),
    [simNodes, degreeByIdx],
  );

  // Refs for direct SVG DOM mutation — avoids React re-render on every tick
  const circleRefs = useRef<Map<string, SVGCircleElement>>(new Map());
  const textRefs = useRef<Map<string, SVGTextElement>>(new Map());
  const lineRefs = useRef<SVGLineElement[]>([]);

  const [, forceRender] = useState(0);
  const draggingRef = useRef<{
    idx: number; offsetX: number; offsetY: number;
    startX: number; startY: number; moved: boolean;
  } | null>(null);
  const hoverRef = useRef<{ idx: number | null; titleIdx: number | null }>({ idx: null, titleIdx: null });
  const suppressClickRef = useRef<Set<number>>(new Set());
  const DRAG_THRESHOLD = 4;

  useEffect(() => {
    let raf = 0;
    let alpha = 1;
    // 노드가 너무 퍼지지 않도록 응집: 반발력↓, 링크 길이↓, 중심 인력↑.
    const REPULSION = 2400;
    const SPRING_K = 0.012;
    const SPRING_LEN = 135;
    const CENTER_K = 0.0026;
    const DAMPING = 0.80;

    const tick = () => {
      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const a = simNodes[i];
          const b = simNodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2; d2 = 4; }
          const f = (REPULSION * alpha) / d2;
          const d = Math.sqrt(d2);
          a.vx += (dx / d) * f; a.vy += (dy / d) * f;
          b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
        }
      }
      for (const e of edges) {
        const ai = idIndex.get(e.a);
        const bi = idIndex.get(e.b);
        if (ai == null || bi == null) continue;
        const a = simNodes[ai];
        const b = simNodes[bi];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - SPRING_LEN) * SPRING_K * alpha;
        a.vx += (dx / d) * f; a.vy += (dy / d) * f;
        b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
      }
      for (let i = 0; i < simNodes.length; i++) {
        const n = simNodes[i];
        if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
        n.vx += (CENTER_X - n.x) * CENTER_K * alpha;
        n.vy += (CENTER_Y - n.y) * CENTER_K * alpha;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
        const deg = degreeByIdx[i] ?? 0;
        const r = (n.type === 'hashtag'
          ? hashtagRadius(deg, maxHashtagDeg)
          : threadRadius(deg, maxThreadDeg)) + 6;
        if (n.x < r) n.x = r;
        if (n.x > WIDTH - r) n.x = WIDTH - r;
        if (n.y < r) n.y = r;
        if (n.y > HEIGHT - r) n.y = HEIGHT - r;
      }

      // Direct DOM updates — no React re-render
      for (const n of simNodes) {
        const circle = circleRefs.current.get(n.id);
        if (circle) {
          circle.setAttribute('cx', String(n.x));
          circle.setAttribute('cy', String(n.y));
        }
        const text = textRefs.current.get(n.id);
        if (text) {
          const deg = degreeByIdx[idIndex.get(n.id) ?? 0] ?? 0;
          const r = n.type === 'hashtag'
            ? hashtagRadius(deg, maxHashtagDeg)
            : threadRadius(deg, maxThreadDeg);
          const offset = n.type === 'hashtag' ? r + 13 : r + 14;
          text.setAttribute('x', String(n.x));
          text.setAttribute('y', String(n.y + offset));
        }
      }
      for (let i = 0; i < edges.length; i++) {
        const line = lineRefs.current[i];
        if (!line) continue;
        const an = simNodes[idIndex.get(edges[i].a) ?? -1];
        const bn = simNodes[idIndex.get(edges[i].b) ?? -1];
        if (!an || !bn) continue;
        line.setAttribute('x1', String(an.x));
        line.setAttribute('y1', String(an.y));
        line.setAttribute('x2', String(bn.x));
        line.setAttribute('y2', String(bn.y));
      }

      alpha = draggingRef.current ? Math.max(alpha, 0.5) : alpha * 0.95;
      if (alpha < 0.005) alpha = 0;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simNodes, edges]);

  function svgPoint(e: React.PointerEvent<Element>) {
    const target = e.currentTarget as Element;
    const svg = target instanceof SVGSVGElement ? target : (target as SVGGraphicsElement).ownerSVGElement;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * (WIDTH / rect.width), y: (e.clientY - rect.top) * (HEIGHT / rect.height) };
  }

  function onPointerDown(e: React.PointerEvent<Element>, idx: number) {
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    try { svg?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = svgPoint(e);
    draggingRef.current = { idx, offsetX: simNodes[idx].x - p.x, offsetY: simNodes[idx].y - p.y, startX: p.x, startY: p.y, moved: false };
    simNodes[idx].pinned = true;
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = draggingRef.current;
    if (!drag) return;
    const p = svgPoint(e);
    if (!drag.moved) {
      const dx = p.x - drag.startX; const dy = p.y - drag.startY;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) drag.moved = true;
    }
    simNodes[drag.idx].x = p.x + drag.offsetX;
    simNodes[drag.idx].y = p.y + drag.offsetY;
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const drag = draggingRef.current;
    if (!drag) return;
    simNodes[drag.idx].pinned = false;
    if (drag.moved) {
      suppressClickRef.current.add(drag.idx);
      const i = drag.idx;
      setTimeout(() => suppressClickRef.current.delete(i), 100);
    }
    draggingRef.current = null;
    try { (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  }

  function onNodeHoverEnter(idx: number) {
    hoverRef.current.idx = idx;
    const n = simNodes[idx];
    if (n.type === 'thread') {
      const text = textRefs.current.get(n.id);
      if (text) {
        text.setAttribute('fill', 'hsl(var(--primary))');
        text.style.fontWeight = '600';
        text.style.textDecoration = 'underline';
      }
    }
  }
  function onNodeHoverLeave(idx: number) {
    hoverRef.current.idx = null;
    const n = simNodes[idx];
    if (n.type === 'thread') {
      const text = textRefs.current.get(n.id);
      if (text) {
        text.setAttribute('fill', 'hsl(var(--foreground))');
        text.style.fontWeight = '400';
        text.style.textDecoration = 'none';
      }
    }
  }
  function onTitleHoverEnter(idx: number) {
    hoverRef.current.titleIdx = idx;
    const n = simNodes[idx];
    const text = textRefs.current.get(n.id);
    if (text) {
      text.setAttribute('fill', 'hsl(var(--primary))');
      text.style.fontWeight = '600';
      text.style.textDecoration = 'underline';
    }
  }
  function onTitleHoverLeave(idx: number) {
    if (hoverRef.current.titleIdx === idx) hoverRef.current.titleIdx = null;
    const n = simNodes[idx];
    const text = textRefs.current.get(n.id);
    if (text) {
      text.setAttribute('fill', 'hsl(var(--foreground))');
      text.style.fontWeight = '400';
      text.style.textDecoration = 'none';
    }
  }

  if (nodes.length === 0) return null;

  return (
    <section>
      <div className="relative overflow-hidden rounded-lg border border-border/50 bg-secondary/20">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block h-auto w-full"
          style={{ maxHeight: 'calc(100dvh - 300px)' }}
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {/* edges */}
          <g>
            {edges.map((e, i) => {
              const an = simNodes[idIndex.get(e.a) ?? -1];
              const bn = simNodes[idIndex.get(e.b) ?? -1];
              if (!an || !bn) return null;
              return (
                <line
                  key={i}
                  ref={(el) => { if (el) lineRefs.current[i] = el; }}
                  x1={an.x} y1={an.y} x2={bn.x} y2={bn.y}
                  stroke="hsl(var(--muted-foreground))"
                  strokeOpacity={0.5}
                  strokeWidth={1.4}
                />
              );
            })}
          </g>

          {/* nodes */}
          <g>
            {simNodes.map((n, idx) => {
              const deg = degreeByIdx[idx] ?? 0;
              const isHashtag = n.type === 'hashtag';
              const r = isHashtag ? hashtagRadius(deg, maxHashtagDeg) : threadRadius(deg, maxThreadDeg);

              if (isHashtag) {
                return (
                  <g
                    key={n.id}
                    onPointerDown={(ev) => onPointerDown(ev, idx)}
                    onPointerEnter={() => onNodeHoverEnter(idx)}
                    onPointerLeave={() => onNodeHoverLeave(idx)}
                    style={{ cursor: 'default' }}
                  >
                    <circle
                      ref={(el) => { if (el) circleRefs.current.set(n.id, el); }}
                      cx={n.x} cy={n.y} r={r}
                      fill="hsl(var(--muted-foreground))"
                      stroke="hsl(var(--background))"
                      strokeWidth={1.5}
                    />
                    <text
                      ref={(el) => { if (el) textRefs.current.set(n.id, el); }}
                      x={n.x} y={n.y + r + 13}
                      fontSize={10} textAnchor="middle"
                      fill="hsl(var(--muted-foreground))"
                      style={{ userSelect: 'none', fontWeight: 500 }}
                    >
                      {n.label.length > 18 ? `${n.label.slice(0, 18)}…` : n.label}
                    </text>
                  </g>
                );
              }

              // thread node
              const label = (n.label || 'Thread').length > 20
                ? `${(n.label || 'Thread').slice(0, 20)}…`
                : n.label || 'Thread';
              return (
                <g
                  key={n.id}
                  onPointerDown={(ev) => onPointerDown(ev, idx)}
                  onPointerEnter={() => onNodeHoverEnter(idx)}
                  onPointerLeave={() => onNodeHoverLeave(idx)}
                  onClick={() => {
                    if (draggingRef.current) return;
                    if (suppressClickRef.current.has(idx)) { suppressClickRef.current.delete(idx); return; }
                    onSelectNode(n.id);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    ref={(el) => { if (el) circleRefs.current.set(n.id, el); }}
                    cx={n.x} cy={n.y} r={r}
                    fill="hsl(var(--primary))"
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  />
                  <text
                    ref={(el) => { if (el) textRefs.current.set(n.id, el); }}
                    x={n.x} y={n.y + r + 14}
                    fontSize={11} textAnchor="middle"
                    fill="hsl(var(--foreground))"
                    style={{ userSelect: 'none', cursor: 'pointer', fontWeight: 400, transition: 'fill 120ms' }}
                    onPointerEnter={(ev) => { ev.stopPropagation(); onTitleHoverEnter(idx); }}
                    onPointerLeave={(ev) => { ev.stopPropagation(); onTitleHoverLeave(idx); }}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onPointerUp={(ev) => ev.stopPropagation()}
                    onClick={(ev) => { ev.stopPropagation(); onSelectNode(n.id); }}
                  >
                    {label}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    </section>
  );
}
