// A PREMISSA QUE O PRAZO MANDA — juros, índice e entrada vindos do cadastro do empreendimento.
//
// Lucas (13/09/2026): *"em vez de cadastrar os juros e correção dentro de um plano, ter um cadastro
// de juros e correção separado por parcelas (...) quando eu montar o plano e falar que aquele plano
// é de x parcelas, automaticamente buscar esses valores correspondente ao número de parcelas daquele
// plano"*, e logo depois *"acho que podemos também colocar a % da entrada nesse comportamento"*.
//
// ⚠️ POR QUE ESTE ARQUIVO NÃO É `faixa-do-plano.ts`, que já existe e parece a mesma coisa. Aquele
// deriva a faixa DOS PLANOS ("o plano de menor prazo que ainda comporta o parcelamento") e só sabe
// responder sobre ENTRADA MÍNIMA — ele é uma régua de VALIDAÇÃO, escrita em 05/09/2026 para
// impedir que 30 parcelas passassem com entrada de plano de 120. Este aqui lê um CADASTRO e
// responde a premissa INTEIRA, para PREENCHER o formulário. Um valida o que a pessoa fez; o outro
// diz o que ela deveria fazer. Juntá-los faria a validação depender de um cadastro que pode estar
// vazio, e aí um empreendimento sem faixa cadastrada perderia a régua de entrada mínima que hoje
// funciona sozinha.
//
// ⚠️ FAIXA DE PRAZO, NUNCA "FAIXA DE PARCELAS". A tela do simulador já tem um painel chamado
// "Reajuste da parcela" que fala em "parcelas 1 a 12", "13 a 24" — e aquelas são faixas DENTRO do
// mesmo contrato (os degraus anuais do SACOC). Aqui, "1 a 12" quer dizer "planos de 1 a 12
// parcelas". As duas coisas usariam as mesmas palavras para significados opostos, e é assim que se
// constrói o sistema errado.

/** Uma linha de `temis_faixas_de_prazo`, como a tela e a rota a leem. */
export type FaixaDePrazo = {
  /** A faixa manda na entrada? Ver o cabeçalho de `premissaDoPrazo`. */
  defineEntrada: boolean;
  defineIndice: boolean;
  defineJuros: boolean;
  entradaPercentual: null | number;
  indiceCorrecao: null | string;
  jurosConvencao: string;
  jurosPeriodicidade: string;
  jurosTaxa: null | number;
  /** Inclusivo. Um plano de 12 parcelas cabe numa faixa de 1 a 12. */
  parcelaMaxima: number;
  parcelaMinima: number;
};

/** O que a faixa manda, já separado do que ela não opina. */
export type PremissaEncontrada = {
  entradaPercentual: null | number;
  faixa: FaixaDePrazo;
  indiceCorrecao: null | string;
  jurosConvencao: null | string;
  jurosPeriodicidade: null | string;
  jurosTaxa: null | number;
};

/**
 * A faixa que vale para um plano deste tamanho.
 *
 * ⚠️ O CRITÉRIO É CONTER, e não "a mais próxima". Um plano de 40 parcelas cai na faixa que vai de
 * 37 a 48 porque ela o CONTÉM. Se nenhuma contém, a resposta é `null` e NADA é preenchido — o
 * palpite mais próximo seria pior que o silêncio, porque preencheria juros de uma faixa que o
 * comercial não escreveu para aquele prazo.
 *
 * ⚠️ O BANCO JÁ IMPEDE SOBREPOSIÇÃO (a `exclude` da migration 0155), então no máximo uma faixa
 * contém cada prazo. Esta função não depende disso: ela pega a de menor `parcelaMinima` entre as
 * que contêm, para o resultado ser o mesmo em qualquer ordem de leitura. Sem isso, um dado
 * inconsistente chegado por outro caminho faria a mesma tela mostrar juros diferentes entre dois
 * cliques iguais.
 */
export function premissaDoPrazo(
  faixas: readonly FaixaDePrazo[],
  parcelas: number,
): null | PremissaEncontrada {
  if (!Number.isFinite(parcelas) || parcelas < 1) return null;

  const contem = faixas
    .filter((f) => parcelas >= f.parcelaMinima && parcelas <= f.parcelaMaxima)
    .sort((a, b) => a.parcelaMinima - b.parcelaMinima);

  const faixa = contem[0];
  if (!faixa) return null;

  return {
    // ⚠️ `defineX` SEPARA "SEM JUROS" DE "NÃO OPINO", e confundir os dois zera contrato. No plano,
    // `jurosTaxa: null` quer dizer SEM JUROS — é o caso do INVESTIDOR e do CURTO em quase todos os
    // empreendimentos. Se a faixa usasse o mesmo nulo para dizer "não falo de juros", uma faixa
    // sem opinião ZERARIA os juros do plano que ela governa, e o erro sairia no papel do cliente
    // como desconto que ninguém deu.
    entradaPercentual: faixa.defineEntrada ? faixa.entradaPercentual : null,
    faixa,
    indiceCorrecao: faixa.defineIndice ? faixa.indiceCorrecao : null,
    jurosConvencao: faixa.defineJuros ? faixa.jurosConvencao : null,
    jurosPeriodicidade: faixa.defineJuros ? faixa.jurosPeriodicidade : null,
    jurosTaxa: faixa.defineJuros ? faixa.jurosTaxa : null,
  };
}

/** O que mudou entre o que estava na tela e o que a faixa manda. Vazio = nada a fazer. */
export type MudancaDaPremissa = {
  campo: "entrada" | "indice" | "juros";
  de: null | number | string;
  para: null | number | string;
};

/**
 * O que a faixa muda num plano que já está na tela.
 *
 * ⚠️ ISTO EXISTE PARA A TELA PODER CONTAR O QUE FEZ. Lucas (13/09/2026), sobre o prazo mudar e a
 * premissa ir junto: *"deve atualizar sozinho"*. Atualizar sozinho sem dizer o que mudou é o que
 * faz o operador desconfiar da tela — ele digita 40, o juro muda, e ele não sabe se foi ele. A
 * lista devolvida é o que a tela escreve em cima dos campos que se mexeram.
 *
 * ⚠️ E É ELA QUE ALIMENTA A NOTA, no dia em que o corretor SOBRESCREVER a premissa: o Lucas pediu
 * que alterar abrisse a caixa de nota, e uma nota sem o de/para não explica nada seis meses depois.
 */
export function mudancasDaPremissa(
  atual: {
    entradaPercentual: null | number;
    indiceCorrecao: null | string;
    jurosTaxa: null | number;
  },
  premissa: null | PremissaEncontrada,
): MudancaDaPremissa[] {
  if (!premissa) return [];

  const mudancas: MudancaDaPremissa[] = [];

  // ⚠️ COMPARAÇÃO NUMÉRICA, e não de identidade: 10 e 10.000 são a mesma entrada, e `!==` entre
  // eles acusaria mudança a cada recarga, piscando aviso na cara de quem não mexeu em nada.
  const mesmoNumero = (a: null | number, b: null | number) =>
    a == null && b == null
      ? true
      : a != null && b != null && Math.abs(a - b) < 0.00005;

  if (
    premissa.entradaPercentual != null &&
    !mesmoNumero(atual.entradaPercentual, premissa.entradaPercentual)
  ) {
    mudancas.push({
      campo: "entrada",
      de: atual.entradaPercentual,
      para: premissa.entradaPercentual,
    });
  }

  if (
    premissa.faixa.defineJuros &&
    !mesmoNumero(atual.jurosTaxa, premissa.jurosTaxa)
  ) {
    mudancas.push({
      campo: "juros",
      de: atual.jurosTaxa,
      para: premissa.jurosTaxa,
    });
  }

  if (
    premissa.indiceCorrecao != null &&
    atual.indiceCorrecao !== premissa.indiceCorrecao
  ) {
    mudancas.push({
      campo: "indice",
      de: atual.indiceCorrecao,
      para: premissa.indiceCorrecao,
    });
  }

  return mudancas;
}

/**
 * O plano com a premissa da faixa aplicada por cima.
 *
 * ⚠️ ESTA É A ÚNICA PORTA. Ela troca o OBJETO que entra nas contas — `taxaMensal`, `parcelaPrice`,
 * `montarCronograma` — e não reescreve conta nenhuma. É o que impede o defeito histórico desta
 * casa: em 04/09/2026 a mesma modal anunciava R$ 2.157,44 no cartão e R$ 1.500,00 no PDF porque a
 * conta tinha sido reescrita num lugar só. Enquanto a faixa entrar por aqui, tela, PDF e contrato
 * recebem o mesmo plano.
 *
 * ⚠️ SEM FAIXA, DEVOLVE O MESMO OBJETO. Não uma cópia: o mesmo, por identidade. É o que garante que
 * um empreendimento sem faixa cadastrada não tenha nem um `useMemo` recalculando à toa, e que a
 * entrega possa subir com a tabela vazia sem mudar comportamento nenhum.
 */
export function aplicarPremissa<
  T extends {
    entradaPercentual: number;
    indiceCorrecao: string;
    jurosConvencao: string;
    jurosPeriodicidade: string;
    jurosTaxa: null | number;
  },
>(plano: T | undefined, premissa: null | PremissaEncontrada): T | undefined {
  if (!plano || !premissa) return plano;

  return {
    ...plano,
    entradaPercentual:
      premissa.entradaPercentual != null
        ? premissa.entradaPercentual
        : plano.entradaPercentual,
    indiceCorrecao: premissa.indiceCorrecao ?? plano.indiceCorrecao,
    // ⚠️ A CONVENÇÃO VIAJA COM A TAXA, sempre. "0,5% ao mês" significa coisas diferentes em
    // equivalente e em proporcional, e a diferença chega a ~1% por parcela num plano de 120. Trocar
    // a taxa e deixar a convenção do plano antigo produziria um número que não é nem o da faixa nem
    // o do plano.
    jurosConvencao: premissa.jurosConvencao ?? plano.jurosConvencao,
    jurosPeriodicidade: premissa.jurosPeriodicidade ?? plano.jurosPeriodicidade,
    // ⚠️ AQUI O NULO É VALOR, E NÃO AUSÊNCIA: faixa com `defineJuros` e taxa nula quer dizer SEM
    // JUROS, e tem que zerar o plano. Por isso a pergunta é `defineJuros`, e não `jurosTaxa != null`
    // — a segunda forma faria a faixa "1 a 12 sem juros" do exemplo do Lucas não funcionar nunca.
    jurosTaxa: premissa.faixa.defineJuros
      ? premissa.jurosTaxa
      : plano.jurosTaxa,
  };
}
