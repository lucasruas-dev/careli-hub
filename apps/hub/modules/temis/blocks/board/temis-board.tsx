"use client";

import { AlertTriangle, Check, FileSignature, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";

// O BOARD DA TÊMIS.
//
// ⚠️ ELE NÃO CELEBRA O QUE ESTÁ PRONTO, MOSTRA O QUE TRAVA. A pergunta que a coordenação faz é
// "posso vender no Jardim das Gerais hoje?", e a resposta é não quando existe plano ativo sem
// minuta: a venda acontece na tela e o contrato não sai no fim. Por isso os empreendimentos com
// problema vêm primeiro e o número em destaque é o do que falta.

type Contagem = {
  minutasPublicadas: number;
  minutasRascunho: number;
  planosAtivos: number;
  planosSemMinuta: number;
};

const VAZIO: Contagem = {
  minutasPublicadas: 0,
  minutasRascunho: 0,
  planosAtivos: 0,
  planosSemMinuta: 0,
};

/**
 * A situação de um empreendimento, em uma frase.
 *
 * A ordem das perguntas é a ordem em que o problema aparece na vida real: primeiro não há nada,
 * depois há plano mas falta minuta, depois há minuta mas ela não foi publicada, e só então vende.
 */
function situacao(c: Contagem): { cor: string; peso: number; texto: string } {
  if (c.planosAtivos === 0 && c.minutasPublicadas === 0 && c.minutasRascunho === 0) {
    return { cor: "neutro", peso: 3, texto: "Nada cadastrado" };
  }
  if (c.planosSemMinuta > 0) {
    return {
      cor: "alerta",
      peso: 0,
      texto: `${c.planosSemMinuta} ${c.planosSemMinuta === 1 ? "plano vende e não gera contrato" : "planos vendem e não geram contrato"}`,
    };
  }
  if (c.planosAtivos === 0) {
    return { cor: "alerta", peso: 1, texto: "Minuta pronta, mas nenhum plano ativo" };
  }
  if (c.minutasPublicadas === 0) {
    return { cor: "alerta", peso: 1, texto: "Minuta ainda em rascunho" };
  }
  return {
    cor: "ok",
    peso: 2,
    texto: `${c.planosAtivos} ${c.planosAtivos === 1 ? "plano gera" : "planos geram"} contrato`,
  };
}

export function TemisBoard({
  aoAbrirEmpreendimento,
  empreendimentos,
}: {
  aoAbrirEmpreendimento: (id: string) => void;
  empreendimentos: ApoloEnterpriseRow[];
}) {
  const [contagens, setContagens] = useState<null | Record<string, Contagem>>(null);
  const [erro, setErro] = useState<null | string>(null);

  useEffect(() => {
    let cancelado = false;

    void (async () => {
      try {
        const token = await getApoloAccessToken();
        const r = await fetch("/api/temis/board", {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const corpo = (await r.json().catch(() => ({}))) as {
          data?: { contagens: Record<string, Contagem> };
          error?: string;
        };
        if (cancelado) return;

        // Falha fechada: sem isto, um timeout pintaria os 35 empreendimentos como "nada cadastrado".
        if (!r.ok || !corpo.data) {
          setErro(corpo.error ?? "Não foi possível montar o board.");
          return;
        }
        setContagens(corpo.data.contagens);
      } catch {
        if (!cancelado) setErro("Falha ao carregar o board.");
      }
    })();

    return () => {
      cancelado = true;
    };
  }, []);

  if (erro) {
    return (
      <p className="m-0 flex items-start gap-2 p-5 text-sm text-rose-900 dark:text-rose-200">
        <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        {erro}
      </p>
    );
  }

  if (!contagens) {
    return (
      <p className="m-0 flex items-center gap-2 p-6 text-sm text-ink-muted">
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        Montando o board…
      </p>
    );
  }

  // Os que travam primeiro; depois os que vendem; por último os que nem começaram.
  const linhas = empreendimentos
    .map((row) => {
      const conta = contagens[row.id] ?? VAZIO;
      return { conta, row, situacao: situacao(conta) };
    })
    .sort((a, b) => a.situacao.peso - b.situacao.peso || a.row.name.localeCompare(b.row.name));

  const travados = linhas.filter((l) => l.situacao.cor === "alerta").length;
  const prontos = linhas.filter((l) => l.situacao.cor === "ok").length;

  return (
    <div className="grid gap-4 p-5">
      <section className="grid gap-2 sm:grid-cols-3">
        <Numero
          hint={prontos === 1 ? "empreendimento gera contrato" : "empreendimentos geram contrato"}
          tom="ok"
          valor={prontos}
        />
        <Numero
          hint={travados === 1 ? "trava antes do contrato" : "travam antes do contrato"}
          tom={travados > 0 ? "alerta" : "neutro"}
          valor={travados}
        />
        <Numero
          hint="sem nada cadastrado ainda"
          tom="neutro"
          valor={linhas.length - prontos - travados}
        />
      </section>

      <ul className="m-0 grid list-none gap-0 overflow-hidden rounded-2xl border border-line bg-surface p-0">
        {linhas.map(({ conta, row, situacao: s }) => (
          <li className="border-b border-line last:border-b-0" key={row.id}>
            <button
              className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-subtle/50"
              onClick={() => aoAbrirEmpreendimento(row.id)}
              type="button"
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
                  s.cor === "ok"
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                    : s.cor === "alerta"
                      ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
                      : "bg-subtle text-ink-muted"
                }`}
              >
                {s.cor === "ok" ? (
                  <Check aria-hidden="true" className="size-4" />
                ) : s.cor === "alerta" ? (
                  <AlertTriangle aria-hidden="true" className="size-4" />
                ) : (
                  <FileSignature aria-hidden="true" className="size-4" />
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="m-0 block truncate text-sm font-semibold text-ink">
                  {row.code} · {row.name}
                </span>
                <span className="m-0 mt-0.5 block truncate text-xs text-ink-muted">{s.texto}</span>
              </span>

              <span className="shrink-0 text-right text-xs tabular-nums text-ink-muted">
                <span className="block">
                  {conta.planosAtivos} {conta.planosAtivos === 1 ? "plano" : "planos"}
                </span>
                <span className="block">
                  {conta.minutasPublicadas} publicada
                  {conta.minutasRascunho > 0 ? ` · ${conta.minutasRascunho} rascunho` : ""}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Numero({
  hint,
  tom,
  valor,
}: {
  hint: string;
  tom: "alerta" | "neutro" | "ok";
  valor: number;
}) {
  const cor =
    tom === "ok"
      ? "text-emerald-700 dark:text-emerald-300"
      : tom === "alerta"
        ? "text-amber-700 dark:text-amber-300"
        : "text-ink";

  return (
    <div className="rounded-xl border border-line bg-subtle/40 px-3 py-2.5">
      <p className={`m-0 text-2xl font-semibold tabular-nums ${cor}`}>{valor}</p>
      <p className="m-0 mt-0.5 text-[11px] text-ink-muted">{hint}</p>
    </div>
  );
}
