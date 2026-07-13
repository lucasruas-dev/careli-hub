"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Search, UserRound, X } from "lucide-react";
import type { QueueClient } from "@/modules/guardian/attendance/types";

// Seletor de cliente da fila de cobranca do Hades. Usado no "Novo atendimento"
// da Fila de atendimento, onde o cliente ainda nao esta selecionado: busca na
// lista do Hades e, ao escolher, cai no form de abertura (HadesAttendanceModal).

const MAX_RESULTS = 40;

export function HadesClientPicker({
  clients,
  onClose,
  onSelect,
}: {
  clients: QueueClient[];
  onClose: () => void;
  onSelect: (clientId: string) => void;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const term = query.trim().toLowerCase();
    const base = term
      ? clients.filter((client) => {
          const haystack = [
            client.nome,
            client.cpf,
            client.carteira?.empreendimento,
            client.responsavel,
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return haystack.includes(term);
        })
      : clients;
    return base.slice(0, MAX_RESULTS);
  }, [clients, query]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
      />
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#A07C3B] text-white">
              <UserRound className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink">
                Novo atendimento
              </h2>
              <p className="text-[11px] text-ink-muted">
                escolha o cliente da fila de cobrança
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-subtle"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="border-b border-line p-3">
          <div className="flex items-center gap-2 rounded-lg border border-line/70 px-3">
            <Search className="size-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por nome, CPF ou empreendimento…"
              className="h-9 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-ink-muted">
              Nenhum cliente encontrado na fila de cobrança.
            </p>
          ) : (
            results.map((client) => (
              <button
                type="button"
                key={client.id}
                onClick={() => onSelect(client.id)}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[#A07C3B]/6"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#A07C3B]/12 text-[10px] font-semibold text-[#7A5E2C] dark:text-[#d9b877]">
                  {initials(client.nome)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {client.nome}
                  </span>
                  <span className="block truncate text-[11px] text-ink-muted">
                    {client.carteira?.empreendimento ?? "—"}
                    {client.parcelas?.vencidas
                      ? ` · ${client.parcelas.vencidas} vencidas`
                      : ""}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs font-semibold text-rose-700 dark:text-rose-300">
                    {client.saldoDevedor}
                  </span>
                </span>
                <ArrowRight
                  className="size-4 shrink-0 text-ink-muted transition-colors group-hover:text-[#A07C3B]"
                  aria-hidden="true"
                />
              </button>
            ))
          )}
        </div>

        <footer className="border-t border-line px-5 py-2.5 text-[11px] text-ink-muted">
          {results.length} de {clients.length} clientes
          {query ? " (filtrados)" : ""}
        </footer>
      </div>
    </div>
  );
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}
