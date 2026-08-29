"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DesenhoDoMasterplan } from "@/lib/prometeu/desenho-do-masterplan";
import { EVENTO_CHAMADO } from "@/lib/prometeu/fila-topic";
import type { SituacaoDoLote } from "@/lib/prometeu/situacao-do-lote";

// O TELÃO DO MASTERPLAN — o mapa de lotes projetado no salão do lançamento.
//
// ⚠️ SÓ O MAPA. NADA MAIS. Regra do Lucas em 28/08/2026, depois de ver a primeira versão com
// legenda e contagem: *"nada de informação, somente mostrar o masterplan (...) o que vai no
// telão, masterplan lançamento é somente o masterplan"*. Sem legenda, sem nome do lançamento,
// sem contadores, sem hora de atualização — nada flutuando por cima da arte.
//
// A versão COMERCIAL, com os números do estilo que o CER já tem, é outra tela e virá depois.
// Se algum dia bater a tentação de "só um cantinho com o total", é esta linha que diz não.
//
// ⚠️ E, por ser projetada para o salão inteiro, num link sem login e em máquina de terceiro:
// nunca nome de comprador, nunca valor. A lição é do Garden, onde uma página interna sem senha
// expôs nome e preço. O dado já chega filtrado do servidor.

type Contagem = Record<SituacaoDoLote, number>;

export type EstadoDoMasterplan = {
  atualizadoEm: string;
  contagem: Contagem;
  lotes: Record<string, SituacaoDoLote>;
};

type Props = {
  desenho: DesenhoDoMasterplan;
  estadoInicial: EstadoDoMasterplan;
  realtime: { key: string; topico: string; url: string };
  token: string;
};

// DUAS CORES, E SÓ (Lucas, 28/08): livre ou não livre. O azul é o do PRÓPRIO C2X — na tabela
// `sale_statuses`, Reservado, Em negociação, Vendido e Bloqueado compartilham o mesmo #0544ff.
// Não é simplificação nossa: é a convenção que o time comercial já enxerga há anos, e inventar
// paleta própria aqui criaria duas linguagens para a mesma informação.
//
// ⚠️ O VERDE, ESSE, NÃO É O DO C2X. Lá o Disponível é #398f19, um verde escuro — que no papel
// funciona, mas neste mapa cairia em cima da GRAMA do loteamento e sumiria. O verde vivo
// destaca o lote livre contra o terreno, que é a única coisa que o cliente procura no telão.
const VERDE_DISPONIVEL = "rgba(34, 197, 94, 0.72)";
const AZUL_OCUPADO = "rgba(5, 68, 255, 0.72)";

const POLL_MS = 20_000;

export function TelaoMasterplan({
  desenho,
  estadoInicial,
  realtime,
  token,
}: Props) {
  const [estado, setEstado] = useState(estadoInicial);
  const [contornos, setContornos] = useState<null | Record<string, string>>(
    null,
  );
  const buscando = useRef(false);

  // Os contornos (um path por lote) vêm de arquivo estático, e não do bundle: são mais de 100 KB
  // que não têm por que pesar em toda página do hub. O fundo já aparece enquanto eles chegam.
  useEffect(() => {
    let vivo = true;
    void fetch(desenho.contornos)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: null | Record<string, string>) => {
        if (vivo && d) setContornos(d);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [desenho.contornos]);

  const atualizar = useCallback(async () => {
    if (buscando.current) return;
    buscando.current = true;
    try {
      const r = await fetch(
        `/api/publico/prometeu/masterplan?tv=${encodeURIComponent(token)}`,
        {
          cache: "no-store",
        },
      );
      if (!r.ok) return;
      const d = (await r.json()) as EstadoDoMasterplan;
      if (d?.lotes) setEstado(d);
    } catch {
      // Telão não mostra erro de rede: manter o último mapa bom é melhor que piscar aviso na
      // frente do salão. A próxima rodada conserta.
    } finally {
      buscando.current = false;
    }
  }, [token]);

  // BROADCAST + POLL. O broadcast é quem entrega em segundos; o poll de 20s é rede de segurança
  // para o caso de o WebSocket cair no meio do evento — que foi exatamente o que aconteceu com
  // a TV da fila em 02/08. Num telão projetado, um minuto de mapa errado é uma eternidade.
  useEffect(() => {
    const timer = window.setInterval(() => void atualizar(), POLL_MS);
    if (!realtime.url || !realtime.key) {
      return () => window.clearInterval(timer);
    }

    const supabase = createClient(realtime.url, realtime.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // ⚠️ Escuta o canal do EVENTO, não um canal só do masterplan: a reserva já avisa nele
    // (avisarFilaEmRealtime, chamado no POST da reserva). Um refetch a mais quando alguém é
    // chamado na fila custa nada perto de manter um segundo canal vivo.
    //
    // ⚠️ E escuta o evento NOMINAL, não `"*"`: o wildcard depende de suporte da versão do
    // supabase-js e falha calado se não houver — num telão, falhar calado é o pior modo de
    // falhar, porque a tela continua bonita mostrando o mapa errado. Com a constante
    // importada, mudar o nome do evento quebra o build em vez de quebrar a projeção.
    const canal = supabase
      .channel(realtime.topico, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: EVENTO_CHAMADO }, () => void atualizar())
      .subscribe();

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(canal);
    };
  }, [atualizar, realtime.key, realtime.topico, realtime.url]);

  return (
    // A arte é 4K (3840×2160) e ocupa a tela inteira. `object-contain` preserva a proporção em
    // qualquer projetor; o fundo escuro só aparece nas bordas quando a tela não é 16:9.
    <main className="relative h-dvh w-dvw overflow-hidden bg-[#0b1017]">
      <div className="absolute inset-0 grid place-items-center">
        <div className="relative aspect-[16/9] max-h-full w-full max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- arte estática do
              loteamento, servida de /public; o otimizador do Next serviria uma versão
              redimensionada, que é justamente o que não se quer numa projeção 4K. */}
          {/* ⚠️ `imageRendering: high-quality` NÃO É ENFEITE. A arte tem 3840px de largura e a
              tela do salão quase nunca tem exatamente isso: o Chrome reduz, e no filtro padrão
              (rápido) as divisas de 1px e os números pequenos saem SERRILHADOS — foi o que o
              Lucas viu em 29/08. Com `high-quality` o Chrome usa reamostragem melhor no
              downscale, e o mapa volta a ficar limpo em qualquer resolução de projetor.
              Conferido antes de mexer: o arquivo servido é byte a byte o que o designer
              exportou, então não havia perda no caminho — o serrilhado nascia aqui. */}
          <img
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
            src={desenho.base}
            style={{ imageRendering: "high-quality" as never }}
          />
          {contornos ? (
            <svg
              aria-hidden="true"
              className="absolute inset-0 h-full w-full"
              preserveAspectRatio="xMidYMid meet"
              viewBox={desenho.viewBox}
            >
              {Object.entries(contornos).map(([nome, d]) => {
                const situacao = estado.lotes[nome];
                if (!situacao) return null;
                return (
                  <path
                    d={d}
                    // ⚠️ evenodd é o que deixa o NÚMERO do lote aparecer: o desenho traz o
                    // contorno e um furo por cima do marcador redondo. Sem isto, a cor cobre
                    // o número e o mapa fica ilegível de longe.
                    fill={
                      situacao === "disponivel"
                        ? VERDE_DISPONIVEL
                        : AZUL_OCUPADO
                    }
                    fillRule="evenodd"
                    key={nome}
                    stroke="rgba(255,255,255,0.28)"
                    strokeWidth={1.5}
                  />
                );
              })}
            </svg>
          ) : null}
        </div>
      </div>
    </main>
  );
}
