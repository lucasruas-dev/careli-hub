"use client";

import {
  CalendarClock,
  CircleDollarSign,
  Download,
  Loader2,
  PiggyBank,
  ReceiptText,
  TrendingUp,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Tooltip } from "@repo/uix";
import {
  contarParcelas,
  dataBr,
  dinheiro,
  percentual,
  resumoPorAno,
  situacaoParaOComprador,
  type ExtratoClienteContrato,
  type ExtratoClienteData,
  type ExtratoClienteParcela,
  type ExtratoClienteRelatorio,
} from "@/lib/apolo/extrato-cliente";
import type { ApoloEntity } from "@/lib/apolo/types";

import { entityC2xId } from "../../data/apolo-derive";
import { getApoloAccessToken } from "../../data/apolo-operations";
import { EmptyPanel } from "../shared/apolo-ui";

// EXTRATO DO CLIENTE COMPRADOR — "quanto já paguei e quanto ainda devo", a pergunta que o
// comprador faz por telefone e que hoje o backoffice responde montando planilha à mão.
//
// A tela e o PDF (`lib/apolo/extrato-cliente-pdf.ts`) desenham a MESMA apuração, vinda da mesma
// lib: o operador confere na tela e entrega o papel sabendo que os números batem. Toda a régua
// (o que é pago, o que entra no saldo, o que é reajuste) mora em `lib/apolo/extrato-cliente.ts`
// — aqui não se calcula nada além de somar o que já veio pronto.

export function ExtratoClientePanel({ entity }: { entity: ApoloEntity }) {
  const c2xId = entityC2xId(entity);
  const [data, setData] = useState<ExtratoClienteData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<null | string>(null);
  const [contratoId, setContratoId] = useState<null | number>(null);
  const [baixando, setBaixando] = useState(false);
  const [erroPdf, setErroPdf] = useState<null | string>(null);

  useEffect(() => {
    if (c2xId == null) {
      setLoading(false);
      return;
    }

    let ativo = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const token = await getApoloAccessToken();
        const response = await fetch(
          `/api/apolo/extrato-cliente?c2xId=${encodeURIComponent(String(c2xId))}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
        );
        const payload = (await response.json().catch(() => null)) as
          | { data?: ExtratoClienteData; error?: string }
          | null;

        if (!ativo) {
          return;
        }

        if (!response.ok || !payload?.data) {
          setError(payload?.error ?? "Não foi possível carregar o extrato do cliente.");
          setData(null);
          return;
        }

        setData(payload.data);
        setContratoId(payload.data.contratos[0]?.contrato.id ?? null);
      } catch {
        if (ativo) {
          setError("Não foi possível carregar o extrato do cliente.");
          setData(null);
        }
      } finally {
        if (ativo) {
          setLoading(false);
        }
      }
    })();

    return () => {
      ativo = false;
    };
  }, [c2xId]);

  const relatorio = useMemo(
    () =>
      data?.contratos.find((item) => item.contrato.id === contratoId) ??
      data?.contratos[0] ??
      null,
    [contratoId, data],
  );

  // A rota do PDF é autenticada por Bearer, então não dá para apontar um <a href> para ela:
  // o navegador não manda o header. Busca-se o blob e dispara-se o download local.
  const baixarPdf = useCallback(
    async (escopo: "contrato" | "todos") => {
      if (c2xId == null) {
        return;
      }

      setBaixando(true);
      setErroPdf(null);

      try {
        const token = await getApoloAccessToken();
        const query = new URLSearchParams({ c2xId: String(c2xId) });
        if (escopo === "contrato" && relatorio) {
          query.set("contrato", String(relatorio.contrato.id));
        }

        const response = await fetch(`/api/apolo/extrato-cliente/pdf?${query.toString()}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as
            | { error?: string }
            | null;
          setErroPdf(payload?.error ?? "Não foi possível gerar o PDF.");
          return;
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = nomeSugerido(response, data, relatorio, escopo);
        document.body.append(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch {
        setErroPdf("Não foi possível gerar o PDF.");
      } finally {
        setBaixando(false);
      }
    },
    [c2xId, data, relatorio],
  );

  if (c2xId == null) {
    return <EmptyPanel text="Cadastro sem vinculo com o C2X para montar o extrato do cliente." />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface p-10 text-sm font-medium text-ink-muted">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Carregando extrato do cliente…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm font-medium text-rose-600 dark:text-rose-300">
        <TriangleAlert className="size-4" aria-hidden="true" />
        {error}
      </div>
    );
  }

  if (!data || !data.contratos.length || !relatorio) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm font-medium text-ink-muted">
        <ReceiptText className="size-4" aria-hidden="true" />
        Este cliente não tem contrato com carteira no C2X.
      </div>
    );
  }

  const { contrato, totais } = relatorio;

  return (
    <section className="grid gap-4">
      <header className="rounded-xl border border-line bg-surface p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Extrato de pagamentos e saldo devedor
            </p>
            <h3 className="m-0 mt-1 truncate text-base font-semibold text-ink">
              {contrato.empreendimentoNome ?? contrato.empreendimentoCodigo} ·{" "}
              {descreverUnidade(relatorio)}
            </h3>
            <p className="m-0 mt-1 text-xs font-medium text-ink-muted">
              Posição em {dataBr(relatorio.posicaoEm)} · Ato em {dataBr(contrato.dataAto)} ·{" "}
              {situacaoParaOComprador(contrato)}
              {contrato.indiceCorrecao ? ` · Correção ${contrato.indiceCorrecao}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {data.contratos.length > 1 ? (
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Contrato
                </span>
                <select
                  className="h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                  onChange={(event) => setContratoId(Number(event.target.value))}
                  value={String(relatorio.contrato.id)}
                >
                  {data.contratos.map((item) => (
                    <option key={item.contrato.id} value={String(item.contrato.id)}>
                      {rotuloDoContrato(item.contrato)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <Tooltip content="Baixar o extrato deste contrato em PDF timbrado" placement="bottom">
              <button
                className="inline-flex h-9 items-center gap-2 self-end rounded-lg bg-inverse px-3 text-sm font-semibold text-brand-ink outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:opacity-60"
                disabled={baixando}
                onClick={() => void baixarPdf("contrato")}
                type="button"
              >
                {baixando ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-4" aria-hidden="true" />
                )}
                PDF
              </button>
            </Tooltip>
            {data.contratos.length > 1 ? (
              <Tooltip content="Um PDF com todos os contratos do cliente" placement="bottom">
                <button
                  className="inline-flex h-9 items-center gap-2 self-end rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink-soft outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:opacity-60"
                  disabled={baixando}
                  onClick={() => void baixarPdf("todos")}
                  type="button"
                >
                  <Download className="size-4" aria-hidden="true" />
                  Todos
                </button>
              </Tooltip>
            ) : null}
          </div>
        </div>

        {erroPdf ? (
          <p className="m-0 mt-3 text-xs font-semibold text-rose-600 dark:text-rose-300">
            {erroPdf}
          </p>
        ) : null}

        <p className="m-0 mt-3 text-xs font-medium text-ink-muted">
          {contrato.titulares.length > 1 ? "Titulares" : "Titular"}:{" "}
          {contrato.titulares
            .map((titular) =>
              titular.documentoMascarado
                ? `${titular.nome} (${titular.documentoMascarado})`
                : titular.nome,
            )
            .join(" · ") || "-"}
        </p>

        {contrato.encerrado ? (
          <p className="m-0 mt-3 rounded-lg bg-[#353d49] px-3 py-2 text-xs font-semibold text-white">
            Contrato {situacaoParaOComprador(contrato).toLowerCase()}. Este extrato reflete
            apenas os valores já pagos.
          </p>
        ) : null}
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Numero
          apoio={
            totais.parcelasTotal
              ? `${totais.parcelasPagas} de ${contarParcelas(totais.parcelasTotal)} quitadas`
              : "Nenhum pagamento registrado"
          }
          icon={PiggyBank}
          label="Total já pago"
          valor={dinheiro(totais.totalPago)}
        />
        {contrato.encerrado ? null : (
          <Numero
            apoio={
              totais.mensalidadeVigente > 0
                ? `${contarParcelas(totais.parcelasAbertas)} em aberto · parcela vigente ${dinheiro(totais.mensalidadeVigente)}`
                : `${contarParcelas(totais.parcelasAbertas)} em aberto`
            }
            icon={CircleDollarSign}
            label="Saldo devedor (a valor de hoje)"
            valor={dinheiro(totais.saldoAValorDeHoje)}
          />
        )}
        {contrato.encerrado ? null : totais.vencidasQuantidade > 0 ? (
          <Numero
            apoio={`${contarParcelas(totais.vencidasQuantidade)} · mais antiga em ${dataBr(totais.vencidaMaisAntiga)} (${totais.diasAtrasoMax} dias)`}
            icon={TriangleAlert}
            label="Em atraso (valores originais)"
            tone="danger"
            valor={dinheiro(totais.vencidasTotal)}
          />
        ) : (
          <Numero
            apoio={
              totais.proximoVencimento
                ? `Vence em ${dataBr(totais.proximoVencimento.vencimento)}`
                : "Nenhuma parcela a vencer"
            }
            icon={CalendarClock}
            label="Próximo vencimento"
            valor={
              totais.proximoVencimento ? dinheiro(totais.proximoVencimento.valor) : "-"
            }
          />
        )}
      </section>

      {contrato.encerrado ? null : totais.saldoNominal > 0 && totais.defasagem > 0 ? (
        <div className="flex items-center justify-between rounded-xl border border-line bg-subtle px-4 py-3">
          <span className="text-xs font-medium text-ink-muted">
            Saldo pelos valores originais de contrato
          </span>
          <span className="text-sm font-semibold tabular-nums text-ink-soft">
            {dinheiro(totais.saldoNominal)}
          </span>
        </div>
      ) : null}

      {relatorio.notas.length ? (
        <section className="rounded-xl border border-line bg-surface p-4">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            O que este saldo considera
          </p>
          <ul className="m-0 mt-2 grid list-disc gap-1.5 pl-4">
            {relatorio.notas.map((nota) => (
              <li className="text-xs leading-5 text-ink-soft" key={nota}>
                {nota}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <EventosDeValor relatorio={relatorio} />

      <Parcelas relatorio={relatorio} />
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────

function EventosDeValor({ relatorio }: { relatorio: ExtratoClienteRelatorio }) {
  const eventos = relatorio.eventos.filter((evento) => evento.tipo !== "fronteira");

  if (!eventos.length) {
    return null;
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center gap-2">
        <TrendingUp className="size-4 text-[#A07C3B]" aria-hidden="true" />
        <p className="m-0 text-sm font-semibold text-ink">Reajustes e alterações de valor</p>
      </div>
      <p className="m-0 mt-1 text-xs font-medium text-ink-muted">
        Detectados pela variação do valor das parcelas mensais ao longo do contrato — o C2X não
        grava o reajuste como evento.
      </p>
      <ul className="m-0 mt-3 grid gap-2">
        {eventos.map((evento) => (
          <li
            className="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-line bg-subtle px-3 py-2"
            key={`${evento.parcela}-${evento.para}`}
          >
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ring-inset ${
                evento.tipo === "reajuste"
                  ? "bg-[#A07C3B]/5 text-[#7a5e2c] ring-[#A07C3B]/15 dark:text-[#d9b877]"
                  : "bg-subtle text-ink-soft ring-line"
              }`}
            >
              {evento.tipo === "reajuste" ? "Reajuste" : "Alteração"}
            </span>
            <span className="text-xs font-medium text-ink-soft">{evento.rotulo}</span>
            <span className="text-[11px] font-medium tabular-nums text-ink-muted">
              parcela {evento.parcela} · {percentual(evento.variacao)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Aba = "abertas" | "atraso" | "pagos";

function Parcelas({ relatorio }: { relatorio: ExtratoClienteRelatorio }) {
  const vencidas = useMemo(
    () => relatorio.abertas.filter((parcela) => parcela.situacao === "vencida"),
    [relatorio.abertas],
  );
  const [aba, setAba] = useState<Aba>("pagos");
  const [porAno, setPorAno] = useState(true);
  const anos = useMemo(() => resumoPorAno(relatorio.abertas), [relatorio.abertas]);

  // Contrato encerrado chega aqui com `abertas` vazio (a régua zera a lista, não só os totais):
  // sem isso a peça listava 120 parcelas de um contrato cancelado sob o total "R$ 0,00".
  const abas: Array<{ id: Aba; label: string; total: number }> = [
    { id: "pagos", label: "Pagamentos realizados", total: relatorio.realizados.length },
    ...(relatorio.contrato.encerrado
      ? []
      : ([
          { id: "atraso", label: "Em atraso", total: vencidas.length },
          { id: "abertas", label: "Em aberto", total: relatorio.abertas.length },
        ] as const)),
  ];

  const abaAtiva = abas.some((item) => item.id === aba) ? aba : "pagos";

  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <nav aria-label="Parcelas" className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
        {abas.map((item) => (
          <button
            aria-current={abaAtiva === item.id ? "page" : undefined}
            className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#A07C3B] ${
              abaAtiva === item.id
                ? "bg-inverse text-brand-ink"
                : "text-ink-soft hover:bg-subtle hover:text-ink"
            }`}
            key={item.id}
            onClick={() => setAba(item.id)}
            type="button"
          >
            {item.label}
            <span className="rounded-full bg-black/10 px-1.5 text-[11px] tabular-nums dark:bg-white/10">
              {item.total}
            </span>
          </button>
        ))}
      </nav>

      {abaAtiva === "pagos" ? (
        <Tabela
          // ⚠️ AS MESMAS COLUNAS DO PDF, e isso não é capricho: o atendente lê esta tela enquanto o
          // cliente lê o PDF que recebeu. Com uma coluna a menos aqui, os dois olham números
          // diferentes na mesma conversa — e quem tem de explicar a diferença é o atendente.
          cabecalho={[
            "Pago em",
            "Tipo",
            "Parcela",
            "Competência",
            "Vencimento",
            "Valor da parcela",
            "Total pago",
          ]}
          linhas={relatorio.realizados.map((parcela) => ({
            chave: parcela.id,
            colunas: [
              dataBr(parcela.pagamento),
              parcela.tipo,
              parcela.numero,
              parcela.competencia ?? "-",
              dataBr(parcela.vencimento),
              // O valor da parcela e o que entrou. Onde diferem, a diferença fica visível sem que a
              // tela AFIRME o que ela é — o C2X não guarda a composição (juros e multa vêm zerados).
              dinheiro(parcela.valorContratual),
              dinheiro(parcela.valorPago ?? 0),
            ],
            detalhe: detalheDaLinha(parcela),
          }))}
          total={[
            "Totais",
            "",
            "",
            "",
            "",
            dinheiro(relatorio.totais.totalContratualPago),
            dinheiro(relatorio.totais.totalPago),
          ]}
          vazio="Nenhum pagamento registrado."
        />
      ) : null}

      {abaAtiva === "atraso" ? (
        <>
          <Tabela
            cabecalho={["Vencimento", "Tipo", "Parcela", "Competência", "Atraso", "Valor original"]}
            linhas={vencidas.map((parcela) => ({
              chave: parcela.id,
              colunas: [
                dataBr(parcela.vencimento),
                parcela.tipo,
                parcela.numero,
                parcela.competencia ?? "-",
                `${parcela.diasAtraso} dias`,
                dinheiro(parcela.valorContratual),
              ],
              detalhe: detalheDaLinha(parcela),
            }))}
            total={[
              "Total em atraso",
              "",
              "",
              "",
              "",
              dinheiro(relatorio.totais.vencidasTotal),
            ]}
            vazio="Nenhuma parcela em atraso."
          />
          {vencidas.length ? (
            <p className="m-0 mt-2 text-[11px] font-medium text-ink-muted">
              Os valores acima não incluem juros e multa: o C2X só os apura no momento do
              pagamento.
            </p>
          ) : null}
        </>
      ) : null}

      {abaAtiva === "abertas" ? (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              className={`h-8 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                porAno
                  ? "border-transparent bg-inverse text-brand-ink"
                  : "border-line bg-surface text-ink-soft hover:bg-subtle"
              }`}
              onClick={() => setPorAno(true)}
              type="button"
            >
              Resumo por ano
            </button>
            <button
              className={`h-8 rounded-lg border px-3 text-xs font-semibold transition-colors ${
                !porAno
                  ? "border-transparent bg-inverse text-brand-ink"
                  : "border-line bg-surface text-ink-soft hover:bg-subtle"
              }`}
              onClick={() => setPorAno(false)}
              type="button"
            >
              Todas as parcelas
            </button>
          </div>
          {porAno ? (
            <Tabela
              cabecalho={["Ano", "Parcelas", "Valores originais", "A valor de hoje"]}
              numericasApartir={2}
              linhas={anos.map((linha) => ({
                chave: linha.ano,
                colunas: [
                  linha.ano,
                  String(linha.quantidade),
                  dinheiro(linha.nominal),
                  dinheiro(linha.atualizado),
                ],
              }))}
              total={[
                "Saldo devedor",
                String(relatorio.totais.parcelasAbertas),
                dinheiro(relatorio.totais.saldoNominal),
                dinheiro(relatorio.totais.saldoAValorDeHoje),
              ]}
              vazio="Nenhuma parcela em aberto."
            />
          ) : (
            <Tabela
              cabecalho={["Vencimento", "Tipo", "Parcela", "Competência", "Valor original", "A valor de hoje"]}
              numericasApartir={4}
              linhas={relatorio.abertas.map((parcela) => ({
                chave: parcela.id,
                colunas: [
                  dataBr(parcela.vencimento),
                  parcela.tipo,
                  parcela.numero,
                  parcela.competencia ?? "-",
                  dinheiro(parcela.valorContratual),
                  dinheiro(parcela.valorAtual),
                ],
                detalhe: detalheDaLinha(parcela),
              }))}
              total={[
                "Saldo devedor",
                "",
                "",
                "",
                dinheiro(relatorio.totais.saldoNominal),
                dinheiro(relatorio.totais.saldoAValorDeHoje),
              ]}
              vazio="Nenhuma parcela em aberto."
            />
          )}
        </>
      ) : null}
    </section>
  );
}

/**
 * O rótulo do <select> quando o cliente tem mais de um contrato.
 *
 * "VOC1221 — VOC" não distingue nada: existe cliente com DOIS contratos na mesma unidade e no
 * mesmo empreendimento (um cancelado, um vigente). O que separa é a situação e a data do ato —
 * e, no empate absoluto, o número do contrato, que é o que o backoffice usa para conferir.
 */
function rotuloDoContrato(contrato: ExtratoClienteContrato): string {
  const partes = [contrato.codigo, contrato.empreendimentoCodigo, situacaoParaOComprador(contrato)];

  if (contrato.dataAto) {
    partes.push(`ato ${dataBr(contrato.dataAto)}`);
  }

  partes.push(`nº ${contrato.id}`);

  return partes.join(" · ");
}

/** As marcações que explicam uma linha fora do padrão (acordo, correção projetada, mora paga). */
function detalheDaLinha(parcela: ExtratoClienteParcela): string[] {
  const marcas: string[] = [];

  if (parcela.trazidaAValorDeHoje) {
    marcas.push("trazida à parcela vigente (sem boleto emitido)");
  }
  if (parcela.empilhada) {
    marcas.push("vencimento compartilhado — acordo");
  }
  if (parcela.juros > 0 || parcela.multa > 0) {
    marcas.push(`inclui ${dinheiro(parcela.juros + parcela.multa)} de encargos`);
  }
  if (parcela.descricao) {
    marcas.push(parcela.descricao);
  }

  return marcas;
}

type LinhaTabela = { chave: number | string; colunas: string[]; detalhe?: string[] };

function Tabela({
  cabecalho,
  linhas,
  // Índice da primeira coluna NUMÉRICA. Daí para a direita tudo alinha à direita com
  // `tabular-nums` - dinheiro só se compara quando as casas ficam uma embaixo da outra.
  numericasApartir,
  total,
  vazio,
}: {
  cabecalho: string[];
  linhas: LinhaTabela[];
  numericasApartir?: number;
  total?: string[];
  vazio: string;
}) {
  if (!linhas.length) {
    return (
      <p className="m-0 mt-4 rounded-lg border border-dashed border-line p-4 text-sm font-semibold text-ink-muted">
        {vazio}
      </p>
    );
  }

  const ultima = cabecalho.length - 1;
  const primeiraNumerica = numericasApartir ?? ultima;

  return (
    <div className="mt-3 max-h-[28rem] overflow-auto rounded-xl border border-line">
      <table className="w-full min-w-[46rem] border-collapse text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-line bg-surface text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {cabecalho.map((titulo, indice) => (
              <th
                className={`bg-surface px-3 py-2.5 font-semibold ${indice >= primeiraNumerica ? "text-right" : ""}`}
                key={titulo}
              >
                {titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((linha) => (
            <tr className="border-b border-line/60 last:border-0" key={linha.chave}>
              {linha.colunas.map((valor, indice) => (
                <td
                  className={`whitespace-nowrap px-3 py-2.5 align-top tabular-nums ${
                    indice >= primeiraNumerica
                      ? "text-right font-semibold text-ink"
                      : "text-ink-soft"
                  }`}
                  key={`${linha.chave}-${indice}`}
                >
                  {valor}
                  {indice === 0 && linha.detalhe?.length ? (
                    <span className="mt-0.5 block whitespace-normal text-[10px] font-medium leading-4 text-ink-muted">
                      {linha.detalhe.join(" · ")}
                    </span>
                  ) : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {total ? (
          <tfoot className="sticky bottom-0">
            <tr className="border-t border-line bg-subtle">
              {total.map((valor, indice) => (
                <td
                  className={`px-3 py-2.5 text-[13px] font-semibold tabular-nums text-ink ${
                    indice >= primeiraNumerica ? "text-right" : ""
                  }`}
                  key={`total-${indice}`}
                >
                  {valor}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function Numero({
  apoio,
  icon: Icon,
  label,
  tone = "neutral",
  valor,
}: {
  apoio: string;
  icon: typeof CircleDollarSign;
  label: string;
  tone?: "danger" | "neutral";
  valor: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <Icon
        aria-hidden="true"
        className={`size-5 ${tone === "danger" ? "text-rose-600 dark:text-rose-300" : "text-ink"}`}
      />
      <p className="m-0 mt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p
        className={`m-0 mt-1 text-2xl font-semibold tabular-nums ${
          tone === "danger" ? "text-rose-600 dark:text-rose-300" : "text-ink"
        }`}
      >
        {valor}
      </p>
      <p className="m-0 mt-1 text-[11px] font-medium leading-4 text-ink-muted">{apoio}</p>
    </div>
  );
}

function descreverUnidade(relatorio: ExtratoClienteRelatorio): string {
  const { codigo, lote, quadra } = relatorio.contrato;
  const partes: string[] = [];

  if (quadra) partes.push(`Quadra ${quadra}`);
  if (lote) partes.push(`Lote ${lote}`);

  return partes.length ? `${partes.join(", ")} (${codigo})` : codigo;
}

/** Usa o nome que o servidor mandou no Content-Disposition; se não vier, monta um equivalente. */
function nomeSugerido(
  response: Response,
  data: ExtratoClienteData | null,
  relatorio: ExtratoClienteRelatorio | null,
  escopo: "contrato" | "todos",
): string {
  const header = response.headers.get("content-disposition") ?? "";
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // cai no fallback
    }
  }

  const simples = /filename="([^"]+)"/i.exec(header);
  if (simples?.[1]) {
    return simples[1];
  }

  const cliente = data?.cliente.nome ?? "Cliente";
  const unidade =
    escopo === "contrato" && relatorio
      ? relatorio.contrato.codigo
      : `${data?.contratos.length ?? 0} contratos`;
  const dia = dataBr(data?.posicaoEm ?? null).replace(/\//g, "-");

  return `Extrato - ${cliente} - ${unidade} - ${dia}.pdf`;
}
