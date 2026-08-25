"use client";

import { Loader2, Search } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { unidadeParaExibir } from "@/lib/lsoft/unidade";

import type { ApiDoLsoft, SubsidioCarregado } from "./api";

// A VISÃO DO SUBSÍDIO DA CAIXA — parcela por parcela.
//
// Pedido do Lucas (25/08/2026): *"eu queria uma tela diferente para os subsidio, eu precisava
// enxergar esses valores separados... parcela por parcela"*.
//
// A carteira responde "quanto o cliente deve". Esta responde outra pergunta: **o que a Caixa tem
// para pagar, e quanto já pagou**. No Vale do Sol (Minha Casa Minha Vida) o financiamento não é
// dívida do comprador — a Caixa libera por medição de obra, e o crédito cai no extrato CIWEB da
// construtora.
//
// ⚠️ O "JÁ LIBERADO" VEM DO EXTRATO, NÃO DO LSOFT (Lucas, 25/08: *"a baixa da caixa vem dos
// extratos e não do lsoft"*). Medido: o LSoft registra R$ 598 mil baixados, o extrato mostra
// R$ 7,75 mi. São R$ 7,15 mi que a Caixa pagou e o sistema da construtora não sabe.

const brl = (valor: number) =>
  valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
const brlCurto = (valor: number) =>
  valor.toLocaleString("pt-BR", { currency: "BRL", maximumFractionDigits: 0, style: "currency" });
const inteiro = (valor: number) => valor.toLocaleString("pt-BR");
const dataBR = (iso: null | string) =>
  iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";

const ROTULO_DA_NATUREZA: Record<string, string> = {
  fgts: "FGTS",
  financiamento: "Financiamento",
  misto: "Financ. + subsídio",
  subsidio: "Subsídio",
  terreno: "Terreno",
};

export function SubsidioDaCaixa({
  api,
  empreendimento,
}: {
  api: ApiDoLsoft;
  empreendimento: string;
}) {
  const [dados, setDados] = useState<null | SubsidioCarregado>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [busca, setBusca] = useState("");
  const [buscaAtiva, setBuscaAtiva] = useState("");

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const resposta = await api.lerSubsidio({ busca: buscaAtiva, empreendimento });
      if (!resposta) setErro("Falha ao ler o subsídio.");
      else {
        setErro(null);
        setDados(resposta);
      }
    } catch (falha) {
      setErro(falha instanceof Error ? falha.message : "Falha ao ler o subsídio.");
    }
    setCarregando(false);
  }, [api, buscaAtiva, empreendimento]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  if (carregando && !dados) {
    return (
      <div className="grid place-items-center py-16 text-ink-soft">
        <Loader2 aria-hidden="true" className="size-5 animate-spin" />
      </div>
    );
  }

  if (erro) {
    return (
      <p className="rounded-xl border border-dashed border-red-300/60 bg-red-50 px-4 py-6 text-center text-sm font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
        {erro}
      </p>
    );
  }

  if (!dados || dados.linhas.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-black/[0.12] p-10 text-center text-sm text-ink-soft dark:border-white/[0.12]">
        Nenhuma parcela de subsídio da Caixa neste empreendimento.
      </p>
    );
  }

  const { linhas, resumo } = dados;

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
        <Cartao
          dica={`${inteiro(resumo.parcelas)} parcela(s) · ${inteiro(resumo.clientes)} cliente(s)`}
          rotulo="Contratado com a Caixa"
          valor={brlCurto(resumo.totalConfirmado + resumo.totalAValidar)}
        />
        <Cartao
          dica="pelos extratos CIWEB"
          rotulo="Já liberado"
          tom="ok"
          valor={brlCurto(resumo.totalLiberado)}
        />
        <Cartao
          dica="a Caixa libera por medição"
          rotulo="Saldo a liberar"
          valor={brlCurto(Math.max(resumo.totalConfirmado - resumo.totalLiberado, 0))}
        />
        {resumo.aValidar > 0 ? (
          <Cartao
            dica={`${inteiro(resumo.aValidar)} parcela(s)`}
            rotulo="A validar"
            tom="alerta"
            valor={brlCurto(resumo.totalAValidar)}
          />
        ) : null}
      </div>

      <form
        className="flex items-center gap-2"
        onSubmit={(evento) => {
          evento.preventDefault();
          setBuscaAtiva(busca.trim());
        }}
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-soft"
            size={15}
          />
          <input
            className="h-9 w-[260px] rounded-lg border border-black/10 bg-canvas pl-8 pr-3 text-sm text-ink dark:border-white/10"
            onChange={(evento) => setBusca(evento.target.value)}
            placeholder="Cliente, unidade ou histórico"
            value={busca}
          />
        </div>
        <button
          className="inline-flex h-9 items-center rounded-lg bg-ink px-3 text-sm font-semibold text-canvas"
          type="submit"
        >
          Buscar
        </button>
        {carregando ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin text-ink-soft" />
        ) : null}
      </form>

      <div className="overflow-x-auto rounded-xl border border-black/[0.08] dark:border-white/[0.08]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-subtle text-[10.5px] uppercase tracking-[0.08em] text-ink-soft">
              <th className="px-3 py-2.5 text-left font-semibold">Cliente</th>
              <th className="px-3 py-2.5 text-left font-semibold">Unidade</th>
              <th className="px-3 py-2.5 text-left font-semibold">Natureza</th>
              <th className="px-3 py-2.5 text-left font-semibold">Vencimento</th>
              <th className="px-3 py-2.5 text-right font-semibold">Valor</th>
              <th className="px-3 py-2.5 text-left font-semibold">Situação</th>
              <th className="px-3 py-2.5 text-left font-semibold">Como foi identificada</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((linha) => (
              <tr
                className="border-t border-black/[0.06] dark:border-white/[0.06]"
                key={linha.parcelaId}
              >
                <td className="px-3 py-2 font-semibold text-ink">{linha.clienteNome || "—"}</td>
                <td className="px-3 py-2 text-xs text-ink-soft" title={linha.observacoes ?? undefined}>
                  {unidadeParaExibir({ observacoes: linha.observacoes }) ?? linha.unidade ?? "—"}
                </td>
                <td className="px-3 py-2 text-xs text-ink-soft">
                  {linha.natureza
                    ? (ROTULO_DA_NATUREZA[linha.natureza] ?? linha.natureza)
                    : "A definir"}
                </td>
                <td className="px-3 py-2 text-xs tabular-nums text-ink-soft">
                  {dataBR(linha.vencimento)}
                </td>
                <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                  {brl(linha.valor)}
                </td>
                <td className="px-3 py-2">
                  <Selo situacao={linha.situacao} />
                </td>
                <td className="px-3 py-2 text-xs text-ink-soft">
                  {linha.origemDaClasse === "regra_texto"
                    ? "Pelo histórico do LSoft"
                    : linha.origemDaClasse === "regra_valor"
                      ? "Pelo valor alto"
                      : "Marcada à mão"}
                  {linha.validadoPorNome ? ` · ${linha.validadoPorNome}` : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-soft">
        O <strong>já liberado</strong> vem dos extratos da Caixa (CIWEB), não da baixa no LSoft: a
        Caixa paga por medição de obra e o crédito cai na conta da construtora.
      </p>
    </div>
  );
}

function Selo({ situacao }: { situacao: string }) {
  const estilo =
    situacao === "confirmada"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : situacao === "rejeitada"
        ? "bg-black/[0.06] text-ink-soft dark:bg-white/[0.08]"
        : "bg-amber-500/10 text-amber-700 dark:text-amber-300";

  const rotulo =
    situacao === "confirmada" ? "Caixa" : situacao === "rejeitada" ? "Não é Caixa" : "A validar";

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${estilo}`}>
      {rotulo}
    </span>
  );
}

function Cartao({
  dica,
  rotulo,
  tom,
  valor,
}: {
  dica: string;
  rotulo: string;
  tom?: "alerta" | "ok";
  valor: string;
}) {
  const cor =
    tom === "alerta"
      ? "text-amber-600 dark:text-amber-400"
      : tom === "ok"
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-ink";

  return (
    <div className="rounded-xl border border-black/[0.08] bg-surface px-4 py-3 dark:border-white/[0.08]">
      <p className="m-0 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-soft">
        {rotulo}
      </p>
      <p className={`m-0 mt-1 text-xl font-bold tabular-nums ${cor}`}>{valor}</p>
      <p className="m-0 mt-0.5 text-[11px] text-ink-soft">{dica}</p>
    </div>
  );
}
