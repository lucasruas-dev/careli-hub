"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Building2,
  Check,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ajustarOrdemRemoto,
  fetchEventos,
  fetchFila,
} from "../../data/prometeu-operations";
import { useLancamentoSelecionado } from "../../lancamento-contexto";
import {
  lancamentoSemEmpreendimento,
  rotuloDoLancamento,
} from "@/lib/prometeu/lancamento";
import { eventoDoDia } from "@/lib/prometeu/evento-do-dia";
import type { PrometeuCredenciado, PrometeuEvento } from "@/lib/prometeu/types";

// FILA DO EVENTO — quem está habilitado e ainda NÃO chegou.
//
// É a lista que vale antes do evento começar: ordenada pela hora do PIX (quem pagou primeiro vem
// primeiro) e, para quem ainda não pagou, por ordem de cadastro. O organizador pode FURAR a fila
// (subir/descer alguém) — decisão sensível, então o motivo é obrigatório e fica auditado com quem
// mudou e quando.
//
// Quem faz check-in SAI daqui e passa a viver na fila da RECEPÇÃO (tela do Atendente): esta tela é
// o "antes do evento", a outra é o "durante". Misturar as duas inverte a fila no dia.

function horaBR(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function documentoBR(doc: string | null): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length !== 11) return doc ?? "—";
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function telefoneBR(tel: string | null | undefined): string {
  const d = (tel ?? "").replace(/\D/g, "");
  const s = d.startsWith("55") ? d.slice(2) : d;
  if (s.length === 11) return `(${s.slice(0, 2)}) ${s.slice(2, 7)}-${s.slice(7)}`;
  if (s.length === 10) return `(${s.slice(0, 2)}) ${s.slice(2, 6)}-${s.slice(6)}`;
  return tel?.trim() || "—";
}

export function FilaView() {
  const [eventos, setEventos] = useState<PrometeuEvento[]>([]);
  const [eventoId, setEventoId] = useState<string>("");
  // O LANCAMENTO SELECIONADO na tela inicial MANDA (bug 24/08: Vale do Ouro selecionado,
  // tela mostrando Villa Paris — o eventoDoDia ignora a escolha). Ref para o efeito de carga
  // inicial; o efeito abaixo troca o evento quando a selecao muda.
  const selecionado = useLancamentoSelecionado();
  const selecionadoRef = useRef(selecionado);
  selecionadoRef.current = selecionado;
  useEffect(() => {
    if (selecionado) setEventoId(selecionado.id);
  }, [selecionado]);

  const [credenciados, setCredenciados] = useState<PrometeuCredenciado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [movendo, setMovendo] = useState<string | null>(null);
  // Furar fila exige motivo: guardamos qual linha está pedindo e para onde vai.
  const [pedido, setPedido] = useState<{ direcao: "cima" | "baixo"; id: string } | null>(null);
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    void (async () => {
      const { data } = await fetchEventos();
      const lista = data ?? [];
      setEventos(lista);
      // ⚠️ MESMA REGRA DAS OUTRAS TELAS: quem está EM ANDAMENTO manda, senão o ativo, senão um
      // rascunho. Aqui era `find(status === "ativo") ?? lista[0]`, e o `?? lista[0]` abria no
      // evento mais RECENTE — que, com um lançamento encerrado no banco, era justamente ele.
      const ativo = selecionadoRef.current ?? eventoDoDia(lista);
      if (ativo) setEventoId(ativo.id);
      else setCarregando(false);
    })();
  }, []);

  const carregar = useCallback(async () => {
    if (!eventoId) return;
    setCarregando(true);
    setErro(null);
    const { data, error } = await fetchFila(eventoId);
    if (error) setErro(error);
    setCredenciados(data?.credenciados ?? []);
    setCarregando(false);
  }, [eventoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // A fila é quem AINDA NÃO chegou. Quem fez check-in já está na recepção.
  const naFila = useMemo(
    () => credenciados.filter((c) => !c.entrouEm),
    [credenciados],
  );
  const jaChegaram = credenciados.length - naFila.length;

  const eventoAtual = useMemo(
    () => eventos.find((e) => e.id === eventoId) ?? null,
    [eventos, eventoId],
  );
  const rotuloLancamento = rotuloDoLancamento(eventoAtual);
  const semEmpreendimento = lancamentoSemEmpreendimento(eventoAtual);

  const filtrada = useMemo(() => {
    const alvo = busca.trim().toLowerCase();
    if (!alvo) return naFila;
    return naFila.filter((c) =>
      `${c.nome} ${c.documento ?? ""} ${c.imobiliaria ?? ""} ${c.corretor ?? ""}`
        .toLowerCase()
        .includes(alvo),
    );
  }, [naFila, busca]);

  // Mover = colocar entre os dois vizinhos do destino. Só a chave do arrastado muda; ninguém
  // mais é recalculado (é o que o backend faz em ajustarOrdem).
  const confirmarMovimento = async () => {
    if (!pedido || !motivo.trim()) return;
    const indice = naFila.findIndex((c) => c.id === pedido.id);
    if (indice < 0) return;

    const alvo =
      pedido.direcao === "cima"
        ? { anterior: naFila[indice - 2] ?? null, seguinte: naFila[indice - 1] ?? null }
        : { anterior: naFila[indice + 1] ?? null, seguinte: naFila[indice + 2] ?? null };

    setMovendo(pedido.id);
    const { error } = await ajustarOrdemRemoto({
      credenciadoId: pedido.id,
      motivo: motivo.trim(),
      ordemAnterior: alvo.anterior?.ordemFila ?? null,
      ordemSeguinte: alvo.seguinte?.ordemFila ?? null,
    });
    setMovendo(null);
    setPedido(null);
    setMotivo("");
    if (error) setErro(error);
    else await carregar();
  };

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      <header className="shrink-0 rounded-xl border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 text-sm font-bold text-ink">Fila do evento</p>
              {/* De qual lançamento é esta fila. Sem isso o time olhava a tela sem saber se
                  estava mexendo no Vale do Ouro ou em outro empreendimento. */}
              {rotuloLancamento ? (
                <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-[#A07C3B]/30 bg-[#A07C3B]/10 px-2.5 text-[11px] font-semibold text-[#7A5E2C] dark:text-[#d9b978]">
                  <Building2 aria-hidden="true" className="size-3.5" />
                  {rotuloLancamento}
                </span>
              ) : null}
            </div>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              Ordem pela hora do PIX; quem ainda não pagou entra depois, por ordem de cadastro.
              Quem faz check-in sai daqui e vai para a recepção.
            </p>
            {semEmpreendimento ? (
              <p className="m-0 mt-1.5 inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-900">
                <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
                Este evento ainda não está ligado a um empreendimento. Escolha em Setup para a
                etiqueta e os telões saberem de qual lançamento é a fila.
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none"
              onChange={(e) => setEventoId(e.target.value)}
              value={eventoId}
            >
              {eventos.map((ev) => (
                <option key={ev.id} value={ev.id}>
                  {ev.nome}
                  {ev.status === "ativo" ? " (ativo)" : ""}
                </option>
              ))}
            </select>

            <label className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
              />
              <input
                className="h-9 w-56 rounded-lg border border-line/70 bg-surface pl-8 pr-3 text-sm text-ink outline-none"
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome, CPF, imobiliária..."
                value={busca}
              />
            </label>

            <button
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold text-ink hover:bg-subtle"
              onClick={() => void carregar()}
              type="button"
            >
              <RefreshCw aria-hidden="true" className="size-4" /> Atualizar
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
          <span>
            <b className="text-ink">{naFila.length}</b> na fila
          </span>
          <span>
            <b className="text-ink">{naFila.filter((c) => c.pagoEm).length}</b> com PIX pago
          </span>
          {jaChegaram > 0 ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
              <Check aria-hidden="true" className="size-3.5" />
              {jaChegaram} já fizeram check-in (estão na recepção)
            </span>
          ) : null}
        </div>
      </header>

      {erro ? (
        <p className="m-0 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="size-3.5 shrink-0" /> {erro}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface">
        {carregando ? (
          <p className="m-0 flex items-center gap-2 p-4 text-xs text-ink-muted">
            <Loader2 className="size-3.5 animate-spin" /> Carregando a fila...
          </p>
        ) : filtrada.length === 0 ? (
          <p className="m-0 p-4 text-xs text-ink-muted">
            {/* ⚠️ SEM LANÇAMENTO É DIFERENTE DE FILA VAZIA. Dizer "ninguém na fila ainda" quando
                não há lançamento nenhum manda o operador procurar gente que nunca ia aparecer —
                e passou a ser um caso real agora que lançamento encerrado pode ser arquivado. */}
            {!eventoId
              ? "Nenhum lançamento em operação. Crie ou ative um lançamento no Setup."
              : credenciados.length === 0
                ? "Ninguém na fila ainda. Quem for credenciado no Apolo entra aqui automaticamente."
                : "Todos que estavam na fila já fizeram check-in."}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-subtle text-[11px] uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">#</th>
                <th className="px-3 py-2 font-semibold">Cliente</th>
                <th className="px-3 py-2 font-semibold">Telefone</th>
                <th className="px-3 py-2 font-semibold">Imobiliária / corretor</th>
                <th className="px-3 py-2 font-semibold">Entrada</th>
                <th className="px-3 py-2 font-semibold">Ordem</th>
              </tr>
            </thead>
            <tbody>
              {filtrada.map((c, i) => {
                const indiceReal = naFila.findIndex((x) => x.id === c.id);
                return (
                  <tr className="border-t border-line align-middle" key={c.id}>
                    <td className="px-3 py-2 tabular-nums text-ink-muted">{i + 1}</td>
                    <td className="px-3 py-2">
                      <p className="m-0 font-semibold text-ink">{c.nome}</p>
                      <p className="m-0 text-[11px] tabular-nums text-ink-muted">
                        {documentoBR(c.documento)}
                      </p>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink-soft">
                      {telefoneBR(c.telefone)}
                    </td>
                    <td className="px-3 py-2 text-xs text-ink-soft">
                      <p className="m-0">{c.imobiliaria ?? "—"}</p>
                      <p className="m-0 text-ink-muted">{c.corretor ?? "—"}</p>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {c.pagoEm ? (
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
                          PIX · {horaBR(c.pagoEm)}
                        </span>
                      ) : (
                        <span className="text-ink-muted">
                          CAD · {horaBR(c.chegouEm ?? c.etapaDesde)}
                        </span>
                      )}
                      {c.ordemMotivo ? (
                        <p
                          className="m-0 mt-0.5 truncate text-[11px] text-amber-700 dark:text-amber-300"
                          title={c.ordemMotivo}
                        >
                          ordem ajustada: {c.ordemMotivo}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1">
                        <button
                          aria-label="Subir na fila"
                          className="inline-flex size-7 items-center justify-center rounded-md border border-line text-ink-soft hover:bg-subtle disabled:opacity-40"
                          disabled={indiceReal <= 0 || movendo === c.id}
                          onClick={() => {
                            setPedido({ direcao: "cima", id: c.id });
                            setMotivo("");
                          }}
                          type="button"
                        >
                          {movendo === c.id ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <ArrowUp className="size-3.5" />
                          )}
                        </button>
                        <button
                          aria-label="Descer na fila"
                          className="inline-flex size-7 items-center justify-center rounded-md border border-line text-ink-soft hover:bg-subtle disabled:opacity-40"
                          disabled={indiceReal >= naFila.length - 1 || movendo === c.id}
                          onClick={() => {
                            setPedido({ direcao: "baixo", id: c.id });
                            setMotivo("");
                          }}
                          type="button"
                        >
                          <ArrowDown className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Furar fila é decisão sensível: sem motivo, não passa. */}
      {pedido ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl border border-line bg-surface p-5">
            <p className="m-0 text-sm font-bold text-ink">
              Mover {pedido.direcao === "cima" ? "para cima" : "para baixo"} na fila
            </p>
            <p className="m-0 mt-1 text-xs text-ink-muted">
              Alterar a ordem muda quem é atendido primeiro. O motivo fica registrado com o seu
              nome e o horário.
            </p>
            <textarea
              className="mt-3 w-full rounded-lg border border-line bg-canvas p-2 text-sm text-ink"
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por que esta pessoa está mudando de posição?"
              rows={3}
              value={motivo}
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                className="inline-flex h-9 items-center rounded-lg border border-line px-4 text-sm font-medium text-ink hover:bg-subtle"
                onClick={() => {
                  setPedido(null);
                  setMotivo("");
                }}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink disabled:opacity-50"
                disabled={!motivo.trim()}
                onClick={() => void confirmarMovimento()}
                type="button"
              >
                <Check className="size-4" /> Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
