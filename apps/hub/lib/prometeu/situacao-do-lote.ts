// DE QUE COR O LOTE APARECE NO TELÃO DO LANÇAMENTO.
//
// ⚠️ A SITUAÇÃO NÃO É DECIDIDA AQUI. Lucas (18/09/2026): *"esses status tem que morar em um so
// lugar"* · *"no c2x não precisa olhar"* · *"quero é dentro do panteon tem que ter o mesmo
// status"*. Ela vem pronta de lib/hercules/situacao-da-unidade.ts, a mesma régua da tela Venda, da
// aba Unidades do Apolo e do espelho público: proposta viva > reserva viva (do Hércules OU do
// evento) > cadastro. Este arquivo só TRADUZ a resposta para as palavras que o telão fala.
//
// ⚠️ O QUE HAVIA AQUI ATÉ 18/09/2026: uma régua própria, lendo o C2X ao vivo (`sale_status_id`,
// `sale_blocked`, pedido de aquisição aberto) com a reserva do salão por cima. Era uma das três
// réguas que faziam a mesma unidade aparecer livre no telão e ocupada na tela Venda (o bloqueio do
// coordenador, por exemplo, vive só no Panteon, e o telão não o via). Quem sentir falta dela: a
// resposta é sincronizar o Panteon, e não voltar a perguntar ao legado.
//
// A reserva do salão continua pintando o lote em segundos: a régua única já conta
// `prometeu_reservas`, e masterplan-do-evento.ts a lê a cada pedido, sem cache nenhum.
//
// ⚠️ O TELÃO MOSTRA SÓ A SITUAÇÃO. Nunca nome de comprador, nunca valor: é a tela mais pública
// que existe no evento, projetada para o salão inteiro, e roda em máquina de terceiro por um
// link sem login. A lição é do Garden, onde uma página interna sem senha expôs nome e preço.
// Por isso este módulo devolve UMA palavra por lote, e nada mais.
import { baldeDaSituacao, type SituacaoDaUnidade } from "@/lib/hercules/situacao-da-unidade";

export type SituacaoDoLote =
  | "disponivel"
  | "indisponivel"
  | "reservado"
  | "vendido";

/**
 * A palavra do telão para a situação da unidade.
 *
 * É o balde de `baldeDaSituacao`, com UM nome trocado: o "bloqueado" do módulo único vira
 * "indisponivel", que é como o telão, a rota pública e o componente sempre chamaram. Não é regra
 * nova, é vocabulário: quem decide o balde continua sendo o módulo único.
 *
 * ⚠️ PROPOSTA, CONTRATO E ASSINATURA CAEM EM "vendido", e não em "reservado" como o telão antigo
 * fazia com o "em negociação" do C2X. No mapa não muda nada (todo lote não livre tem a mesma cor
 * azul); muda só a contagem que a rota devolve, que passa a bater com os cards do Apolo.
 */
export function situacaoNoTelao(situacao: SituacaoDaUnidade): SituacaoDoLote {
  const balde = baldeDaSituacao(situacao);
  return balde === "bloqueado" ? "indisponivel" : balde;
}

/** Quantos lotes em cada situação: o painel de números que a rota devolve. */
export function contarSituacoes(
  situacoes: Iterable<SituacaoDoLote>,
): Record<SituacaoDoLote, number> {
  const total: Record<SituacaoDoLote, number> = {
    disponivel: 0,
    indisponivel: 0,
    reservado: 0,
    vendido: 0,
  };
  for (const s of situacoes) total[s] += 1;
  return total;
}
