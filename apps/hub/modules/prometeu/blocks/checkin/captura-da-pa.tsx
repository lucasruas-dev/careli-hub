"use client";

import { Camera, Check, Loader2, X } from "lucide-react";
import { useRef, useState } from "react";

import { enviarPaRemoto } from "../../data/prometeu-operations";
import type { PrometeuCredenciado } from "@/lib/prometeu/types";

// FOTOGRAFAR A PA logo depois do bip da secretaria.
//
// A PA é a folha A4 com a proposta preenchida no salão. Parte do atendimento é REMOTO — quem
// atende de fora não tem o papel na mão, e sem a foto não consegue lançar a proposta.
//
// REGRA DO LUCAS (27/07): NÃO trava. O cliente já entrou na fila da secretaria quando esta tela
// aparece; se a foto falhar (internet do salão caindo, celular cheio), o organizador pula e a
// PA fica pendente. O que a falta de PA impede é o encaminhamento para o atendimento REMOTO,
// não a passagem pela fila.
//
// Usa a câmera nativa (`capture="environment"`) em vez de stream próprio: o app de câmera do
// celular já foca, corta e comprime melhor do que qualquer coisa que a gente escreva aqui — e
// fotografar papel é justamente onde foco automático faz diferença.
export function CapturaDaPa({
  credenciado,
  eventoId,
  onFechar,
  onRegistrada,
}: {
  credenciado: PrometeuCredenciado;
  eventoId: string;
  onFechar: () => void;
  onRegistrada: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aoEscolher(arquivo: File | undefined) {
    if (!arquivo) return;

    setEnviando(true);
    setErro(null);

    const { error } = await enviarPaRemoto({
      arquivo,
      credenciadoId: credenciado.id,
      eventoId,
    });

    setEnviando(false);

    if (error) {
      // Erro aparece NA TELA com a saída "seguir sem a PA" logo abaixo: o organizador não pode
      // ficar preso tentando de novo com a fila andando atrás dele.
      setErro(error);
      return;
    }

    onRegistrada();
  }

  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-black/85 p-4 backdrop-blur-sm">
      <div className="w-full max-w-sm rounded-2xl border border-[#cba25a]/40 bg-[#111823] p-5 text-center">
        <p className="m-0 text-[11px] font-black uppercase tracking-widest text-[#cba25a]">
          Registrar a PA
        </p>
        <p className="m-0 mt-1 text-xl font-black leading-tight text-white">
          {credenciado.nome}
        </p>
        <p className="m-0 mt-2 text-xs text-white/60">
          Fotografe a folha da proposta. É o que o atendimento remoto precisa para lançar.
        </p>

        <input
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(evento) => void aoEscolher(evento.target.files?.[0])}
          ref={inputRef}
          type="file"
        />

        {erro ? (
          <p className="m-0 mt-3 rounded-lg border border-red-400/40 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200">
            {erro}
          </p>
        ) : null}

        <button
          className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#cba25a] text-sm font-black text-[#101820] disabled:opacity-60"
          disabled={enviando}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          {enviando ? (
            <>
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              Enviando...
            </>
          ) : (
            <>
              <Camera aria-hidden="true" className="size-4" />
              {erro ? "Tentar de novo" : "Fotografar a PA"}
            </>
          )}
        </button>

        <button
          className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/15 text-xs font-bold text-white/70"
          disabled={enviando}
          onClick={onFechar}
          type="button"
        >
          <X aria-hidden="true" className="size-3.5" />
          Seguir sem a PA
        </button>

        <p className="m-0 mt-3 text-[10px] leading-snug text-white/40">
          Sem a PA o cliente segue na fila normalmente, mas não pode ser atendido por quem está
          remoto.
        </p>
      </div>
    </div>
  );
}

// Selo de PA na lista: verde com o "ok" quando registrada, âmbar quando pendente. O organizador
// da secretaria usa isso para voltar e fotografar quem ficou sem.
export function SeloDaPa({ temPa }: { temPa: boolean }) {
  if (temPa) {
    return (
      <span
        aria-label="PA registrada"
        className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500 text-white"
        title="PA registrada"
      >
        <Check aria-hidden="true" className="size-3" />
      </span>
    );
  }

  return (
    <span
      className="shrink-0 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-black uppercase text-amber-300"
      title="PA pendente: não pode ir para atendimento remoto"
    >
      Sem PA
    </span>
  );
}
