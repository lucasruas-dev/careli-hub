// O BEM E A PERMUTA RECEBIDOS NA AQUISIÇÃO — o carro, o lote, o apartamento que entram na conta.
//
// Lucas (22/09/2026), em resposta direta: *"Abate, como uma entrada"*; quantos cabem numa proposta,
// *"Vários"*; e se conta para a entrada mínima de 10%, *"pode ser um ou outro, pode apontar na
// entrada ou somente no valor negociado"*.
//
// ⚠️ POR QUE UM MÓDULO SÓ PARA ISTO, E NÃO O TIPO SOLTO EM `proposta.ts`. Quatro contas leem a
// mesma lista — `montarCronograma` (o PDF e o boleto), `conferirProposta` (a régua do servidor),
// `montarProposta`/`entradaParaAParcela` (a tela) e `composicoesQueFecham` (a busca por parcela) —
// e o módulo da régua importa o da conta, não o contrário. Com o tipo em `proposta.ts`,
// `cronograma.ts` e `simulacao.ts` passariam a importar a régua para somar dinheiro, e o import
// ficaria circular. Aqui não depende de ninguém, e por isso todo mundo pode depender.
//
// ⚠️ E A SOMA É UMA FUNÇÃO SÓ, PELO MESMO MOTIVO DE `anuaisQueAbatemOSaldo`. Cada chamador somando
// a lista do seu jeito é como a tela e o PDF voltam a anunciar dois financiados para a mesma venda
// — foi exatamente o que aconteceu com os reforços anuais (o cartão dizia R$ 180.000 e o papel do
// cliente, R$ 166.111,11).

/**
 * Quantos bens cabem numa proposta.
 *
 * ⚠️ O TETO EXISTE PORQUE ESTA LISTA VAI PARA O CONTRATO, E ELE É UM PAPEL. Lucas disse *"Vários"*
 * quando perguntado quantos cabem, e vários não é ilimitado: cada item vira uma linha do
 * Quadro-Resumo e uma oração da minuta, e um POST com mil itens montaria um PDF que ninguém
 * assina, dentro dos 60s de `maxDuration`. Dez cobre com folga o caso real (um carro e um lote) e
 * ainda deixa o negócio de quem traz uma carteira de imóveis passar. Se um dia faltar, o número
 * sobe aqui — mas o limite fica EXPLÍCITO, e não implícito no que o gateway aguenta.
 *
 * ⚠️ E ELE MORA AQUI, E NÃO NA ROTA, DESDE 23/09/2026. A TELA precisa do mesmo número para apagar
 * o botão "Acrescentar" no décimo item: enquanto o teto foi só do servidor, o único jeito de
 * descobri-lo era acrescentar o décimo primeiro, clicar em Gerar e receber um 422 com uma lista já
 * digitada para desmanchar à mão. Régua de recusa é uma só, pelo mesmo motivo de `valeDinheiro`.
 */
export const TETO_DE_BENS_NA_PROPOSTA = 10;

/** Quanto texto cabe na descrição de um bem. O bastante para "lote 12 da quadra 4, matrícula X". */
export const TAMANHO_MAXIMO_DA_DESCRICAO = 300;

/** Um bem ou uma permuta recebido na aquisição da unidade. */
export type BemOuPermuta = {
  /** O que é o bem, em texto livre: "Ford Ka 2019 placa ABC1D23", "lote 12 da quadra 4 em Anápolis". */
  descricao: string;
  /**
   * Onde o valor entra na conta.
   * "entrada"     — conta como entrada e CUMPRE a entrada mínima.
   * "abatimento"  — reduz o saldo a financiar mas NÃO cumpre a entrada mínima.
   */
  entraComo: "abatimento" | "entrada";
  tipo: "bem" | "permuta";
  /** Em reais. */
  valor: number;
};

/**
 * Só o que é dinheiro de verdade.
 *
 * ⚠️ VALOR QUE NÃO É NÚMERO POSITIVO NÃO SOMA. A lista chega de um formulário que está sendo
 * preenchido: uma linha recém-adicionada tem `valor` vazio (`NaN` depois do `Number`), e somá-la
 * levaria `NaN` para o financiado — e `NaN < 0` é falso, então a trava de composição que não fecha
 * deixaria passar um cronograma inteiro de parcelas `NaN`.
 *
 * ⚠️ ELA É EXPORTADA PORQUE QUEM IMPRIME TAMBÉM PRECISA DELA. O quadro do contrato
 * (`lib/temis/tabela-de-pagamentos.ts`) e a folha da proposta (`proposta-para-pdf.ts`) decidem quais
 * itens viram LINHA, e a linha tem de ser exatamente o que esta soma conta. Enquanto o quadro teve
 * a sua própria cópia — que coagia com `Number(bem.valor)` —, a lista `[{ valor: "80000" }]`
 * imprimia um total de R$ 2.000.080.000.100.000,00 embaixo de uma cláusula que dizia R$ 0,00
 * (medido em 22/09/2026). Régua de dinheiro é uma só, pelo mesmo motivo de `somarBensEPermutas`.
 *
 * ⚠️ E NÃO COAGE DE PROPÓSITO. `valor` é `number` no contrato do tipo: quem grava normaliza (a rota
 * faz `Number` antes do upsert). Aceitar texto aqui seria aceitar que ele chegue torto lá.
 */
export const valeDinheiro = (bem: BemOuPermuta): boolean =>
  Number.isFinite(bem.valor) && bem.valor > 0;

/** Centavos inteiros: é nesta moeda que dinheiro se soma sem susto de ponto flutuante. */
const emReais = (valor: number): number => Math.round(valor * 100) / 100;

/**
 * Quanto os bens e permutas abatem do valor a financiar — PELO VALOR CHEIO, os dois `entraComo`.
 *
 * ⚠️ ELES NÃO PASSAM POR `anuaisQueAbatemOSaldo`. Aquele critério de valor presente é do reforço
 * ANUAL, que vence lá na frente (o balão do terceiro aniversário vale hoje menos que a face); o bem
 * é entregue no ato da aquisição, e o que é entregue hoje vale hoje o que vale. Descontá-lo a valor
 * presente tiraria do comprador uma parte do carro que ele já deu.
 *
 * ⚠️ E O `entraComo` NÃO MUDA ESTE NÚMERO. Lucas (22/09/2026): *"Abate, como uma entrada"* — os
 * dois modos abatem igual. O que "abatimento" não faz é CUMPRIR a entrada mínima, e isso é a outra
 * função deste arquivo.
 */
export function somarBensEPermutas(
  bens: null | readonly BemOuPermuta[] | undefined,
): number {
  if (!bens || bens.length === 0) return 0;
  return emReais(
    bens.reduce((total, bem) => (valeDinheiro(bem) ? total + bem.valor : total), 0),
  );
}

/**
 * Quanto dos bens e permutas CUMPRE a entrada mínima — só os `entraComo: "entrada"`.
 *
 * ⚠️ É UM CAMPO POR ITEM, E NÃO UMA REGRA FIXA DA CASA (Lucas, 22/09/2026, perguntado se a permuta
 * conta para a entrada mínima de 10%: *"pode ser um ou outro, pode apontar na entrada ou somente no
 * valor negociado"*). Fixar a regra num lado só tiraria do comercial a escolha que ele acabou de
 * pedir: com "sempre conta", o piso de 10% vira letra morta em toda venda com permuta grande; com
 * "nunca conta", o cliente que entrega um carro de R$ 80.000 num lote de R$ 200.000 ainda precisa
 * pôr R$ 20.000 em espécie.
 */
export function somarBensQueContamNaEntrada(
  bens: null | readonly BemOuPermuta[] | undefined,
): number {
  if (!bens || bens.length === 0) return 0;
  return emReais(
    bens.reduce(
      (total, bem) =>
        bem.entraComo === "entrada" && valeDinheiro(bem) ? total + bem.valor : total,
      0,
    ),
  );
}

const TIPOS_DE_BEM = ["bem", "permuta"] as const;
const ENTRADAS_DO_BEM = ["abatimento", "entrada"] as const;

/**
 * A lista de bens e permutas que veio no corpo de uma requisição, conferida item a item.
 *
 * ⚠️ ESTA FUNÇÃO MORAVA NA ROTA DA PROPOSTA E MUDOU DE CASA EM 23/09/2026, quando o ESPELHO
 * PÚBLICO passou a aceitar permuta (Lucas: *"permuta tem que entrar, não entendi sua colocação"*).
 * São duas rotas conferindo a mesma lista: a da venda, com login, e a de `/e/<apelido>-<selo>`, que
 * não tem nenhum. Deixar cada uma com a sua cópia é exatamente como o quadro do contrato ganhou uma
 * soma própria e imprimiu R$ 2.000.080.000.100.000,00 embaixo de uma cláusula que dizia R$ 0,00
 * (medido em 22/09/2026). Régua de recusa é uma só, pelo mesmo motivo de `valeDinheiro`.
 *
 * ⚠️ AUSENTE É LISTA VAZIA, E NÃO ERRO. Nenhum cliente de hoje manda este campo — nem a tela em
 * cache do navegador, nem a chamada antiga. Recusá-los pararia toda venda por causa de um campo
 * que eles não sabem existir, que é a mesma regra que o prazo da proposta já segue.
 *
 * ⚠️ MAS VALOR VAZIO É ERRO, NUNCA ZERO. `Number("")` é 0, e nesta casa isso já transformou
 * cobrança sem valor em R$ 0,00 emitido. Um campo que o coordenador não preencheu não pode virar
 * "permuta de zero reais" gravada e impressa no contrato como se tivesse sido combinada — por isso
 * o valor só passa vindo de número ou de texto que vira número FINITO e MAIOR QUE ZERO, e `null`,
 * `undefined`, `""`, `{}` e `[]` caem todos no mesmo erro.
 *
 * ⚠️ E O QUE VEM A MAIS NO ITEM É DESCARTADO. A lista é gravada em jsonb, que não tem schema para
 * barrar nada depois, e é dela que a Têmis vai imprimir o contrato: um `id` de rascunho ou um
 * `valorFipe` de outra aba que a tela mandasse por engano chegaria à minuta sem ninguém conferir.
 * O objeto devolvido é montado campo a campo, e não copiado.
 */
export function conferirBensEPermutasDoCorpo(valor: unknown): {
  erros: Array<{ campo: string; mensagem: string }>;
  lista: BemOuPermuta[];
} {
  const erros: Array<{ campo: string; mensagem: string }> = [];
  const lista: BemOuPermuta[] = [];
  if (valor === null || valor === undefined) return { erros, lista };

  if (!Array.isArray(valor)) {
    erros.push({
      campo: "bensEPermutas",
      mensagem: "Os bens e permutas têm que vir em uma lista.",
    });
    return { erros, lista };
  }
  if (valor.length > TETO_DE_BENS_NA_PROPOSTA) {
    // ⚠️ A FRASE NÃO DIZ "PROPOSTA" (23/09/2026). Ela agora também é lida no espelho público, numa
    // página que passa a folha inteira insistindo que aquilo NÃO é proposta — e o rodapé que dizia
    // "as condições que vão para a proposta" ali foi defeito corrigido nesta mesma rodada.
    erros.push({
      campo: "bensEPermutas",
      mensagem: `Cabem no máximo ${TETO_DE_BENS_NA_PROPOSTA} bens ou permutas.`,
    });
    return { erros, lista };
  }

  valor.forEach((bruto, i) => {
    // ⚠️ O `campo` É O CAMINHO NO JSON (base zero), e é por ele que a tela acha o input para
    // marcar de vermelho; a frase fala em "posição 1" porque quem lê conta a partir de um.
    const caminho = `bensEPermutas[${i}]`;
    const posicao = i + 1;
    const errosAntesDoItem = erros.length;
    if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) {
      erros.push({
        campo: caminho,
        mensagem: `O bem ou permuta na posição ${posicao} não foi entendido.`,
      });
      return;
    }
    const item = bruto as Record<string, unknown>;

    const descricao =
      typeof item.descricao === "string" ? item.descricao.trim() : "";
    if (!descricao) {
      erros.push({
        campo: `${caminho}.descricao`,
        mensagem: `Descreva o bem ou permuta na posição ${posicao}.`,
      });
    } else if (descricao.length > TAMANHO_MAXIMO_DA_DESCRICAO) {
      // ⚠️ RECUSA, E NÃO CORTE. Cortar em silêncio mandaria para o contrato uma descrição pela
      // metade — "lote 12 da quadra 4 em Anápolis, matríc" — com ar de texto conferido.
      erros.push({
        campo: `${caminho}.descricao`,
        mensagem: `A descrição do bem ou permuta na posição ${posicao} passa de ${TAMANHO_MAXIMO_DA_DESCRICAO} caracteres.`,
      });
    }

    const tipo = typeof item.tipo === "string" ? item.tipo.trim() : "";
    if (!(TIPOS_DE_BEM as readonly string[]).includes(tipo)) {
      erros.push({
        campo: `${caminho}.tipo`,
        mensagem: `O tipo do item na posição ${posicao} tem que ser "bem" ou "permuta".`,
      });
    }

    const entraComo =
      typeof item.entraComo === "string" ? item.entraComo.trim() : "";
    if (!(ENTRADAS_DO_BEM as readonly string[]).includes(entraComo)) {
      erros.push({
        campo: `${caminho}.entraComo`,
        mensagem: `Diga se o bem ou permuta na posição ${posicao} entra como "entrada" (cumpre a entrada mínima) ou como "abatimento" (só reduz o saldo).`,
      });
    }

    // ⚠️ SÓ NÚMERO OU TEXTO CHEGAM ATÉ O `Number`, e é o que barra o resto: `Number([])` é 0,
    // `Number([5])` é 5 e `Number(true)` é 1 — três jeitos de um corpo malformado virar valor de
    // permuta sem ninguém digitar número nenhum.
    const valorBruto = item.valor;
    const numero =
      (typeof valorBruto === "number" || typeof valorBruto === "string") &&
      String(valorBruto).trim() !== ""
        ? Number(valorBruto)
        : Number.NaN;
    if (!Number.isFinite(numero) || numero <= 0) {
      erros.push({
        campo: `${caminho}.valor`,
        mensagem: `Informe o valor do bem ou permuta na posição ${posicao}, em reais e maior que zero.`,
      });
    }

    // Item com qualquer campo recusado não entra na lista — e a lista inteira é descartada
    // abaixo, porque meia proposta gravada é pior do que proposta nenhuma.
    if (erros.length > errosAntesDoItem) return;
    lista.push({
      descricao,
      entraComo: entraComo as BemOuPermuta["entraComo"],
      tipo: tipo as BemOuPermuta["tipo"],
      valor: numero,
    });
  });

  return { erros, lista: erros.length > 0 ? [] : lista };
}
