"use client";

import { useEffect, useRef } from "react";

// LEITOR USB (wedge de teclado) — o leitor 2D de mesa "digita" o conteúdo do QR em rajada e
// finaliza com Enter. A janela de 300ms entre teclas separa leitor de digitação humana.
// Usado na posição de Reserva, na Impressão da PA e na Secretária (bip do cupom).
export function usarLeitorWedge(aoLer: (valor: string) => void, ativo: boolean) {
  const bufferRef = useRef("");
  const ultimoRef = useRef(0);
  const aoLerRef = useRef(aoLer);

  useEffect(() => {
    aoLerRef.current = aoLer;
  }, [aoLer]);

  useEffect(() => {
    if (!ativo) return;
    const aoTeclar = (ev: KeyboardEvent) => {
      // Digitação em campo de formulário não é bip: se o foco está num input/textarea,
      // o wedge global não intercepta (a Secretária tem campos de busca).
      const alvo = ev.target as HTMLElement | null;
      const emCampo =
        alvo instanceof HTMLInputElement ||
        alvo instanceof HTMLTextAreaElement ||
        Boolean(alvo?.isContentEditable);

      const agora = Date.now();
      if (agora - ultimoRef.current > 300) bufferRef.current = "";
      ultimoRef.current = agora;

      if (ev.key === "Enter") {
        const lido = bufferRef.current.trim();
        bufferRef.current = "";
        // Rajada rápida terminada em Enter com cara de código: vale mesmo vindo de um campo
        // (o leitor digita onde o foco estiver) — mas só se o texto veio em ritmo de máquina.
        if (lido.length >= 6 && !emCampo) aoLerRef.current(lido);
        else if (lido.length >= 32) aoLerRef.current(lido);
        return;
      }
      if (ev.key.length === 1) bufferRef.current += ev.key;
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [ativo]);
}
