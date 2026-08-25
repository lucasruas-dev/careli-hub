"use client";

import { ChevronDown, ChevronRight, Loader2, Search } from "lucide-react";
import { Fragment, useCallback, useEffect, useState } from "react";

import type { ApiDoLsoft, SubsidioCarregado } from "./api";

// A VISÃO DO SUBSÍDIO DA CAIXA — por cliente e unidade.
//
// Pedido do Lucas (25/08/2026): *"o financiamento e subsídio é a mesma coisa, tem que trazer essas
// informações agrupadas por cliente / unidade"* e *"quero que tenha o valor das unidades e o que a
// caixa já pagou"*.
//
// A carteira responde "quanto o cliente deve". Esta responde outra pergunta: **o que a Caixa tem
// para pagar em cada unidade, e quanto já pagou**. No Vale do Sol (Minha Casa Minha Vida) o
// financiamento não é dívida do comprador — a Caixa libera por medição de obra, e o crédito cai no
// extrato CIWEB da construtora.
//
// ⚠️ DUAS FONTES QUE NUNCA SE FALARAM. O contratado vem do LSoft (as parcelas); o pago vem do
// extrato. Lucas, 25/08: *"a baixa da caixa vem dos extratos e não do lsoft"*. Medido: o LSoft
// registra R$ 598 mil baixados, o extrato mostra R$ 7,75 mi ligados a cliente.
//
// ⚠️ FINANCIAMENTO, SUBSÍDIO, FGTS E TERRENO SÃO O MESMO BOLSO. A natureza continua visível parcela
// a parcela, para auditoria, mas o número que decide é a soma da unidade.

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
  const [abertos, setAbertos] = useState<Set<string>>(new Set());

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

  if (!dados || dados.clientes.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-black/[0.12] p-10 text-center text-sm text-ink-soft dark:border-white/[0.12]">
        Nenhuma parcela de subsídio da Caixa neste empreendimento.
      </p>
    );
  }

  const { clientes, resumo } = dados;
  const contratado = resumo.totalConfirmado + resumo.totalAValidar;
  const saldo = clientes.reduce((total, cliente) => total + cliente.saldo, 0);

  const alternar = (codigo: string) =>
    setAbertos((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(codigo)) proximo.delete(codigo);
      else proximo.add(codigo);
      return proximo;
    });

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
        <Cartao
          dica={`${inteiro(resumo.clientes)} unidade(s) · ${inteiro(resumo.parcelas)} parcela(s)`}
          rotulo="Contratado com a Caixa"
          valor={brlCurto(contratado)}
        />
        <Cartao
          dica={`${inteiro(resumo.clientesComLiberacao)} unidade(s) · extratos CIWEB`}
          rotulo="A Caixa já pagou"
          tom="ok"
          valor={brlCurto(resumo.totalLiberado)}
        />
        <Cartao
          dica="a Caixa libera por medição"
          rotulo="Saldo a liberar"
          valor={brlCurto(saldo)}
        />
        {resumo.aValidar > 0 ? (
          <Cartao
            dica={`${inteiro(resumo.aValidar)} parcela(s)`}
            rotulo="A validar"
            tom="alerta"
            valor={brlCurto(resumo.totalAValidar)}
          />
        ) : null}
        {resumo.totalSemVinculo > 0 ? (
          <Cartao
            dica="crédito sem cliente identificado"
            rotulo="Fora do rateio"
            tom="alerta"
            valor={brlCurto(resumo.totalSemVinculo)}
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
              <th className="px-3 py-2.5 text-right font-semibold">Contratado</th>
              <th className="px-3 py-2.5 text-right font-semibold">Caixa já pagou</th>
              <th className="px-3 py-2.5 text-right font-semibold">Saldo a liberar</th>
              <th className="px-3 py-2.5 text-left font-semibold">Última liberação</th>
            </tr>
          </thead>
          <tbody>
            {clientes.map((cliente) => {
              const aberto = abertos.has(cliente.clienteCodigo);
              // Quanto do contratado a Caixa já cobriu — o número que a obra acompanha.
              const percentual =
                cliente.contratado > 0
                  ? Math.min(Math.round((cliente.caixaPagou / cliente.contratado) * 100), 100)
                  : 0;

              return (
                <Fragment key={cliente.clienteCodigo}>
                  <tr
                    className="cursor-pointer border-t border-black/[0.06] hover:bg-subtle dark:border-white/[0.06]"
                    onClick={() => alternar(cliente.clienteCodigo)}
                  >
                    <td className="px-3 py-2.5 font-semibold text-ink">
                      <span className="inline-flex items-center gap-1.5">
                        {aberto ? (
                          <ChevronDown
                            aria-hidden="true"
                            className="shrink-0 text-ink-soft"
                            size={14}
                          />
                        ) : (
                          <ChevronRight
                            aria-hidden="true"
                            className="shrink-0 text-ink-soft"
                            size={14}
                          />
                        )}
                        {cliente.clienteNome || cliente.clienteCodigo}
                      </span>
                      <span className="ml-5 block text-[11px] font-normal text-ink-soft">
                        {inteiro(cliente.parcelas.length)} parcela(s)
                        {cliente.liberacoes > 0
                          ? ` · ${inteiro(cliente.liberacoes)} liberação(ões)`
                          : " · nenhuma liberação ainda"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-ink-soft">{cliente.unidade ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink">
                      {brl(cliente.contratado)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                        {brl(cliente.caixaPagou)}
                      </span>
                      <span className="block text-[11px] font-normal text-ink-soft">
                        {percentual}% do contratado
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {cliente.liquidado ? (
                        <span className="inline-flex rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                          Liquidada
                        </span>
                      ) : (
                        <span className="font-semibold text-ink">{brl(cliente.saldo)}</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs tabular-nums text-ink-soft">
                      {dataBR(cliente.ultimaLiberacao)}
                    </td>
                  </tr>

                  {aberto ? (
                    <tr className="border-t border-black/[0.06] dark:border-white/[0.06]">
                      <td className="bg-subtle/50 px-3 py-3" colSpan={6}>
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="text-[10px] uppercase tracking-[0.08em] text-ink-soft">
                              <th className="px-2 py-1.5 text-left font-semibold">Natureza</th>
                              <th className="px-2 py-1.5 text-left font-semibold">Vencimento</th>
                              <th className="px-2 py-1.5 text-right font-semibold">Valor</th>
                              <th className="px-2 py-1.5 text-left font-semibold">Situação</th>
                              <th className="px-2 py-1.5 text-left font-semibold">
                                Como foi identificada
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {cliente.parcelas.map((parcela) => (
                              <tr key={parcela.parcelaId}>
                                <td
                                  className="px-2 py-1.5 text-ink"
                                  title={parcela.observacoes ?? undefined}
                                >
                                  {parcela.natureza
                                    ? (ROTULO_DA_NATUREZA[parcela.natureza] ?? parcela.natureza)
                                    : "A definir"}
                                </td>
                                <td className="px-2 py-1.5 tabular-nums text-ink-soft">
                                  {dataBR(parcela.vencimento)}
                                </td>
                                <td className="px-2 py-1.5 text-right font-semibold tabular-nums text-ink">
                                  {brl(parcela.valor)}
                                </td>
                                <td className="px-2 py-1.5">
                                  <Selo situacao={parcela.situacao} />
                                </td>
                                <td className="px-2 py-1.5 text-ink-soft">
                                  {parcela.origemDaClasse === "regra_texto"
                                    ? "Pelo histórico do LSoft"
                                    : parcela.origemDaClasse === "regra_valor"
                                      ? "Pelo valor alto"
                                      : "Marcada à mão"}
                                  {parcela.validadoPorNome ? ` · ${parcela.validadoPorNome}` : ""}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>

                        {cliente.caixaPagouSecundario > 0 ? (
                          <p className="m-0 mt-2 text-[11px] text-ink-soft">
                            Do que a Caixa pagou, {brl(cliente.caixaPagouSecundario)} vieram em
                            créditos menores (rateio), já somados acima.
                          </p>
                        ) : null}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-ink-soft">
        O <strong>Caixa já pagou</strong> vem dos extratos da Caixa (CIWEB), não da baixa no LSoft: a
        Caixa paga por medição de obra e o crédito cai na conta da construtora. Financiamento,
        subsídio, FGTS e terreno somam na mesma unidade.
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
