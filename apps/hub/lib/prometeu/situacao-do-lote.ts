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
// A reserva do salão continua pintando o lote em segundos: desde 18/09/2026 ela nasce no Hércules
// (`criarReservaNoHercules`, origem `salao`), a régua única a conta como qualquer reserva, e
// masterplan-do-evento.ts a lê a cada pedido, sem cache nenhum.
//
// ⚠️ O TELÃO MOSTRA SÓ A SITUAÇÃO. Nunca nome de comprador, nunca valor: é a tela mais pública
// que existe no evento, projetada para o salão inteiro, e roda em máquina de terceiro por um
// link sem login. A lição é do Garden, onde uma página interna sem senha expôs nome e preço.
// Por isso este módulo devolve UMA palavra por lote, e nada mais.
import { baldeDaSituacao, type SituacaoDaUnidade } from "@/lib/hercules/situacao-da-unidade";

import { normalizarCodigoDeUnidade } from "./cupom";

export type SituacaoDoLote =
  | "disponivel"
  | "indisponivel"
  | "negociacao"
  | "reservado"
  | "vendido";

/**
 * A palavra do telão para a situação da unidade.
 *
 * É o balde de `baldeDaSituacao`, com UM nome trocado: o "bloqueado" do módulo único vira
 * "indisponivel", que é como o telão, a rota pública e o componente sempre chamaram. Não é regra
 * nova, é vocabulário: quem decide o balde continua sendo o módulo único.
 *
 * ⚠️ PROPOSTA, CONTRATO E ASSINATURA SÃO "negociacao", o quinto balde do módulo único (*"UM
 * AGRUPAMENTO SÓ PARA TODAS AS TELAS"*, ver `baldeDaSituacao`). A primeira passada punha os três em
 * "vendido" aqui enquanto o módulo único já dizia "Em negociação": o mesmo lote com dois nomes, e o
 * tipo nem fechava. No mapa não muda nada (todo lote não livre tem a mesma cor azul); muda só a
 * contagem que a rota devolve, que passa a bater com os cards do Apolo e do Hércules.
 */
export function situacaoNoTelao(situacao: SituacaoDaUnidade): SituacaoDoLote {
  const balde = baldeDaSituacao(situacao);
  if (balde === "bloqueado") return "indisponivel";
  // ⚠️ NO TELÃO A VENDA EM CANCELAMENTO CONTINUA VENDIDA, e de propósito. O telão é do salão de
  // vendas: enquanto o jurídico não desfaz, aquele lote tem dono e não pode ser oferecido. Um
  // estado a mais ali só ensinaria o corretor a perguntar o que ele significa.
  if (balde === "em_cancelamento") return "vendido";
  return balde;
}

/**
 * Os códigos travados no Setup do evento (`config.lotesBloqueados`), normalizados.
 *
 * ⚠️ A TRAVA DO EVENTO BLOQUEIA POR CIMA (Lucas, 29/08/2026: *"bloqueia para ficar azul também"*).
 * Nasceu para o lote que não tem cadastro (vendido antes da carga, permuta, área remanescente) e
 * continua valendo também para o lote que TEM cadastro: foi assim até 18/09, e a primeira passada da
 * situação única a tinha rebaixado a "só tapa buraco". Tirar um lote do telão e do tótem por decisão
 * do lançamento não pode depender de ele estar no Panteon. Quem lê: o telão
 * (masterplan-do-evento.ts) e a oferta do tótem e a reserva do salão (reservas-evento.ts), os três
 * pela MESMA lista.
 *
 * Mora aqui, e não em masterplan-do-evento.ts, porque este arquivo não faz I/O: a reserva do salão
 * importa daqui sem puxar a leitura do mapa.
 */
export function lotesTravadosDoEvento(
  config: null | Record<string, unknown> | undefined,
): Set<string> {
  const lista = Array.isArray(config?.lotesBloqueados) ? (config.lotesBloqueados as unknown[]) : [];
  return new Set(
    lista.map((c) => normalizarCodigoDeUnidade(String(c ?? ""))).filter(Boolean),
  );
}

/** Quantos lotes em cada situação: o painel de números que a rota devolve. */
export function contarSituacoes(
  situacoes: Iterable<SituacaoDoLote>,
): Record<SituacaoDoLote, number> {
  const total: Record<SituacaoDoLote, number> = {
    disponivel: 0,
    indisponivel: 0,
    negociacao: 0,
    reservado: 0,
    vendido: 0,
  };
  for (const s of situacoes) total[s] += 1;
  return total;
}
