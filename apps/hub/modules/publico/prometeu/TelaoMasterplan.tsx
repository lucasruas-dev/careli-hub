"use client";

import { createClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DesenhoDoMasterplan } from "@/lib/prometeu/desenho-do-masterplan";
import type { SituacaoDoLote } from "@/lib/prometeu/situacao-do-lote";

// O TELÃO DO MASTERPLAN — o mapa de lotes projetado no salão do lançamento.
//
// ⚠️ ESTA TELA É PROJETADA PARA O SALÃO INTEIRO e roda em máquina de terceiro, por um link sem
// login. Ela mostra SÓ a cor de cada lote — nunca nome de comprador, nunca valor. A lição é do
// Garden, onde uma página interna sem senha expôs nome e preço. O dado já chega filtrado do
// servidor; não acrescente campo nesta tela sem revisar essa decisão.
//
// Fluxo: o servidor entrega o mapa já pintado no primeiro pixel (nada de tela cinza esperando
// fetch na frente do salão), e daqui em diante a tela só se atualiza — pelo broadcast do
// Realtime, em segundos, com um poll lento como rede de segurança.

type Contagem = Record<SituacaoDoLote, number>;

export type EstadoDoMasterplan = {
  atualizadoEm: string;
  contagem: Contagem;
  lotes: Record<string, SituacaoDoLote>;
};

type Props = {
  desenho: DesenhoDoMasterplan;
  estadoInicial: EstadoDoMasterplan;
  evento: { data: null | string; nome: string };
  realtime: { key: string; topico: string; url: string };
  token: string;
};

// As cores do salão. Translúcidas de propósito: o terreno, a rua e o número do lote precisam
// continuar visíveis por baixo — o mapa é a arte do loteamento, não um gráfico.
const COR: Record<SituacaoDoLote, string> = {
  disponivel: "rgba(34, 197, 94, 0.55)",
  indisponivel: "rgba(120, 128, 140, 0.45)",
  reservado: "rgba(245, 158, 11, 0.62)",
  vendido: "rgba(239, 68, 68, 0.55)",
};

const ROTULO: Record<SituacaoDoLote, string> = {
  disponivel: "Disponível",
  indisponivel: "Indisponível",
  reservado: "Reservado",
  vendido: "Vendido",
};

// A ordem da legenda é a da jornada do lote, não a alfabética.
const ORDEM: SituacaoDoLote[] = [
  "disponivel",
  "reservado",
  "vendido",
  "indisponivel",
];

const POLL_MS = 60_000;

export function TelaoMasterplan({
  desenho,
  estadoInicial,
  evento,
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

  // BROADCAST + POLL. O broadcast dá o segundo; o poll de 1 minuto é o que garante que a
  // projeção não fica congelada se o WebSocket cair no meio do evento — que foi exatamente o
  // que aconteceu com a TV da fila em 02/08.
  useEffect(() => {
    const timer = window.setInterval(() => void atualizar(), POLL_MS);
    if (!realtime.url || !realtime.key) {
      return () => window.clearInterval(timer);
    }

    const supabase = createClient(realtime.url, realtime.key, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    // ⚠️ Escuta o canal do EVENTO, não um canal só do masterplan: a reserva já avisa nele
    // (avisarFilaEmRealtime, chamado no POST da reserva). Qualquer aviso serve de gatilho — a
    // fonte da verdade continua sendo o servidor, e um refetch a mais quando alguém é chamado
    // na fila custa nada perto de manter um segundo canal vivo.
    const canal = supabase
      .channel(realtime.topico, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "*" }, () => void atualizar())
      .subscribe();

    return () => {
      window.clearInterval(timer);
      void supabase.removeChannel(canal);
    };
  }, [atualizar, realtime.key, realtime.topico, realtime.url]);

  const hora = new Date(estado.atualizadoEm).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    // ⚠️ A ARTE OCUPA A TELA INTEIRA, e tudo o que é nosso flutua por cima. A primeira versão
    // tinha cabeçalho e rodapé próprios, e eles brigavam com o desenho: o loteamento já traz o
    // título ("ESCOLHA SEU LOTE AQUI!") no alto e a faixa de marcas embaixo. Duas molduras
    // concorrendo espremiam o mapa, que é a única coisa que o salão precisa enxergar de longe.
    <main className="relative h-dvh w-dvw overflow-hidden bg-[#0b1017] text-white">
      <div className="absolute inset-0 grid place-items-center">
        <div className="relative aspect-[16/9] max-h-full w-full max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element -- arte estática do
              loteamento, servida de /public; o otimizador do Next não acrescenta nada aqui. */}
          <img
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
            src={desenho.base}
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
                    fill={COR[situacao]}
                    fillRule="evenodd"
                    key={nome}
                    stroke="rgba(255,255,255,0.35)"
                    strokeWidth={1.5}
                  />
                );
              })}
            </svg>
          ) : null}
        </div>
      </div>

      {/* A legenda mora no canto superior esquerdo, sobre o céu escuro da arte: é onde não há
          desenho de lote em nenhum dos mapas, e onde o olho de quem entra no salão cai antes de
          procurar o próprio lote. Fundo translúcido para não virar um bloco opaco na projeção. */}
      <div className="absolute left-6 top-6 rounded-2xl bg-black/45 px-5 py-4 backdrop-blur-sm">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold tracking-tight">
            {evento.nome}
          </h1>
          {evento.data ? (
            <span className="text-sm text-white/45">
              {new Date(evento.data).toLocaleDateString("pt-BR", {
                timeZone: "UTC",
              })}
            </span>
          ) : null}
        </div>
        <dl className="mt-3 flex flex-col gap-2">
          {ORDEM.map((s) => (
            <div className="flex items-center gap-3" key={s}>
              <span
                className="h-4 w-4 shrink-0 rounded border border-white/30"
                style={{ background: COR[s] }}
              />
              <dt className="text-base text-white/70">{ROTULO[s]}</dt>
              <dd className="ml-auto text-xl font-bold tabular-nums">
                {estado.contagem[s]}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* Discreto de propósito, mas presente: mapa projetado que congelou sem ninguém perceber é
          pior que mapa desatualizado com hora à vista. */}
      <span className="absolute bottom-4 right-6 text-xs tabular-nums text-white/30">
        atualizado {hora}
      </span>
    </main>
  );
}
