// QUAL LINHA DE `hercules_unidades` RESPONDE POR ESTE TERRENO.
//
// ⚠️ O MESMO TERRENO TEM DUAS LINHAS, e as duas já discordavam. Medido em produção em 14/09/2026:
// 714 terrenos da Lagoa Bonita e do Vale do Ouro têm uma linha no empreendimento PAI (o registro de
// antes da divisão em glebas) e outra no FILHO (a gleba que vende). 330 pares da Lagoa e 62 do Vale
// já tinham SITUAÇÃO diferente; 346 e 4 tinham PREÇO diferente — o mesmo lote aparecia "bloqueada a
// R$ 545.864,00" de um lado e "vendida a R$ 519.573,00" do outro.
//
// ⚠️ A VERDADE É A DO FILHO, E QUEM RESPONDE ISSO É O DINHEIRO. No C2X, os pais têm ZERO parcelas e
// R$ 0,00; os filhos têm 2.726 e 26.972 parcelas, R$ 12,1 mi e R$ 25,6 mi. E o padrão das propostas
// fecha o argumento: o MESMO cliente, com o MESMO CPF, aparece "reservado" na linha do pai e
// "faturado" na do filho. Não são duas vendas — é uma venda que começou como reserva no registro
// antigo e foi concluída no novo. A linha do pai é história parada.
//
// ⚠️ POR QUE ISTO EXISTE COMO LIB, E NÃO COMO REGRA EM CADA TELA. Antes da coluna `espelho_de`
// (migration 0161) cada leitor tinha de descobrir o parentesco sozinho, agrupando por quadra+lote —
// e só DOIS descobriram: `espelho/situacao-publica.ts` fez a sua própria precedência e
// `incorporador/painel-de-produtos.ts` marcou o pai como "consumido" para os cards. As outras 23
// telas que leem `hercules_unidades` não sabiam de nada, e mostravam o valor da linha que
// calhasse. Lucas, 14/09/2026: *"não podemos ter duas interpretações e duas visões na mesma tela"*.
//
// ⚠️ ESTA LIB NÃO SUBSTITUI `situacaoDoLoteReal`. Aquela responde "o que o PÚBLICO vê", juntando
// processo (reserva, proposta) com cadastro, e continua sendo a régua do espelho. Esta responde uma
// pergunta menor e anterior: DE QUAL LINHA eu leio situação e preço. Quem precisa das duas usa as
// duas, nesta ordem.

/** O mínimo que uma linha precisa trazer para esta lib decidir. */
export type LinhaDeUnidade = {
  /** `null` na linha viva. Preenchido na linha ANTIGA, apontando para a viva. */
  espelho_de?: null | string;
  id: string;
};

/**
 * Esta linha é o registro antigo de um terreno que já vive em outro lugar?
 *
 * ⚠️ NÃO É O MESMO QUE "não vale". Ela vale como HISTÓRIA: é por ela que se chega às 331 propostas
 * lançadas antes da divisão, e é ela que o masterplan do pai desenha. O que ela não faz é responder
 * pela situação ou pelo preço de hoje.
 */
export function ehEspelho(linha: LinhaDeUnidade): boolean {
  return typeof linha.espelho_de === "string" && linha.espelho_de.length > 0;
}

/**
 * Só as linhas que respondem por si — o que se deve SOMAR, CONTAR e OFERECER.
 *
 * ⚠️ É ESTA A FUNÇÃO QUE IMPEDE A CONTAGEM DOBRADA. Somar a lista crua dá 4.560 unidades e
 * R$ 1,068 bi onde o certo é 4.262 e R$ 1,040 bi — a diferença é o espelho inteiro, medido em
 * 18/08/2026 na tela "todos os empreendimentos".
 *
 * ⚠️ E OS 83 SEM GÊMEO CONTINUAM AQUI, de propósito: são lotes da Lagoa Bonita que existem só no
 * pai, sem gleba nenhuma que os tenha assumido. Eles não são duplicata — são lote de verdade, e
 * escondê-los seria perder venda. `espelho_de` deles é nulo, então esta função os mantém.
 */
export function apenasVivas<T extends LinhaDeUnidade>(linhas: readonly T[]): T[] {
  return linhas.filter((l) => !ehEspelho(l));
}

/**
 * A linha que responde por este terreno, seguindo o ponteiro quando houver.
 *
 * ⚠️ UM SALTO, E NÃO UMA CAMINHADA. O ponteiro nasce apontando sempre para uma linha VIVA
 * (conferido na 0161: zero espelhos apontando para espelho), então um salto basta. Um laço aqui
 * daria a impressão de que a cadeia é permitida — e cadeia é exatamente o que não pode existir:
 * com ela, "qual é a situação deste lote" volta a depender de por onde se começou a perguntar.
 *
 * Devolve a PRÓPRIA linha quando ela já é viva, ou quando o alvo não veio no conjunto carregado —
 * responder com a linha errada seria pior do que responder com a que se tem.
 */
export function unidadeQueResponde<T extends LinhaDeUnidade>(
  linha: T,
  porId: Map<string, T> | ReadonlyMap<string, T>,
): T {
  if (!ehEspelho(linha)) return linha;
  return porId.get(linha.espelho_de as string) ?? linha;
}

/**
 * Resolve uma lista inteira: cada espelho vira a linha viva correspondente, sem repetir.
 *
 * ⚠️ SEM REPETIR É O PONTO. Se o espelho e a linha viva estiverem os dois no conjunto — que é o
 * caso sempre que alguém carrega o pai e os filhos juntos —, trocar um pelo outro devolveria a
 * mesma linha duas vezes, e a contagem dobrada voltaria por outro caminho.
 */
export function resolverUnidades<T extends LinhaDeUnidade>(linhas: readonly T[]): T[] {
  const porId = new Map(linhas.map((l) => [l.id, l]));
  const vistos = new Set<string>();
  const saida: T[] = [];

  for (const linha of linhas) {
    const viva = unidadeQueResponde(linha, porId);
    if (vistos.has(viva.id)) continue;
    vistos.add(viva.id);
    saida.push(viva);
  }

  return saida;
}

/** As colunas que qualquer `select` precisa trazer para esta lib funcionar. */
export const COLUNAS_DA_UNIDADE_VIVA = "id,espelho_de" as const;
