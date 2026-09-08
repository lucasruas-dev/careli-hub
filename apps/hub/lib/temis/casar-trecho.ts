// COMO O TRECHO DA IA ENCONTRA O SEU LUGAR NO TEXTO — a busca tolerante.
//
// Lucas, 08/09/2026, olhando o painel do agente: *"11 propostas… 17 não casou com o texto e ficou de
// fora"*. Mais da metade do trabalho do modelo estava sendo jogado fora, e não por estar errado.
//
// ⚠️ O QUE DERRUBAVA AS 17. A busca era `texto.indexOf(trecho)` — literal, caractere a caractere. Um
// contrato importado do Word está cheio de coisas que a IA reescreve sem perceber ao citar:
//
//   ESPAÇO DURO (U+00A0)   O Word põe entre "n.º" e o número, e entre "R$" e o valor. Na tela é um
//                          espaço; na comparação, um caractere completamente diferente.
//   ESPAÇO DOBRADO         Duas batidas de barra de espaço depois do ponto final, herança de
//                          datilografia, que sobrevivem à importação.
//   ASPAS E TRAÇOS CURVOS  " " ' ' – — que o Word troca sozinho enquanto se digita.
//   QUEBRA DE LINHA        O trecho que atravessa duas linhas do parágrafo.
//
// Nenhum deles muda uma letra do contrato, e todos derrubavam a proposta.
//
// ⚠️ A TOLERÂNCIA É SÓ DE FORMA, NUNCA DE CONTEÚDO. Acento, letra e pontuação continuam valendo:
// "n.º" não casa com "no", "José" não casa com "Jose". A regra é estreita de propósito — o dia em
// que a busca "quase" achar o trecho é o dia em que a substituição cai no lugar errado do contrato.
//
// ⚠️ E A POSIÇÃO DEVOLVIDA É SEMPRE DO TEXTO ORIGINAL. A normalização serve para COMPARAR; o
// recorte acontece no texto de verdade. Por isso o mapa de índices existe: cada caractere do texto
// normalizado sabe de onde veio.

/** O que vira o quê antes de comparar. Só forma — nada que mude a leitura de uma palavra. */
const TROCAS: Record<string, string> = {
  " ": " ", // espaço duro
  " ": " ", // espaço de quatro-por-em
  " ": " ", // espaço de figura
  " ": " ", // espaço fino
  "​": "", // espaço de largura zero: some
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-", // en dash
  "—": "-", // em dash
  "‘": "'",
  "’": "'",
  "“": '"',
  "”": '"',
  "…": "...",
  "﻿": "", // BOM
};

type TextoNormalizado = {
  /** Para cada caractere do texto normalizado, de onde ele veio no original. */
  indices: number[];
  texto: string;
};

/**
 * O texto pronto para comparar, com o mapa de volta.
 *
 * ⚠️ ESPAÇOS EM SEQUÊNCIA VIRAM UM SÓ, e o único que sobra aponta para o PRIMEIRO da sequência. É o
 * que faz "R$ 100" (com espaço duro) e "R$  100" (com dois espaços) casarem com "R$ 100" — e é o que
 * garante que o recorte no original comece no lugar certo.
 */
export function normalizarParaBusca(bruto: string): TextoNormalizado {
  const saida: string[] = [];
  const indices: number[] = [];
  let espacoEm = -1;

  for (let i = 0; i < bruto.length; i += 1) {
    const original = bruto[i] as string;
    const trocado = TROCAS[original] ?? original;

    if (trocado === "") continue;

    if (/^\s$/.test(trocado)) {
      if (espacoEm < 0) espacoEm = i;
      continue;
    }

    // O espaço pendente só entra se já houver conteúdo: espaço no começo do texto não conta.
    if (espacoEm >= 0) {
      if (saida.length > 0) {
        saida.push(" ");
        indices.push(espacoEm);
      }
      espacoEm = -1;
    }

    for (const ch of trocado) {
      saida.push(ch);
      indices.push(i);
    }
  }

  return { indices, texto: saida.join("") };
}

export type Casamento = {
  /** Posição no texto ORIGINAL onde o trecho termina (exclusiva). */
  fim: number;
  /** Posição no texto ORIGINAL onde o trecho começa. */
  inicio: number;
};

export type ResultadoDoCasamento =
  | { casamento: Casamento; situacao: "achou" }
  | { situacao: "ambiguo" }
  | { situacao: "nao_encontrado" };

/**
 * Onde este trecho está no texto — uma vez, e só uma.
 *
 * ⚠️ AMBÍGUO É RECUSA, NÃO ESCOLHA. Num contrato de três compradores, "portador do CPF n.º" aparece
 * três vezes. Marcar a primeira ocorrência produziria um contrato que parece certo e qualifica a
 * pessoa errada — o pior tipo de defeito, porque não tem sintoma.
 *
 * ⚠️ O CONTEXTO É A SAÍDA PARA A LACUNA REPETIDA, e ele nasceu de uma minuta real. A do Jardim das
 * Gerais (Lucas, 08/09/2026: *"como exemplo"*) não vem preenchida — ela vem com o lugar do dado em
 * branco:
 *
 *     NOME COMPLETO, nacionalidade, estado civil, inscrito no CPF sob o n.º ________________,
 *     residente na Rua ________________, n.º _____, Bairro ______________
 *
 * O trecho a substituir é `________________`, que aparece dezenas de vezes no documento — e sem o
 * contexto TODAS essas propostas cairiam como ambíguas, que é justamente a metade da minuta que mais
 * precisa de variável.
 *
 * Com ele, a busca acontece em dois tempos: acha o CONTEXTO (que é único, porque carrega as palavras
 * ao redor) e procura o trecho DENTRO dele. A substituição continua sendo só do trecho — o contexto
 * desambigua sem alargar o que se troca, que é o ponto: `[cpf_cliente]` entra na lacuna, e "inscrito
 * no CPF sob o n.º" continua escrito no contrato.
 */
export function casarTrecho(
  texto: string,
  trecho: string,
  contexto?: string,
): ResultadoDoCasamento {
  const alvo = normalizarParaBusca(trecho ?? "").texto.trim();
  if (!alvo) return { situacao: "nao_encontrado" };

  const base = normalizarParaBusca(texto ?? "");

  // A janela onde procurar: o documento inteiro, ou só o pedaço que o contexto delimita.
  let janelaInicio = 0;
  let janelaFim = base.texto.length;

  const pista = normalizarParaBusca(contexto ?? "").texto.trim();
  if (pista) {
    const ancora = acharAncora(base.texto, pista, alvo);
    // ⚠️ A RECUSA PRECISA DIZER A VERDADE. Sem âncora, o motivo é do ALVO, não do contexto: um
    // trecho que aparece três vezes no documento é AMBÍGUO, e chamar isso de "não encontrado"
    // manda quem revisa procurar um trecho que está lá, na frente dele, três vezes.
    if (!ancora) return { situacao: apareceMaisDeUmaVez(base.texto, alvo) ? "ambiguo" : "nao_encontrado" };
    janelaInicio = ancora.inicio;
    janelaFim = ancora.fim;
  }

  const janela = base.texto.slice(janelaInicio, janelaFim);
  const dentro = janela.indexOf(alvo);
  if (dentro < 0) return { situacao: "nao_encontrado" };
  if (janela.indexOf(alvo, dentro + 1) >= 0) return { situacao: "ambiguo" };

  const primeira = janelaInicio + dentro;
  const inicio = base.indices[primeira];
  const ultimo = base.indices[primeira + alvo.length - 1];
  if (inicio === undefined || ultimo === undefined) return { situacao: "nao_encontrado" };

  // ⚠️ O FIM É O ÚLTIMO CARACTERE + 1, e não o índice do próximo caractere normalizado. Somar 1 ao
  // último é o que mantém o recorte colado no trecho: usar o índice do caractere seguinte engoliria
  // os espaços que a normalização colapsou logo depois dele.
  return { casamento: { fim: ultimo + 1, inicio }, situacao: "achou" };
}

/**
 * A janela onde procurar o trecho, a partir do contexto.
 *
 * ⚠️ O CONTEXTO É ÂNCORA, NÃO CONDIÇÃO — e essa distinção custou uma rodada de teste do Lucas.
 *
 * Em 08/09/2026 ele mandou aplicar 52 propostas de uma vez na minuta do Aldeia da Cachoeira. Várias
 * não entraram, em silêncio. A mais visível foi a mais importante do contrato: `[NOME COMPLETO]`,
 * que deveria virar `[nome_cliente]`.
 *
 * A causa é a ordem de aplicação. As propostas são aplicadas DE TRÁS PARA A FRENTE, de propósito:
 * cada substituição muda o documento, e começar pelo fim mantém as posições das anteriores. Só que
 * o contexto de uma proposta cerca o trecho dos DOIS lados:
 *
 *     contexto: "FIDUCIANTE(S): [NOME COMPLETO], [nacionalidade]"
 *                                ↑ o trecho      ↑ isto vem DEPOIS, e já virou
 *                                                  [nacionalidade_cliente]
 *
 * Quando a vez do `[NOME COMPLETO]` chegava, o contexto exato não existia mais no documento — e o
 * casamento falhava, apesar de o trecho estar lá, intacto e único.
 *
 * A saída é deixar o contexto CEDER PELA PONTA QUE MUDOU, sem deixar de desambiguar:
 *
 *   1. o contexto inteiro          — o caso normal, e o mais preciso;
 *   2. só o PREFIXO até o trecho   — aplicando de trás para a frente, tudo que vem ANTES ainda está
 *                                    intacto, então este é o pedaço confiável do contexto;
 *   3. o trecho sozinho, se for ÚNICO no documento — sem ambiguidade, contexto nenhum é necessário.
 *
 * ⚠️ O PASSO 3 NÃO AFROUXA A REGRA. `[●]` aparece dezenas de vezes na minuta do Aldeia: para ele o
 * passo 3 nunca vale, e a proposta continua caindo como ambígua em vez de cair no lugar errado. Só
 * o trecho que é único no documento inteiro dispensa âncora — e para esse o contexto era enfeite.
 */
function acharAncora(
  texto: string,
  pista: string,
  alvo: string,
): null | { fim: number; inicio: number } {
  const soUmaVez = (agulha: string) => {
    const onde = texto.indexOf(agulha);
    return onde >= 0 && texto.indexOf(agulha, onde + 1) < 0 ? onde : -1;
  };

  // 1. O contexto inteiro.
  const inteiro = soUmaVez(pista);
  if (inteiro >= 0) return { fim: inteiro + pista.length, inicio: inteiro };

  // 2. O prefixo até o trecho — a metade que a aplicação de trás para a frente não tocou.
  const ondeAlvoNaPista = pista.indexOf(alvo);
  if (ondeAlvoNaPista > 0) {
    const prefixo = pista.slice(0, ondeAlvoNaPista);
    const so = soUmaVez(prefixo);
    // A janela vai do prefixo até o fim do documento: o trecho está logo depois dele, e a busca
    // dentro da janela ainda reprova se ele aparecer duas vezes daí para a frente.
    if (so >= 0) return { fim: texto.length, inicio: so };
  }

  // 3. Sem âncora nenhuma — só vale se o trecho for único no documento inteiro.
  return soUmaVez(alvo) >= 0 ? { fim: texto.length, inicio: 0 } : null;
}

/** O trecho está no documento mais de uma vez — o que faz dele ambíguo quando nada o ancora. */
function apareceMaisDeUmaVez(texto: string, agulha: string): boolean {
  const onde = texto.indexOf(agulha);
  return onde >= 0 && texto.indexOf(agulha, onde + 1) >= 0;
}
