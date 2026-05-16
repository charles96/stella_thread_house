'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

interface GraphNode {
  id: string;
  title: string;
  tagCount: number;
}

interface GraphEdge {
  a: string;
  b: string;
  shared: string[];
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

const WIDTH = 820;
const HEIGHT = 520;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

// 노드 크기 — 연결(degree) 이 많을수록 큼. degree 0 = 9, max degree = 15.
// 선형 비율로 미연결(0) 과 최다연결의 차이가 ~1.7배 정도가 되도록 변동폭 축소.
function nodeRadius(degree: number, maxDegree: number): number {
  if (maxDegree <= 0) return 9;
  const t = degree / maxDegree;
  return 9 + t * 6;
}

// 노드 색 농도 — degree 가 클수록 더 짙은 primary. 최소 0.45, 최대 1.0.
function nodeOpacity(degree: number, maxDegree: number): number {
  if (maxDegree <= 0) return 0.6;
  const t = degree / maxDegree;
  return 0.45 + t * 0.55;
}

export default function ThreadGraph({
  nodes,
  edges,
  onSelectNode,
}: Props) {
  // 시뮬레이션 노드는 입력 nodes 가 바뀔 때마다 새로 초기화.
  const simNodes = useMemo<SimNode[]>(() => {
    const n = nodes.length;
    return nodes.map((nd, i) => {
      // 원형으로 살짝 흩어 둔 후 시뮬레이션이 정렬.
      const angle = (i / Math.max(1, n)) * Math.PI * 2;
      const r = 80 + (i % 5) * 20;
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

  // 노드별 연결 수 (degree) — 노드 크기/색상 농도에 사용.
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
  const maxDegree = useMemo(
    () => degreeByIdx.reduce((m, v) => Math.max(m, v), 0),
    [degreeByIdx],
  );

  const [, force] = useState(0); // 강제 리렌더용

  const draggingRef = useRef<{
    idx: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const hoverRef = useRef<{
    idx: number | null;
    titleIdx: number | null;
  }>({ idx: null, titleIdx: null });
  // edge 점 호버 시 즉시 노출되는 커스텀 툴팁 — native <title> 의 ~500ms 지연 회피.
  const [edgeTip, setEdgeTip] = useState<{
    x: number;
    y: number;
    text: string;
  } | null>(null);
  // 드래그가 발생한 노드는 직후 click 이벤트를 무시하도록 잠시 표시.
  const suppressClickRef = useRef<Set<number>>(new Set());
  const DRAG_THRESHOLD = 4; // 4 SVG units 이상 움직이면 드래그로 간주.

  // 시뮬레이션 루프
  useEffect(() => {
    let raf = 0;
    let alpha = 1;
    // 라벨이 edge 중간에 표기되므로 노드 사이 거리를 충분히 띄움.
    const REPULSION = 1800;
    const SPRING_K = 0.014;
    const SPRING_LEN = 180;
    const CENTER_K = 0.003;
    const DAMPING = 0.84;

    const tick = () => {
      // 반발력
      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const a = simNodes[i];
          const b = simNodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            // 같은 위치면 살짝 흔들어서 분리
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
            d2 = 4;
          }
          const f = (REPULSION * alpha) / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }
      }
      // 스프링 (edge)
      for (const e of edges) {
        const ai = idIndex.get(e.a);
        const bi = idIndex.get(e.b);
        if (ai == null || bi == null) continue;
        const a = simNodes[ai];
        const b = simNodes[bi];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        // shared 가 많을수록 더 강하게 끌어당김.
        const strength = SPRING_K * (1 + Math.log2(e.shared.length));
        const targetLen = SPRING_LEN;
        const f = (d - targetLen) * strength * alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        a.vx += fx;
        a.vy += fy;
        b.vx -= fx;
        b.vy -= fy;
      }
      // 중심 인력 + 위치 갱신 + damping
      for (const n of simNodes) {
        if (n.pinned) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx += (CENTER_X - n.x) * CENTER_K * alpha;
        n.vy += (CENTER_Y - n.y) * CENTER_K * alpha;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
        // 경계 클램프 (살짝 안쪽)
        const idx = idIndex.get(n.id) ?? -1;
        const deg = idx >= 0 ? degreeByIdx[idx] : 0;
        const r = nodeRadius(deg, maxDegree) + 6;
        if (n.x < r) n.x = r;
        if (n.x > WIDTH - r) n.x = WIDTH - r;
        if (n.y < r) n.y = r;
        if (n.y > HEIGHT - r) n.y = HEIGHT - r;
      }
      // 드래그 중에는 alpha 를 높게 유지 → 다른 노드들이 즉각 반응.
      // 손 떼고 안정화되면 alpha 를 점점 0 에 가깝게 → 미세한 표류 제거.
      if (draggingRef.current) {
        alpha = Math.max(alpha, 0.5);
      } else {
        alpha *= 0.95;
        if (alpha < 0.005) alpha = 0;
      }
      force((c) => (c + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simNodes, edges]);

  // 좌표 계산은 항상 부모 SVG 의 boundingRect 기준 — pointerdown 이 <g> 자식에서 발생해도
  // currentTarget(<g>) 이 아닌 SVG 컨테이너 좌표를 써야 drag offset 이 일치한다.
  function svgPoint(e: React.PointerEvent<Element>) {
    const target = e.currentTarget as Element;
    const svg =
      target instanceof SVGSVGElement
        ? target
        : (target as SVGGraphicsElement).ownerSVGElement;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = WIDTH / rect.width;
    const sy = HEIGHT / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  }

  function onPointerDown(e: React.PointerEvent<Element>, idx: number) {
    // setPointerCapture 는 부모 SVG 에 — pointermove/up 이 거기에 등록돼 있어야 추적이 일관.
    const svg = (e.currentTarget as SVGGraphicsElement).ownerSVGElement;
    try {
      svg?.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const p = svgPoint(e);
    draggingRef.current = {
      idx,
      offsetX: simNodes[idx].x - p.x,
      offsetY: simNodes[idx].y - p.y,
      startX: p.x,
      startY: p.y,
      moved: false,
    };
    simNodes[idx].pinned = true;
  }
  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    const drag = draggingRef.current;
    if (!drag) return;
    const p = svgPoint(e);
    if (!drag.moved) {
      const dx = p.x - drag.startX;
      const dy = p.y - drag.startY;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD * DRAG_THRESHOLD) {
        drag.moved = true;
      }
    }
    simNodes[drag.idx].x = p.x + drag.offsetX;
    simNodes[drag.idx].y = p.y + drag.offsetY;
    force((c) => (c + 1) % 1_000_000);
  }
  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    const drag = draggingRef.current;
    if (!drag) return;
    simNodes[drag.idx].pinned = false;
    // 실제로 드래그가 발생했으면 직후 발생할 click 이벤트를 무시.
    if (drag.moved) {
      suppressClickRef.current.add(drag.idx);
      const idxToRelease = drag.idx;
      // 다음 이벤트 사이클이 지나면 자동 해제 (혹시 click 이 안 오는 케이스 대비).
      setTimeout(() => {
        suppressClickRef.current.delete(idxToRelease);
      }, 100);
    }
    draggingRef.current = null;
    try {
      (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  }

  if (nodes.length === 0) return null;

  return (
    <section>
      <div className="relative overflow-hidden rounded-lg border border-border/50 bg-secondary/20">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="block h-auto max-h-[60vh] w-full"
          preserveAspectRatio="xMidYMid meet"
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {/* edges — 라인 + 정중앙 마커. hover 풍선도움말은 마커(점)에 부착. */}
          <g>
            {edges.map((e, i) => {
              const a = simNodes[idIndex.get(e.a) ?? -1];
              const b = simNodes[idIndex.get(e.b) ?? -1];
              if (!a || !b) return null;
              const w = Math.min(3, 0.6 + Math.log2(e.shared.length) * 0.6);
              const tip = `${e.shared.join(' · ')}  (${e.shared.length})`;
              const mx = (a.x + b.x) / 2;
              const my = (a.y + b.y) / 2;
              return (
                <g key={i}>
                  {/* 실제 시각 라인 — muted-foreground 톤(다크/라이트 양쪽에서 충분히 보임).
                      이전 --border 는 다크 테마에서 lightness 22% 라 너무 어두워 잘 안 보였음. */}
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="hsl(var(--muted-foreground))"
                    strokeOpacity={0.6}
                    strokeWidth={w}
                  />
                  {/* 라인 hover 영역 확장 — 두꺼운 투명 hit-area, native title 동일 */}
                  <line
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="transparent"
                    strokeWidth={Math.max(12, w + 8)}
                    style={{ cursor: 'help' }}
                  >
                    <title>{tip}</title>
                  </line>
                  {/* 정중앙 점 — halo + core 두 겹. */}
                  <circle
                    cx={mx}
                    cy={my}
                    r={6}
                    fill="hsl(var(--primary))"
                    fillOpacity={0.18}
                    pointerEvents="none"
                  />
                  <circle
                    cx={mx}
                    cy={my}
                    r={3}
                    fill="hsl(var(--primary))"
                    stroke="hsl(var(--background))"
                    strokeWidth={1}
                    pointerEvents="none"
                  />
                  {/* hover 영역 확장 + 커스텀 툴팁 트리거 — native <title> 지연 없이 즉시 노출. */}
                  <circle
                    cx={mx}
                    cy={my}
                    r={12}
                    fill="transparent"
                    style={{ cursor: 'help' }}
                    onPointerEnter={(ev) => {
                      setEdgeTip({
                        x: ev.clientX,
                        y: ev.clientY,
                        text: tip,
                      });
                    }}
                    onPointerMove={(ev) => {
                      setEdgeTip((prev) =>
                        prev
                          ? { ...prev, x: ev.clientX, y: ev.clientY }
                          : prev,
                      );
                    }}
                    onPointerLeave={() => setEdgeTip(null)}
                  />
                </g>
              );
            })}
          </g>
          {/* nodes */}
          <g>
            {simNodes.map((n, idx) => {
              const deg = degreeByIdx[idx] ?? 0;
              const r = nodeRadius(deg, maxDegree);
              const baseOpacity = nodeOpacity(deg, maxDegree);
              const isHover = hoverRef.current.idx === idx;
              return (
                <g
                  key={n.id}
                  onPointerDown={(ev) => onPointerDown(ev, idx)}
                  onPointerEnter={() => {
                    hoverRef.current.idx = idx;
                    force((c) => (c + 1) % 1_000_000);
                  }}
                  onPointerLeave={() => {
                    hoverRef.current.idx = null;
                    force((c) => (c + 1) % 1_000_000);
                  }}
                  onClick={() => {
                    if (draggingRef.current) return;
                    if (suppressClickRef.current.has(idx)) {
                      suppressClickRef.current.delete(idx);
                      return;
                    }
                    onSelectNode(n.id);
                  }}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    cx={n.x}
                    cy={n.y}
                    r={r}
                    fill="hsl(var(--primary))"
                    fillOpacity={isHover ? 1 : baseOpacity}
                    stroke="hsl(var(--background))"
                    strokeWidth={2}
                  />
                  {(() => {
                    const title =
                      (n.title || 'Thread').length > 20
                        ? `${(n.title || 'Thread').slice(0, 20)}…`
                        : n.title || 'Thread';
                    const titleHover = hoverRef.current.titleIdx === idx;
                    return (
                      <text
                        x={n.x}
                        y={n.y + r + 14}
                        fontSize={11}
                        textAnchor="middle"
                        fill={
                          titleHover
                            ? 'hsl(var(--primary))'
                            : 'hsl(var(--foreground))'
                        }
                        style={{
                          userSelect: 'none',
                          cursor: 'pointer',
                          textDecoration: titleHover ? 'underline' : 'none',
                          fontWeight: titleHover ? 600 : 400,
                          transition: 'fill 120ms',
                        }}
                        onPointerEnter={(ev) => {
                          ev.stopPropagation();
                          hoverRef.current.titleIdx = idx;
                          force((c) => (c + 1) % 1_000_000);
                        }}
                        onPointerLeave={(ev) => {
                          ev.stopPropagation();
                          if (hoverRef.current.titleIdx === idx)
                            hoverRef.current.titleIdx = null;
                          force((c) => (c + 1) % 1_000_000);
                        }}
                        // pointerdown 을 부모 <g> 로 전파하지 않음 → 드래그 시작 자체를 안 일으키므로
                        // 터치패드 미세 이동으로 click 이 suppress 되는 문제 차단.
                        onPointerDown={(ev) => ev.stopPropagation()}
                        onPointerUp={(ev) => ev.stopPropagation()}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          onSelectNode(n.id);
                        }}
                      >
                        {title}
                      </text>
                    );
                  })()}
                </g>
              );
            })}
          </g>
        </svg>

        {/* 커스텀 edge 툴팁 — 마우스 우상단으로 살짝 띄움. position: fixed 로 viewport 좌표 사용. */}
        {edgeTip && (
          <div
            className="pointer-events-none fixed z-50 rounded-md border border-border bg-popover px-2 py-1 text-[11.5px] text-popover-foreground shadow-md"
            style={{
              left: edgeTip.x + 12,
              top: edgeTip.y + 12,
            }}
          >
            {edgeTip.text}
          </div>
        )}
      </div>
    </section>
  );
}
