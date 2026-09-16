// OS ANALISTAS DA FILA DO BOARD PELO PORTAL.
//
// Na tela interna, `analistas` é a lista de `hub_users` (nome ou e-mail de toda a equipe) e cada
// card traz `analistaId`, o uuid de quem da Careli cuida dele (gravado pela importação do Asana,
// lib/apolo/asana-import.ts; o Board não persiste a escolha). Pelo portal, com o Cecílio e o
// comercial da Gurgel do lado de fora, isso entregava o quadro de pessoal da Careli
// (16/09/2026).
//
// O QUE A TELA PRECISA, E SÓ ISSO (modules/apolo/blocks/board/board-view.tsx):
//   • `usuarioAtual` na lista, porque abrir um card o atribui a quem abriu e o seletor mostra o
//     nome procurando o id em `analistas`;
//   • um rótulo para o card que já tem analista da Careli, senão o kanban mostra vazio e o
//     seletor cai em "Sem analista" como se ninguém cuidasse.
// Então: a conta do portal, mais UMA entrada "Equipe Careli" quando algum card é da Careli, e o
// `analistaId` desses cards trocado pelo id dessa entrada. Com lista vazia a tela também não quebra
// (o seletor cai em "Sem analista"), mas mentiria sobre quem está cuidando.
import type { FilaDoBoard } from "@/lib/apolo/board-do-servidor";

import { EQUIPE_CARELI } from "./historico-do-portal";

/** O id da entrada única que representa qualquer analista da Careli. Não é uuid de propósito. */
export const ID_EQUIPE_CARELI = "equipe-careli";

export function analistasParaPortal(fila: FilaDoBoard): FilaDoBoard {
  const usuario = fila.usuarioAtual;

  const itens = fila.itens.map((item) => {
    if (!item.analistaId) return item;
    if (usuario && item.analistaId === usuario.id) return item;
    return { ...item, analistaId: ID_EQUIPE_CARELI };
  });

  const analistas: FilaDoBoard["analistas"] = [];
  if (usuario) analistas.push({ id: usuario.id, nome: usuario.nome });
  if (itens.some((item) => item.analistaId === ID_EQUIPE_CARELI)) {
    analistas.push({ id: ID_EQUIPE_CARELI, nome: EQUIPE_CARELI });
  }

  return { ...fila, analistas, itens };
}
