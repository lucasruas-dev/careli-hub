"use client";

import { Check, Loader2, Printer, RotateCcw, Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  cancelarReservaRemoto,
  fetchReservasDoEvento,
  type ReservaDoEventoLinha,
} from "../../data/prometeu-operations";

// A LISTA DE RESERVAS DO POSTO DA PA — imprimir sem bipar, reemitir e cancelar.
//
// ⚠️ POR QUE ELA EXISTE (Lucas, 29/08/2026): *"na parte de impressão PA colocar a impressão
// manual, a qual lista as unidades em reserva, ae eu posso clicar e mandar imprimir, mas também
// vamos fechar mais pra frente o bip para impressão de PA, para amanhã terá que ser manualmente
// mesmo"*. O bip é o caminho bonito; a lista é o que faz o evento andar amanhã.
//
// As TRÊS coisas moram aqui porque fazem a mesma pergunta — "quais reservas existem?" — e três
// telas para a mesma consulta seria três lugares para desencontrar:
//   1. IMPRIMIR sem o leitor;
//   2. REEMITIR uma proposta já impressa (o "histórico" que o Lucas pediu é esta lista, que
//      mostra o que já saiu e quando);
//   3. CANCELAR uma reserva — que até 29/08 não existia em lugar nenhum e só se fazia por SQL.

type Props = {
  /** Imprime as folhas daquele cupom. A tela do posto já sabe fazer isso. */
  aoImprimir: (grupoId: string) => Promise<void>;
  eventoId?: string;
};

function horaBR(iso: null | string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
}

const CHIP = "rounded-full px-2 py-0.5 text-[0.7rem] font-bold";

function Situacao({ reserva }: { reserva: ReservaDoEventoLinha }) {
  if (reserva.situacao === "cancelada") {
    return (
      <span
        className={`${CHIP} bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300`}
      >
        Cancelada
      </span>
    );
  }
  if (reserva.propostaLancadaEm) {
    return (
      <span
        className={`${CHIP} bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300`}
      >
        Proposta lançada
      </span>
    );
  }
  if (reserva.paImpressaEm) {
    return (
      <span
        className={`${CHIP} bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300`}
      >
        PA impressa {horaBR(reserva.paImpressaEm)}
      </span>
    );
  }
  return (
    <span className={`${CHIP} bg-black/[0.06] text-ink-soft dark:bg-white/10`}>
      Aguardando impressão
    </span>
  );
}

export function ListaDeReservas({ aoImprimir, eventoId }: Props) {
  const [reservas, setReservas] = useState<null | ReservaDoEventoLinha[]>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [busca, setBusca] = useState("");
  const [ocupado, setOcupado] = useState<null | string>(null);
  const [confirmandoCancelar, setConfirmandoCancelar] =
    useState<null | ReservaDoEventoLinha>(null);

  const carregar = useCallback(async () => {
    const r = await fetchReservasDoEvento(eventoId);
    if (r.error) {
      setErro(r.error);
      return;
    }
    setErro(null);
    setReservas(r.data?.reservas ?? []);
  }, [eventoId]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Busca por nome ou por lote: no salão o operador tem um dos dois na mão, nunca o grupo.
  const filtradas = useMemo(() => {
    const termo = busca.trim().toLocaleLowerCase("pt-BR");
    if (!termo || !reservas) return (reservas ?? []).slice(0, 200);
    return reservas
      .filter((r) => {
        const alvo =
          `${r.cliente ?? ""} ${r.lotes.join(" ")} ${r.origem ?? ""}`.toLocaleLowerCase(
            "pt-BR",
          );
        return alvo.includes(termo);
      })
      .slice(0, 200);
  }, [busca, reservas]);

  const imprimir = async (reserva: ReservaDoEventoLinha) => {
    setOcupado(reserva.grupoId);
    try {
      await aoImprimir(reserva.grupoId);
      await carregar();
    } finally {
      setOcupado(null);
    }
  };

  const cancelar = async (
    reserva: ReservaDoEventoLinha,
    motivo: string,
    codigos: string[],
  ) => {
    setOcupado(reserva.grupoId);
    setConfirmandoCancelar(null);
    const r = await cancelarReservaRemoto({
      // Lista completa = cupom inteiro; a rota trata vazio como "todos".
      codigos: codigos.length === reserva.lotes.length ? undefined : codigos,
      eventoId,
      grupoId: reserva.grupoId,
      motivo,
    });
    if (r.error) setErro(r.error);
    await carregar();
    setOcupado(null);
  };

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col gap-3 p-4">
      <div className="flex shrink-0 items-center gap-2">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted"
            size={16}
          />
          <input
            className="w-full rounded-lg border border-line bg-surface py-2.5 pl-9 pr-3 text-sm text-ink"
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por cliente ou lote"
            value={busca}
          />
        </div>
        <button
          className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line text-ink-soft transition hover:text-ink"
          onClick={() => void carregar()}
          title="Atualizar"
          type="button"
        >
          <RotateCcw aria-hidden="true" size={16} />
        </button>
      </div>

      {erro ? (
        <p className="shrink-0 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {erro}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {reservas === null ? (
          <div className="grid place-items-center py-10 text-ink-muted">
            <Loader2 aria-hidden="true" className="animate-spin" size={24} />
          </div>
        ) : filtradas.length === 0 ? (
          <p className="py-10 text-center text-sm text-ink-muted">
            {busca
              ? "Nada encontrado."
              : "Nenhuma reserva neste lançamento ainda."}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtradas.map((reserva) => {
              const cancelada = reserva.situacao === "cancelada";
              return (
                <li
                  className={`rounded-xl border border-line bg-surface p-3 ${cancelada ? "opacity-60" : ""}`}
                  key={reserva.grupoId}
                >
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold text-ink">
                        {reserva.cliente ?? "Sem proponente"}
                      </p>
                      {reserva.origem ? (
                        <p className="truncate text-xs text-ink-muted">
                          {reserva.origem}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm font-semibold text-ink-soft">
                        {reserva.lotes.join("  ·  ")}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <Situacao reserva={reserva} />
                        <span className="text-[0.7rem] text-ink-muted">
                          reservada {horaBR(reserva.criadaEm)}
                        </span>
                      </div>
                      {cancelada && reserva.canceladaMotivo ? (
                        <p className="mt-1 text-xs text-ink-muted">
                          {reserva.canceladaMotivo}
                        </p>
                      ) : null}
                    </div>

                    {cancelada ? null : (
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          className="grid h-11 w-11 place-items-center rounded-lg border border-line text-ink-soft transition hover:border-red-400 hover:text-red-600"
                          disabled={ocupado === reserva.grupoId}
                          onClick={() => setConfirmandoCancelar(reserva)}
                          title="Cancelar reserva"
                          type="button"
                        >
                          <X aria-hidden="true" size={18} />
                        </button>
                        <button
                          className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#2C2C2A] px-4 text-sm font-bold text-[#F1EFE8] transition hover:opacity-90 disabled:opacity-40"
                          disabled={ocupado === reserva.grupoId}
                          onClick={() => void imprimir(reserva)}
                          type="button"
                        >
                          {ocupado === reserva.grupoId ? (
                            <Loader2
                              aria-hidden="true"
                              className="animate-spin"
                              size={16}
                            />
                          ) : (
                            <Printer aria-hidden="true" size={16} />
                          )}
                          {reserva.paImpressaEm ? "2ª via" : "Imprimir"}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {confirmandoCancelar ? (
        <ConfirmarCancelamento
          onCancelar={() => setConfirmandoCancelar(null)}
          onConfirmar={(motivo, codigos) =>
            void cancelar(confirmandoCancelar, motivo, codigos)
          }
          reserva={confirmandoCancelar}
        />
      ) : null}
    </div>
  );
}

// ⚠️ CANCELAR PEDE CONFIRMAÇÃO E MOTIVO. O lote volta para a prateleira na hora e o cliente
// pode estar com o cupom impresso na mão — não é uma ação para acontecer por toque errado. O
// motivo fica gravado na reserva, que é como se descobre depois por que um lote voltou.
function ConfirmarCancelamento({
  onCancelar,
  onConfirmar,
  reserva,
}: {
  onCancelar: () => void;
  onConfirmar: (motivo: string, codigos: string[]) => void;
  reserva: ReservaDoEventoLinha;
}) {
  const [motivo, setMotivo] = useState("");
  // ⚠️ COMEÇA COM TUDO MARCADO: devolver o cupom inteiro é o caso comum, e o operador que quer
  // isso não deve precisar marcar nada. Quem devolve UM lote desmarca os outros.
  const [escolhidos, setEscolhidos] = useState<string[]>(() => [...reserva.codigos]);
  const varios = reserva.lotes.length > 1;
  const nenhum = escolhidos.length === 0;
  const todos = escolhidos.length === reserva.lotes.length;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5">
        <p className="text-lg font-bold text-ink">
          {varios && !todos ? "Cancelar o lote?" : "Cancelar a reserva?"}
        </p>
        <p className="mt-2 text-sm text-ink-soft">
          <b>{reserva.cliente ?? "Sem proponente"}</b>
        </p>

        {/* ⚠️ A ESCOLHA SÓ APARECE COM MAIS DE UM LOTE (Lucas, 29/08: *"o vitor vai devolver
            somente um lote, tem que especificar qual quando tem mais de um"*). Com um lote só,
            a lista seria uma pergunta com uma resposta — ruído no meio do salão. */}
        {varios ? (
          <div className="mt-3">
            <span className="mb-1.5 block text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted">
              Quais lotes devolver
            </span>
            <ul className="flex flex-col gap-1">
              {reserva.lotes.map((rotulo, i) => {
                const codigo = reserva.codigos[i] ?? "";
                const marcado = escolhidos.includes(codigo);
                return (
                  <li key={codigo || rotulo}>
                    <button
                      className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition ${
                        marcado
                          ? "border-red-400 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-300"
                          : "border-line text-ink-soft"
                      }`}
                      onClick={() =>
                        setEscolhidos((atual) =>
                          atual.includes(codigo)
                            ? atual.filter((c) => c !== codigo)
                            : [...atual, codigo],
                        )
                      }
                      type="button"
                    >
                      <span
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${
                          marcado ? "border-red-500 bg-red-500 text-white" : "border-line"
                        }`}
                      >
                        {marcado ? <Check aria-hidden="true" size={13} /> : null}
                      </span>
                      {rotulo}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : (
          <p className="mt-1 text-sm font-semibold text-ink-soft">
            {reserva.lotes.join(", ")}
          </p>
        )}

        <p className="mt-3 text-sm text-ink-muted">
          {escolhidos.length === 1 ? "O lote volta" : "Os lotes voltam"} para a
          prateleira na hora, e {escolhidos.length === 1 ? "aparece" : "aparecem"} de
          novo no telão.
          {varios && !todos && !nenhum
            ? " O resto do cupom continua reservado."
            : ""}
        </p>
        <label className="mt-4 block">
          <span className="mb-1.5 block text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted">
            Motivo
          </span>
          <input
            autoFocus
            className="w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink"
            onChange={(e) => setMotivo(e.target.value)}
            placeholder="Desistiu, trocou de lote, erro de operação..."
            value={motivo}
          />
        </label>
        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded-lg border border-line px-4 py-2.5 text-sm font-semibold text-ink-soft"
            onClick={onCancelar}
            type="button"
          >
            Voltar
          </button>
          <button
            className="rounded-lg bg-red-600 px-4 py-2.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-40"
            disabled={nenhum}
            onClick={() => onConfirmar(motivo.trim(), escolhidos)}
            type="button"
          >
            {nenhum
              ? "Escolha um lote"
              : varios && !todos
                ? `Cancelar ${escolhidos.length} lote${escolhidos.length > 1 ? "s" : ""}`
                : "Cancelar reserva"}
          </button>
        </div>
      </div>
    </div>
  );
}
