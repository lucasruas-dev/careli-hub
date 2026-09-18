// DE QUE COR O LOTE APARECE NO ESPELHO PÚBLICO — e são DUAS cores, só.
//
// Lucas (09/09/2026): *"para esse publico são duas cores, azul para bloqueado vendido, reserva,
// proposta, contrato) e verde para disponivel"* · *"esse é o padrão externo, o interno é o que
// desenhamos e que está hoje com as cores referente aos status"*.
//
// ⚠️ ESTE ARQUIVO NÃO DECIDE SITUAÇÃO NENHUMA. Quem decide é `../situacao-da-unidade.ts`, a régua
// única do Panteon (Lucas, 18/09/2026: *"esses status tem que morar em um so lugar"* · *"quero é
// dentro do panteon tem que ter o mesmo status"*). Aqui só se traduz a resposta dela em duas cores:
// VERDE SE E SÓ SE `estaLivre`. Proposta, contrato, assinatura, faturado, reserva, vendido e
// bloqueado saem todos azul, que é exatamente o pedido de 09/09.
//
// ⚠️ O QUE HAVIA AQUI ANTES, E POR QUE SAIU. O espelho tinha régua própria, e errada nos dois sinais
// de processo: `hercules_propostas.aberta` (que NUNCA volta a falso depois que a proposta morre, então
// proposta cancelada seguia travando o lote) e `hercules_reservas.situacao = 'reservada'` (valor que a
// tabela não usa: a reserva viva é `ativa`, então reserva nenhuma do Hércules pintava o lote de azul).
// Resultado: o link público e a tela Venda discordavam do mesmo lote. Nenhuma régua daqui para a
// frente; se a cor pública estiver errada, o defeito está na régua única, e é lá que se corrige.
//
// ⚠️ FAIL-CLOSED, SEMPRE. Verde é uma AFIRMAÇÃO para quem está de fora: "este lote está à venda".
// Linha que a leitura da situação não conhece, lote sem registro, dúvida sobre qual terreno o
// quadrado representa: tudo sai azul. O erro caro desta tela é anunciar disponível um lote que já
// tem dono: o cliente escolhe, o corretor promete, e alguém tem de desdizer.

import { estaLivre, type SituacaoDaUnidade } from "../situacao-da-unidade";

/** As duas cores do público. Nada de status intermediário aqui: isso é o espelho INTERNO. */
export type SituacaoPublica = "disponivel" | "indisponivel";

/**
 * A cor pública de uma situação da régua única.
 *
 * ⚠️ `undefined` É "NÃO CONSEGUI LER", e sai azul. Nunca devolve verde por ausência.
 */
export function corPublica(situacao: SituacaoDaUnidade | undefined): SituacaoPublica {
  return situacao !== undefined && estaLivre(situacao) ? "disponivel" : "indisponivel";
}

/** Uma linha de `hercules_unidades` que caiu no quadrado de um lote do espelho. */
export type LinhaDoLote = {
  /** A linha é do empreendimento PAI, o dono do desenho (`inkscape:label` é o código dele). */
  doPai: boolean;
  /** `hercules_unidades.id`. É por ele que a régua única responde (`porLinha`). */
  id: string;
};

/** O pedaço da leitura da régua única que esta função consulta. */
export type TerrenoComSituacao = { id: string; situacao: SituacaoDaUnidade };

/**
 * A cor de UM quadrado do espelho: as linhas de `hercules_unidades` que o espelho juntou pela
 * quadra e pelo lote (ou torre e apartamento), respondidas pela régua única.
 *
 * ⚠️ QUEM RESPONDE É O TERRENO DO DESENHO. O público vê o loteamento pelo masterplan do PAI, e o
 * lote do desenho é o código do pai (VLO0305). A régua única já resolve esse código para o terreno
 * inteiro: a linha antiga do pai aponta (`espelho_de`) para a viva da gleba, e `porLinha` devolve a
 * mesma resposta para as duas, com proposta e reserva de qualquer uma delas na conta. Então:
 *
 * 1. **Linha que a régua não conhece: azul.** É uma linha que a leitura não trouxe (outro workspace,
 *    unidade criada entre as duas leituras). Sem resposta, não há afirmação de verde.
 * 2. **Linha do pai que aponta para uma gleba: é esse terreno que responde.** É o caso do Vale do
 *    Ouro com os lotes que VOC e VOR disputam: a migration 0162 apontou o pai para a gleba que vende
 *    (a não bloqueada), e a outra linha do quadrado é outro cadastro, que a régua única trata como
 *    outra unidade. Somar as duas deixaria azul um lote que a carteira viva vende.
 * 3. **Sem esse ponteiro, o quadrado junta linhas que o Panteon não diz serem o mesmo terreno**
 *    (pai sem gleba cadastrada, ou produto dividido que a marca ainda não alcança). Verde só se
 *    TODAS estiverem livres. Na dúvida, azul.
 */
export function situacaoPublicaDoLote(
  linhas: readonly LinhaDoLote[],
  porLinha: ReadonlyMap<string, TerrenoComSituacao>,
): SituacaoPublica {
  if (linhas.length === 0) return "indisponivel";

  const todos = new Map<string, SituacaoDaUnidade>();
  const doDesenho = new Map<string, SituacaoDaUnidade>();

  for (const linha of linhas) {
    const terreno = porLinha.get(linha.id);
    if (!terreno) return "indisponivel";
    todos.set(terreno.id, terreno.situacao);
    // O pai que responde por OUTRA linha é o pai apontando para a gleba viva.
    if (linha.doPai && terreno.id !== linha.id) doDesenho.set(terreno.id, terreno.situacao);
  }

  const quemResponde = doDesenho.size > 0 ? doDesenho : todos;
  for (const situacao of quemResponde.values()) {
    if (corPublica(situacao) !== "disponivel") return "indisponivel";
  }
  return "disponivel";
}

/** Quantos de cada cor: a legenda do espelho. */
export function contarPublicas(
  situacoes: Iterable<SituacaoPublica>,
): Record<SituacaoPublica, number> {
  const total: Record<SituacaoPublica, number> = {
    disponivel: 0,
    indisponivel: 0,
  };
  for (const s of situacoes) total[s] += 1;
  return total;
}
