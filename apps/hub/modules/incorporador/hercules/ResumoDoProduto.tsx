"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  BadgeDollarSign,
  Bookmark,
  Building2,
  ClipboardList,
  FileSignature,
  FileText,
  type LucideIcon,
  RefreshCw,
  Users,
} from "lucide-react";

import type { ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";
import type { ResumoDoProduto as DadosDoResumo } from "@/lib/apolo/incorporador/resumo-do-produto";
import { ResumoTab } from "@/modules/apolo/blocks/empreendimentos/empreendimentos-view";

import { MOLDURA_TAILWIND } from "../TelaContratos";
import { useTemaDoPortal } from "../tema";

// A ABA RESUMO DA FICHA DO PRODUTO (Hércules).
//
// Lucas (02/09/2026): *"produtos é replicar a tela que temos hoje em empreendimento do apolo"*. A
// aba é o ResumoTab do Apolo (Comercial % vendido + Empreendimento) MAIS o que o coordenador
// precisa e o Apolo não mostra: a FAIXA DO PROCESSO, na ordem em que a venda acontece —
//
//   quem vende (dourado)  →  cadastro (azul)  →  venda (verde)
//   Imobiliárias · Corretores · CADs em andamento · Credenciados · Reservas · Propostas ·
//   Em contrato · Vendidas
//
// Cada bloco é um atalho: clicar leva à aba que detalha aquele número (`onIr`). Abaixo, o
// ResumoTab e dois cartões: as CADs por etapa (barras) e quem vende este produto.
//
// ⚠️ O ROW VEM POR PROPS, A FAIXA VEM DA ROTA. O ResumoTab só precisa da linha que o painel já
// entregou (a frente A converte `LinhaDoPainel` em `ApoloEnterpriseRow`), então ele renderiza na
// hora; a faixa pede /api/incorporador/produto/resumo (C2X + Apolo) e chega depois. Sem polling.
//
// ⚠️ TAILWIND DENTRO DO PORTAL — a moldura ÚNICA da TelaContratos (`MOLDURA_TAILWIND`): redeclara
// as `--color-*` do @theme para os `--inc-*` do portal (só `--uix-*` não basta — o porquê está
// lá), e o `data-uix-theme` carrega o tema EFETIVO do portal para os utilitários `dark:`
// responderem.

/** O dourado da casa. Só ele fica em hex: azul e verde já são utilitários do hub. */
const DOURADO = "#A07C3B";

type Aba = "cadastro" | "contratos" | "imobiliarias" | "vendas";

/** A fase de cada bloco, que dá a cor da borda esquerda. */
type Fase = "cadastro" | "quemVende" | "venda";

const BORDA_DA_FASE: Record<Fase, string> = {
  cadastro: "border-l-blue-600 dark:border-l-blue-500",
  quemVende: "",
  venda: "border-l-emerald-600 dark:border-l-emerald-500",
};

type Bloco = {
  aba: Aba;
  fase: Fase;
  icone: LucideIcon;
  numero: number;
  rotulo: string;
  subtexto: string;
};

/** Os oito blocos, na ordem do processo do coordenador. */
function blocosDaFaixa(processo: DadosDoResumo["processo"]): Bloco[] {
  return [
    {
      aba: "imobiliarias",
      fase: "quemVende",
      icone: Building2,
      numero: processo.imobiliariasHabilitadas,
      rotulo: "Imobiliárias",
      subtexto: `${processo.imobiliariasHabilitadas} habilitadas · ${processo.imobiliariasAguardando} aguardando`,
    },
    {
      aba: "imobiliarias",
      fase: "quemVende",
      icone: Users,
      numero: processo.corretores,
      rotulo: "Corretores",
      subtexto: "com CAD neste produto",
    },
    {
      aba: "cadastro",
      fase: "cadastro",
      icone: ClipboardList,
      numero: processo.cadsEmAndamento,
      rotulo: "CADs em andamento",
      subtexto:
        processo.cadsCorrecao > 0
          ? `${processo.cadsCorrecao} com correção`
          : "nenhuma em correção",
    },
    {
      aba: "cadastro",
      fase: "cadastro",
      icone: BadgeCheck,
      numero: processo.credenciados,
      rotulo: "Credenciados",
      subtexto: "prontos para reservar",
    },
    {
      aba: "vendas",
      fase: "venda",
      icone: Bookmark,
      numero: processo.reservas,
      rotulo: "Reservas",
      subtexto: "unidades reservadas",
    },
    {
      aba: "vendas",
      fase: "venda",
      icone: FileText,
      numero: processo.propostas,
      rotulo: "Propostas",
      subtexto: "em análise ou emitidas",
    },
    {
      aba: "contratos",
      fase: "venda",
      icone: FileSignature,
      numero: processo.emContrato + processo.emAssinatura,
      rotulo: "Em contrato",
      subtexto: `${processo.emContrato} gerados · ${processo.emAssinatura} em assinatura`,
    },
    {
      aba: "vendas",
      fase: "venda",
      icone: BadgeDollarSign,
      numero: processo.vendidas,
      rotulo: "Vendidas",
      subtexto: "unidades faturadas",
    },
  ];
}

type Estado =
  | { dados: DadosDoResumo; tipo: "pronto" }
  | { mensagem: string; tipo: "erro" }
  | { tipo: "carregando" };

export function ResumoDoProduto({
  emp,
  onIr,
  row,
}: {
  emp: string;
  onIr: (aba: Aba) => void;
  row: ApoloEnterpriseRow;
}) {
  const { efetivo } = useTemaDoPortal();
  const [estado, setEstado] = useState<Estado>({ tipo: "carregando" });

  const carregar = useCallback(async () => {
    setEstado({ tipo: "carregando" });

    try {
      const resposta = await fetch(
        `/api/incorporador/produto/resumo?emp=${encodeURIComponent(emp)}`,
        { cache: "no-store" },
      );
      const corpo = (await resposta.json().catch(() => null)) as
        | { data?: DadosDoResumo; error?: string }
        | null;

      if (!resposta.ok || !corpo?.data) {
        setEstado({
          mensagem: corpo?.error ?? "Não foi possível carregar o resumo agora.",
          tipo: "erro",
        });
        return;
      }

      setEstado({ dados: corpo.data, tipo: "pronto" });
    } catch {
      setEstado({ mensagem: "Não foi possível carregar o resumo agora.", tipo: "erro" });
    }
  }, [emp]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <div
      className="grid gap-3"
      data-uix-theme={efetivo === "escuro" ? "dark" : "light"}
      style={MOLDURA_TAILWIND}
    >
      {/* ── 1. A FAIXA DO PROCESSO ──────────────────────────────────────────── */}
      {estado.tipo === "carregando" ? <FaixaEsqueleto /> : null}
      {estado.tipo === "erro" ? (
        <FaixaErro mensagem={estado.mensagem} onTentar={() => void carregar()} />
      ) : null}
      {estado.tipo === "pronto" ? (
        <FaixaDoProcesso blocos={blocosDaFaixa(estado.dados.processo)} onIr={onIr} />
      ) : null}

      {/* ── 2. O RESUMO DO APOLO, como está lá ─────────────────────────────── */}
      <ResumoTab row={row} />

      {/* ── 3. CADs por etapa · Quem vende ──────────────────────────────────── */}
      <div className="grid gap-3 lg:grid-cols-2">
        {estado.tipo === "pronto" ? (
          <>
            <CadsPorEtapa
              barras={estado.dados.cadsPorEtapa}
              onIr={() => onIr("cadastro")}
            />
            <QuemVende
              onIr={() => onIr("imobiliarias")}
              quemVende={estado.dados.quemVende}
            />
          </>
        ) : (
          <>
            <CartaoEsqueleto />
            <CartaoEsqueleto />
          </>
        )}
      </div>
    </div>
  );
}

// ── A faixa ─────────────────────────────────────────────────────────────────

function FaixaDoProcesso({ blocos, onIr }: { blocos: Bloco[]; onIr: (aba: Aba) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8">
      {blocos.map((bloco) => {
        const Icone = bloco.icone;
        return (
          <button
            className={`group rounded-xl border border-line border-l-4 bg-surface p-3 text-left transition hover:bg-subtle focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${BORDA_DA_FASE[bloco.fase]}`}
            key={bloco.rotulo}
            onClick={() => onIr(bloco.aba)}
            style={bloco.fase === "quemVende" ? { borderLeftColor: DOURADO } : undefined}
            title={`Abrir ${bloco.rotulo.toLowerCase()}`}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                {bloco.rotulo}
              </span>
              <Icone aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
            </div>
            <p className="m-0 mt-1.5 text-2xl font-semibold tabular-nums leading-none text-ink">
              {bloco.numero.toLocaleString("pt-BR")}
            </p>
            <p className="m-0 mt-1.5 truncate text-[11px] text-ink-soft" title={bloco.subtexto}>
              {bloco.subtexto}
            </p>
          </button>
        );
      })}
    </div>
  );
}

function FaixaEsqueleto() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-8"
    >
      <span className="sr-only">Carregando</span>
      {Array.from({ length: 8 }).map((_, indice) => (
        <div
          className="h-[86px] animate-pulse rounded-xl border border-line bg-subtle"
          key={indice}
        />
      ))}
    </div>
  );
}

function FaixaErro({ mensagem, onTentar }: { mensagem: string; onTentar: () => void }) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
      role="alert"
    >
      <span>{mensagem}</span>
      <button
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-surface px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-subtle dark:border-red-800 dark:text-red-300"
        onClick={onTentar}
        type="button"
      >
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Tentar de novo
      </button>
    </div>
  );
}

// ── Os cartões ──────────────────────────────────────────────────────────────

function CadsPorEtapa({
  barras,
  onIr,
}: {
  barras: DadosDoResumo["cadsPorEtapa"];
  onIr: () => void;
}) {
  const total = barras.reduce((acc, barra) => acc + barra.quantidade, 0);
  const maior = Math.max(1, ...barras.map((barra) => barra.quantidade));

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          CADs por etapa
        </p>
        <button
          className="text-xs font-semibold text-ink-muted hover:text-ink"
          onClick={onIr}
          type="button"
        >
          Ver cadastro
        </button>
      </div>
      <p className="m-0 mt-2 text-2xl font-semibold tabular-nums text-ink">
        {total.toLocaleString("pt-BR")}
        <span className="ml-2 text-sm font-medium text-ink-muted">
          {total === 1 ? "cadastro" : "cadastros"}
        </span>
      </p>

      {total === 0 ? (
        <p className="m-0 mt-3 text-sm text-ink-muted">Nenhuma CAD neste produto ainda.</p>
      ) : (
        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
          {barras.map((barra) => (
            <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1" key={barra.etapa}>
              <span className="truncate text-xs font-medium text-ink-soft">{barra.rotulo}</span>
              <span className="text-xs font-semibold tabular-nums text-ink">
                {barra.quantidade.toLocaleString("pt-BR")}
              </span>
              <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-subtle">
                <div
                  className="h-full rounded-full bg-blue-600 dark:bg-blue-500"
                  style={{ width: `${(barra.quantidade / maior) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function QuemVende({
  onIr,
  quemVende,
}: {
  onIr: () => void;
  quemVende: DadosDoResumo["quemVende"];
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Quem vende este produto
        </p>
        <button
          className="text-xs font-semibold text-ink-muted hover:text-ink"
          onClick={onIr}
          type="button"
        >
          Ver imobiliárias
        </button>
      </div>
      <p className="m-0 mt-2 text-2xl font-semibold tabular-nums text-ink">
        {quemVende.habilitadas.toLocaleString("pt-BR")}
        <span className="ml-2 text-sm font-medium text-ink-muted">
          {quemVende.habilitadas === 1 ? "imobiliária habilitada" : "imobiliárias habilitadas"}
        </span>
      </p>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <Fato rotulo="Aguardando habilitação" valor={quemVende.aguardando.toLocaleString("pt-BR")} />
        <Fato rotulo="Corretores" valor={quemVende.corretores.toLocaleString("pt-BR")} />
        <Fato
          rotulo="Maior imobiliária"
          valor={quemVende.maior ? quemVende.maior.nome : "Nenhuma CAD com imobiliária"}
        />
        <Fato
          rotulo="CADs dela"
          valor={quemVende.maior ? quemVende.maior.cads.toLocaleString("pt-BR") : "-"}
        />
      </dl>
    </section>
  );
}

function Fato({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="m-0 text-xs font-medium text-ink-muted">{rotulo}</dt>
      <dd className="m-0 mt-0.5 truncate text-sm font-semibold text-ink" title={valor}>
        {valor}
      </dd>
    </div>
  );
}

function CartaoEsqueleto() {
  return <div className="h-48 animate-pulse rounded-xl border border-line bg-subtle" />;
}
