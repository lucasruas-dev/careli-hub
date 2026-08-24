"use client";

import { Archive, CalendarDays, ChevronRight, Flame, Loader2, Plus, Settings } from "lucide-react";
import { useEffect, useState } from "react";

import { dataDoLancamento, rotuloDoLancamento } from "@/lib/prometeu/lancamento";
import type { PrometeuEvento } from "@/lib/prometeu/types";

import { fetchEventos } from "../../data/prometeu-operations";

// A TELA INICIAL DO PROMETEU (Lucas, 24/08: "podemos ter uma tela inicial para selecionar os
// lançamentos... vamos imaginar se eu tiver dois lançamentos simultâneos").
//
// O módulo abre AQUI: os lançamentos vivos para operar, os encerrados para consultar. A
// escolha vira o contexto de todas as telas — é o que permite dois lançamentos rodando ao
// mesmo tempo, cada posto dentro do seu.

const STATUS_ROTULO: Record<string, string> = {
  ativo: "Preparação",
  em_andamento: "Em andamento",
  encerrado: "Encerrado",
  rascunho: "Rascunho",
};

function dataBR(evento: PrometeuEvento): string {
  const dia = dataDoLancamento(evento.dataEvento);
  if (!dia) return "";
  const [ano, mes, diaN] = dia.split("-");
  return `${diaN}/${mes}/${ano}`;
}

export function SelecaoDeLancamento({
  aoEscolher,
  aoIrParaSetup,
}: {
  aoEscolher: (evento: PrometeuEvento) => void;
  aoIrParaSetup: () => void;
}) {
  const [eventos, setEventos] = useState<PrometeuEvento[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<null | string>(null);

  useEffect(() => {
    let vivo = true;
    void fetchEventos().then((r) => {
      if (!vivo) return;
      if (r.error) setErro(r.error);
      else setEventos(r.data ?? []);
      setCarregando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const naoArquivados = eventos.filter((e) => !e.arquivadoEm);
  const vivos = naoArquivados.filter((e) => e.status !== "encerrado");
  const encerrados = naoArquivados.filter((e) => e.status === "encerrado");

  const Cartao = ({ evento, consulta }: { consulta?: boolean; evento: PrometeuEvento }) => (
    <button
      className={`group flex w-full items-center gap-4 rounded-xl border px-5 py-4 text-left transition ${
        consulta
          ? "border-line bg-surface opacity-80 hover:opacity-100"
          : "border-line bg-surface hover:border-[#A07C3B]/60"
      }`}
      onClick={() => aoEscolher(evento)}
      type="button"
    >
      <span
        className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${
          consulta
            ? "border border-line text-ink-muted"
            : "border border-[#A07C3B]/55 bg-[#101820] text-[#cba25a]"
        }`}
      >
        {consulta ? <Archive aria-hidden="true" size={20} /> : <Flame aria-hidden="true" size={20} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-ink">
          {rotuloDoLancamento(evento)}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
          <CalendarDays aria-hidden="true" size={13} />
          {dataBR(evento) || "sem data"}
          <span className="rounded-full border border-line px-2 py-0.5 font-semibold">
            {STATUS_ROTULO[evento.status] ?? evento.status}
          </span>
        </span>
      </span>
      <ChevronRight aria-hidden="true" className="shrink-0 text-ink-muted transition group-hover:text-ink" size={18} />
    </button>
  );

  return (
    <div className="grid h-full min-h-0 place-items-center overflow-y-auto bg-canvas p-6">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl border border-[#A07C3B]/55 bg-[#101820] text-[#cba25a]">
            <Flame aria-hidden="true" size={22} />
          </span>
          <h1 className="mt-3 text-xl font-semibold text-ink">Escolha o lançamento</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Todas as telas do Prometeu trabalham dentro do lançamento escolhido.
          </p>
        </div>

        {erro ? (
          <p className="mb-4 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
            {erro}
          </p>
        ) : null}

        {carregando ? (
          <div className="grid place-items-center py-10 text-ink-muted">
            <Loader2 aria-hidden="true" className="animate-spin" size={28} />
          </div>
        ) : (
          <div className="grid gap-2.5">
            {vivos.map((evento) => (
              <Cartao evento={evento} key={evento.id} />
            ))}
            {vivos.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line px-5 py-6 text-center text-sm text-ink-muted">
                Nenhum lançamento em preparação ou em andamento.
              </p>
            ) : null}

            {encerrados.length > 0 ? (
              <>
                <p className="mt-3 px-1 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-muted">
                  Encerrados — consulta
                </p>
                {encerrados.map((evento) => (
                  <Cartao consulta evento={evento} key={evento.id} />
                ))}
              </>
            ) : null}

            <button
              className="mt-3 inline-flex items-center justify-center gap-2 rounded-xl border border-line px-5 py-3 text-sm font-semibold text-ink-soft transition hover:text-ink"
              onClick={aoIrParaSetup}
              type="button"
            >
              <Plus aria-hidden="true" size={16} />
              Novo lançamento
              <Settings aria-hidden="true" className="text-ink-muted" size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
