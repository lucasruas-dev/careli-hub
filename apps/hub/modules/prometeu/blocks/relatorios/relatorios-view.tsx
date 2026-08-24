"use client";

import { BarChart3, Check, Copy, ExternalLink, Gauge, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { eventoDoDia } from "@/lib/prometeu/evento-do-dia";

import {
  fetchEventos,
  fetchRelatoriosDoLancamento,
} from "../../data/prometeu-operations";
import { useLancamentoSelecionado } from "../../lancamento-contexto";

// RELATÓRIOS DO LANÇAMENTO (grupo Inteligência de Dados — Lucas, 24/08): os dois relatórios
// herdados do Vale do Ouro, por lançamento, na tela e com link público para encaminhar a
// gestores e loteadores. COMERCIAL = vendas/estoque; PERFORMANCE = fila e atendimento.

type Aba = "comercial" | "performance";

export function RelatoriosView() {
  const selecionado = useLancamentoSelecionado();
  const [links, setLinks] = useState<null | { comercial: string; performance: string }>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [aba, setAba] = useState<Aba>("comercial");
  const [copiado, setCopiado] = useState<null | Aba>(null);

  useEffect(() => {
    let vivo = true;
    void (async () => {
      let eventoId = selecionado?.id;
      if (!eventoId) {
        const eventos = await fetchEventos();
        eventoId = eventoDoDia(eventos.data ?? [])?.id;
      }
      const r = await fetchRelatoriosDoLancamento(eventoId);
      if (!vivo) return;
      if (r.error || !r.data) setErro(r.error ?? "Não consegui montar os links.");
      else setLinks({ comercial: r.data.comercial, performance: r.data.performance });
    })();
    return () => {
      vivo = false;
    };
  }, [selecionado?.id]);

  const linkAtivo = links ? links[aba] : null;

  const copiar = async () => {
    if (!linkAtivo) return;
    await navigator.clipboard.writeText(linkAtivo);
    setCopiado(aba);
    window.setTimeout(() => setCopiado(null), 2_500);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-xl border border-line bg-surface p-1">
          {(
            [
              ["comercial", "Comercial", BarChart3],
              ["performance", "Performance", Gauge],
            ] as const
          ).map(([id, rotulo, Icone]) => (
            <button
              key={id}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                aba === id
                  ? "bg-[#2C2C2A] text-[#F1EFE8]"
                  : "text-ink-soft hover:text-ink"
              }`}
              onClick={() => setAba(id)}
              type="button"
            >
              <Icone aria-hidden="true" size={15} />
              {rotulo}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:border-[#A07C3B]/60 disabled:opacity-40"
            disabled={!linkAtivo}
            onClick={() => void copiar()}
            type="button"
          >
            {copiado === aba ? (
              <Check aria-hidden="true" size={15} />
            ) : (
              <Copy aria-hidden="true" size={15} />
            )}
            {copiado === aba ? "Link copiado" : "Copiar link"}
          </button>
          <a
            className={`inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-ink transition hover:border-[#A07C3B]/60 ${
              linkAtivo ? "" : "pointer-events-none opacity-40"
            }`}
            href={linkAtivo ?? "#"}
            rel="noopener noreferrer"
            target="_blank"
          >
            <ExternalLink aria-hidden="true" size={15} />
            Abrir
          </a>
        </div>
      </header>

      <p className="mb-3 text-xs text-ink-muted">
        O link é público e mostra só números agregados — pode encaminhar para gestores e
        loteadores. A página atualiza sozinha a cada minuto.
      </p>

      {erro ? (
        <p className="mb-3 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {erro}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-white">
        {linkAtivo ? (
          <iframe
            className="block h-full w-full border-0"
            key={linkAtivo}
            src={linkAtivo}
            title={`Relatório ${aba}`}
          />
        ) : !erro ? (
          <div className="grid h-full place-items-center text-ink-muted">
            <Loader2 aria-hidden="true" className="animate-spin" size={28} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
