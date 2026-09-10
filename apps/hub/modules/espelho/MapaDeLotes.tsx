"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// O MAPA DE LOTES — o motor de desenho, zoom e arraste, usado pelas DUAS telas.
//
// ⚠️ ELE EXISTE PARA NÃO HAVER DOIS. O espelho público (`modules/publico/espelho`) e o da Mesa de
// Venda (`modules/incorporador/hercules`) desenham a mesma coisa a partir da mesma fonte — a arte
// e a geometria de `hercules_masterplans` — e mudam em duas coisas só: a COR de cada lote e o que
// acontece ao clicar. Tudo o mais (conter a arte sem esticar, ancorar o zoom no cursor, distinguir
// arraste de clique) é idêntico, e cada uma dessas três já custou um defeito visível em 10/09/2026.
// Duas cópias divergiriam na primeira correção.
//
// ⚠️ A ARTE VAI DENTRO DO SVG, e não ao lado. Como dois irmãos sobrepostos — uma <img> e um <svg>
// —, eles só ficam em registro enquanto o container tiver EXATAMENTE a proporção do viewBox: no
// primeiro pixel de diferença a imagem estica (width/height 100%) e o SVG não (preserveAspectRatio
// mantém a proporção), e os contornos saem de cima dos lotes. Dentro do SVG os dois compartilham o
// mesmo sistema de coordenadas, e o alinhamento deixa de depender do CSS.

export type ContornoDeLote = { codigo: string; d: string };

export type GeometriaDoMapa = {
  contornos: ContornoDeLote[];
  viewBox: string;
};

const ZMIN = 1;
const ZMAX = 8;
/** Acima disto o gesto é arraste, e o clique no lote não vale. */
const TOLERANCIA_DE_CLIQUE = 4;

export function MapaDeLotes({
  aoClicar,
  corDoLote,
  destacado,
  fundo,
  geometria,
  opacidade = 0.6,
  urlDaArte,
}: {
  /** Chamado com o código do lote. Não dispara quando o gesto foi arraste. */
  aoClicar: (codigo: string) => void;
  /** A tinta de cada lote. É a ÚNICA diferença de aparência entre as duas telas. */
  corDoLote: (codigo: string) => string;
  /** O lote com contorno branco — o que está aberto no painel. */
  destacado?: null | string;
  /** A cor por trás do mapa, quando a arte não preenche a área toda. */
  fundo?: string;
  geometria: GeometriaDoMapa;
  /** 0.6 é o valor do espelho do C2X, medido. Ver o espelho público. */
  opacidade?: number;
  urlDaArte: string;
}) {
  const cena = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // ⚠️ O ARRASTE PRECISA SABER SE HOUVE ARRASTE. Sem isto, soltar o botão depois de mover o mapa
  // dispara o clique do lote que estava sob o cursor e o painel abre sozinho.
  const arrasto = useRef<null | {
    /** Se a cena chegou a prender o ponteiro. Só acontece quando o gesto vira arraste. */
    capturou: boolean;
    moveu: boolean;
    px: number;
    py: number;
    x: number;
    y: number;
  }>(null);

  const caixa = useMemo(() => {
    const p = geometria.viewBox.trim().split(/\s+/).map(Number);
    const num = (i: number, padrao: number): number => {
      const v = p[i];
      return typeof v === "number" && Number.isFinite(v) ? v : padrao;
    };
    return {
      altura: num(3, 2160) > 0 ? num(3, 2160) : 2160,
      largura: num(2, 3840) > 0 ? num(2, 3840) : 3840,
      x: num(0, 0),
      y: num(1, 0),
    };
  }, [geometria.viewBox]);

  const aplicarZoom = useCallback(
    (alvo: number, clienteX: number, clienteY: number) => {
      const area = cena.current?.getBoundingClientRect();
      if (!area) return;
      setZoom((atual) => {
        const novo = Math.min(ZMAX, Math.max(ZMIN, alvo));
        if (novo === atual) return atual;
        // Ancora no cursor: escalar a partir do canto faz o ponto de interesse fugir da tela.
        const px = clienteX - area.left - area.width / 2;
        const py = clienteY - area.top - area.height / 2;
        setPos((p) =>
          novo === ZMIN
            ? { x: 0, y: 0 }
            : {
                x: px - (px - p.x) * (novo / atual),
                y: py - (py - p.y) * (novo / atual),
              },
        );
        return novo;
      });
    },
    [],
  );

  // ⚠️ A RODA SOZINHA DÁ ZOOM, sem Ctrl. `passive: false` é obrigatório para o preventDefault
  // valer — senão a página rola junto e o mapa foge.
  useEffect(() => {
    const el = cena.current;
    if (!el) return;
    const naRoda = (ev: WheelEvent) => {
      ev.preventDefault();
      aplicarZoom(zoom * (ev.deltaY < 0 ? 1.18 : 1 / 1.18), ev.clientX, ev.clientY);
    };
    el.addEventListener("wheel", naRoda, { passive: false });
    return () => el.removeEventListener("wheel", naRoda);
  }, [aplicarZoom, zoom]);

  // ⚠️ A CAPTURA NÃO ACONTECE NO `pointerdown`. `setPointerCapture` redireciona os eventos
  // seguintes para quem capturou, e o `click` passa a nascer NA CENA em vez de no `<path>` do
  // lote: com o mapa afastado o clique funcionava (o arraste só liga acima do zoom mínimo) e ao
  // aproximar parava. A cena só captura quando o ponteiro ANDA de verdade.
  const aoDescer = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      if (zoom <= ZMIN) return;
      arrasto.current = {
        capturou: false,
        moveu: false,
        px: pos.x,
        py: pos.y,
        x: ev.clientX,
        y: ev.clientY,
      };
    },
    [pos.x, pos.y, zoom],
  );

  const aoMover = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    const a = arrasto.current;
    if (!a) return;
    const dx = ev.clientX - a.x;
    const dy = ev.clientY - a.y;

    if (!a.moveu && (Math.abs(dx) > TOLERANCIA_DE_CLIQUE || Math.abs(dy) > TOLERANCIA_DE_CLIQUE)) {
      a.moveu = true;
      try {
        cena.current?.setPointerCapture(ev.pointerId);
        a.capturou = true;
      } catch {
        // Ponteiro que já sumiu (toque cancelado): o arraste segue sem captura.
      }
    }

    if (a.moveu) setPos({ x: a.px + dx, y: a.py + dy });
  }, []);

  const aoSoltar = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    if (arrasto.current?.capturou && cena.current?.hasPointerCapture(ev.pointerId)) {
      cena.current.releasePointerCapture(ev.pointerId);
    }
    // ⚠️ A BANDEIRA SOBREVIVE AO CLIQUE. O `onClick` do path roda DEPOIS do pointerup, e é ele
    // que a consulta — limpar aqui, direto, faria o painel abrir no fim de todo arraste.
    const marca = arrasto.current;
    if (marca?.moveu) {
      setTimeout(() => {
        if (arrasto.current === marca) arrasto.current = null;
      }, 0);
      return;
    }
    arrasto.current = null;
  }, []);

  return (
    <div
      onPointerCancel={aoSoltar}
      onPointerDown={aoDescer}
      onPointerMove={aoMover}
      onPointerUp={aoSoltar}
      ref={cena}
      style={{
        alignItems: "center",
        background: fundo,
        cursor: zoom > ZMIN ? "grab" : "default",
        display: "flex",
        flex: 1,
        justifyContent: "center",
        minHeight: 0,
        overflow: "hidden",
        position: "relative",
        // Sem isto o navegador do celular rola a página em vez de arrastar o mapa.
        touchAction: "none",
      }}
    >
      <div
        style={{
          height: "100%",
          position: "relative",
          transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})`,
          transformOrigin: "center center",
          width: "100%",
        }}
      >
        {/* Quem contém a arte é o `preserveAspectRatio`, e não o CSS: ele mostra o desenho
            INTEIRO, centralizado e na proporção certa, seja qual for o formato da janela. */}
        <svg
          preserveAspectRatio="xMidYMid meet"
          style={{ display: "block", height: "100%", width: "100%" }}
          viewBox={geometria.viewBox}
        >
          <image
            height={caixa.altura}
            href={urlDaArte}
            width={caixa.largura}
            x={caixa.x}
            y={caixa.y}
          />

          {geometria.contornos.map((c) => (
            <path
              d={c.d}
              fill={corDoLote(c.codigo)}
              // A planta aparece por baixo: é ela que traz número, metragem e rua.
              fillOpacity={opacidade}
              fillRule="evenodd"
              key={c.codigo}
              onClick={() => {
                // Arrastou o mapa? Então não foi clique em lote.
                if (arrasto.current?.moveu) return;
                aoClicar(c.codigo);
              }}
              stroke={destacado === c.codigo ? "#ffffff" : "none"}
              strokeWidth={destacado === c.codigo ? 3 : 0}
              style={{ cursor: "pointer" }}
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
