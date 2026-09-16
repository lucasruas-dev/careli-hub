// A FILA DO BOARD PELO PORTAL DE INCORPORADOR, SEM A ANÁLISE DE CRÉDITO.
//
// Por que existe (revisão da onda do Cecílio, 16/09/2026): `montarFilaDoBoard` devolve, em cada
// card, `etapa` e `motivo` crus da esteira. Para a CAD reprovada no Serasa, a consulta grava etapa
// `revisao` com o motivo "Crédito reprovado. Restrições de R$ X acima do limite de R$ Y."
// (app/api/apolo/serasa/consultar/route.ts), e o BoardView pinta esse motivo numa faixa âmbar ao
// abrir a ficha. Com o Cecílio passando pela porta do board, isso chegava ao time dele junto com
// nome e CPF do comprador, contra a regra da casa: *"não tem por que saber que fulano foi reprovado"*
// (crm.ts, `rotuloDaEtapa`). Os documentos e o histórico já seguiam essa regra; a fila, não.
//
// O que muda, e só fora do comercial:
//   • `revisao` (o desvio do crédito reprovado) vira `credito`: é o "Em análise" que `rotuloDaEtapa`
//     já dá às duas. O card fica na coluna de Análise de crédito, e mover para fora dela continua
//     barrado no servidor (`moverEtapaDoBoard` recusa sair de revisão);
//   • `motivo` só sai onde ele é pendência de CADASTRO para alguém corrigir (validação, correção e a
//     imobiliária, que não tem etapa) e nunca com cara de análise de crédito;
//   • `indeferido` continua `indeferido`: é o fim do processo, e quem vende precisa saber que aquela
//     CAD não segue (a Venda já diz "com o cadastro indeferido"). O motivo dele não sai.
//
// ⚠️ O COMERCIAL NÃO PASSA POR AQUI. O coordenador da Careli move a CAD até crédito e revisão
// (`ETAPAS_DO_COORDENADOR`) e precisa do motivo para conversar com o corretor.
//
// (16/09/2026, onda do crédito no portal) ⚠️ NEM O PORTAL QUE OPERA SOZINHO. Decisão do Lucas:
// *"A Cecílio, no portal"* faz a análise de crédito (Serasa) e o credenciamento dos clientes dela.
// Quem consulta, aprova com restrição e indefere precisa ver a CAD em `revisao` e o motivo da
// reprovação: com a fila saneada, a CAD reprovada aparecia em Análise de crédito sem dizer por quê,
// e o botão "Aprovar com restrição" (que só existe em revisão) nunca aparecia. A fila já chega
// recortada pelo produto (`montarFilaDoBoard` com o recorte da sessão): o que abre aqui é o crédito
// das CADs DO ESCOPO, não o de outro loteamento. Quem decide é `filaDoBoardParaPortal`, abaixo.
import type { FilaDoBoard, ItemDaFila } from "@/lib/apolo/board-do-servidor";

import { ehPortalComercial, portalConfeccionaContrato } from "./perfis-de-portal";

/** As etapas em que o motivo é pendência de cadastro, e não veredito. `""` = sem etapa (imobiliária). */
const ETAPAS_COM_MOTIVO_DE_CADASTRO: ReadonlySet<string> = new Set(["", "correcao", "validacao"]);

/**
 * A rede para o motivo escrito à mão que fala de crédito mesmo numa etapa de cadastro (ex.: a
 * correção de identidade grava o motivo em todas as CADs da pessoa, em qualquer etapa).
 */
const FALA_DE_CREDITO = /cr[eé]dito|serasa|score|restri[cç][aã]o|restri[cç][oõ]es|negativa/i;

export function itemSemCreditoParaPortal(item: ItemDaFila): ItemDaFila {
  const etapa = String(item.etapa ?? "").trim().toLowerCase();
  const motivo = item.motivo?.trim() ?? "";
  const motivoSai =
    motivo !== "" && ETAPAS_COM_MOTIVO_DE_CADASTRO.has(etapa) && !FALA_DE_CREDITO.test(motivo);

  return {
    ...item,
    etapa: etapa === "revisao" ? "credito" : item.etapa,
    motivo: motivoSai ? item.motivo : null,
  };
}

export function filaSemCreditoParaPortal(fila: FilaDoBoard): FilaDoBoard {
  return { ...fila, itens: fila.itens.map(itemSemCreditoParaPortal) };
}

/** O que a fila precisa saber da sessão: o slug e o tipo do portal (nada mais sai do cookie). */
export type PortaDaFila = { slug?: null | string; tipo?: null | string };

/**
 * Esta porta enxerga a análise de crédito da fila como ela é (etapa `revisao` e o motivo)?
 *
 *   • comercial (a Careli vendendo): sim, como sempre foi (onda 1);
 *   • portal que opera sozinho (`portalConfeccionaContrato`, hoje só o `cecilio-rocha`): sim, é ele
 *     quem faz o crédito dos clientes dele;
 *   • incorporador padrão (cer, vistaalegre...): não. Continua valendo *"não tem por que saber que
 *     fulano foi reprovado"*.
 *
 * ⚠️ FECHADO POR PADRÃO: sessão sem slug nem tipo cai no incorporador padrão e recebe a fila saneada.
 */
export function portalVeCreditoNaFila(porta: PortaDaFila): boolean {
  return ehPortalComercial(porta.tipo) || portalConfeccionaContrato(porta.slug, porta.tipo);
}

/**
 * A fila do board como ESTA porta pode ver. É a única chamada da rota
 * (app/api/incorporador/board/route.ts), para a regra por tipo de portal morar num lugar só.
 */
export function filaDoBoardParaPortal(fila: FilaDoBoard, porta: PortaDaFila): FilaDoBoard {
  return portalVeCreditoNaFila(porta) ? fila : filaSemCreditoParaPortal(fila);
}
