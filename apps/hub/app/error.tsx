"use client";

// A REDE EMBAIXO DO HUB INTEIRO.
//
// ⚠️ ATÉ AGORA NÃO HAVIA NENHUMA. Medido em 13/09/2026: nenhum `error.tsx`, nenhum
// `componentDidCatch`, nenhum `ErrorBoundary` em todo o `apps/hub`. Qualquer exceção lançada em
// fase de render — de qualquer módulo, por qualquer biblioteca — subia até a raiz do React e
// desmontava a aplicação. O usuário via tela branca e perdia o que estava fazendo.
//
// ⚠️ E ISSO JÁ ACONTECEU DUAS VEZES NO EDITOR DE MINUTAS. Uma delas está escrita no próprio código
// (`modules/temis/editor-de-minuta.tsx`: o Radix lançando "Tooltip must be used within
// TooltipProvider" derrubou a árvore inteira ao abrir a minuta), e a outra é a reclamação do Lucas
// em 13/09/2026: *"para trocar a fonte da minuta derrubou a página"*.
//
// ⚠️ O CONSERTO PONTUAL NÃO SUBSTITUI A REDE. As duas causas foram tratadas onde nasceram, e ainda
// assim esta página precisa existir: a próxima exceção vai vir de um lugar que ninguém previu, e a
// diferença entre "a tela caiu" e "o hub inteiro caiu" é este arquivo.

import { AlertTriangle, RotateCcw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: { digest?: string } & Error;
  reset: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <div className="mb-3 flex items-center gap-2 text-rose-600 dark:text-rose-300">
          <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
          <h1 className="m-0 font-semibold text-base">Esta tela parou</h1>
        </div>

        {/* ⚠️ A FRASE DIZ O QUE ACONTECEU COM O TRABALHO, e não "algo deu errado". Quem está numa
            minuta há quarenta minutos precisa saber, na primeira linha, se perdeu o texto. */}
        <p className="m-0 text-ink-soft text-sm leading-relaxed">
          O erro ficou nesta tela e o resto do hub continua de pé. O que não tinha
          sido salvo aqui se perdeu; o que já foi salvo está guardado.
        </p>

        {/* O `digest` é o que liga esta tela ao log do servidor. Sem ele, um chamado de suporte
            vira "deu erro numa tela" e ninguém acha nada. */}
        {error.digest ? (
          <p className="mt-3 mb-0 font-mono text-[11px] text-ink-muted">
            Código para o suporte: {error.digest}
          </p>
        ) : null}

        <button
          className="mt-5 inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-subtle px-4 font-semibold text-ink text-sm transition-colors hover:bg-subtle/70"
          onClick={reset}
          type="button"
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          Tentar de novo
        </button>
      </div>
    </div>
  );
}
