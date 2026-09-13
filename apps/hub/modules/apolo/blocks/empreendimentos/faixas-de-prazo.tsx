"use client";

import { Loader2, Plus, Power, Ruler } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { conferirFaixa, type EntradaDeFaixa } from "@/lib/temis/faixas";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// A ESCADA DO PRODUTO — quanto custa cada prazo, antes de existir plano nenhum.
//
// Lucas (13/09/2026): *"em vez de cadastrar os juros e correção dentro de um plano, ter um cadastro
// de juros e correção separado por parcelas. Exemplo: 1-12 parcelas, sem juros e sem correção;
// 13-36, sem juros correção IPCA; 37 a 48 juros de x correção IPCA mensal"*, e *"Faixa é por
// empreendimento"*.
//
// ⚠️ O VOCABULÁRIO DA TELA DIZ "PLANOS DE 13 A 36 PARCELAS", e nunca "parcelas 13 a 36". A outra
// tela desta casa — o simulador — já usa a segunda forma para a tabela de reajuste, e lá ela
// significa as parcelas 13 a 36 DE UM CONTRATO. As mesmas palavras para coisas opostas é o jeito
// mais barato de alguém construir o sistema errado.

type Indice = {
  aplicacao: string;
  codigo: string;
  exige_parametro: boolean;
  fonte: string;
  nome: string;
  sigla: string;
};

type Faixa = {
  ativo: boolean;
  define_entrada: boolean;
  define_indice: boolean;
  define_juros: boolean;
  entrada_percentual: null | number | string;
  id: string;
  indice_correcao: null | string;
  juros_convencao: string;
  juros_periodicidade: string;
  juros_taxa: null | number | string;
  observacao: null | string;
  parcela_maxima: number;
  parcela_minima: number;
};

const RASCUNHO_VAZIO = {
  entrada: "",
  indice: "SEM_CORRECAO",
  juros: "",
  max: "",
  min: "",
  periodicidade: "mensal",
};

function paraNumero(texto: string): null | number {
  const limpo = texto.trim().replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}

/** "0,6434% a.m." — as casas do cadastro, sem zero à direita. É a régua de `textoDaTaxa`. */
function escreverTaxa(taxa: null | number, periodicidade: string): string {
  if (taxa == null || taxa <= 0) return "sem juros";
  const numero = String(Number(taxa.toFixed(4))).replace(".", ",");
  return `${numero}% ${periodicidade === "anual" ? "a.a." : "a.m."}`;
}

export function FaixasDePrazo({ enterpriseId }: { enterpriseId: string }) {
  const [faixas, setFaixas] = useState<Faixa[]>([]);
  const [indices, setIndices] = useState<Indice[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);
  const [salvando, setSalvando] = useState(false);
  const [rascunho, setRascunho] = useState(RASCUNHO_VAZIO);
  const [recarregar, setRecarregar] = useState(0);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/faixas?enterpriseId=${encodeURIComponent(enterpriseId)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const corpo = (await r.json()) as {
        data?: { faixas: Faixa[]; indices: Indice[] };
        error?: string;
      };
      if (!r.ok) throw new Error(corpo.error ?? "Falha ao ler as faixas.");
      setFaixas(corpo.data?.faixas ?? []);
      setIndices(corpo.data?.indices ?? []);
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao ler as faixas.");
    } finally {
      setCarregando(false);
    }
  }, [enterpriseId]);

  useEffect(() => {
    void carregar();
  }, [carregar, recarregar]);

  const criar = async () => {
    const entrada: EntradaDeFaixa = {
      defineEntrada: rascunho.entrada.trim() !== "",
      defineIndice: true,
      // ⚠️ CAMPO DE JUROS EM BRANCO É "SEM JUROS", e não "não opino". É a faixa "1 a 12 sem juros"
      // do exemplo do Lucas, e é por isso que `defineJuros` é sempre verdadeiro aqui: a tela do
      // empreendimento sempre tem opinião sobre juros. O `define_juros: false` existe no banco para
      // um uso que ainda não tem tela, e deixá-lo fora daqui evita oferecer uma terceira opção que
      // ninguém sabe explicar.
      defineJuros: true,
      entradaPercentual: paraNumero(rascunho.entrada),
      indiceCorrecao: rascunho.indice,
      jurosConvencao: "equivalente",
      jurosPeriodicidade: rascunho.periodicidade,
      jurosTaxa: paraNumero(rascunho.juros),
      observacao: null,
      parcelaMaxima: paraNumero(rascunho.max) ?? 0,
      parcelaMinima: paraNumero(rascunho.min) ?? 0,
    };

    const problemas = conferirFaixa(entrada);
    if (problemas.length > 0) {
      setErro(problemas.join(" "));
      return;
    }

    setSalvando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/faixas?enterpriseId=${encodeURIComponent(enterpriseId)}`,
        {
          body: JSON.stringify(entrada),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        },
      );
      const corpo = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(corpo.error ?? "Falha ao gravar a faixa.");
      setRascunho(RASCUNHO_VAZIO);
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gravar a faixa.");
    } finally {
      setSalvando(false);
    }
  };

  const desativar = async (faixa: Faixa) => {
    setSalvando(true);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const r = await fetch(
        `/api/temis/faixas?id=${encodeURIComponent(faixa.id)}`,
        {
          headers: { Authorization: `Bearer ${token}` },
          method: "DELETE",
        },
      );
      const corpo = (await r.json()) as { error?: string };
      if (!r.ok) throw new Error(corpo.error ?? "Falha ao desativar.");
      setRecarregar((n) => n + 1);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao desativar.");
    } finally {
      setSalvando(false);
    }
  };

  const ativas = faixas.filter((f) => f.ativo);

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-subtle/40 px-4 py-3">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
            <Ruler aria-hidden="true" className="size-4" />
          </span>
          <div>
            <h3 className="m-0 text-sm font-semibold text-ink">
              Faixas de prazo
            </h3>
            <p className="m-0 text-xs text-ink-muted">
              A escada do produto: quanto cada prazo custa de entrada, juros e
              correção. Ao montar um plano, o sistema busca a faixa em que o
              prazo dele cabe.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 p-4">
        {carregando ? (
          <p className="m-0 flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            Carregando as faixas…
          </p>
        ) : null}

        {!carregando && ativas.length === 0 ? (
          <p className="m-0 rounded-xl border border-dashed border-line px-3 py-4 text-center text-xs text-ink-muted">
            Nenhuma faixa cadastrada. Sem faixa, cada plano continua com os
            juros e o índice que estiverem escritos nele — é como funcionava
            antes, e nada quebra.
          </p>
        ) : null}

        {ativas.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-left text-ink-muted">
                  <th className="px-2 py-1 font-medium">Planos de</th>
                  <th className="px-2 py-1 font-medium">Entrada</th>
                  <th className="px-2 py-1 font-medium">Juros</th>
                  <th className="px-2 py-1 font-medium">Correção</th>
                  <th className="px-2 py-1" />
                </tr>
              </thead>
              <tbody>
                {ativas.map((f) => (
                  <tr className="border-t border-line" key={f.id}>
                    <td className="px-2 py-2 font-semibold tabular-nums text-ink">
                      {f.parcela_minima} a {f.parcela_maxima} parcelas
                    </td>
                    <td className="px-2 py-2 tabular-nums text-ink">
                      {f.define_entrada && f.entrada_percentual != null
                        ? `${String(Number(f.entrada_percentual)).replace(".", ",")}%`
                        : "—"}
                    </td>
                    <td className="px-2 py-2 tabular-nums text-ink">
                      {f.define_juros
                        ? escreverTaxa(
                            f.juros_taxa == null ? null : Number(f.juros_taxa),
                            f.juros_periodicidade,
                          )
                        : "—"}
                    </td>
                    <td className="px-2 py-2 text-ink">
                      {f.define_indice
                        ? (indices.find((i) => i.codigo === f.indice_correcao)
                            ?.sigla ?? f.indice_correcao)
                        : "—"}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button
                        aria-label={`Desativar a faixa de ${f.parcela_minima} a ${f.parcela_maxima} parcelas`}
                        className="rounded-lg p-1 text-ink-muted hover:bg-subtle hover:text-ink"
                        disabled={salvando}
                        onClick={() => void desativar(f)}
                        title="Desativar"
                        type="button"
                      >
                        <Power aria-hidden="true" className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {/* ⚠️ O FORMULÁRIO É UMA LINHA SÓ, e os rótulos dizem o que o campo significa em branco:
            juros vazio quer dizer SEM JUROS, e é a condição mais comum nas faixas curtas. */}
        <div className="grid gap-2 rounded-xl border border-line bg-subtle/30 p-3 md:grid-cols-6">
          <label className="grid gap-1 text-[11px] text-ink-muted">
            De (parcelas)
            <input
              className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
              inputMode="numeric"
              onChange={(e) =>
                setRascunho((r) => ({ ...r, min: e.target.value }))
              }
              value={rascunho.min}
            />
          </label>
          <label className="grid gap-1 text-[11px] text-ink-muted">
            Até (parcelas)
            <input
              className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
              inputMode="numeric"
              onChange={(e) =>
                setRascunho((r) => ({ ...r, max: e.target.value }))
              }
              value={rascunho.max}
            />
          </label>
          <label className="grid gap-1 text-[11px] text-ink-muted">
            Entrada %
            <input
              className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
              inputMode="decimal"
              onChange={(e) =>
                setRascunho((r) => ({ ...r, entrada: e.target.value }))
              }
              placeholder="em branco = não define"
              value={rascunho.entrada}
            />
          </label>
          <label className="grid gap-1 text-[11px] text-ink-muted">
            Juros
            <input
              className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
              inputMode="decimal"
              onChange={(e) =>
                setRascunho((r) => ({ ...r, juros: e.target.value }))
              }
              placeholder="em branco = sem juros"
              value={rascunho.juros}
            />
          </label>
          <label className="grid gap-1 text-[11px] text-ink-muted">
            Ao
            <select
              className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
              onChange={(e) =>
                setRascunho((r) => ({ ...r, periodicidade: e.target.value }))
              }
              value={rascunho.periodicidade}
            >
              <option value="mensal">mês</option>
              <option value="anual">ano</option>
            </select>
          </label>
          <label className="grid gap-1 text-[11px] text-ink-muted">
            Correção
            <select
              className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-ink"
              onChange={(e) =>
                setRascunho((r) => ({ ...r, indice: e.target.value }))
              }
              value={rascunho.indice}
            >
              {indices.map((i) => (
                <option key={i.codigo} value={i.codigo}>
                  {i.sigla}
                  {i.aplicacao === "nenhuma" ? "" : ` ${i.aplicacao}`}
                  {/* ⚠️ O AVISO VAI NO NOME DA OPÇÃO porque é onde a pessoa está olhando na hora
                      de escolher. Índice sem fonte automática vira cláusula de contrato sem número
                      por trás: alguém terá que informar o valor à mão a cada competência. */}
                  {i.fonte === "manual" && i.codigo !== "SEM_CORRECAO"
                    ? " · valor manual"
                    : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        {erro ? <p className="m-0 text-xs text-danger">{erro}</p> : null}

        <div className="flex justify-end">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg bg-inverse px-3 py-1.5 text-xs font-semibold text-brand-ink disabled:opacity-60"
            disabled={salvando}
            onClick={() => void criar()}
            type="button"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            {salvando ? "Gravando…" : "Adicionar faixa"}
          </button>
        </div>
      </div>
    </section>
  );
}
