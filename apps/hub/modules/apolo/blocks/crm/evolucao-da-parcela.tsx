"use client";

import { AlertTriangle, Download, Loader2, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { EvolucaoDoContrato } from "@/lib/apolo/reajuste/projecao-do-contrato";
import type { CenarioDeProjecao } from "@/lib/apolo/reajuste/projecao";
import { entityC2xId } from "@/modules/apolo/data/apolo-derive";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import type { ApoloEntity } from "@/lib/apolo/types";

// EVOLUÇÃO DA PARCELA — a terceira sub-aba do Financeiro do cliente.
//
// Lucas (23/09/2026), com a tela do Financeiro aberta: *"queria aqui na tela do financeiro por
// cliente, é um relatório"*. A primeira tentativa virou painel de carteira (`/apolo/defasagem`),
// que é outra coisa e continua valendo para a operação.
//
// ⚠️ A PEÇA SEPARA O QUE É FATO DO QUE É PALPITE, e a separação é visual, não uma nota de rodapé:
// o que já aconteceu e o valor de hoje são medidos; a curva para a frente é estimativa e está
// rotulada como tal em cada linha.
//
// ⚠️ SEM O BEARER A ROTA DEVOLVE 401 (a lição da v1.366.0, no mesmo dia): `authorizeApoloRead` lê
// só o header, e cookie de sessão não conta.

type Props = {
  entity: ApoloEntity;
};

const CENARIOS: { id: CenarioDeProjecao; rotulo: string }[] = [
  { id: "otimista", rotulo: "Otimista" },
  { id: "tendencia", rotulo: "Tendência" },
  { id: "conservador", rotulo: "Conservador" },
];

function reais(valor: number): string {
  return valor.toLocaleString("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  });
}

/** "AAAAMM" -> "mar/2027" */
function mes(aaaamm: string): string {
  const nomes = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const indice = Number(aaaamm.slice(4, 6)) - 1;
  return `${nomes[indice] ?? "?"}/${aaaamm.slice(0, 4)}`;
}

export function EvolucaoDaParcela({ entity }: Props) {
  // ⚠️ A MESMA CHAVE DO EXTRATO. Sem `c2x_id` não há carteira no legado para projetar, e a peça
  // diz isso em vez de ficar girando.
  const c2xId = entityC2xId(entity);
  const [dados, setDados] = useState<EvolucaoDoContrato[] | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [cenario, setCenario] = useState<CenarioDeProjecao>("tendencia");
  const [baixando, setBaixando] = useState(false);
  const [erroPdf, setErroPdf] = useState<null | string>(null);

  const carregar = useCallback(async () => {
    if (c2xId == null) {
      setCarregando(false);
      return;
    }
    setCarregando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(
        `/api/apolo/evolucao-da-parcela?c2xId=${c2xId}&cenario=${cenario}`,
        { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      );
      const corpo = (await resposta.json().catch(() => null)) as
        | { data?: EvolucaoDoContrato[]; error?: string }
        | null;
      if (!resposta.ok || !corpo?.data) {
        setErro(corpo?.error ?? "Não consegui montar a evolução.");
        return;
      }
      setDados(corpo.data);
    } catch {
      setErro("Não consegui montar a evolução.");
    } finally {
      setCarregando(false);
    }
  }, [c2xId, cenario]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * Baixa o PDF timbrado, no cenário que está na tela.
   *
   * ⚠️ NÃO DÁ PARA APONTAR UM <a href> PARA A ROTA: ela é autenticada por Bearer e o navegador não
   * manda o header. Busca-se o blob e dispara-se o download local, igual ao PDF do extrato.
   */
  const baixarPdf = useCallback(async () => {
    if (c2xId == null) return;
    setBaixando(true);
    setErroPdf(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(
        `/api/apolo/evolucao-da-parcela/pdf?c2xId=${c2xId}&cenario=${cenario}`,
        { cache: "no-store", headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      );
      if (!resposta.ok) {
        const corpo = (await resposta.json().catch(() => null)) as { error?: string } | null;
        setErroPdf(corpo?.error ?? "Não foi possível gerar o PDF.");
        return;
      }

      const nome =
        /filename="([^"]+)"/.exec(resposta.headers.get("content-disposition") ?? "")?.[1] ??
        "evolucao-da-parcela.pdf";
      const blob = await resposta.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = nome;
      link.href = url;
      document.body.append(link);
      link.click();
      link.remove();
      // ⚠️ A REVOGAÇÃO ESPERA. Revogar na mesma linha do clique é corrida com o navegador: ele
      // pode ainda não ter começado a ler o blob, e o download morre CALADO. Foi o defeito que o
      // Isac relatou em 08/09/2026 no PDF do extrato; os outros downloads da casa já adiavam.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setErroPdf("Não foi possível gerar o PDF.");
    } finally {
      setBaixando(false);
    }
  }, [c2xId, cenario]);

  if (c2xId == null) {
    return (
      <section className="rounded-xl border border-line bg-surface p-6 text-sm text-ink-soft">
        Este cadastro não está ligado a um cliente do C2X, então não há carteira para projetar.
      </section>
    );
  }

  if (carregando && !dados) {
    return (
      <section className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm text-ink-soft">
        <Loader2 className="size-4 animate-spin" />
        Lendo a carteira e a série do índice…
      </section>
    );
  }

  if (erro && !dados) {
    return (
      <section className="rounded-xl border border-line bg-surface p-6">
        <p className="m-0 text-sm text-danger">{erro}</p>
        <button
          className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink"
          onClick={() => void carregar()}
          type="button"
        >
          Tentar de novo
        </button>
      </section>
    );
  }

  if (!dados || dados.length === 0) {
    return (
      <section className="rounded-xl border border-line bg-surface p-6 text-sm text-ink-soft">
        Este cliente não tem contrato com parcelas para projetar.
      </section>
    );
  }

  return (
    <section className="grid gap-4">
      <section className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Evolução da parcela
            </p>
            <p className="m-0 mt-1 max-w-2xl text-sm text-ink-muted">
              Quanto a mensalidade tende a ficar, aplicando sobre o valor de hoje a média do índice
              do contrato. É estimativa, não compromisso: o índice futuro ninguém sabe.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
          <nav className="flex gap-1 rounded-lg border border-line p-1" aria-label="Cenário">
            {CENARIOS.map((c) => (
              <button
                aria-current={cenario === c.id ? "true" : undefined}
                className={`h-8 rounded px-2.5 text-xs font-semibold transition-colors ${
                  cenario === c.id
                    ? "bg-inverse text-brand-ink"
                    : "text-ink-soft hover:bg-subtle hover:text-ink"
                }`}
                key={c.id}
                onClick={() => setCenario(c.id)}
                type="button"
              >
                {c.rotulo}
              </button>
            ))}
          </nav>
          {/* O PDF sai no cenário que está na tela: gerar sempre na tendência faria a tela
              mostrar um número e o papel imprimir outro. */}
          <button
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-xs font-semibold text-ink transition-colors hover:bg-subtle disabled:opacity-50"
            disabled={baixando}
            onClick={() => void baixarPdf()}
            type="button"
          >
            {baixando ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Download className="size-3.5" />
            )}
            PDF
          </button>
          </div>
        </div>
        {erroPdf ? <p className="m-0 mt-2 text-xs text-danger">{erroPdf}</p> : null}
      </section>

      {dados.map((contrato) => (
        <ContratoProjetado cenario={cenario} contrato={contrato} key={contrato.contratoId} />
      ))}
    </section>
  );
}

function ContratoProjetado({
  cenario,
  contrato,
}: {
  cenario: CenarioDeProjecao;
  contrato: EvolucaoDoContrato;
}) {
  const quadro = contrato.quadros?.[cenario];
  const ehPrice = quadro?.sistema === "price";

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-sm font-semibold text-ink">
          {contrato.empreendimento ?? "Contrato"} · {contrato.codigo}
        </h3>
        <p className="m-0 text-xs text-ink-soft">
          Correção {contrato.indiceDoContrato ?? "não registrada no contrato"}
          {contrato.indiceNoAno != null
            ? ` · ${contrato.indiceNoAno.toFixed(2).replace(".", ",")}% nos últimos 12 meses`
            : ""}
        </p>
      </header>

      {/* ⚠️ OS CARTÕES SÃO OS INSUMOS DO QUADRO, e não o caixa. "Parcela de hoje" saiu daqui em
          24/09/2026: ela é o que a cobrança lançou (R$ 481,94 no LOS0617, com o IPCA de 2025 fechado
          do lote da Lavra), e ficava ao lado de um quadro que, pela regra do contrato, dá R$ 484,00
          no mesmo ano. Dois números para a mesma parcela, lado a lado, fazem o leitor duvidar dos
          dois. */}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Numero
          rotulo="Valor de contrato"
          valor={reais(contrato.mensalidadeBase)}
          nota="a amortização, parcela do 1º ano"
        />
        <Numero
          destaque
          rotulo="Juros do contrato"
          valor={
            ehPrice
              ? "na parcela"
              : `${(contrato.jurosAnualPct ?? 0).toFixed(2).replace(".", ",")}% a.a.`
          }
          nota={
            ehPrice ? "PRICE: o aniversário aplica só o índice" : "SACOC: juros + índice no aniversário"
          }
        />
        <Numero
          rotulo="Índice publicado até"
          valor={contrato.indicePublicadoAte ? mes(contrato.indicePublicadoAte) : "-"}
          nota="a fonte atrasa um mês"
        />
      </div>

      {contrato.motivo ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-line bg-subtle px-3 py-2 text-[12.5px] text-ink-muted">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-ink-soft" />
          {contrato.motivo}
        </p>
      ) : null}

      {quadro ? (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-subtle text-left text-ink-soft">
                  <th className="px-3 py-2 font-medium">Período</th>
                  <th className="px-3 py-2 text-right font-medium">Parcelas</th>
                  <th className="px-3 py-2 text-right font-medium">Amortização</th>
                  <th className="px-3 py-2 text-right font-medium">Juros</th>
                  <th className="px-3 py-2 text-right font-medium">
                    Correção{contrato.indice ? ` (${contrato.indice})` : ""}
                  </th>
                  <th className="px-3 py-2 text-right font-medium">Valor da parcela</th>
                  <th className="px-3 py-2 text-right font-medium">Total do período</th>
                </tr>
              </thead>
              <tbody>
                {quadro.linhas.map((linha) => (
                  <tr className="border-t border-line" key={linha.ciclo}>
                    <td className="px-3 py-2 tabular-nums">
                      {mes(linha.de)} a {mes(linha.ate)}
                      {linha.origem === "estimado" ? (
                        <span className="ml-1.5 text-[11px] text-ink-soft">estimativa</span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                      {linha.deParcela === linha.ateParcela
                        ? linha.deParcela
                        : `${linha.deParcela} a ${linha.ateParcela}`}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{reais(linha.amortizacao)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {linha.juros > 0 ? reais(linha.juros) : "-"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {linha.correcao > 0 ? (
                        <>
                          {reais(linha.correcao)}
                          <span className="ml-1 text-[11px] text-ink-soft">
                            {linha.indicePct.toFixed(2).replace(".", ",")}%
                          </span>
                        </>
                      ) : linha.origem === "indisponivel" ? (
                        <span className="text-[11px] text-ink-soft">não calculada</span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                      {reais(linha.parcela)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                      {reais(linha.totalDoCiclo)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-semibold text-ink">
                  <td className="px-3 py-2" colSpan={2}>
                    Total do contrato
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {reais(quadro.totalDeAmortizacao)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{reais(quadro.totalDeJuros)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {reais(quadro.totalDeCorrecao)}
                  </td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums">
                    {reais(quadro.totalDoContrato)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-3 flex items-start gap-2 text-[12px] leading-relaxed text-ink-soft">
            <TrendingUp className="mt-0.5 size-3.5 shrink-0" />
            <span>
              {ehPrice ? (
                <>
                  Contrato em <strong className="text-ink">PRICE</strong>: os juros já estão dentro
                  da parcela, e a cada aniversário do contrato ela é corrigida só pelo{" "}
                  {contrato.indice ?? "índice"} acumulado dos 12 meses até o aniversário.
                </>
              ) : (
                <>
                  Contrato em <strong className="text-ink">SACOC</strong>: no primeiro ano a parcela
                  é só a amortização. A cada aniversário do contrato, a taxa do ano é o{" "}
                  {contrato.indice ?? "índice"} acumulado dos 12 meses até o aniversário{" "}
                  <strong className="text-ink">somado</strong> aos juros de{" "}
                  {(contrato.jurosAnualPct ?? 0).toFixed(2).replace(".", ",")}% a.a., e a parcela
                  passa a cobrar os juros teóricos do ano anterior pela tabela SACOC.
                </>
              )}{" "}
              Os anos marcados como estimativa usam{" "}
              {contrato.mesTipicoPorCenario?.[cenario] != null ? (
                <strong className="text-ink">
                  {contrato.mesTipicoPorCenario[cenario]?.toFixed(2).replace(".", ",")}% ao mês
                </strong>
              ) : (
                "a média"
              )}{" "}
              de {contrato.indice ?? "índice"}, a média do cenário escolhido.{" "}
              <strong className="text-ink">Não é promessa</strong>: é a conta do contrato, e o valor
              de cada parcela é o do boleto.
            </span>
          </p>
        </>
      ) : null}

      {contrato.eventos.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-[12.5px] font-semibold text-ink-soft">
            O que já aconteceu com esta parcela ({contrato.eventos.length})
          </summary>
          <ul className="mt-2 grid gap-1 pl-4 text-[12.5px] text-ink-muted">
            {contrato.eventos.map((evento, indice) => (
              <li key={`${evento.competencia ?? indice}-${evento.parcela}`}>{evento.rotulo}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

function Numero({
  destaque,
  nota,
  rotulo,
  valor,
}: {
  destaque?: boolean;
  nota?: string;
  rotulo: string;
  valor: string;
}) {
  return (
    <div className={`rounded-lg border p-3 ${destaque ? "border-line bg-subtle" : "border-line"}`}>
      <p className="m-0 text-[11px] uppercase tracking-wide text-ink-soft">{rotulo}</p>
      <p className="m-0 mt-1 text-base font-semibold tabular-nums text-ink">{valor}</p>
      {nota ? <p className="m-0 mt-0.5 text-[11.5px] text-ink-soft">{nota}</p> : null}
    </div>
  );
}
