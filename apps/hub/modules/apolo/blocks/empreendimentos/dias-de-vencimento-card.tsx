"use client";

import { AlertTriangle, CalendarDays, Check, Loader2, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  DIA_DE_VENCIMENTO_MAXIMO,
  DIA_DE_VENCIMENTO_MINIMO,
  DIAS_SEM_CADASTRO,
  type DiasDeVencimento,
  diasPorExtenso,
} from "@/lib/hercules/dias-de-vencimento";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// OS DIAS DE VENCIMENTO DO EMPREENDIMENTO — o bloco da aba Políticas comerciais.
//
// Lucas (02/10/2026): *"o usuario pode colocar as datas, inserir mais de uma o ideia seria ir
// cadastrando as datas para aquele empreendimento"*. Os dias viram os atalhos do bloco Cobrança da
// proposta, e o primeiro é o que ela já nasce marcando.
//
// ⚠️ A TELA MOSTRA O QUE ESTÁ VALENDO MESMO SEM CADASTRO AQUI, e é a regra da casa, não enfeite: campo
// vazio numa tela de herança faz o operador cadastrar uma cópia "por segurança", e a herança morre
// calada. O herdado do principal e os 10 e 20 de quando ninguém cadastrou aparecem esmaecidos, com a
// origem no `title`.
//
// ⚠️ TIRAR O ÚLTIMO DIA E SALVAR É VOLTAR A HERDAR (a rota grava nulo). Não existe "lista vazia".

type Dados = {
  doPai: null | number[];
  enterpriseId: string;
  paiEnterpriseId: null | string;
  proprios: null | number[];
  valendo: DiasDeVencimento;
};

type Props = {
  codes: string[];
  enterpriseId: string;
};

function mesmaLista(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((dia, i) => dia === b[i]);
}

/** O dia digitado, se ele pode entrar na lista; senão, a frase do porquê. */
export function diaParaAdicionar(
  digitado: string,
  lista: readonly number[],
): { dia: number; ok: true } | { motivo: string; ok: false } {
  const limpo = digitado.trim();
  if (!limpo) return { motivo: "Digite um dia.", ok: false };
  const dia = Number(limpo);
  if (!Number.isInteger(dia) || dia < DIA_DE_VENCIMENTO_MINIMO || dia > DIA_DE_VENCIMENTO_MAXIMO) {
    return {
      motivo: `Do dia ${DIA_DE_VENCIMENTO_MINIMO} ao ${DIA_DE_VENCIMENTO_MAXIMO}.`,
      ok: false,
    };
  }
  if (lista.includes(dia)) return { motivo: `O dia ${dia} já está na lista.`, ok: false };
  return { dia, ok: true };
}

export function DiasDeVencimentoCard({ codes, enterpriseId }: Props) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [rascunho, setRascunho] = useState<number[]>([]);
  const [digitado, setDigitado] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<null | string>(null);
  const [recarregar, setRecarregar] = useState(0);

  // Chave estável: `codes` é um array novo a cada render do pai.
  const chaveDosCodes = codes.join(",");

  useEffect(() => {
    let vivo = true;
    setDados(null);
    setErro(null);

    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const resposta = await fetch(
          `/api/apolo/empreendimentos/dias-de-vencimento?enterprise=${encodeURIComponent(enterpriseId)}&codes=${encodeURIComponent(chaveDosCodes)}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
        );
        const corpo = (await resposta.json().catch(() => ({}))) as {
          data?: Dados;
          error?: string;
        };
        if (!vivo) return;
        if (!resposta.ok || !corpo.data) {
          setErro(corpo.error ?? "Não foi possível carregar os dias de vencimento.");
          return;
        }
        setDados(corpo.data);
        setRascunho(corpo.data.proprios ?? []);
      } catch {
        if (vivo) setErro("Não foi possível carregar os dias de vencimento.");
      }
    })();

    return () => {
      vivo = false;
    };
  }, [chaveDosCodes, enterpriseId, recarregar]);

  const salvos = dados?.proprios ?? [];
  const alterado = dados !== null && !mesmaLista(rascunho, salvos);
  const candidato = diaParaAdicionar(digitado, rascunho);

  const adicionar = () => {
    if (!candidato.ok) return;
    setRascunho((atual) => [...atual, candidato.dia].sort((a, b) => a - b));
    setDigitado("");
    setAviso(null);
  };

  const remover = (dia: number) => {
    setRascunho((atual) => atual.filter((d) => d !== dia));
    setAviso(null);
  };

  const salvar = async () => {
    if (!dados || salvando) return;
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/apolo/empreendimentos/dias-de-vencimento", {
        body: JSON.stringify({
          codes,
          dias: rascunho.length > 0 ? rascunho : null,
          enterpriseId: dados.enterpriseId,
        }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: "PUT",
      });
      const corpo = (await resposta.json().catch(() => ({}))) as { error?: string };
      if (!resposta.ok) {
        setErro(corpo.error ?? "Não foi possível salvar.");
        return;
      }
      setAviso(rascunho.length > 0 ? "Dias salvos." : "Dias removidos.");
      setRecarregar((n) => n + 1);
    } catch {
      setErro("Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  };

  // O que aparece esmaecido quando a lista própria está vazia: o herdado ou o padrão.
  const valendoDeFora =
    dados && rascunho.length === 0
      ? dados.doPai
        ? { dias: dados.doPai, origem: "Herdado do empreendimento principal" }
        : { dias: DIAS_SEM_CADASTRO, origem: "Sem cadastro, a proposta oferece estes dias" }
      : null;
  const semCadastroNenhum = dados !== null && rascunho.length === 0 && !dados.doPai;

  return (
    <section
      aria-label="Dias de vencimento"
      className="overflow-hidden rounded-2xl border border-line bg-surface"
    >
      <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
          <CalendarDays aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="m-0 text-sm font-semibold text-ink">Dias de vencimento</h4>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            Os dias que a proposta oferece para a parcela. O primeiro já vem marcado.
          </p>
        </div>
      </div>

      <div className="grid gap-3 px-4 py-4">
        {dados === null && !erro ? (
          <span className="inline-flex items-center gap-2 text-xs text-ink-muted">
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
            Carregando
          </span>
        ) : null}

        {dados ? (
          <div className="flex flex-wrap items-center gap-2" data-teste="lista-de-dias">
            {rascunho.map((dia) => (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-ink/30 bg-black/[0.045] py-1 pl-3 pr-1 text-sm font-semibold tabular-nums text-ink dark:bg-white/[0.07]"
                key={dia}
              >
                dia {dia}
                <button
                  aria-label={`Remover o dia ${dia}`}
                  className="flex size-5 items-center justify-center rounded-full text-ink-muted hover:bg-black/10 hover:text-ink dark:hover:bg-white/10"
                  onClick={() => remover(dia)}
                  title={`Remover o dia ${dia}`}
                  type="button"
                >
                  <X aria-hidden="true" className="size-3.5" />
                </button>
              </span>
            ))}

            {valendoDeFora
              ? valendoDeFora.dias.map((dia) => (
                  <span
                    className="inline-flex items-center rounded-full border border-dashed border-line px-3 py-1 text-sm font-semibold tabular-nums text-ink-muted"
                    key={`fora-${dia}`}
                    title={valendoDeFora.origem}
                  >
                    dia {dia}
                  </span>
                ))
              : null}

            {semCadastroNenhum ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-500/10 dark:text-amber-200"
                title="Sem dias cadastrados, a proposta oferece os dias 10 e 20 e avisa que falta cadastrar."
              >
                <AlertTriangle aria-hidden="true" className="size-3.5" />
                não cadastrado
              </span>
            ) : null}

            <span className="inline-flex items-center gap-1">
              <input
                aria-label="Novo dia de vencimento"
                className="h-8 w-16 rounded-lg border border-line bg-surface px-2 text-center text-sm tabular-nums text-ink outline-none focus:border-ink/40"
                inputMode="numeric"
                max={DIA_DE_VENCIMENTO_MAXIMO}
                min={DIA_DE_VENCIMENTO_MINIMO}
                onChange={(evento) => setDigitado(evento.target.value)}
                onKeyDown={(evento) => {
                  if (evento.key === "Enter") {
                    evento.preventDefault();
                    adicionar();
                  }
                }}
                placeholder="dia"
                type="number"
                value={digitado}
              />
              <button
                aria-label="Adicionar o dia"
                className="flex size-8 items-center justify-center rounded-lg bg-inverse text-brand-ink disabled:cursor-not-allowed disabled:opacity-40"
                disabled={!candidato.ok}
                onClick={adicionar}
                title={candidato.ok ? `Adicionar o dia ${candidato.dia}` : candidato.motivo}
                type="button"
              >
                <Plus aria-hidden="true" className="size-4" />
              </button>
            </span>

            {alterado ? (
              <button
                aria-label="Salvar os dias"
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-inverse px-3 text-xs font-semibold text-brand-ink disabled:opacity-60"
                disabled={salvando}
                onClick={() => void salvar()}
                title={
                  rascunho.length > 0
                    ? `Salvar ${diasPorExtenso(rascunho)}`
                    : dados.doPai
                      ? "Salvar e voltar a herdar do principal"
                      : "Salvar sem dias cadastrados"
                }
                type="button"
              >
                {salvando ? (
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                ) : (
                  <Check aria-hidden="true" className="size-3.5" />
                )}
                Salvar
              </button>
            ) : null}
          </div>
        ) : null}

        {aviso ? (
          <p className="m-0 rounded-lg bg-subtle px-3 py-2 text-xs font-medium text-ink">{aviso}</p>
        ) : null}

        {erro ? (
          <p className="m-0 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 dark:bg-rose-500/10 dark:text-rose-300">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            {erro}
          </p>
        ) : null}
      </div>
    </section>
  );
}
