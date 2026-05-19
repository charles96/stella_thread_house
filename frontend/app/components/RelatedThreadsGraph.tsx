'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface BipartiteNode {
  id: string;
  label: string;
  type: 'thread' | 'hashtag';
  isActive?: boolean; // 현재 열려 있는 thread
}

export interface BipartiteEdge {
  a: string; // thread id
  b: string; // hashtag id
}

interface SimNode extends BipartiteNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: boolean;
}

interface Props {
  nodes: BipartiteNode[];
  edges: BipartiteEdge[];
  onSelect: (id: string) => void;
}

const FALLBACK_W = 340;
const FALLBACK_H = 240;
const DRAG_THRESHOLD = 8;

function threadRadius(degree: number, maxDegree: number, isActive: boolean): number {
  if (isActive) return 11;
  if (maxDegree <= 0) return 9;
  return 9 + (degree / maxDegree) * 4;
}

function hashtagRadius(degree: number, maxDegree: number): number {
  if (maxDegree <= 0) return 6;
  return 6 + (degree / maxDegree) * 3;
}

export default function RelatedThreadsGraph({ nodes, edges, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: FALLBACK_W, h: FALLBACK_H });
  const sizeRef = useRef(size);
  sizeRef.current = size;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const cr = e.contentRect;
        const w = Math.max(120, Math.round(cr.width));
        const h = Math.max(120, Math.round(cr.height));
        setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const simNodes = useMemo<SimNode[]>(() => {
    const W = sizeRef.current.w;
    const H = sizeRef.current.h;
    const cx = W / 2;
    const cy = H / 2;
    const n = nodes.length;
    return nodes.map((nd, i) => {
      if (nd.isActive) {
        return { ...nd, x: cx, y: cy, vx: 0, vy: 0 };
      }
      const angle = (i / Math.max(1, n)) * Math.PI * 2;
      const r = 50 + (i % 4) * 15;
      return {
        ...nd,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: Math.cos(angle) * (4 + Math.random() * 3),
        vy: Math.sin(angle) * (4 + Math.random() * 3),
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
    () => simNodes.reduce((m, n, i) => n.type === 'thread' && !n.isActive ? Math.max(m, degreeByIdx[i] ?? 0) : m, 0),
    [simNodes, degreeByIdx],
  );
  const maxHashtagDeg = useMemo(
    () => simNodes.reduce((m, n, i) => n.type === 'hashtag' ? Math.max(m, degreeByIdx[i] ?? 0) : m, 0),
    [simNodes, degreeByIdx],
  );

  // Refs for direct SVG DOM mutation — avoids React re-render on every tick
  const circleRefs = useRef<Map<string, SVGCircleElement>>(new Map());
  const ringRefs = useRef<Map<string, SVGCircleElement>>(new Map());
  const textRefs = useRef<Map<string, SVGTextElement>>(new Map());
  const lineRefs = useRef<SVGLineElement[]>([]);

  const [, forceRender] = useState(0);
  const [wake, setWake] = useState(0);
  const wakeSimulation = () => setWake((c) => (c + 1) % 1_000_000);

  const draggingRef = useRef<{
    idx: number; offsetX: number; offsetY: number;
    startX: number; startY: number; startTime: number; moved: boolean;
  } | null>(null);
  const hoverRef = useRef<{ idx: number | null }>({ idx: null });
  const suppressClickRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (simNodes.length <= 1) return;
    let raf = 0;
    let alpha = 1;
    const REPULSION = 3500;
    const SPRING_K = 0.010;
    const SPRING_LEN = 130;
    const CENTER_K = 0.0015;
    const DAMPING = 0.82;
    const COLLISION_PAD = 14; // minimum gap between node surfaces

    // precompute node radii once per tick setup
    const nodeRadii = simNodes.map((n, i) => {
      const deg = degreeByIdx[i] ?? 0;
      return n.type === 'hashtag'
        ? hashtagRadius(deg, maxHashtagDeg)
        : threadRadius(deg, maxThreadDeg, !!n.isActive);
    });

    const tick = () => {
      const W = sizeRef.current.w;
      const H = sizeRef.current.h;
      const cx = W / 2;
      const cy = H / 2;

      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const a = simNodes[i];
          const b = simNodes[j];
          let dx = a.x - b.x; let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2; d2 = 4; }
          const d = Math.sqrt(d2);

          // long-range repulsion
          if (!a.isActive && !a.pinned) {
            const f = (REPULSION * alpha) / d2;
            a.vx += (dx / d) * f; a.vy += (dy / d) * f;
          }
          if (!b.isActive && !b.pinned) {
            const f = (REPULSION * alpha) / d2;
            b.vx -= (dx / d) * f; b.vy -= (dy / d) * f;
          }

          // collision: push apart if centres are closer than sum of radii + padding
          const minDist = nodeRadii[i] + nodeRadii[j] + COLLISION_PAD;
          if (d < minDist) {
            const overlap = (minDist - d) / d;
            if (!a.isActive && !a.pinned) { a.vx += dx * overlap * 0.6; a.vy += dy * overlap * 0.6; }
            if (!b.isActive && !b.pinned) { b.vx -= dx * overlap * 0.6; b.vy -= dy * overlap * 0.6; }
          }
        }
      }

      for (const e of edges) {
        const ai = idIndex.get(e.a);
        const bi = idIndex.get(e.b);
        if (ai == null || bi == null) continue;
        const a = simNodes[ai];
        const b = simNodes[bi];
        const dx = b.x - a.x; const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = (d - SPRING_LEN) * SPRING_K * alpha;
        if (!a.isActive && !a.pinned) { a.vx += (dx / d) * f; a.vy += (dy / d) * f; }
        if (!b.isActive && !b.pinned) { b.vx -= (dx / d) * f; b.vy -= (dy / d) * f; }
      }

      for (let i = 0; i < simNodes.length; i++) {
        const n = simNodes[i];
        if (n.isActive) { n.x = cx; n.y = cy; n.vx = 0; n.vy = 0; continue; }
        if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
        n.vx += (cx - n.x) * CENTER_K * alpha;
        n.vy += (cy - n.y) * CENTER_K * alpha;
        n.vx *= DAMPING; n.vy *= DAMPING;
        n.x += n.vx; n.y += n.vy;
        const r = nodeRadii[i] + 4;
        if (n.x < r) n.x = r;
        if (n.x > W - r) n.x = W - r;
        if (n.y < r) n.y = r;
        if (n.y > H - r) n.y = H - r;
      }

      // Direct DOM updates — no React re-render
      for (const n of simNodes) {
        const idx = idIndex.get(n.id) ?? 0;
        const deg = degreeByIdx[idx] ?? 0;
        const r = n.type === 'hashtag'
          ? hashtagRadius(deg, maxHashtagDeg)
          : threadRadius(deg, maxThreadDeg, !!n.isActive);

        const circle = circleRefs.current.get(n.id);
        if (circle) {
          circle.setAttribute('cx', String(n.x));
          circle.setAttribute('cy', String(n.y));
        }
        const ring = ringRefs.current.get(n.id);
        if (ring) {
          ring.setAttribute('cx', String(n.x));
          ring.setAttribute('cy', String(n.y));
        }
        const text = textRefs.current.get(n.id);
        if (text) {
          const offset = n.type === 'hashtag' ? r + 11 : r + 12;
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

      alpha = draggingRef.current ? Math.max(alpha, 0.5) : alpha * 0.97;
      if (alpha < 0.01) {
        alpha = 0;
        for (const n of simNodes) { n.vx = 0; n.vy = 0; }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { if (raf) cancelAnimationFrame(raf); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simNodes, edges, wake]);

  function svgPoint(e: React.PointerEvent<Element>) {
    const target = e.currentTarget as Element;
    const svg = target instanceof SVGSVGElement ? target : (target as SVGGraphicsElement).ownerSVGElement;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (sizeRef.current.w / rect.width),
      y: (e.clientY - rect.top) * (sizeRef.current.h / rect.height),
    };
  }

  function onPointerDown(e: React.PointerEvent<Element>, idx: number) {
    if (simNodes[idx].isActive) return;
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    try { svg?.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const p = svgPoint(e);
    draggingRef.current = { idx, offsetX: simNodes[idx].x - p.x, offsetY: simNodes[idx].y - p.y, startX: p.x, startY: p.y, startTime: Date.now(), moved: false };
    simNodes[idx].pinned = true;
    wakeSimulation();
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
    const isQuickTap = Date.now() - drag.startTime < 250 && !drag.moved;
    const idxClicked = drag.idx;
    draggingRef.current = null;
    try { (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (isQuickTap && simNodes[idxClicked].type === 'thread') {
      suppressClickRef.current.add(idxClicked);
      setTimeout(() => suppressClickRef.current.delete(idxClicked), 200);
      onSelect(simNodes[idxClicked].id);
    }
  }

  function onNodeHoverEnter(idx: number) {
    hoverRef.current.idx = idx;
    const n = simNodes[idx];
    if (n.type === 'thread' && !n.isActive) {
      const circle = circleRefs.current.get(n.id);
      if (circle) circle.setAttribute('fill', 'hsl(195 70% 60%)');
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
    if (n.type === 'thread' && !n.isActive) {
      const circle = circleRefs.current.get(n.id);
      if (circle) circle.setAttribute('fill', 'hsl(195 70% 50%)');
      const text = textRefs.current.get(n.id);
      if (text) {
        text.setAttribute('fill', 'hsl(var(--foreground))');
        text.style.fontWeight = '400';
        text.style.textDecoration = 'none';
      }
    }
  }

  const hasRelated = nodes.some((n) => n.type === 'thread' && !n.isActive);
  if (!hasRelated) return null;

  return (
    <div ref={containerRef} className="relative h-full w-full">
      <svg
        viewBox={`0 0 ${size.w} ${size.h}`}
        className="block h-full w-full select-none"
        style={{ touchAction: 'none' }}
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
                strokeOpacity={0.45}
                strokeWidth={1.2}
              />
            );
          })}
        </g>

        {/* nodes */}
        <g>
          {simNodes.map((n, idx) => {
            const deg = degreeByIdx[idx] ?? 0;
            const isHashtag = n.type === 'hashtag';
            const r = isHashtag
              ? hashtagRadius(deg, maxHashtagDeg)
              : threadRadius(deg, maxThreadDeg, !!n.isActive);

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
                    x={n.x} y={n.y + r + 11}
                    fontSize={9} textAnchor="middle"
                    fill="hsl(var(--muted-foreground))"
                    style={{ userSelect: 'none', fontWeight: 500 }}
                  >
                    {n.label.length > 14 ? `${n.label.slice(0, 14)}…` : n.label}
                  </text>
                </g>
              );
            }

            // thread node
            const fill = n.isActive ? 'hsl(var(--primary))' : 'hsl(195 70% 50%)';
            return (
              <g
                key={n.id}
                onPointerDown={(ev) => onPointerDown(ev, idx)}
                onPointerEnter={() => onNodeHoverEnter(idx)}
                onPointerLeave={() => onNodeHoverLeave(idx)}
                onClick={() => {
                  if (n.isActive) return;
                  if (draggingRef.current) return;
                  if (suppressClickRef.current.has(idx)) { suppressClickRef.current.delete(idx); return; }
                  onSelect(n.id);
                }}
                style={{ cursor: n.isActive ? 'default' : 'pointer' }}
              >
                {n.isActive && (
                  <circle
                    ref={(el) => { if (el) ringRefs.current.set(n.id, el); }}
                    cx={n.x} cy={n.y} r={r + 4}
                    fill="none"
                    stroke="hsl(var(--primary))"
                    strokeOpacity={0.3}
                    strokeWidth={2}
                  />
                )}
                <circle
                  ref={(el) => { if (el) circleRefs.current.set(n.id, el); }}
                  cx={n.x} cy={n.y} r={r}
                  fill={fill}
                  stroke="hsl(var(--background))"
                  strokeWidth={2}
                />
                <text
                  ref={(el) => { if (el) textRefs.current.set(n.id, el); }}
                  x={n.x} y={n.y + r + 12}
                  fontSize={n.isActive ? 10 : 9.5}
                  textAnchor="middle"
                  fill="hsl(var(--foreground))"
                  style={{
                    userSelect: 'none',
                    cursor: n.isActive ? 'default' : 'pointer',
                    fontWeight: n.isActive ? 600 : 400,
                  }}
                  onPointerDown={(ev) => { if (!n.isActive) ev.stopPropagation(); }}
                  onClick={(ev) => {
                    if (n.isActive) return;
                    ev.stopPropagation();
                    onSelect(n.id);
                  }}
                >
                  {(n.label || 'Thread').length > 14
                    ? `${(n.label || 'Thread').slice(0, 14)}…`
                    : n.label || 'Thread'}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
