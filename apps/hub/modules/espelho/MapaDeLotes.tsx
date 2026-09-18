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
// ⚠️ E DIVERGIRAM: ATÉ 14/09/2026 ESTE COMENTÁRIO ERA FALSO. O espelho público tinha a própria
// cópia do desenho, e por isso o conserto do clique no buraco do `evenodd` — feito aqui pela
// manhã e anunciado no changelog 1.338.0 — NÃO chegou à tela onde o Lucas viu o defeito: a Mesa
// consertou, o público continuou perdendo o clique. A cópia foi apagada e o público passou a usar
// este motor. É o custo exato que o parágrafo acima previa, cobrado no mesmo dia.
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

/**
 * O deslocamento que ainda mostra o mapa: nunca se arrasta a arte para fora da tela.
 *
 * ⚠️ COM O ZOOM NA ORIGEM (1) NÃO HÁ PARA ONDE IR: a arte inteira já cabe, e o limite é zero. A cada
 * aproximação a folga cresce na mesma proporção (a cena escala a partir do centro).
 */
export function limitarDeslocamento(
  pos: { x: number; y: number },
  zoom: number,
  area: { height: number; width: number },
): { x: number; y: number } {
  const folgaX = (area.width * (zoom - 1)) / 2;
  const folgaY = (area.height * (zoom - 1)) / 2;
  // `|| 0` troca o −0 (limite zero com sinal) por 0: é o mesmo lugar, mas o −0 vaza para o CSS.
  return {
    x: Math.max(-folgaX, Math.min(folgaX, pos.x)) || 0,
    y: Math.max(-folgaY, Math.min(folgaY, pos.y)) || 0,
  };
}

/**
 * Só o contorno do lote, sem os sub-caminhos do balão do número.
 *
 * ⚠️ O PRIMEIRO SUB-CAMINHO É O TERRENO, e os seguintes são decoração que o importador trouxe
 * junto do SVG (o círculo do número, poligonizado). Cortar no primeiro `Z` devolve o polígono
 * maciço do lote — que é o que a área de toque precisa ser.
 *
 * ⚠️ SEM `Z` NENHUM, DEVOLVE O CAMINHO INTEIRO. Um `d` de uma figura só, ou um formato que o
 * importador mude amanhã, continua clicável: perder o clique de novo é pior do que uma área de
 * toque um pouco maior do que o desenho.
 */
export function areaDeToque(d: string): string {
  const corte = String(d ?? "").search(/[Zz]/);
  if (corte < 0) return d;
  return `${d.slice(0, corte)}Z`;
}

export function MapaDeLotes({
  aoClicar,
  clicavel,
  corDoLote,
  destacado,
  fundo,
  geometria,
  opacidade = 0.6,
  urlDaArte,
}: {
  /** Chamado com o código do lote. Não dispara quando o gesto foi arraste. */
  aoClicar: (codigo: string) => void;
  /**
   * Este contorno abre alguma coisa? Ausente, todos abrem.
   *
   * ⚠️ É O ÚNICO AVISO PRÉVIO QUE O MAPA DÁ. Nem todo contorno do masterplan tem unidade no
   * cadastro, e a mãozinha do cursor sobre um deles promete um painel que não vai abrir. Quem
   * devolve `false` aqui ganha o cursor de seta — a pessoa descobre antes de clicar, e não
   * depois de clicar e nada acontecer.
   */
  clicavel?: (codigo: string) => boolean;
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
            : limitarDeslocamento(
                {
                  x: px - (px - p.x) * (novo / atual),
                  y: py - (py - p.y) * (novo / atual),
                },
                novo,
                area,
              ),
        );
        return novo;
      });
    },
    [],
  );

  // ── O TOQUE: A PINÇA E O ARRASTE COM O DEDO ─────────────────────────────────
  //
  // ⚠️ `touchAction: none` DESLIGA OS GESTOS DO NAVEGADOR, e até 18/09/2026 nada os substituía: o zoom
  // era só pela roda do mouse, e o arraste só existia com o zoom já ligado. No celular o mapa ficava
  // "todo travado" (Lucas). Os dedos vivem aqui: cada ponteiro na tela é lembrado pelo id, e dois ao
  // mesmo tempo viram pinça, ancorada no ponto entre os dedos (como a roda ancora no cursor).
  const dedos = useRef(new Map<number, { x: number; y: number }>());
  const pinca = useRef<null | {
    distancia: number;
    meio: { x: number; y: number };
    pos: { x: number; y: number };
    zoom: number;
  }>(null);

  const medirPinca = useCallback(() => {
    const [a, b] = [...dedos.current.values()];
    if (!a || !b) return null;
    return {
      distancia: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
      meio: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }, []);

  // Girar o celular muda o tamanho da cena: o deslocamento é recortado de novo para o mapa não
  // ficar fora da tela depois de deitar ou levantar o aparelho.
  useEffect(() => {
    const el = cena.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observador = new ResizeObserver(() => {
      const area = el.getBoundingClientRect();
      setPos((p) => limitarDeslocamento(p, zoom, area));
    });
    observador.observe(el);
    return () => observador.disconnect();
  }, [zoom]);

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
      dedos.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

      // O SEGUNDO DEDO VIRA PINÇA. O gesto passa a ser de zoom, e nenhum clique de lote vale até
      // o fim dele (a bandeira `moveu` é a mesma que o arraste usa).
      if (dedos.current.size === 2) {
        const medida = medirPinca();
        if (medida) {
          pinca.current = { ...medida, pos: { ...pos }, zoom };
          arrasto.current = {
            capturou: false,
            moveu: true,
            px: pos.x,
            py: pos.y,
            x: ev.clientX,
            y: ev.clientY,
          };
          for (const id of dedos.current.keys()) {
            try {
              cena.current?.setPointerCapture(id);
            } catch {
              // Dedo que já saiu: a pinça segue com o que sobrou.
            }
          }
        }
        return;
      }

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
    [medirPinca, pos, zoom],
  );

  const aoMover = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    if (dedos.current.has(ev.pointerId)) {
      dedos.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    }

    const p = pinca.current;
    if (p && dedos.current.size >= 2) {
      const medida = medirPinca();
      const area = cena.current?.getBoundingClientRect();
      if (!medida || !area) return;
      const novo = Math.min(ZMAX, Math.max(ZMIN, p.zoom * (medida.distancia / p.distancia)));
      // O ponto da arte que estava entre os dedos no começo fica entre os dedos agora, mesmo que
      // eles tenham andado: é a pinça e o arraste de dois dedos na mesma conta.
      const centro = { x: area.left + area.width / 2, y: area.top + area.height / 2 };
      const m0 = { x: p.meio.x - centro.x, y: p.meio.y - centro.y };
      const m1 = { x: medida.meio.x - centro.x, y: medida.meio.y - centro.y };
      setZoom(novo);
      setPos(
        novo === ZMIN
          ? { x: 0, y: 0 }
          : limitarDeslocamento(
              {
                x: m1.x - (m0.x - p.pos.x) * (novo / p.zoom),
                y: m1.y - (m0.y - p.pos.y) * (novo / p.zoom),
              },
              novo,
              area,
            ),
      );
      return;
    }

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

    if (a.moveu) {
      const area = cena.current?.getBoundingClientRect();
      const alvo = { x: a.px + dx, y: a.py + dy };
      setPos(area ? limitarDeslocamento(alvo, zoom, area) : alvo);
    }
  }, [medirPinca, zoom]);

  const aoSoltar = useCallback((ev: React.PointerEvent<HTMLDivElement>) => {
    dedos.current.delete(ev.pointerId);
    if (cena.current?.hasPointerCapture(ev.pointerId)) {
      cena.current.releasePointerCapture(ev.pointerId);
    }

    // ⚠️ A PINÇA ACABOU E UM DEDO FICOU: o arraste recomeça DAQUI, com o zoom novo. Sem isto o dedo
    // que sobrou puxaria o mapa pela distância acumulada desde o começo da pinça, num salto.
    if (pinca.current) {
      pinca.current = null;
      const [restante] = [...dedos.current.values()];
      const marca = arrasto.current;
      if (restante && zoom > ZMIN) {
        arrasto.current = {
          capturou: true,
          moveu: true,
          px: pos.x,
          py: pos.y,
          x: restante.x,
          y: restante.y,
        };
      } else if (marca) {
        setTimeout(() => {
          if (arrasto.current === marca) arrasto.current = null;
        }, 0);
      }
      return;
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
  }, [pos, zoom]);

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

          {/* ⚠️ O BURACO DO `evenodd` ENGOLIA O CLIQUE, e por isso são DOIS caminhos por lote.
              Lucas (14/09/2026): *"o lote 09 e 11 da quadra d quando clico não acontece nada"*.

              O `d` de cada lote tem DOIS ou TRÊS sub-caminhos: o contorno do terreno e o balão do
              número, poligonizado pelo importador. Com `fillRule="evenodd"` o segundo vira BURACO —
              que é exatamente o que se quer no desenho, porque é assim que o número e a metragem da
              planta aparecem nítidos por baixo da cor. Só que buraco em SVG NÃO RECEBE CLIQUE: quem
              mirava o número (que é onde qualquer pessoa mira) clicava no vazio. Medido no Villa
              Paris: todo lote da quadra D tem 2 sub-caminhos, e D04, D05, D12 e D13 têm 3 — dois
              buracos cada.

              ⚠️ E NÃO SE RESOLVE TROCANDO PARA `nonzero`: aí o balão deixa de ser buraco, a cor
              passa por cima do número e o mapa perde a legenda que a planta traz. A separação é o
              conserto: um caminho PINTA (com os buracos) e outro, invisível e só com o contorno,
              RECEBE O CLIQUE. */}
          {geometria.contornos.map((c) => (
            <g key={c.codigo}>
              <path
                d={c.d}
                fill={corDoLote(c.codigo)}
                // A planta aparece por baixo: é ela que traz número, metragem e rua.
                fillOpacity={opacidade}
                fillRule="evenodd"
                // ⚠️ QUEM PINTA NÃO OUVE. Sem isto os dois caminhos disputam o evento, e o de cima
                // volta a decidir pelo buraco.
                pointerEvents="none"
                stroke={destacado === c.codigo ? "#ffffff" : "none"}
                strokeWidth={destacado === c.codigo ? 3 : 0}
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={areaDeToque(c.d)}
                fill="transparent"
                // ⚠️ `nonzero` AQUI DE PROPÓSITO: esta área é só o contorno do lote, sem balão
                // nenhum, e ela precisa ser maciça do começo ao fim.
                fillRule="nonzero"
                onClick={() => {
                  // Arrastou o mapa? Então não foi clique em lote.
                  if (arrasto.current?.moveu) return;
                  aoClicar(c.codigo);
                }}
                style={{
                  cursor: clicavel?.(c.codigo) === false ? "default" : "pointer",
                }}
              />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
