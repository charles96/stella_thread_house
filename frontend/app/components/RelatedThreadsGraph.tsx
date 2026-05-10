'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

export interface RelatedNode {
  id: string;
  title: string;
  // 현재 thread 와 공유하는 해시태그 개수.
  shared: number;
}

interface Props {
  // 현재 활성 thread 정보 — 중앙 고정 노드.
  active: { id: string; title: string };
  // 이웃 thread 들 (>= threshold 만큼 해시태그 일치).
  related: RelatedNode[];
  onSelect: (id: string) => void;
  // 노드 hover 시 보여줄 보조 정보 (id → 공유 해시태그 목록).
  sharedTagsMap?: Map<string, string[]>;
}

interface SimNode {
  id: string;
  title: string;
  shared: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pinned?: boolean;
  isActive?: boolean;
}

// 초기 렌더 시점 fallback 사이즈 — ResizeObserver 가 실측치를 곧 채워준다.
const FALLBACK_W = 340;
const FALLBACK_H = 240;
// 트랙패드/터치 클릭 시 미세한 좌표 이동이 흔하므로 드래그 임계값을 약간 크게.
const DRAG_THRESHOLD = 8;

// 활성 노드는 별도 사이즈, 이웃은 shared (연결 수) 가 클수록 큰 폭으로 확대.
function nodeRadius(shared: number, maxShared: number, isActive: boolean) {
  if (isActive) return 8;
  if (maxShared <= 0) return 3.5;
  const t = shared / maxShared;
  return 3.5 + t * 5;
}

// 색상 — 활성(현재) 과 이웃(연결) 노드를 명확히 구분.
const ACTIVE_COLOR = 'hsl(var(--primary))';
const RELATED_COLOR = 'hsl(195 70% 55%)';

export default function RelatedThreadsGraph({
  active,
  related,
  onSelect,
  sharedTagsMap,
}: Props) {
  // 컨테이너 실측 사이즈 — ResizeObserver 로 추적해 그래프가 panel 영역을 꽉 채우도록.
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({
    w: FALLBACK_W,
    h: FALLBACK_H,
  });
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
  const cx = size.w / 2;
  const cy = size.h / 2;

  const simNodes = useMemo<SimNode[]>(() => {
    const out: SimNode[] = [
      {
        id: active.id,
        title: active.title,
        shared: 0,
        x: cx,
        y: cy,
        vx: 0,
        vy: 0,
        isActive: true,
      },
    ];
    const n = related.length;
    related.forEach((r, i) => {
      // 폭발하듯 뻗어나가는 도입 효과 — 모든 노드를 중앙 근처에서 시작하되
      // 강한 초기 속도(바깥 방향) 를 주어 화면 밖으로 펼쳐지듯 동적으로 등장.
      const baseAngle = (i / Math.max(1, n)) * Math.PI * 2;
      const angle = baseAngle + (Math.random() - 0.5) * 1.2;
      const startDist = 18 + Math.random() * 14; // 중앙에서 약간 떨어진 곳 출발
      const launchSpeed = 7 + Math.random() * 6; // 바깥쪽으로 적당한 초기 속도
      out.push({
        id: r.id,
        title: r.title,
        shared: r.shared,
        x: cx + Math.cos(angle) * startDist,
        y: cy + Math.sin(angle) * startDist,
        vx: Math.cos(angle) * launchSpeed,
        vy: Math.sin(angle) * launchSpeed,
      });
    });
    return out;
    // 사이즈가 바뀌어도 노드 재초기화 안 함 — bounds 와 인력 중심만 따라감.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active.id, related.map((r) => r.id).join('|')]);

  const maxShared = useMemo(
    () => related.reduce((m, r) => Math.max(m, r.shared), 0),
    [related],
  );

  const [, force] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const draggingRef = useRef<{
    idx: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    startTime: number;
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef<Set<number>>(new Set());

  // 드래그가 시작되면 시뮬레이션을 다시 깨우기 위한 신호 (effect 재실행 트리거).
  const [wake, setWake] = useState(0);
  const wakeSimulation = () => setWake((c) => (c + 1) % 1_000_000);
  useEffect(() => {
    if (simNodes.length <= 1) return;
    let raf = 0;
    let alpha = 1;
    const REPULSION = 1100;
    const SPRING_K = 0.018;
    const SPRING_LEN = 75;
    const CENTER_K = 0.003;
    const DAMPING = 0.85;
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
            dx = (Math.random() - 0.5) * 2;
            dy = (Math.random() - 0.5) * 2;
            d2 = 4;
          }
          const f = (REPULSION * alpha) / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * f;
          const fy = (dy / d) * f;
          if (!a.isActive && !a.pinned) {
            a.vx += fx;
            a.vy += fy;
          }
          if (!b.isActive && !b.pinned) {
            b.vx -= fx;
            b.vy -= fy;
          }
        }
      }
      // 활성 노드 → 각 이웃: 스프링 (shared 가 클수록 가깝게)
      const center = simNodes[0];
      for (let i = 1; i < simNodes.length; i++) {
        const r = simNodes[i];
        if (r.pinned) continue;
        const dx = center.x - r.x;
        const dy = center.y - r.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetLen = SPRING_LEN - Math.min(20, r.shared * 4);
        const f = (d - targetLen) * SPRING_K * alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        r.vx += fx;
        r.vy += fy;
      }
      // 중심 인력 + 위치 갱신 — 사이즈는 sizeRef 로 항상 최신값 참조 (resize 즉시 반영).
      const W = sizeRef.current.w;
      const H = sizeRef.current.h;
      const cxLive = W / 2;
      const cyLive = H / 2;
      for (const n of simNodes) {
        if (n.isActive) {
          n.x = cxLive;
          n.y = cyLive;
          continue;
        }
        if (n.pinned) {
          n.vx = 0;
          n.vy = 0;
          continue;
        }
        n.vx += (cxLive - n.x) * CENTER_K * alpha;
        n.vy += (cyLive - n.y) * CENTER_K * alpha;
        n.vx *= DAMPING;
        n.vy *= DAMPING;
        n.x += n.vx;
        n.y += n.vy;
        const r = nodeRadius(n.shared, maxShared, false) + 4;
        if (n.x < r) n.x = r;
        if (n.x > W - r) n.x = W - r;
        if (n.y < r) n.y = r;
        if (n.y > H - r) n.y = H - r;
      }
      // 드래그 중에는 alpha 를 높게 유지. 평소엔 적당히 감쇄해 차분히 정착.
      if (draggingRef.current) {
        alpha = Math.max(alpha, 0.5);
      } else {
        alpha *= 0.97;
        if (alpha < 0.01) alpha = 0;
      }
      // 정착 완료 — 잔여 속도/위치 부동소수점 오차로 인한 미세한 떨림 제거 후 루프 정지.
      if (alpha === 0 && !draggingRef.current) {
        for (const n of simNodes) {
          n.vx = 0;
          n.vy = 0;
        }
        force((c) => (c + 1) % 1_000_000);
        raf = 0;
        return;
      }
      force((c) => (c + 1) % 1_000_000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
    // wake — 드래그 시작 시 setWake 로 effect 재실행 → raf 재가동.
  }, [simNodes, maxShared, wake]);

  function svgPoint(e: React.PointerEvent<Element>) {
    const target = e.currentTarget as Element;
    const svg =
      target instanceof SVGSVGElement
        ? target
        : (target as SVGGraphicsElement).ownerSVGElement;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const sx = sizeRef.current.w / rect.width;
    const sy = sizeRef.current.h / rect.height;
    return {
      x: (e.clientX - rect.left) * sx,
      y: (e.clientY - rect.top) * sy,
    };
  }

  function onPointerDown(e: React.PointerEvent<Element>, idx: number) {
    // 활성 중심 노드는 드래그 불가 (위치 고정).
    if (simNodes[idx].isActive) return;
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
      startTime: Date.now(),
      moved: false,
    };
    simNodes[idx].pinned = true;
    // 정착해서 멈춘 시뮬레이션을 다시 깨움.
    wakeSimulation();
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
    // setPointerCapture 환경에선 자식 text 의 click 이벤트가 발화 안할 수 있어
    // 빠른 탭이면 여기서 직접 onSelect 호출. (드래그였으면 호출하지 않음.)
    const elapsed = Date.now() - drag.startTime;
    const isQuickTap = elapsed < 250 && !drag.moved;
    const idxClicked = drag.idx;
    draggingRef.current = null;
    try {
      (e.currentTarget as SVGSVGElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (isQuickTap) {
      // 혹시 뒤따라오는 click 이벤트의 중복 호출을 막기 위해 잠시 suppress.
      suppressClickRef.current.add(idxClicked);
      setTimeout(() => suppressClickRef.current.delete(idxClicked), 200);
      onSelect(simNodes[idxClicked].id);
    }
  }

  if (related.length === 0) return null;

  const center = simNodes[0];
  const others = simNodes.slice(1);
  const hoveredNode =
    hoverIdx !== null ? simNodes[hoverIdx] ?? null : null;

  return (
    <div ref={containerRef} className="relative h-full w-full">
    <svg
      viewBox={`0 0 ${size.w} ${size.h}`}
      className="block h-full w-full select-none"
      style={{ touchAction: 'none' }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* edges — 중심 ↔ 이웃, shared 가 많을수록 굵고 진하게. 색은 이웃 색 톤으로. */}
      {others.map((n, i) => {
        const idx = i + 1;
        const t = maxShared > 0 ? n.shared / maxShared : 0;
        const op = 0.3 + t * 0.5;
        const w = 0.8 + t * 1.6;
        return (
          <line
            key={`e-${n.id}`}
            x1={center.x}
            y1={center.y}
            x2={n.x}
            y2={n.y}
            stroke={`hsl(195 70% 55% / ${op})`}
            strokeWidth={hoverIdx === idx ? w + 0.6 : w}
          />
        );
      })}
      {/* 중심 노드 (active) — primary 색, 약간 더 큰 사이즈로 강조 */}
      <g>
        <circle
          cx={center.x}
          cy={center.y}
          r={nodeRadius(0, 0, true)}
          fill={ACTIVE_COLOR}
          stroke="hsl(var(--background))"
          strokeWidth={2}
        />
        <text
          x={center.x}
          y={center.y + nodeRadius(0, 0, true) + 12}
          fontSize={10}
          textAnchor="middle"
          fill="hsl(var(--foreground))"
          style={{ userSelect: 'none', fontWeight: 600 }}
        >
          {(active.title || 'Thread').length > 16
            ? `${(active.title || 'Thread').slice(0, 16)}…`
            : active.title || 'Thread'}
        </text>
      </g>
      {/* 이웃 노드 — drag 으로 위치 이동, click 으로 thread 이동 */}
      {others.map((n, i) => {
        const idx = i + 1;
        const r = nodeRadius(n.shared, maxShared, false);
        const isHover = hoverIdx === idx;
        return (
          <g
            key={n.id}
            onPointerDown={(ev) => onPointerDown(ev, idx)}
            onPointerEnter={() => setHoverIdx(idx)}
            onPointerLeave={() =>
              setHoverIdx((cur) => (cur === idx ? null : cur))
            }
            onClick={() => {
              if (draggingRef.current) return;
              if (suppressClickRef.current.has(idx)) {
                suppressClickRef.current.delete(idx);
                return;
              }
              onSelect(n.id);
            }}
            style={{ cursor: 'pointer' }}
          >
            <circle
              cx={n.x}
              cy={n.y}
              r={r}
              fill={RELATED_COLOR}
              stroke="hsl(var(--background))"
              strokeWidth={1.5}
              style={isHover ? { filter: 'brightness(1.15)' } : undefined}
            />
            <text
              x={n.x}
              y={n.y + r + 11}
              fontSize={9.5}
              textAnchor="middle"
              pointerEvents="all"
              fill={
                isHover ? 'hsl(var(--primary))' : 'hsl(var(--foreground))'
              }
              style={{
                userSelect: 'none',
                cursor: 'pointer',
                fontWeight: isHover ? 600 : 400,
                textDecoration: isHover ? 'underline' : 'none',
              }}
            >
              {n.title.length > 12
                ? `${n.title.slice(0, 12)}…`
                : n.title}
            </text>
          </g>
        );
      })}
      {/* hover 시 공유 해시태그 일부를 작은 풍선으로 노출 */}
      {hoveredNode && !hoveredNode.isActive && (
        <g pointerEvents="none">
          {(() => {
            const tags = sharedTagsMap?.get(hoveredNode.id) ?? [];
            const lines: string[] = [];
            lines.push(`공유 ${hoveredNode.shared}개`);
            if (tags.length > 0) {
              lines.push(
                tags
                  .slice(0, 3)
                  .map((t) => `#${t.replace(/^#+/, '')}`)
                  .join(' '),
              );
            }
            const padX = 6;
            const padY = 4;
            const lineH = 12;
            const w = 150;
            const h = padY * 2 + lineH * lines.length;
            let x = hoveredNode.x + 10;
            let y = hoveredNode.y - h - 6;
            if (x + w > size.w - 4) x = size.w - w - 4;
            if (y < 4) y = hoveredNode.y + 14;
            return (
              <>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  rx={4}
                  fill="hsl(var(--card))"
                  stroke="hsl(var(--border))"
                />
                {lines.map((line, li) => (
                  <text
                    key={li}
                    x={x + padX}
                    y={y + padY + lineH * (li + 1) - 3}
                    fontSize="9.5"
                    fill={
                      li === 0
                        ? 'hsl(var(--foreground))'
                        : 'hsl(var(--muted-foreground))'
                    }
                  >
                    {line}
                  </text>
                ))}
              </>
            );
          })()}
        </g>
      )}
    </svg>
    </div>
  );
}
