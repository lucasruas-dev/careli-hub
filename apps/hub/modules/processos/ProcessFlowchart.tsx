"use client";

import { useMemo, useState } from "react";
import { Focus, ZoomIn, ZoomOut } from "lucide-react";

import type { PopProcess, PopState } from "@/lib/processos/catalog";

const NODE_W = 140;
const NODE_H = 56;
const INICIO_W = 122;
const INICIO_H = 46;

type Box = {
  cx: number;
  cy: number;
  h: number;
  w: number;
  x: number;
  y: number;
};

const KIND_STYLE: Record<
  PopState["kind"],
  { fill: string; stroke: string; text: string }
> = {
  inicio: { fill: "#f8fafc", stroke: "#e2e8f0", text: "#64748b" },
  etapa: { fill: "#ffffff", stroke: "#cbd5e1", text: "#0f172a" },
  "fim-sucesso": { fill: "#ecfdf5", stroke: "#10b981", text: "#047857" },
  "fim-escalonamento": { fill: "#fff1f2", stroke: "#f43f5e", text: "#be123c" },
};

const KIND_LABEL: Record<PopState["kind"], string> = {
  inicio: "Início",
  etapa: "Etapa",
  "fim-sucesso": "Fim · sucesso",
  "fim-escalonamento": "Fim · escalonamento",
};

function boxFor(state: PopState): Box {
  const w = state.kind === "inicio" ? INICIO_W : NODE_W;
  const h = state.kind === "inicio" ? INICIO_H : NODE_H;

  return { cx: state.x + w / 2, cy: state.y + h / 2, h, w, x: state.x, y: state.y };
}

function wrapText(text: string, max: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if ((`${current} ${word}`).trim().length > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = current ? `${current} ${word}` : word;
    }
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function labelLines(label: string): string[] {
  if (label.length <= 14) {
    return [label];
  }

  return wrapText(label, Math.ceil(label.length / 2));
}

type EdgePoint = { x: number; y: number };
type EdgeGeometry = { c1: EdgePoint; c2: EdgePoint; end: EdgePoint; mid: EdgePoint; start: EdgePoint };

function edgeGeometry(from: Box, to: Box): EdgeGeometry {
  const dx = to.cx - from.cx;
  const dy = to.cy - from.cy;
  const sameRow = Math.abs(dy) <= 30;
  const horizontal = Math.abs(dx) >= Math.abs(dy);

  if (horizontal && dx > 0) {
    const start = { x: from.x + from.w, y: from.cy };
    const end = { x: to.x, y: to.cy };
    const offset = (end.x - start.x) / 2;

    return {
      c1: { x: start.x + offset, y: start.y },
      c2: { x: end.x - offset, y: end.y },
      end,
      mid: { x: (start.x + end.x) / 2, y: start.y },
      start,
    };
  }

  if (sameRow && dx < 0) {
    const bow = 64;
    const start = { x: from.cx, y: from.y };
    const end = { x: to.cx, y: to.y };

    return {
      c1: { x: from.cx, y: from.y - bow },
      c2: { x: to.cx, y: to.y - bow },
      end,
      mid: { x: (from.cx + to.cx) / 2, y: from.y - bow + 6 },
      start,
    };
  }

  const direction = dy >= 0 ? 1 : -1;
  const start = { x: from.cx, y: direction > 0 ? from.y + from.h : from.y };
  const end = { x: to.cx, y: direction > 0 ? to.y : to.y + to.h };
  const offset = Math.max(28, Math.abs(end.y - start.y) / 2);

  return {
    c1: { x: start.x, y: start.y + direction * offset },
    c2: { x: end.x, y: end.y - direction * offset },
    end,
    mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    start,
  };
}

type Hovered =
  | { index: number; kind: "edge" }
  | { id: string; kind: "node" }
  | null;

function bezierPoint(geometry: EdgeGeometry, t: number) {
  const mt = 1 - t;

  return {
    x:
      mt * mt * mt * geometry.start.x +
      3 * mt * mt * t * geometry.c1.x +
      3 * mt * t * t * geometry.c2.x +
      t * t * t * geometry.end.x,
    y:
      mt * mt * mt * geometry.start.y +
      3 * mt * mt * t * geometry.c1.y +
      3 * mt * t * t * geometry.c2.y +
      t * t * t * geometry.end.y,
  };
}

export function ProcessFlowchart({
  onOpenProcess,
  process,
}: {
  onOpenProcess?: (processId: string) => void;
  process: PopProcess;
}) {
  const [hovered, setHovered] = useState<Hovered>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [scale, setScale] = useState(1);

  const boxes = useMemo(() => {
    const map = new Map<string, Box>();
    process.estados.forEach((state) => map.set(state.id, boxFor(state)));
    return map;
  }, [process]);

  const stateById = useMemo(() => {
    const map = new Map<string, PopState>();
    process.estados.forEach((state) => map.set(state.id, state));
    return map;
  }, [process]);

  const { vbWidth, vbHeight } = useMemo(() => {
    let maxX = 0;
    let maxY = 0;
    boxes.forEach((box) => {
      maxX = Math.max(maxX, box.x + box.w);
      maxY = Math.max(maxY, box.y + box.h);
    });
    return { vbHeight: maxY + 28, vbWidth: maxX + 24 };
  }, [boxes]);

  function isNodeActive(id: string) {
    if (!focused) {
      return true;
    }

    if (id === focused) {
      return true;
    }

    return process.transicoes.some(
      (transition) =>
        (transition.de === focused && transition.para === id) ||
        (transition.para === focused && transition.de === id),
    );
  }

  function isEdgeActive(de: string, para: string) {
    if (!focused) {
      return true;
    }

    return de === focused || para === focused;
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-end gap-1.5">
        {focused ? (
          <button
            className="mr-auto inline-flex items-center gap-1.5 rounded-md border border-[#A07C3B]/30 bg-[#FFF9EF] px-2.5 py-1 text-xs font-medium text-[#8A6A2F] transition hover:bg-[#fdf3e0]"
            onClick={() => setFocused(null)}
            type="button"
          >
            <Focus aria-hidden="true" size={13} /> Sair do foco
          </button>
        ) : (
          <span className="mr-auto text-xs text-slate-400">
            Passe o mouse nos nós e setas · clique num nó para focar o caminho
          </span>
        )}
        <button
          aria-label="Menos zoom"
          className="grid size-7 place-items-center rounded-md border border-[#d9e0e7] text-slate-500 transition hover:bg-slate-50"
          onClick={() => setScale((value) => Math.max(0.6, Number((value - 0.2).toFixed(2))))}
          type="button"
        >
          <ZoomOut aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="Mais zoom"
          className="grid size-7 place-items-center rounded-md border border-[#d9e0e7] text-slate-500 transition hover:bg-slate-50"
          onClick={() => setScale((value) => Math.min(2, Number((value + 0.2).toFixed(2))))}
          type="button"
        >
          <ZoomIn aria-hidden="true" size={14} />
        </button>
      </div>

      <div className="overflow-auto rounded-lg border border-[#edf1f5] bg-slate-50/40 p-3">
        <svg
          aria-label={`Fluxograma do processo ${process.nome}`}
          role="img"
          style={{ width: `${vbWidth * scale}px`, maxWidth: scale <= 1 ? "100%" : "none", height: "auto" }}
          viewBox={`0 0 ${vbWidth} ${vbHeight}`}
        >
          <defs>
            <marker id="pop-arrow" markerHeight="7" markerWidth="7" orient="auto-start-reverse" refX="9" refY="5" viewBox="0 0 10 10">
              <path d="M0,0 L10,5 L0,10 z" fill="#94a3b8" />
            </marker>
            <marker id="pop-arrow-gold" markerHeight="7" markerWidth="7" orient="auto-start-reverse" refX="9" refY="5" viewBox="0 0 10 10">
              <path d="M0,0 L10,5 L0,10 z" fill="#A07C3B" />
            </marker>
          </defs>

          {process.transicoes.map((transition, index) => {
            const from = boxes.get(transition.de);
            const to = boxes.get(transition.para);

            if (!from || !to) {
              return null;
            }

            const geometry = edgeGeometry(from, to);
            const tagged = Boolean(transition.tag);
            const active = isEdgeActive(transition.de, transition.para);
            const rotuloWidth = transition.rotulo ? transition.rotulo.length * 7 + 14 : 0;
            const labelPoint = bezierPoint(geometry, 0.42);

            return (
              <g key={`edge-${index}`} style={{ opacity: active ? 1 : 0.16, transition: "opacity .15s" }}>
                <path
                  d={`M ${geometry.start.x} ${geometry.start.y} C ${geometry.c1.x} ${geometry.c1.y}, ${geometry.c2.x} ${geometry.c2.y}, ${geometry.end.x} ${geometry.end.y}`}
                  fill="none"
                  markerEnd={`url(#${tagged ? "pop-arrow-gold" : "pop-arrow"})`}
                  onMouseEnter={() => setHovered({ index, kind: "edge" })}
                  onMouseLeave={() => setHovered(null)}
                  stroke={tagged ? "#A07C3B" : "#94a3b8"}
                  strokeDasharray={tagged ? "5 4" : undefined}
                  strokeWidth={hovered?.kind === "edge" && hovered.index === index ? 2.6 : 1.6}
                  style={{ cursor: "pointer" }}
                />
                {transition.rotulo ? (
                  <g pointerEvents="none">
                    <rect
                      fill="#ffffff"
                      height={16}
                      rx={8}
                      stroke="#e2e8f0"
                      width={rotuloWidth}
                      x={labelPoint.x - rotuloWidth / 2}
                      y={labelPoint.y - 8}
                    />
                    <text fill="#475569" fontSize={10} fontWeight={600} textAnchor="middle" x={labelPoint.x} y={labelPoint.y + 3.5}>
                      {transition.rotulo}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}

          {process.estados.map((state) => {
            const box = boxes.get(state.id);

            if (!box) {
              return null;
            }

            const style = KIND_STYLE[state.kind];
            const lines = labelLines(state.label);
            const active = isNodeActive(state.id);
            const isHover = hovered?.kind === "node" && hovered.id === state.id;

            return (
              <g
                key={state.id}
                onClick={() =>
                  state.processoLink && onOpenProcess
                    ? onOpenProcess(state.processoLink)
                    : setFocused((current) => (current === state.id ? null : state.id))
                }
                onMouseEnter={() => setHovered({ id: state.id, kind: "node" })}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer", opacity: active ? 1 : 0.22, transition: "opacity .15s" }}
              >
                <rect
                  fill={style.fill}
                  height={box.h}
                  rx={state.kind === "inicio" ? box.h / 2 : 11}
                  stroke={isHover || focused === state.id ? "#A07C3B" : style.stroke}
                  strokeWidth={isHover || focused === state.id ? 2.4 : 1.6}
                  width={box.w}
                  x={box.x}
                  y={box.y}
                />
                {lines.map((line, lineIndex) => (
                  <text
                    fill={style.text}
                    fontSize={state.kind === "inicio" ? 11 : 13}
                    fontWeight={state.kind === "inicio" ? 600 : 700}
                    key={lineIndex}
                    textAnchor="middle"
                    x={box.cx}
                    y={box.cy + (lineIndex - (lines.length - 1) / 2) * 15 + 4.5}
                  >
                    {line}
                  </text>
                ))}
                {state.processoLink ? (
                  <g pointerEvents="none">
                    <circle cx={box.x + box.w - 13} cy={box.y + 13} fill="#A07C3B" r={9} />
                    <text fill="#ffffff" fontSize={12} fontWeight={700} textAnchor="middle" x={box.x + box.w - 13} y={box.y + 17}>
                      ↗
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}

          <FlowTooltip
            boxes={boxes}
            hovered={hovered}
            process={process}
            stateById={stateById}
            vbWidth={vbWidth}
          />
        </svg>
      </div>
    </div>
  );
}

function FlowTooltip({
  boxes,
  hovered,
  process,
  stateById,
  vbWidth,
}: {
  boxes: Map<string, Box>;
  hovered: Hovered;
  process: PopProcess;
  stateById: Map<string, PopState>;
  vbWidth: number;
}) {
  if (!hovered) {
    return null;
  }

  let anchorX = 0;
  let anchorY = 0;
  let title = "";
  const lines: string[] = [];

  if (hovered.kind === "node") {
    const state = stateById.get(hovered.id);
    const box = boxes.get(hovered.id);

    if (!state || !box) {
      return null;
    }

    anchorX = box.cx;
    anchorY = box.y;
    title = state.label;
    lines.push(KIND_LABEL[state.kind]);

    if (state.nota) {
      wrapText(state.nota, 34).forEach((line) => lines.push(line));
    }
  } else {
    const transition = process.transicoes[hovered.index];

    if (!transition) {
      return null;
    }

    const from = boxes.get(transition.de);
    const to = boxes.get(transition.para);

    if (!from || !to) {
      return null;
    }

    const geometry = edgeGeometry(from, to);
    anchorX = geometry.mid.x;
    anchorY = geometry.mid.y - 6;
    title = `${stateById.get(transition.de)?.label ?? transition.de} → ${stateById.get(transition.para)?.label ?? transition.para}`;
    wrapText(`Gatilho: ${transition.gatilho}`, 34).forEach((line) => lines.push(line));
    lines.push(`Tipo: ${transition.modo === "auto" ? "automático" : "manual"}${transition.tag ? ` · tag ${transition.tag}` : ""}`);
  }

  const width = 224;
  const titleLines = wrapText(title, 30);
  const allLines = [...titleLines.map((line) => ({ bold: true, text: line })), ...lines.map((line) => ({ bold: false, text: line }))];
  const height = 14 + allLines.length * 15;
  let x = anchorX - width / 2;
  x = Math.max(6, Math.min(x, vbWidth - width - 6));
  let y = anchorY - height - 12;

  if (y < 4) {
    y = anchorY + 14;
  }

  return (
    <g pointerEvents="none">
      <rect
        fill="#0f172a"
        height={height}
        rx={9}
        width={width}
        x={x}
        y={y}
        opacity={0.96}
      />
      {allLines.map((line, index) => (
        <text
          fill={line.bold ? "#ffffff" : "#cbd5e1"}
          fontSize={line.bold ? 12 : 11}
          fontWeight={line.bold ? 600 : 400}
          key={index}
          x={x + 12}
          y={y + 18 + index * 15}
        >
          {line.text}
        </text>
      ))}
    </g>
  );
}
