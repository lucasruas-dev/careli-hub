"use client";

import { FestoRobo } from "@/components/hub-support/festo-robo";
import { X } from "lucide-react";
import { useEffect, useState } from "react";

// A APRESENTAÇÃO DO FESTO AO TIME.
//
// Lucas (11/09/2026): *"de hoje até terça, na tela principal do panteon, vamos colocar o festo
// grande para que o time possa conhece-lo? Eu sou o novo colaborador da C2X, me chamo Festos, estou
// muito ansioso para trabalhar com você"* — e, sobre o tamanho: *"pensei ele em meia tela mesmo"*.
//
// ⚠️ ELE SE APRESENTA COMO GENTE NOVA NA EQUIPE, e o texto é na primeira pessoa de propósito. Um
// aviso institucional ("o Panteon agora conta com um assistente de IA") produz a reação errada: as
// pessoas leem "mais um robô no meu caminho". Alguém chegando e se apresentando produz a outra — e
// a diferença aparece na primeira vez que alguém precisar pedir ajuda.
//
// ⚠️ MEIA TELA É O PONTO, não exagero. Esta é a única vez em que o Festos vai ser visto grande o
// bastante para alguém reparar no rosto dele; no canto da tela ele tem 56 pixels. Quem vir isto uma
// vez reconhece o bonequinho miúdo depois — que é exatamente o que esta semana precisa entregar.
//
// ⚠️ E ELE TEM PRAZO. Some sozinho depois de terça, sem ninguém lembrar de tirar. Banner de boas
// vindas que fica seis meses vira parte do cenário: ninguém lê e ainda ocupa o lugar mais valioso
// da tela — que é justamente o que ele está ocupando agora, e por isso o prazo é curto.

/** De quinta (11/09) até terça (16/09), inclusive. Depois disso ele não aparece mais. */
const ATE = new Date("2026-09-17T03:00:00.000Z");
const CHAVE = "panteon-festo-apresentado";

/**
 * A semana de apresentação ainda está correndo?
 *
 * ⚠️ UMA DATA SÓ, NUM LUGAR SÓ. O Festos aparece em dois pontos durante essa semana — o cartão
 * grande da home e o tchauzinho no painel de Novidades — e as duas coisas precisam acabar no mesmo
 * dia. Com a data copiada nos dois arquivos, um deles fica para trás na primeira vez que alguém
 * mudar o prazo, e o suporte passa a acenar num canto e não no outro.
 */
export function festoAindaSeApresenta(): boolean {
  return new Date() <= ATE;
}

export function FestoApresentacao() {
  // ⚠️ COMEÇA ESCONDIDO E APARECE NO CLIENTE. O servidor não sabe se esta pessoa já dispensou o
  // card (isso vive no navegador dela), e renderizar no servidor faria o banner piscar na tela de
  // quem já fechou — a forma mais rápida de irritar justamente quem já entendeu o recado.
  const [mostrar, setMostrar] = useState(false);

  useEffect(() => {
    if (new Date() > ATE) return;
    try {
      if (localStorage.getItem(CHAVE) === "1") return;
    } catch {
      // Sem armazenamento (aba privativa): mostra. Melhor repetir do que sumir.
    }
    setMostrar(true);
  }, []);

  if (!mostrar) return null;

  function dispensar() {
    setMostrar(false);
    try {
      localStorage.setItem(CHAVE, "1");
    } catch {
      // Sem armazenamento: fecha só nesta sessão.
    }
  }

  return (
    <section className="relative col-span-12 grid min-h-[52vh] place-items-center overflow-hidden rounded-2xl border border-line bg-raised px-6 py-10 sm:px-10">
      <button
        aria-label="Já conheci o Festos, pode fechar"
        className="absolute right-3 top-3 grid size-9 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
        onClick={dispensar}
        type="button"
      >
        <X aria-hidden="true" className="size-4" />
      </button>

      <div className="flex w-full max-w-4xl flex-col items-center gap-8 text-center md:flex-row md:items-center md:gap-12 md:text-left">
        <div className="shrink-0">
          <FestoRobo className="size-40 sm:size-52 md:size-60" />
        </div>

        <div className="min-w-0">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-ink-muted">
            Novo no time
          </p>
          <h2 className="m-0 mt-1.5 text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
            Oi! Eu sou o Festos.
          </h2>

          <div className="mt-4 grid gap-3 text-[15px] leading-relaxed text-ink-soft">
            <p className="m-0">
              Sou o mais novo integrante da C2X e vou cuidar do{" "}
              <strong className="font-semibold text-ink">suporte aqui dentro do Panteon</strong>.
              Estou bem ansioso para trabalhar com vocês.
            </p>
            <p className="m-0">
              Quando alguma coisa travar, parecer errada, ou quando você só quiser entender como uma
              tela funciona, me chama. Dúvida eu respondo na hora. Problema eu investigo, abro o
              chamado com o diagnóstico pronto — e volto para contar o que foi feito.
            </p>
            <p className="m-0">
              Pode me mandar print, áudio, vídeo, o que for mais fácil. Quanto mais eu enxergar do
              que aconteceu, menos eu preciso ficar te perguntando.
            </p>
          </div>

          {/*
            ⚠️ O CARD ENSINA ONDE ELE MORA PELO DESENHO, e não pela posição: o botão é arrastável,
            então dizer "no canto inferior direito" seria uma promessa que a primeira pessoa a
            arrastar já quebra. O que sempre vale é a cara dele.
          */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3 md:justify-start">
            <span className="inline-flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2">
              <FestoRobo className="size-9" />
              <span className="text-sm font-semibold text-ink-soft">
                É só clicar em mim, em qualquer tela
              </span>
            </span>
            <button
              className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:bg-subtle"
              onClick={dispensar}
              type="button"
            >
              Prazer, Festos!
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
