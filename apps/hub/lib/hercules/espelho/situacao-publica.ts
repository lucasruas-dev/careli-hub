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

import {
  acharUnidade,
  estaLivre,
  type SituacaoDaUnidade,
  type SituacaoDasUnidades,
  type UnidadeComSituacao,
} from "../situacao-da-unidade";

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
  /** `hercules_unidades.id`. É por ele que a régua única responde (`acharUnidade`, `linhaId`). */
  id: string;
};

/**
 * A resposta da régua única para UMA linha do quadrado, pela ordem única de busca.
 *
 * ⚠️ SÓ O ID DA LINHA, DE PROPÓSITO, e é a mesma escolha de `criar-reserva.ts`. `acharUnidade`
 * procura pela linha do Panteon, depois pelo id do legado, depois pelo código; o espelho sempre tem
 * a primeira chave, porque lê a MESMA tabela que a régua lê. Quando a régua não conhece esse id, é
 * porque não leu a linha (outro workspace, unidade criada entre as duas leituras), e então também
 * não leu as propostas e reservas penduradas nela. Cair para o id do legado ou para o código
 * responderia com o processo de OUTRA linha, e aí o verde de uma linha limpa cobriria a linha que
 * tem dono. Sem resposta pelo id: sem resposta, e o quadrado sai azul.
 */
function respostaDaRegua(
  situacoes: SituacaoDasUnidades,
  linha: LinhaDoLote,
): undefined | UnidadeComSituacao {
  return acharUnidade(situacoes, { linhaId: linha.id });
}

/**
 * A cor de UM quadrado do espelho: as linhas de `hercules_unidades` que o espelho juntou pela
 * quadra e pelo lote (ou torre e apartamento), respondidas pela régua única.
 *
 * ⚠️ QUEM RESPONDE É O TERRENO DO DESENHO. O público vê o loteamento pelo masterplan do PAI, e o
 * lote do desenho é o código do pai (VLO0305). A régua única já resolve esse código para o terreno
 * inteiro: a linha antiga do pai aponta (`espelho_de`) para a viva da gleba, e a busca pela linha do
 * pai devolve a unidade viva, com proposta e reserva de qualquer linha do terreno na conta. E o
 * terreno inclui a IRMÃ de outra gleba com a mesma quadra e lote (VOC e VOR no Vale do Ouro): a
 * proposta viva na VOC pinta de azul a VOR para onde o pai aponta. Então:
 *
 * 1. **Linha que a régua não conhece: azul.** É uma linha que a leitura não trouxe (outro workspace,
 *    unidade criada entre as duas leituras). Sem resposta, não há afirmação de verde.
 * 2. **Linha do pai que aponta para uma gleba: é esse terreno que responde**, e ele precisa estar
 *    livre. É o caso dos lotes que VOC e VOR disputam: a migration 0162 apontou o pai para a gleba
 *    que vende (a não bloqueada).
 * 3. **As OUTRAS linhas do quadrado só perdem a voz num caso: gleba (não o pai) com o cadastro
 *    `bloqueada` e processo nenhum.** É exatamente a forma da 0162, a carteira de onde o lote saiu, e
 *    somá-la deixaria azul um lote que a carteira viva vende. Qualquer outra coisa nela (proposta,
 *    contrato, reserva, "vendida" ou "reservada" no cadastro) é sinal de dono, e o lote sai azul.
 *    ⚠️ Isto NÃO é uma segunda régua: a régua já soma a irmã quando reconhece a família do pai
 *    (e aí a VOR responde "proposta" sozinha). O item 3 é o cinto para quando ela não reconhece
 *    (gleba para onde nenhuma linha do pai aponta): o quadrado do espelho junta as duas linhas pela
 *    quadra e pelo lote, e dono numa delas não pode sumir porque o pai olha para a outra.
 * 4. **Sem esse ponteiro, o quadrado junta linhas que o Panteon não diz serem o mesmo terreno**
 *    (pai sem gleba cadastrada, ou produto dividido que a marca ainda não alcança). Verde só se
 *    TODAS estiverem livres. Na dúvida, azul.
 */
export function situacaoPublicaDoLote(
  linhas: readonly LinhaDoLote[],
  situacoes: SituacaoDasUnidades,
): SituacaoPublica {
  if (linhas.length === 0) return "indisponivel";

  const respostas: Array<{ linha: LinhaDoLote; unidade: UnidadeComSituacao }> = [];
  for (const linha of linhas) {
    const unidade = respostaDaRegua(situacoes, linha);
    if (!unidade) return "indisponivel";
    respostas.push({ linha, unidade });
  }

  // O pai que responde por OUTRA linha é o pai apontando para a gleba viva.
  const doDesenho = new Set(
    respostas.filter(({ linha, unidade }) => linha.doPai && unidade.id !== linha.id).map(({ unidade }) => unidade.id),
  );

  for (const { linha, unidade } of respostas) {
    if (corPublica(unidade.situacao) === "disponivel") continue;
    // A carteira de onde o lote saiu (0162): gleba, bloqueada, sem processo. Só ela cala, e só
    // quando o pai aponta para outra unidade que responde pelo desenho. "bloqueada" vinda da régua
    // já quer dizer processo nenhum: ela põe proposta viva e reserva viva ACIMA do cadastro.
    const carteiraQueNaoVende =
      doDesenho.size > 0 && !doDesenho.has(unidade.id) && !linha.doPai && unidade.situacao === "bloqueada";
    if (!carteiraQueNaoVende) return "indisponivel";
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
