"use client";

import { BoardView, type OcultavelDoBoard } from "@/modules/apolo/blocks/board/board-view";

import { MOLDURA_TAILWIND } from "../moldura";
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
// (16/09/2026) ⚠️ O PORTAL QUE OPERA SOZINHO GANHA A ANÁLISE DE CRÉDITO. Decisão do Lucas: *"A
// Cecílio, no portal"* faz a análise de crédito (Serasa) e o credenciamento dos clientes dela, com a
// consulta paga na conta da Careli e o registro de quem consultou. Com `operaSozinho`, o Serasa e a
// aprovação com restrição aparecem (pelas rotas /api/incorporador/board/<id>/serasa/*), e o Board
// libera as decisões que a Careli tomaria: indeferir a CAD em revisão e credenciar na pré-venda.
// Continuam de fora o PIX (a cobrança é da Careli), subir para o C2X, avisar em lote e os disparos.
// A GURGEL (COMERCIAL) NÃO GANHA NADA DISSO: o crédito das vendas dela continua com a Careli no
// Apolo, e sem a prop a porta é exatamente a de antes. O servidor confere de novo em cada rota; aqui
// é só o que aparece.
//
// ⚠️ O BOARD FALA TAILWIND, O PORTAL FALA VARIÁVEL CSS. A moldura ÚNICA do portal
// (`MOLDURA_TAILWIND`, em ../moldura, a mesma que a TelaContratos reexporta) redeclara as
// `--color-*` do @theme para os `--inc-*` do portal (só `--uix-*` não basta, o porquê está na
// TelaContratos), e o `data-uix-theme` carrega o tema EFETIVO do portal para os utilitários `dark:`
// responderem. Importada de ../moldura para esta tela não arrastar o quadro da Têmis junto.

/** O que o comercial não tem pela porta do portal (a Careli faz): tudo isto, como sempre foi. */
const OCULTOS_NO_COMERCIAL: OcultavelDoBoard[] = ["serasa", "c2xSync", "avisarLote", "disparos", "pix"];

/** O portal que opera sozinho faz o crédito: só o Serasa sai da lista. O resto segue da Careli. */
const OCULTOS_NO_PORTAL_SOZINHO: OcultavelDoBoard[] = ["c2xSync", "avisarLote", "disparos", "pix"];

export function BoardDoProduto({
  emp,
  operaSozinho = false,
  somenteLeitura = false,
}: {
  emp: string;
  /**
   * O portal opera a venda sem a Careli (`portalConfeccionaContrato`, hoje só o `cecilio-rocha`)?
   * Quem monta é a FichaDoProduto, a partir do modo "incorporador". Sem a prop: o comercial.
   */
  operaSozinho?: boolean;
  /**
   * (16/09/2026, D1) O produto é SÓ CONSULTA para este portal? Decisão do Lucas: no portal que
   * confecciona, a escrita só vale no produto que ele opera (`operado_por`); VOC e VOR ficam só
   * consulta para a Cecílio. A FichaDoProduto passa `linha.podeEscrever !== true` (o painel calcula
   * pela régua única, lib/apolo/incorporador/operacao-do-produto.ts). O BoardView esconde toda ação
   * que grava e mostra a faixa "Só consulta neste produto."; o servidor recusa de novo (403).
   * Sem a prop: tudo como antes.
   */
  somenteLeitura?: boolean;
}) {
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
        ocultar={operaSozinho ? OCULTOS_NO_PORTAL_SOZINHO : OCULTOS_NO_COMERCIAL}
        operaSozinho={operaSozinho}
        somenteLeitura={somenteLeitura}
      />
    </section>
  );
}
