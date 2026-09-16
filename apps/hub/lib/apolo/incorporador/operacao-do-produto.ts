// QUEM PODE ESCREVER EM CADA PRODUTO PELO PORTAL — a régua ÚNICA, pura, que toda rota de escrita e
// toda tela do portal consultam.
//
// Decisão do Lucas (16/09/2026), olhando o portal da Cecílio Rocha virar réplica do Hércules:
// *"ESCRITA SÓ NO QUE A CECÍLIO OPERA"*. O banco é o mesmo, as tabelas são as mesmas e o código é o
// mesmo; o que separa o que a Cecílio mexe do que a Careli mexe é a coluna
// `hercules_empreendimentos.operado_por` (migration 0170): nulo = a Careli opera; preenchido = o
// `apolo_incorporadores.id` do portal que opera.
//
//   • VOC (37) e VOR (41) continuam da Gurgel/Careli: no portal da Cecílio ficam SÓ CONSULTA, mesmo
//     estando no escopo da sessão (ela enxerga, não mexe);
//   • Garden (39) e todo produto nascido no portal (id >= 100000) são da Cecílio: ela escreve;
//   • o portal COMERCIAL (a Gurgel) NÃO MUDA: continua operando reserva, proposta, contrato e board
//     como hoje, em qualquer produto do escopo. Mas NÃO cadastra produto nem unidade
//     (`podeCadastrarNoProduto`), que é trabalho de quem opera o produto;
//   • qualquer outro portal (o padrão: cer, mmendes, vistaalegre...) não escreve em nada.
//
// ⚠️ FAIL-CLOSED. Sem a 0170 aplicada (`com0170 = false`) toda linha do cadastro sai "a Careli
// opera", e isso é certo para quem LÊ e errado para quem ESCREVE: a Cecílio perderia o Garden em
// silêncio ou, pior, uma leitura sem a coluna passaria a valer como "ninguém é dono, então pode".
// Aqui é o contrário: sem a coluna, sem dono ou com dono diferente, NÃO escreve.
//
// ⚠️ UM ARQUIVO SÓ, E PURO (sem banco, sem next/server). As rotas usam pelo servidor
// (`operacao-do-produto-servidor.ts`), as telas usam o `podeEscrever` que o painel calcula com esta
// mesma função. Se cada rota decidisse por conta própria, a primeira a divergir abriria escrita no
// VOC para gente de fora da Careli.
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";
import { PREFIXO_DO_PAI } from "@/lib/hercules/expandir-id-do-painel";

import { ehPortalComercial, portalConfeccionaContrato } from "./perfis-de-portal";

/** O mínimo da sessão que a régua precisa: quem é o portal e de que tipo. */
export type PortalDaEscrita = {
  incorporadorId: null | string | undefined;
  slug: null | string | undefined;
  tipo: null | string | undefined;
};

/** O texto da recusa (403) quando o produto está no escopo mas é operado por outro. */
export const MENSAGEM_PRODUTO_SO_CONSULTA =
  "Este produto está disponível só para consulta no seu portal.";

const PREFIXO_DO_GRUPO = "group:";

// Comparação tolerante de ids: um espaço ou uma maiúscula no uuid gravado à mão não pode tirar da
// Cecílio o produto dela (nem dar a ela o de outro, que teria outro uuid de qualquer jeito).
function idNormalizado(valor: null | string | undefined): string {
  return String(valor ?? "").trim().toLowerCase();
}

/** O portal que confecciona escreve só no produto que ele mesmo opera. */
function operaOProduto(portal: PortalDaEscrita, operadoPor: null | string | undefined, com0170: boolean): boolean {
  if (!com0170) return false;
  const dono = idNormalizado(operadoPor);
  const quem = idNormalizado(portal.incorporadorId);
  return dono !== "" && quem !== "" && dono === quem;
}

/**
 * O portal pode ESCREVER (reserva, proposta, contrato, board, minutas, arquivos...) num produto
 * operado por `operadoPor`?
 *
 *   • comercial → sim, em qualquer produto do escopo (a Gurgel como hoje);
 *   • portal que confecciona (o Cecílio) → só com a 0170 e com `operadoPor` igual ao id dele;
 *   • qualquer outro → não.
 */
export function podeEscreverNoProduto(
  portal: PortalDaEscrita,
  operadoPor: null | string | undefined,
  com0170: boolean,
): boolean {
  if (ehPortalComercial(portal.tipo)) return true;
  if (portalConfeccionaContrato(portal.slug, portal.tipo)) {
    return operaOProduto(portal, operadoPor, com0170);
  }
  return false;
}

/**
 * O portal pode CADASTRAR (produto novo, unidade nova, atualizar unidade) neste produto?
 *
 * A mesma régua, com uma diferença: o comercial NÃO cadastra. A Gurgel vende o que a Careli
 * cadastrou; quem cria e mantém o produto é quem o opera.
 */
export function podeCadastrarNoProduto(
  portal: PortalDaEscrita,
  operadoPor: null | string | undefined,
  com0170: boolean,
): boolean {
  if (ehPortalComercial(portal.tipo)) return false;
  return podeEscreverNoProduto(portal, operadoPor, com0170);
}

type OperadorDoEnterprise = { achado: false } | { achado: true; operadoPor: null | string };

function textoOuNulo(valor: null | string | undefined): null | string {
  const limpo = String(valor ?? "").trim();
  return limpo ? limpo : null;
}

/**
 * O operador de UMA linha do cadastro.
 *
 * ⚠️ PAI COM FILHOS: o operador do pai só vale quando TODOS os filhos cadastrados concordam com ele.
 * Escrever pelo pai (o espelho "35" ou "pai:<uuid>") alcança as unidades e as CADs dos filhos; um
 * pai "da Cecílio" com um filho da Careli daria a ela escrita no filho por tabela. Divergiu =
 * ninguém opera (nulo), e a régua recusa.
 */
function operadorDaLinha(linha: LinhaDoCadastro, cadastro: readonly LinhaDoCadastro[]): null | string {
  const doPai = textoOuNulo(linha.operadoPor);
  if (linha.paiId !== null) return doPai;

  for (const filho of cadastro) {
    if (filho.paiId !== linha.id) continue;
    if (idNormalizado(filho.operadoPor) !== idNormalizado(doPai)) return null;
  }
  return doPai;
}

/**
 * Quem opera o enterprise pedido, pelo cadastro do Panteon.
 *
 *   • "pai:<uuid>" → a linha com aquele id;
 *   • só dígitos ("39", "100000") → a(s) linha(s) com aquele `c2xEnterpriseId`;
 *   • "group:..." e qualquer outro formato → não achado (o grupo do catálogo do C2X não tem dono
 *     próprio, e um formato desconhecido não pode virar permissão).
 *
 * Mais de uma linha com o mesmo id do C2X (não deveria existir) só vale quando todas concordam;
 * senão ninguém opera.
 */
export function operadorDoEnterprise(
  cadastro: readonly LinhaDoCadastro[],
  enterpriseId: unknown,
): OperadorDoEnterprise {
  if (typeof enterpriseId !== "string" && typeof enterpriseId !== "number") return { achado: false };
  const alvo = String(enterpriseId).trim();
  if (!alvo) return { achado: false };

  if (alvo.startsWith(PREFIXO_DO_PAI)) {
    const uuid = idNormalizado(alvo.slice(PREFIXO_DO_PAI.length));
    if (!uuid) return { achado: false };
    const linha = cadastro.find((item) => idNormalizado(item.id) === uuid);
    return linha ? { achado: true, operadoPor: operadorDaLinha(linha, cadastro) } : { achado: false };
  }

  if (!/^\d+$/.test(alvo)) return { achado: false };

  const linhas = cadastro.filter((item) => String(item.c2xEnterpriseId ?? "").trim() === alvo);
  if (linhas.length === 0) return { achado: false };

  const operadores = linhas.map((linha) => operadorDaLinha(linha, cadastro));
  const primeiro = operadores[0] ?? null;
  const concordam = operadores.every((op) => idNormalizado(op) === idNormalizado(primeiro));
  return { achado: true, operadoPor: concordam ? primeiro : null };
}

/** Os ids que a régua decide: sem vazio e sem o grupo do catálogo. */
function idsQueContam(enterpriseIds: Iterable<unknown>): unknown[] {
  const saida: unknown[] = [];
  for (const id of enterpriseIds) {
    const texto = String(id ?? "").trim();
    if (!texto || texto.toLowerCase().startsWith(PREFIXO_DO_GRUPO)) continue;
    saida.push(id);
  }
  return saida;
}

function todosPassam(
  cadastro: readonly LinhaDoCadastro[],
  enterpriseIds: Iterable<unknown>,
  regra: (operadoPor: null | string) => boolean,
): boolean {
  const ids = idsQueContam(enterpriseIds);
  // Nada para decidir (lista vazia ou só grupo) não é "pode": é pedido sem alvo.
  if (ids.length === 0) return false;

  return ids.every((id) => {
    const operador = operadorDoEnterprise(cadastro, id);
    return operador.achado && regra(operador.operadoPor);
  });
}

/**
 * O portal pode escrever em TODOS estes enterprises? Um só de fora recusa o pedido inteiro.
 *
 * Comercial: sim sem olhar o cadastro (a Gurgel como hoje). Os demais: cada id que conta (sem vazio
 * e sem "group:") precisa existir no cadastro e passar em `podeEscreverNoProduto`; sobra vazia = não.
 */
export function podeEscreverNosEnterprises(
  portal: PortalDaEscrita,
  cadastro: readonly LinhaDoCadastro[],
  enterpriseIds: Iterable<unknown>,
  com0170: boolean,
): boolean {
  if (ehPortalComercial(portal.tipo)) return true;
  if (!portalConfeccionaContrato(portal.slug, portal.tipo)) return false;
  return todosPassam(cadastro, enterpriseIds, (operadoPor) =>
    podeEscreverNoProduto(portal, operadoPor, com0170),
  );
}

/** A mesma pergunta para CADASTRAR (produto, unidade): o comercial nunca. */
export function podeCadastrarNosEnterprises(
  portal: PortalDaEscrita,
  cadastro: readonly LinhaDoCadastro[],
  enterpriseIds: Iterable<unknown>,
  com0170: boolean,
): boolean {
  if (ehPortalComercial(portal.tipo)) return false;
  if (!portalConfeccionaContrato(portal.slug, portal.tipo)) return false;
  return todosPassam(cadastro, enterpriseIds, (operadoPor) =>
    podeCadastrarNoProduto(portal, operadoPor, com0170),
  );
}
