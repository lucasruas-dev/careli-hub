"use client";

import { BoardView } from "@/modules/apolo/blocks/board/board-view";

import { MOLDURA_TAILWIND } from "../TelaContratos";
import { useTemaDoPortal } from "../tema";

// CADASTRO DO PRODUTO — o Board do Apolo, dentro da ficha do produto no Hércules.
//
// Pedido do Lucas (02/09/2026): *"deixa cadastro mesmo e traz a mesma visão do apolo, imobiliária
// e cads"*. É O MESMO COMPONENTE da tela interna (BoardView: filtro todos/imobiliária/prospect,
// kanban por etapa, ficha com documento ao lado, mover etapa, habilitar, histórico, identidade),
// por outra porta:
//   • `api.base` troca `/api/apolo/board` por `/api/incorporador/board`, e `api.query` leva o
//     `emp` em TODA chamada (a fila, a ficha, a etapa, o habilitar…) — é o que o servidor usa
//     para recortar pelo produto e para conferir que a CAD alvo é deste produto;
//   • `semToken`: o cookie do portal vai junto; `getApoloAccessToken` LANÇA sem sessão do hub, e
//     o coordenador não tem uma;
//   • `empreendimentosFixos`: o seletor de empreendimento some (o produto já é o filtro);
//   • `ocultar`: o que não tem porta no portal fica de fora — Serasa, subir para o C2X, avisar o
//     coordenador em lote (ele É o coordenador), status de disparos e o ciclo do PIX. Ver as
//     pendências no relatório da frente.
//
// ⚠️ O BOARD FALA TAILWIND, O PORTAL FALA VARIÁVEL CSS — a moldura ÚNICA da TelaContratos
// (`MOLDURA_TAILWIND`): redeclara as `--color-*` do @theme para os `--inc-*` do portal (só
// `--uix-*` não basta — ver o porquê lá), e o `data-uix-theme` carrega o tema EFETIVO do portal
// para os utilitários `dark:` responderem.

export function BoardDoProduto({ emp }: { emp: string }) {
  // O tema efetivo (já resolvido o "seguir o aparelho") vira o atributo que os `dark:` leem.
  const { efetivo } = useTemaDoPortal();

  return (
    <section
      data-uix-theme={efetivo === "escuro" ? "dark" : "light"}
      style={{
        ...MOLDURA_TAILWIND,
        // O BoardView é `h-full` com o kanban rolando por dentro: precisa de uma altura de
        // verdade, senão a fila vira uma faixa de zero pixels dentro da ficha do produto.
        height: "calc(100vh - 220px)",
        minHeight: 560,
      }}
    >
      <BoardView
        api={{
          base: "/api/incorporador/board",
          query: `emp=${encodeURIComponent(emp)}`,
          semToken: true,
        }}
        empreendimentosFixos={[]}
        ocultar={["serasa", "c2xSync", "avisarLote", "disparos", "pix"]}
      />
    </section>
  );
}
