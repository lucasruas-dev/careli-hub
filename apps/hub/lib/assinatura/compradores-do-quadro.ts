import type { ItemDoQuadro } from "./registro-db";

// QUEM É COMPRADOR NO QUADRO, E SE TODOS ELES JÁ ASSINARAM. Uma folha pura, sem banco.
//
// Lucas, 02/10/2026, vendo a Têmis com 12 contratos em "Em assinatura" e nenhum no Pré-faturamento:
// *"acho que a regra de negocio para andar de em assinatura para pre-faturamento nao esta acontecendo
// pois eu nao tenho nenhum em pre-faturamento"*. Medido em produção no mesmo dia: nunca houve uma
// passagem para `prazo_legal`, e 6 dos 12 já tinham TODOS os compradores assinados. O card só andava
// com o envelope INTEIRO assinado (`estadoDepois === "assinado"`), e a regra escrita era outra: o card
// entra no prazo legal quando os COMPRADORES assinam, e os 7 dias contam da última assinatura deles
// (docs/operations/temis-redesenho-decisoes.md, e as decisões de 29/09 da F8). O envelope inteiro
// assinado passou a ser condição à parte, para o Faturado.
//
// ⚠️ A RÉGUA MORA AQUI, E SÓ AQUI, PORQUE TRÊS LEITORES FAZEM A MESMA PERGUNTA: a porta do envelope na
// venda (o card anda?), o início dos 7 dias (`ultimaAssinaturaDoComprador`, `estado-db.ts`) e o selo
// do card no quadro ("0/1 comprador"). Uma segunda escrita em qualquer um deles faria o selo dizer
// "1/1" num card que não anda, que é exatamente o tipo de divergência que ninguém acha olhando o board.

/** Os papéis da casa (`PapelNoContrato`) que são do lado de quem compra. */
const PAPEIS_DO_COMPRADOR: ReadonlySet<string> = new Set(["comprador", "conjuge"]);

/** O rótulo de tela que a régua de sempre (`perfilDeTela`) dá ao cliente do C2X. */
const PERFIL_DO_COMPRADOR = "comprador";

/**
 * Esta pessoa do quadro é COMPRADORA? Puro.
 *
 * ⚠️ CLICKSIGN: pelo PAPEL, `comprador` ou `conjuge` (congelado no envio e nunca nulo lá, medido em 8
 * de 8 contratos em 28/09/2026). A vendedora, a coordenadora, o corretor e a testemunha não são.
 *
 * ⚠️ D4SIGN: O PAPEL VEM NULO DE PROPÓSITO (`espelho-d4sign/quadro.ts`: o C2X não diz cônjuge nem
 * vendedora), e quem diz é o PERFIL "Comprador", que `perfilDeTela` dá a quem o C2X chama de "Cliente".
 * Só vale com o papel vazio: um papel escrito manda, e o perfil não o desmente.
 *
 * ⚠️ O LIMITE CONHECIDO DA D4SIGN, ACEITO: o comprador sem usuário no C2X sai "Sem perfil", e o
 * corretor que compra sai "Imobiliária". Nenhum dos dois conta como comprador aqui. O card pode então
 * entrar no Pré-faturamento antes deles; o que segura o dinheiro é a trava do Faturado (o envelope
 * inteiro assinado, `marcarAtividade` em `lib/temis/trabalhos-db.ts`).
 */
export function ehCompradorNoQuadro(item: Pick<ItemDoQuadro, "papel" | "perfil">): boolean {
  const papel = String(item.papel ?? "").trim().toLowerCase();
  if (papel) return PAPEIS_DO_COMPRADOR.has(papel);
  return String(item.perfil ?? "").trim().toLowerCase() === PERFIL_DO_COMPRADOR;
}

/** Os compradores de um quadro: quantos são, quantos assinaram e quando o último assinou. */
export type CompradoresDoQuadro = {
  /** Quantos compradores têm marca de assinatura com data legível. */
  assinaram: number;
  /** Quantos compradores o quadro tem. */
  total: number;
  /** A marca do último comprador a assinar, COMO FOI GUARDADA (`-03:00`); `null` sem nenhuma. */
  ultima: null | string;
};

/**
 * Conta os compradores do quadro. Puro.
 *
 * ⚠️ SÓ VALE MARCA COM DATA LEGÍVEL. A marca é o que afirma "assinou" (escrita só pela função da 0195),
 * e é da data dela que os 7 dias contam: uma marca ilegível não pode contar como assinatura e ao mesmo
 * tempo não ter data para o prazo. O selo do card usa a mesma conta, para nunca dizer "1/1" num card
 * que a porta não deixa andar.
 *
 * ⚠️ COMPARA COMO DATA E DEVOLVE O TEXTO COMO FOI GUARDADO. As marcas da casa saem em `-03:00`
 * (`emBrasilia`), e uma comparação de texto erraria o instante escrito com outro fuso.
 */
export function compradoresDoQuadro(quadro: readonly ItemDoQuadro[]): CompradoresDoQuadro {
  let total = 0;
  let assinaram = 0;
  let ultima: null | string = null;
  for (const item of quadro) {
    if (!ehCompradorNoQuadro(item)) continue;
    total += 1;
    const quando = item.assinado_em;
    if (!quando || Number.isNaN(Date.parse(quando))) continue;
    assinaram += 1;
    if (ultima === null || Date.parse(quando) > Date.parse(ultima)) ultima = quando;
  }
  return { assinaram, total, ultima };
}

/**
 * TODOS os compradores do quadro já assinaram? Puro.
 *
 * ⚠️ QUADRO SEM COMPRADOR DEVOLVE `false`, E NUNCA "TODOS OS ZERO". Um quadro sem ninguém marcado como
 * comprador é envio que não sabe quem compra (o quadro antigo sem papel, a D4Sign com o cliente "Sem
 * perfil"); dizer "todos assinaram" ali levaria ao Pré-faturamento um contrato que nenhum comprador
 * assinou. Esse card espera o envelope fechar, como sempre esperou.
 */
export function todosOsCompradoresAssinaram(quadro: readonly ItemDoQuadro[]): boolean {
  const { assinaram, total } = compradoresDoQuadro(quadro);
  return total > 0 && assinaram === total;
}
