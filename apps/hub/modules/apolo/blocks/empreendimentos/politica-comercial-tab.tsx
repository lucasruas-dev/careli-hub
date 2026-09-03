"use client";

import { AlertTriangle, Check, Info, Loader2, Lock } from "lucide-react";
import { useEffect, useState } from "react";

import type { PoliticaComercialDoEmpreendimento } from "@/lib/apolo/politica-comercial";
import { ENTRADA_MINIMA_PERCENTUAL } from "@/lib/hercules/composicoes";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// ABA POLÍTICAS COMERCIAIS do empreendimento.
//
// Pedido do Lucas (17/08/2026): "no cadastro do empreendimento, podemos trazer a aba políticas
// comerciais, e lá podemos registrar o valor de comissão, bem como o valor da gestão de carteira e
// os planos comerciais aprovados para aquele empreendimento".
//
// ⚠️ A TELA SEPARA O QUE É DO C2X DO QUE É NOSSO, e isso não é enfeite: a regra de precedência é
// que o C2X manda no financeiro enquanto a migração não acontece, e só a % de gestão de carteira
// nasce no Apolo. Sem a marcação, o operador não sabe onde ir mudar — e o incorporador vai perguntar
// de onde saiu o número.
//
// ⚠️ VAZIO NA GESTÃO DE CARTEIRA SIGNIFICA "NÃO FAZEMOS A GESTÃO desse empreendimento", não "falta
// preencher" (Lucas, 17/08). É por isso que o campo não tem valor sugerido: um 97% pré-preenchido
// viraria dado cadastrado sem ninguém ter decidido.

type Props = {
  code: string;
  codes: string[];
  name: string;
};

/**
 * O padrão da casa, quando o empreendimento não cadastrou o seu.
 *
 * ⚠️ IMPORTADO, NÃO REDIGITADO: é a mesma constante que o simulador obedece
 * (`lib/hercules/composicoes.ts`). Escrever "10" aqui criaria uma segunda verdade, e a tela passaria
 * a prometer um piso diferente do que a conta aplica no dia em que o número mudar.
 */
const PADRAO_DA_CASA = ENTRADA_MINIMA_PERCENTUAL;

const pct = (v: null | number): string =>
  v === null ? "—" : `${v.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}%`;

export function PoliticaComercialTab({ code, codes, name }: Props) {
  const [politicas, setPoliticas] = useState<PoliticaComercialDoEmpreendimento[] | null>(null);
  const [erro, setErro] = useState<null | string>(null);

  // Um campo por divisão: a edição é POR EMPREENDIMENTO, mas o valor é gravado em cada divisão,
  // porque é nelas que as parcelas penduram. Ver o comentário do `salvar`.
  const [rascunho, setRascunho] = useState<Record<string, string>>({});
  // A entrada mínima tem o próprio rascunho: a tela salva um campo por vez, e a rota recusa os
  // dois juntos justamente para não sobrescrever o que o operador não tocou.
  const [rascunhoEntrada, setRascunhoEntrada] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<null | string>(null);
  const [recarregar, setRecarregar] = useState(0);

  // ⚠️ CHAVE ESTÁVEL, não o array. `codes` é uma prop nova a cada render do pai, então usá-lo direto
  // na dependência do efeito dispara refetch em loop.
  const chaveDosCodes = codes.join(",");

  useEffect(() => {
    let vivo = true;
    setPoliticas(null);
    setErro(null);
    setAviso(null);

    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const resposta = await fetch(
          `/api/apolo/empreendimentos/politica?codes=${encodeURIComponent(chaveDosCodes)}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
        );
        const corpo = (await resposta.json()) as {
          data?: { politicas?: PoliticaComercialDoEmpreendimento[] };
          error?: string;
        };

        if (!vivo) return;

        if (!resposta.ok) {
          setErro(corpo.error ?? "Não foi possível carregar a política comercial.");
          return;
        }

        const lista = corpo.data?.politicas ?? [];
        setPoliticas(lista);
        setRascunho(
          Object.fromEntries(
            lista.map((p) => [
              p.enterpriseId,
              p.gestaoCarteiraApolo === null
                ? ""
                : String(p.gestaoCarteiraApolo).replace(".", ","),
            ]),
          ),
        );
      } catch {
        if (vivo) setErro("Falha ao carregar a política comercial.");
      }
    })();

    return () => {
      vivo = false;
    };
  }, [chaveDosCodes, recarregar]);

  /**
   * Grava a % em TODAS as divisões do empreendimento.
   *
   * O Lucas edita "Vale do Ouro: 97%" uma vez; o Apolo grava em VOC e VOL. A regra dele é "por
   * empreendimento, sempre a carteira será por empreendimento", e as divisões existem por
   * particularidade (fases, sócios) mas refletem ao empreendimento único. Gravar nas divisões
   * mantém o dado no nível onde o dinheiro está, sem precisar resolver herança na hora de somar.
   */
  const salvar = async (valor: string, campo: "entrada" | "gestao" = "gestao") => {
    if (!politicas) return;

    setSalvando(true);
    setErro(null);
    setAviso(null);

    // Lista vazia = nada para gravar. Sem isto, o laço não rodava e a tela dizia "salva" sem ter
    // mandado requisição nenhuma — o pior tipo de confirmação.
    if (politicas.length === 0) {
      setErro("Nenhum empreendimento carregado: recarregue a tela antes de salvar.");
      setSalvando(false);
      return;
    }

    try {
      const token = await getApoloAccessToken();
      const limpo = valor.trim();

      // UMA chamada para TODAS as divisões: é o servidor que percorre, e ele relata o que gravou
      // se algo falhar no meio.
      const resposta = await fetch("/api/apolo/empreendimentos/politica", {
        body: JSON.stringify({
          code: politicas[0]?.code ?? null,
          enterpriseIds: politicas.map((p) => p.enterpriseId),
          ...(campo === "gestao"
            ? { gestaoCarteiraPercentual: limpo === "" ? null : limpo }
            : { entradaMinimaPercentual: limpo === "" ? null : limpo }),
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "PATCH",
      });

      const corpo = (await resposta.json().catch(() => ({}))) as {
        data?: { divisoes?: number };
        error?: string;
      };

      if (!resposta.ok) {
        setErro(corpo.error ?? "Não foi possível salvar.");
        // Recarrega: depois de uma falha parcial o banco pode ter mudado, e manter a tela no valor
        // antigo esconderia isso do operador.
        setRecarregar((n) => n + 1);
        return;
      }

      const numero = limpo === "" ? null : Number(limpo.replace(",", "."));
      setPoliticas((atual) =>
        (atual ?? []).map((p) => ({
          ...p,
          ...(campo === "gestao" ? { gestaoCarteiraApolo: numero } : { entradaMinimaApolo: numero }),
        })),
      );

      const divisoes = corpo.data?.divisoes ?? politicas.length;
      const nome = campo === "gestao" ? "Gestão de carteira" : "Entrada mínima";
      setAviso(
        limpo === ""
          ? campo === "gestao"
            ? "Gestão de carteira removida: este empreendimento passa a não ter carteira administrada."
            : `Entrada mínima removida: volta a valer o padrão da casa (${PADRAO_DA_CASA}%).`
          : divisoes > 1
            ? `${nome} salva nas ${divisoes} divisões deste empreendimento.`
            : `${nome} salva.`,
      );
    } catch {
      setErro("Falha de rede. Recarregue a tela para conferir o que foi salvo.");
      setRecarregar((n) => n + 1);
    } finally {
      setSalvando(false);
    }
  };

  if (erro && !politicas) {
    return (
      <p className="m-0 flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {erro}
      </p>
    );
  }

  if (!politicas) {
    return (
      <p className="m-0 flex items-center gap-2 p-6 text-sm text-ink-muted">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Carregando a política comercial…
      </p>
    );
  }

  // ⚠️ AS DIVISÕES PODEM DISCORDAR, E O LAGOA BONITA É O CASO. Regra do Lucas: "do Lagoa Bonita
  // fazemos somente do LBF" — o LBR e o LBP não têm gestora de recebíveis no split. Escolher
  // `politicas[0]` como referência fazia a tela AFIRMAR o que estivesse na divisão que o banco
  // devolvesse primeiro: se viesse o LBR, ela diria "a Careli não administra a carteira deste
  // empreendimento", frase falsa sobre um empreendimento onde administramos.
  //
  // A consolidação segue a regra do negócio: se ALGUMA divisão tem gestão, o empreendimento tem.
  const ref = politicas[0];
  const comSplit = politicas.filter(
    (p) => p.gestaoCarteiraSplit !== null && p.gestaoCarteiraSplit !== undefined,
  );
  const splitDoEmpreendimento = comSplit[0]?.gestaoCarteiraSplit ?? null;
  // Divisões com percentuais DIFERENTES entre si: não dá para resumir num número só, e esconder
  // isso seria pior do que mostrar.
  const splitsDivergentes =
    new Set(comSplit.map((p) => p.gestaoCarteiraSplit)).size > 1 ||
    (comSplit.length > 0 && comSplit.length < politicas.length);

  // Os campos vindos do C2X (comissão, entrada mínima, parcelas do sinal, juros) são exibidos a
  // partir da primeira divisão. Isso vale enquanto elas concordam — quando não, a tela precisa
  // dizer, em vez de eleger uma em silêncio.
  const divergemNoC2x =
    new Set(
      politicas.map((p) =>
        [p.comissaoTotal, p.entradaMinima, p.maxParcelasSinal, p.jurosAtraso].join("|"),
      ),
    ).size > 1;

  const avisosUnicos = [...new Set(politicas.flatMap((p) => p.avisos))];
  const valorAtual = ref ? (rascunho[ref.enterpriseId] ?? "") : "";
  const semGestao = politicas.every((p) => p.gestaoCarteiraApolo === null);

  // A entrada mínima cadastrada no Apolo. Como a gestão de carteira, o valor é do EMPREENDIMENTO e
  // fica gravado em cada divisão; se alguma divergir, a tela mostra a primeira e o operador salva
  // por cima, igualando as duas.
  const entradaCadastrada = politicas.find((p) => p.entradaMinimaApolo !== null)?.entradaMinimaApolo ?? null;
  const valorDaEntrada = ref
    ? (rascunhoEntrada[ref.enterpriseId] ??
      (entradaCadastrada === null ? "" : String(entradaCadastrada).replace(".", ",")))
    : "";

  return (
    <div className="grid gap-4 p-5">
      {/* ── A GESTÃO DE CARTEIRA: o que é NOSSO ─────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
            <Check aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h4 className="m-0 text-sm font-semibold text-ink">Gestão de carteira</h4>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              O percentual das parcelas do financiamento que fica com o incorporador. É o que define
              o valor líquido dele, e vem do split cadastrado no C2X. O campo abaixo só é preciso
              quando a negociação mudou e o C2X ainda não reflete.
            </p>
          </div>
        </div>

        <div className="grid gap-3 px-4 py-4">
          <label className="grid gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              % do incorporador {splitDoEmpreendimento === null ? "" : "(exceção)"}
            </span>
            <span className="flex items-center gap-2">
              <input
                className="h-9 w-32 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
                inputMode="decimal"
                onChange={(evento) =>
                  setRascunho((atual) =>
                    ref ? { ...atual, [ref.enterpriseId]: evento.target.value } : atual,
                  )
                }
                placeholder="97,5"
                value={valorAtual}
              />
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={salvando}
                onClick={() => void salvar(valorAtual)}
                type="button"
              >
                {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Salvar
              </button>
            </span>
          </label>

          {splitDoEmpreendimento !== null ? (
            <p className="m-0 flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
              <Check aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              O split do C2X dá {pct(splitDoEmpreendimento)} ao incorporador nas mensalidades
              {splitsDivergentes
                ? ` (${comSplit.map((p) => p.code ?? p.enterpriseId).join(", ")})`
                : ""}
              .
              {semGestao
                ? " É este o valor em uso."
                : " O campo acima está preenchido e tem prioridade sobre ele."}
            </p>
          ) : null}

          {/* ── A ENTRADA MÍNIMA: a segunda coisa que nasce no Apolo ────────
              Lucas (03/09/2026): *"vamos ter um campo dentro da parte que vamos cadastrar a
              política comercial e lá vamos apontar a % mínima"*. Fica aqui, no bloco do que é
              NOSSO, e não junto dos campos do C2X — a leitura do legado (`entradaMinima`) continua
              embaixo, como referência, e as duas não se misturam. */}
          <label className="grid gap-1.5 border-t border-line pt-4">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              % mínima de entrada
            </span>
            <span className="flex items-center gap-2">
              <input
                className="h-9 w-32 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-line-strong"
                inputMode="decimal"
                onChange={(evento) =>
                  setRascunhoEntrada((atual) =>
                    ref ? { ...atual, [ref.enterpriseId]: evento.target.value } : atual,
                  )
                }
                placeholder={String(PADRAO_DA_CASA)}
                value={valorDaEntrada}
              />
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={salvando}
                onClick={() => void salvar(valorDaEntrada, "entrada")}
                type="button"
              >
                {salvando ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Salvar
              </button>
            </span>
            <span className="text-xs text-ink-soft">
              {entradaCadastrada === null
                ? `Não cadastrada: vale o padrão da casa, ${PADRAO_DA_CASA}%. O simulador não oferece composição abaixo disso.`
                : `O simulador e a proposta não aceitam entrada abaixo de ${pct(entradaCadastrada)} do valor da unidade.`}
              {ref?.entradaMinima !== null && ref?.entradaMinima !== undefined
                ? ` O C2X registra ${pct(ref.entradaMinima)} para este empreendimento.`
                : ""}
            </span>
          </label>

          {/* ⚠️ Só afirma "não administramos" quando NENHUMA divisão tem gestão. No Lagoa Bonita
              administramos só o LBF: olhar uma divisão sorteada diria o contrário. */}
          {semGestao && splitDoEmpreendimento === null ? (
            <p className="m-0 flex items-start gap-2 rounded-lg bg-subtle px-3 py-2 text-xs text-ink-soft">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              Sem gestão de carteira cadastrada. Pela regra, isso significa que a Careli não
              administra a carteira deste empreendimento, e a aba Carteira não aparece para o
              incorporador.
            </p>
          ) : null}

          {splitsDivergentes ? (
            <p className="m-0 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              As divisões deste empreendimento não têm o mesmo split. Administramos a carteira de{" "}
              {comSplit.map((p) => p.code ?? p.enterpriseId).join(", ")} e não das demais. É o caso
              do Lagoa Bonita, onde só o LBF tem gestão. Salvar o campo acima grava a mesma % em
              todas as divisões, inclusive nas que hoje não têm gestão.
            </p>
          ) : null}

          {politicas.length > 1 ? (
            <p className="m-0 text-xs text-ink-muted">
              Este empreendimento tem {politicas.length} divisões (
              {politicas.map((p) => p.code).join(", ")}). O percentual vale para todas.
            </p>
          ) : null}

          {aviso ? (
            <p className="m-0 rounded-lg bg-subtle px-3 py-2 text-xs font-medium text-ink">
              {aviso}
            </p>
          ) : null}

          {erro ? (
            <p className="m-0 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
              <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              {erro}
            </p>
          ) : null}
        </div>
      </section>

      {/* ── O QUE VEM DO C2X: leitura ────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-subtle text-ink-muted">
            <Lock aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h4 className="m-0 text-sm font-semibold text-ink">Comissão e entrada</h4>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              Vem do C2X e só muda lá, na política comercial do empreendimento.
            </p>
          </div>
        </div>

        {/* ⚠️ NÃO EXISTE "% DO INCORPORADOR NA ENTRADA" FIXA, e mostrar uma seria enganoso.
            O `commissioning_incorporador` do C2X (3% no Recanto) é a fatia dele DENTRO da cadeia de
            comissionamento, e aparece na tabela abaixo junto dos outros papéis. O que ele recebe da
            entrada é o COMPLEMENTO, e depende da entrada que CADA CLIENTE fechou: com 10% de
            entrada sobram 30% para ele, com 20% sobram 65%, com 33% sobram 78,79%. Eu tinha posto
            "Comissão do incorporador: 3%" em destaque aqui, e o Lucas leu como o que ele recebe —
            que é exatamente a confusão que este aviso evita. */}
        <p className="m-0 flex items-start gap-2 border-b border-line bg-subtle/20 px-4 py-3 text-xs text-ink-soft">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            A comissão de {pct(ref?.comissaoTotal ?? null)} é sobre o valor do lote, e o
            incorporador recebe o que sobra da entrada. Como a entrada muda de contrato para
            contrato, a fatia dele também muda: quanto maior a entrada do cliente, maior a parte
            dele. Só as parcelas do financiamento têm percentual fixo, que é a gestão de carteira
            acima.
          </span>
        </p>

        {/* ⚠️ Os campos abaixo saem da PRIMEIRA divisão, o que só é honesto enquanto as divisões
            concordam. Quando divergem, a tela avisa em vez de eleger uma em silêncio — foi o erro
            que a gestão de carteira cometia, e o Lagoa Bonita é o contraexemplo vivo. */}
        {divergemNoC2x ? (
          <p className="m-0 flex items-start gap-2 border-b border-line bg-amber-50 px-4 py-3 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            <span>
              As divisões deste empreendimento têm política diferente entre si no C2X. Os números
              abaixo são os de {ref?.code ?? ref?.enterpriseId}; confira divisão a divisão antes de
              usá-los como referência.
            </span>
          </p>
        ) : null}

        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Campo label="Comissão total" valor={pct(ref?.comissaoTotal ?? null)} />
          <Campo label="Entrada mínima" valor={pct(ref?.entradaMinima ?? null)} />
          <Campo
            label="Parcelas do sinal"
            valor={ref?.maxParcelasSinal === null || ref?.maxParcelasSinal === undefined ? "—" : String(ref.maxParcelasSinal)}
          />
          <Campo label="Juros por atraso" valor={pct(ref?.jurosAtraso ?? null)} />
          <Campo label="Multa por atraso" valor={pct(ref?.multaAtraso ?? null)} />
          <Campo
            label="Divisão da parcela no C2X"
            valor={
              ref?.gestaoCarteiraC2x === null || ref?.gestaoCarteiraC2x === undefined
                ? "—"
                : `${pct(ref.gestaoCarteiraC2x)} loteador · ${pct(ref.gestaoCarteiraCareliC2x)} Careli`
            }
          />
        </div>

        {(ref?.splitCadastrado.length ?? 0) > 0 ? (
          <div className="border-t border-line px-4 py-4">
            <h5 className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              Divisão do pagamento (split)
            </h5>
            <p className="m-0 mb-3 text-xs text-ink-muted">
              É este cadastro que gera os boletos e define quanto cada um recebe. Cada tipo de
              pagamento divide 100% do valor.
              {ref?.splitNome ? ` Split ativo: ${ref.splitNome}.` : ""}
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {ref?.splitCadastrado.map((grupo) => {
                const fecha = Math.abs(grupo.total - 100) <= 0.01;
                return (
                  <div
                    className="overflow-hidden rounded-xl border border-line bg-subtle/30"
                    key={grupo.grupo}
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
                      <span className="text-xs font-semibold text-ink">{grupo.grupo}</span>
                      {/* Se não fecha 100%, o rateio está incompleto e o boleto sai errado. */}
                      <span
                        className={
                          fecha
                            ? "text-[11px] font-semibold tabular-nums text-emerald-700 dark:text-emerald-300"
                            : "text-[11px] font-semibold tabular-nums text-amber-700 dark:text-amber-300"
                        }
                      >
                        {grupo.total.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%
                        {fecha ? "" : " ⚠"}
                      </span>
                    </div>
                    <div className="grid gap-1.5 px-3 py-2.5">
                      {grupo.linhas.map((linha, indice) => (
                        <div
                          className="flex items-baseline justify-between gap-3 text-sm"
                          key={`${linha.perfil}-${indice}`}
                        >
                          <span className="min-w-0">
                            <span className="text-ink">{linha.perfil}</span>
                            {linha.quemRecebe ? (
                              <span className="block truncate text-[11px] text-ink-muted">
                                {linha.quemRecebe}
                              </span>
                            ) : null}
                          </span>
                          <span className="shrink-0 tabular-nums text-ink">
                            {linha.percentual === null
                              ? linha.fixo === null
                                ? "—"
                                : linha.fixo.toLocaleString("pt-BR", {
                                    currency: "BRL",
                                    style: "currency",
                                  })
                              : pct(linha.percentual)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

      </section>

      {/* ── O QUE ESTÁ FURADO, quando está ──────────────────────────────── */}
      {avisosUnicos.length > 0 ? (
        <section className="overflow-hidden rounded-2xl border border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-start gap-3 px-4 py-3">
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300"
            />
            <div className="min-w-0">
              <h4 className="m-0 text-sm font-semibold text-amber-900 dark:text-amber-200">
                Confira a política de {name} ({code})
              </h4>
              <ul className="m-0 mt-1.5 grid list-disc gap-1 pl-4 text-xs text-amber-900 dark:text-amber-200">
                {avisosUnicos.map((texto) => (
                  <li key={texto}>{texto}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Campo({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="rounded-xl border border-line bg-subtle/40 px-3 py-2.5">
      <span className="block text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      <span className="mt-1 block text-sm font-semibold tabular-nums text-ink">{valor}</span>
    </div>
  );
}
