"use client";

import { type RefObject, useEffect, useState } from "react";

import {
  type EscalaDoTotem,
  escalaDoTotem,
} from "@/lib/prometeu/escala-do-totem";

/**
 * Observa o quadro da reserva e devolve de que tamanho ela deve se desenhar.
 *
 * Mede o ELEMENTO, não a janela: é o quadro que sabe quanto espaço sobrou depois do rail e das
 * abas do hub. E mede de novo a cada resize, giro de tela e mudança de layout — o tablet que
 * gira no suporte e o operador que sai da tela cheia caem no mesmo caminho.
 *
 * Começa em "compacta" de propósito: é o único degrau que cabe em qualquer lugar, então o
 * primeiro quadro nunca nasce estourando a tela antes da primeira medida chegar.
 */
export function usarEscalaDoTotem(
  quadroRef: RefObject<HTMLElement | null>,
  telaCheiaPelaApi: boolean,
): EscalaDoTotem {
  const [escala, setEscala] = useState<EscalaDoTotem>("compacta");

  useEffect(() => {
    const medir = () => {
      setEscala(
        escalaDoTotem({
          alturaDaJanela: window.innerHeight,
          alturaDaTela: window.screen?.height ?? 0,
          alturaDoQuadro:
            quadroRef.current?.getBoundingClientRect().height ?? 0,
          telaCheiaPelaApi,
        }),
      );
    };

    medir();

    // O quadro é `h-full`: a altura vem do pai, não do conteúdo. Por isso trocar a escala não
    // muda a altura medida — não há laço de realimentação aqui.
    const elemento = quadroRef.current;
    const observador =
      elemento && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(medir)
        : null;
    observador?.observe(elemento as Element);

    window.addEventListener("resize", medir);
    window.addEventListener("orientationchange", medir);
    return () => {
      observador?.disconnect();
      window.removeEventListener("resize", medir);
      window.removeEventListener("orientationchange", medir);
    };
  }, [quadroRef, telaCheiaPelaApi]);

  return escala;
}
