import { acharVariavel, type VariavelDoContrato } from "./variaveis";

// O AGENTE QUE MARCA A MINUTA — lê o texto, acha onde cada variável entra, e propõe.
//
// Pedido do Lucas (07/09/2026): *"isso é o que eu quero, um super agente que consiga inserir as
// variáveis, olhar o texto e identificar onde as variáveis vão, e conhece todas as variáveis"*.
//
// ⚠️ A IA PROPÕE, ELA NÃO REESCREVE. Esta é a decisão que sustenta tudo aqui, e ela é sobre o que
// pode dar errado num contrato:
//
//   Se a IA devolvesse o TEXTO REESCRITO, cada geração seria uma chance de ela mudar uma palavra do
//   instrumento — trocar "resolvido" por "rescindido", ajustar uma vírgula que muda quem paga o
//   ITBI, "melhorar" um parágrafo que o jurídico escolheu palavra por palavra. E ninguém iria
//   conferir 60 mil caracteres para achar a diferença. Pior: ela escreveria `[nome do cliente]` no
//   lugar de `[nome_cliente]`, que é exatamente como `[Nome]` e `[CPF]` entraram nas minutas
//   antigas e saíram impressos em contrato assinado.
//
//   Aqui ela devolve uma LISTA DE PROPOSTAS: "o trecho tal deve virar a variável tal". O texto
//   jurídico é intocado; o que se aplica é a troca de um trecho exato por uma variável do catálogo.
//   Toda proposta é conferida contra o catálogo ANTES de existir na tela, e o trecho tem de existir
//   no texto — proposta que não casa é descartada, não corrigida.
//
// ⚠️ E O QUE ELA PROPÕE É REVERSÍVEL POR CONSTRUÇÃO: aplicar é uma substituição de texto, e o
// operador aceita uma a uma. Nada entra na minuta sem alguém ter olhado.

/** Uma proposta da IA: este trecho do texto é esta variável. */
export type Proposta = {
  /** Por que a IA acha isso — aparece na tela, para o operador decidir em segundos. */
  motivo: string;
  /** O nome da variável, sem colchetes. */
  nome: string;
  /** O trecho EXATO do texto que deve virar a variável. */
  trecho: string;
};

export type PropostaValidada = Proposta & {
  /** Onde o trecho começa no texto. -1 nunca chega aqui: proposta sem posição é descartada. */
  posicao: number;
  variavel: VariavelDoContrato;
};

export type RecusaDeProposta = {
  motivo: "fora_do_catalogo" | "ja_marcado" | "trecho_ambiguo" | "trecho_nao_encontrado";
  proposta: Proposta;
};

export type Triagem = {
  aceitas: PropostaValidada[];
  recusadas: RecusaDeProposta[];
};

/**
 * Separa o que dá para aplicar do que não dá.
 *
 * ⚠️ AS QUATRO RECUSAS SÃO O CORAÇÃO DA SEGURANÇA, e cada uma existe por um estrago diferente:
 *
 * - `fora_do_catalogo`: a IA inventou um nome. É o defeito mais provável de todos — o modelo vê
 *   "CPF do fiador" e propõe `[cpf_fiador]`, que não existe. Aplicar isso imprimiria `[cpf_fiador]`
 *   no contrato assinado.
 * - `trecho_nao_encontrado`: a IA "citou" um trecho que não está no texto (parafraseou, corrigiu um
 *   acento, mudou um espaço). Substituir pelo trecho aproximado mexeria no texto jurídico.
 * - `trecho_ambiguo`: o trecho aparece MAIS DE UMA VEZ. Num contrato com cinco compradores, "CPF
 *   n.º" aparece cinco vezes, e trocar a primeira ocorrência marcaria o comprador errado — em
 *   silêncio, porque o resultado parece certo.
 * - `ja_marcado`: o trecho já é uma variável. Marcar de novo produziria `[[nome_cliente]]`.
 */
export function triarPropostas(texto: string, propostas: Proposta[]): Triagem {
  const aceitas: PropostaValidada[] = [];
  const recusadas: RecusaDeProposta[] = [];

  for (const proposta of propostas) {
    const nome = proposta.nome?.trim().replace(/^\[|\]$/g, "") ?? "";
    const trecho = proposta.trecho ?? "";

    const variavel = acharVariavel(nome);
    if (!variavel) {
      recusadas.push({ motivo: "fora_do_catalogo", proposta });
      continue;
    }

    if (!trecho.trim()) {
      recusadas.push({ motivo: "trecho_nao_encontrado", proposta });
      continue;
    }

    // ⚠️ Já é variável? `[nome_cliente]` proposto sobre `[nome_cliente]` daria `[[nome_cliente]]`.
    if (/^\[[A-Za-z0-9_]+\]$/.test(trecho.trim())) {
      recusadas.push({ motivo: "ja_marcado", proposta });
      continue;
    }

    const primeira = texto.indexOf(trecho);
    if (primeira < 0) {
      recusadas.push({ motivo: "trecho_nao_encontrado", proposta });
      continue;
    }

    if (texto.indexOf(trecho, primeira + 1) >= 0) {
      recusadas.push({ motivo: "trecho_ambiguo", proposta });
      continue;
    }

    aceitas.push({ ...proposta, nome, posicao: primeira, variavel });
  }

  // Da última para a primeira: aplicar de trás para a frente mantém as posições das anteriores
  // válidas. Ordenar aqui poupa quem aplica de reordenar.
  aceitas.sort((a, b) => b.posicao - a.posicao);

  return { aceitas, recusadas };
}

/**
 * Aplica as propostas aceitas, devolvendo o texto marcado.
 *
 * ⚠️ DE TRÁS PARA A FRENTE. Substituir da primeira para a última muda o comprimento do texto e
 * invalida todas as posições seguintes — o clássico. Como `triarPropostas` já ordena decrescente,
 * aqui é só percorrer.
 *
 * ⚠️ E SÓ APLICA O QUE FOI ESCOLHIDO. Recebe as aceitas que o operador aprovou, não a lista inteira:
 * o gesto de aceitar é dele, não do modelo.
 */
export function aplicarPropostas(texto: string, aceitas: PropostaValidada[]): string {
  let saida = texto;
  for (const p of [...aceitas].sort((a, b) => b.posicao - a.posicao)) {
    // Reconfere a posição no texto ATUAL: se outra proposta já mexeu ali, esta não se aplica.
    if (saida.slice(p.posicao, p.posicao + p.trecho.length) !== p.trecho) continue;
    saida = saida.slice(0, p.posicao) + `[${p.nome}]` + saida.slice(p.posicao + p.trecho.length);
  }
  return saida;
}

/** O texto da recusa, para a tela dizer por que aquela proposta não entrou. */
export function motivoDaRecusa(recusa: RecusaDeProposta): string {
  switch (recusa.motivo) {
    case "fora_do_catalogo":
      return `"${recusa.proposta.nome}" não existe no catálogo — o Panteon não saberia preencher.`;
    case "ja_marcado":
      return "Esse trecho já é uma variável.";
    case "trecho_ambiguo":
      return `"${cortar(recusa.proposta.trecho)}" aparece mais de uma vez no texto: não dá para saber qual.`;
    default:
      return `"${cortar(recusa.proposta.trecho)}" não foi encontrado no texto exatamente assim.`;
  }
}

function cortar(t: string): string {
  const limpo = (t ?? "").replace(/\s+/g, " ").trim();
  return limpo.length > 48 ? `${limpo.slice(0, 48)}…` : limpo;
}
