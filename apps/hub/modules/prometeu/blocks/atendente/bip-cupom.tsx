"use client";

import { Check, FileText, Loader2, X } from "lucide-react";
import { useCallback, useState } from "react";

import { ehIdDeCupom } from "@/lib/prometeu/cupom";

import {
  fetchCupom,
  lancarPropostaDoCupomRemoto,
  type CupomReservaLinha,
} from "../../data/prometeu-operations";
import { usarLeitorWedge } from "../usar-leitor-wedge";

// O BIP DO CUPOM NA SECRETÁRIA (Lucas, 24/08: "dentro da secretária eu lanço a proposta").
//
// A tela da mesa fica como é; este componente só ESCUTA o leitor USB. Quando um cupom de
// reserva é bipado, abre a confirmação com cliente + unidades + proponentes e o botão único:
// LANÇAR A PROPOSTA — o carimbo que o funil conta (mini dash da Reserva, Central). O corretor
// entrega a PA em papel; a secretária bipa e lança.

type CupomNaMesa = {
  cliente: { nome: string };
  grupoId: string;
  reservas: CupomReservaLinha[];
};

export function BipDoCupomDaSecretaria({ operador }: { operador?: null | string }) {
  const [cupom, setCupom] = useState<null | CupomNaMesa>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<null | string>(null);
  const [feito, setFeito] = useState<null | { jaLancada: boolean; nome: string }>(null);

  const aoBipar = useCallback(
    async (lido: string) => {
      const grupoId = lido.trim();
      // Só age em QR de CUPOM (uuid); crachás e códigos digitados seguem para a tela da mesa.
      if (!ehIdDeCupom(grupoId) || ocupado || cupom) return;
      setOcupado(true);
      setErro(null);
      const r = await fetchCupom(grupoId);
      if (r.error || !r.data) {
        setErro(r.error ?? "Cupom não encontrado.");
        window.setTimeout(() => setErro(null), 4_000);
      } else {
        setCupom({ cliente: r.data.cliente, grupoId, reservas: r.data.reservas });
      }
      setOcupado(false);
    },
    [cupom, ocupado],
  );

  usarLeitorWedge((v) => void aoBipar(v), true);

  const lancar = async () => {
    if (!cupom || ocupado) return;
    setOcupado(true);
    const r = await lancarPropostaDoCupomRemoto({
      grupoId: cupom.grupoId,
      lancadoPor: operador ?? undefined,
    });
    if (r.error) {
      setErro(r.error);
      window.setTimeout(() => setErro(null), 4_000);
    } else {
      setFeito({ jaLancada: Boolean(r.data?.jaLancada), nome: cupom.cliente.nome });
      window.setTimeout(() => setFeito(null), 4_000);
    }
    setCupom(null);
    setOcupado(false);
  };

  if (!cupom && !feito && !erro) return null;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-xl">
        {erro && !cupom ? (
          <p className="text-sm font-semibold text-red-600 dark:text-red-300">{erro}</p>
        ) : feito ? (
          <>
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#2C2C2A] text-[#F1EFE8]">
              <Check aria-hidden="true" size={32} />
            </span>
            <p className="mt-3 text-lg font-bold text-ink">{feito.nome}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {feito.jaLancada ? "Proposta já estava lançada." : "Proposta lançada."}
            </p>
          </>
        ) : cupom ? (
          <>
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl border border-line text-ink-muted">
              <FileText aria-hidden="true" size={26} />
            </span>
            <p className="mt-3 text-lg font-bold text-ink">{cupom.cliente.nome}</p>
            <p className="mt-1 text-sm text-ink-soft">
              {cupom.reservas.map((r) => r.codigo).join(" · ")}
            </p>
            {cupom.reservas[0]?.proponentes && cupom.reservas[0].proponentes.length > 1 ? (
              <p className="mt-1 text-xs text-ink-muted">
                {cupom.reservas[0].proponentes
                  .map((p) => `${p.nome.split(/\s+/)[0]} ${p.percentual}%`)
                  .join(" · ")}
              </p>
            ) : null}
            {erro ? (
              <p className="mt-2 text-xs font-semibold text-red-600 dark:text-red-300">{erro}</p>
            ) : null}
            <div className="mt-5 flex justify-center gap-3">
              <button
                className="grid h-12 w-12 place-items-center rounded-xl border border-line text-ink"
                onClick={() => setCupom(null)}
                title="Cancelar"
                type="button"
              >
                <X aria-hidden="true" size={20} />
              </button>
              <button
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#2C2C2A] px-6 text-base font-bold text-[#F1EFE8] disabled:opacity-40"
                disabled={ocupado}
                onClick={() => void lancar()}
                type="button"
              >
                {ocupado ? (
                  <Loader2 aria-hidden="true" className="animate-spin" size={18} />
                ) : (
                  <Check aria-hidden="true" size={18} />
                )}
                Lançar proposta
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
