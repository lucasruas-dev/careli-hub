"use client";

import { useEffect, useRef } from "react";

import {
  decidirEnterDoWedge,
  focoEmCampoDeTexto,
  JANELA_DE_RAJADA_MS,
} from "@/lib/prometeu/leitura-wedge";

// LEITOR USB (wedge de teclado) — o leitor 2D de mesa "digita" o conteúdo do QR em rajada e
// finaliza com Enter. A janela de 300ms entre teclas separa leitor de digitação humana.
// Usado na posição de Reserva, na Impressão da PA e na Secretária (bip do cupom).
//
// ⚠️ O QUE CHEGA PASSA POR normalizarLeituraDoQr ANTES de sair daqui: leitor em layout de
// teclado diferente do Windows entrega o UUID com o separador trocado (medido no primeiro teste
// com o hardware: hífen virou ponto e vírgula). Consertar aqui cobre os três pontos de bip de
// uma vez — ver o cabeçalho de lib/prometeu/leitura-qr.ts.
//
// ⚠️ O ENTER DO LEITOR NÃO PODE VAZAR PARA A PÁGINA (28/08/2026). Ativar um <button> com Enter
// é a ação padrão do keydown: o Enter que fecha a rajada re-clicava o último botão focado — na
// Reserva, o próprio botão de TELA CHEIA, que então saía da tela cheia bem na hora do bip.
// TODO Enter com cara de máquina é cancelado, mesmo o que não vira leitura (sufixo CR+LF do
// leitor, rajada curta de etiqueta amassada) — senão sobra o mesmo sintoma desmarcando o lote
// que o operador acabou de tocar. Quem decide é decidirEnterDoWedge, em lib/prometeu/leitura-wedge.ts.
export function usarLeitorWedge(aoLer: (valor: string) => void, ativo: boolean) {
  const bufferRef = useRef("");
  const ultimoRef = useRef(0);
  const inicioRef = useRef(0);
  const ultimaLeituraRef = useRef(0);
  const aoLerRef = useRef(aoLer);

  useEffect(() => {
    aoLerRef.current = aoLer;
  }, [aoLer]);

  useEffect(() => {
    if (!ativo) return;
    const aoTeclar = (ev: KeyboardEvent) => {
      // Digitação em campo de formulário não é bip: se o foco está num input/textarea, o wedge
      // global só aceita o que tem tamanho de UUID, e nunca cancela o Enter da pessoa.
      const emCampo = focoEmCampoDeTexto(ev.target);

      const agora = Date.now();
      if (agora - ultimoRef.current > JANELA_DE_RAJADA_MS) {
        bufferRef.current = "";
        inicioRef.current = agora;
      }
      const inicioDaRajada = inicioRef.current || agora;
      ultimoRef.current = agora;

      if (ev.key === "Enter") {
        const lido = bufferRef.current.trim();
        const chars = bufferRef.current.length;
        bufferRef.current = "";
        // Rajada rápida terminada em Enter com cara de código: vale mesmo vindo de um campo
        // (o leitor digita onde o foco estiver) — mas só se o texto veio em ritmo de máquina.
        const decisao = decidirEnterDoWedge({
          charsDaRajada: chars,
          duracaoDaRajadaMs: Math.max(0, agora - inicioDaRajada),
          emCampo,
          msDesdeAUltimaLeitura: agora - ultimaLeituraRef.current,
          texto: lido,
        });
        // O Enter era do LEITOR: ele não pode acionar o botão focado nem submeter formulário.
        if (decisao.cancelarPadrao) {
          ev.preventDefault();
          ev.stopPropagation();
        }
        if (!decisao.aceita) return;
        ultimaLeituraRef.current = agora;
        aoLerRef.current(decisao.valor);
        return;
      }
      if (ev.key.length === 1) bufferRef.current += ev.key;
    };
    window.addEventListener("keydown", aoTeclar, true);
    return () => window.removeEventListener("keydown", aoTeclar, true);
  }, [ativo]);
}
