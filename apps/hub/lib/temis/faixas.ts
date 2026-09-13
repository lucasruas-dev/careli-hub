// A CONFERÊNCIA DA FAIXA DE PRAZO — o que o servidor recusa antes de gravar.
//
// ⚠️ ELA NÃO SUBSTITUI O BANCO, ELA O ANTECIPA. As travas de verdade estão na migration 0155
// (os CHECKs e a `exclude` de sobreposição), porque validação de aplicação não resolve corrida
// entre duas abas abertas. O que esta função compra é a FRASE: o operador lê "a entrada tem que
// estar entre 0 e 100" em vez de uma violação de constraint com nome de constraint.
//
// ⚠️ E A SOBREPOSIÇÃO NÃO É CONFERIDA AQUI DE PROPÓSITO. Para saber se 13–36 colide com alguma
// outra, é preciso ler as faixas vizinhas — e entre a leitura e a gravação cabe outra aba
// gravando. Quem decide é a `exclude` do banco; a rota traduz o `23P01`.

export type EntradaDeFaixa = {
  defineEntrada: boolean;
  defineIndice: boolean;
  defineJuros: boolean;
  entradaPercentual: null | number;
  indiceCorrecao: null | string;
  jurosConvencao: string;
  jurosPeriodicidade: string;
  jurosTaxa: null | number;
  observacao: null | string;
  parcelaMaxima: number;
  parcelaMinima: number;
};

const PERIODICIDADES = new Set(["anual", "mensal"]);
const CONVENCOES = new Set(["equivalente", "proporcional"]);

/** Os problemas, todos de uma vez — o operador corrige tudo num gesto só. */
export function conferirFaixa(entrada: EntradaDeFaixa): string[] {
  const problemas: string[] = [];

  const min = Number(entrada.parcelaMinima);
  const max = Number(entrada.parcelaMaxima);

  if (!Number.isInteger(min) || min < 1) {
    problemas.push(
      "A primeira parcela da faixa tem que ser um número inteiro a partir de 1.",
    );
  }
  if (!Number.isInteger(max) || max < 1) {
    problemas.push(
      "A última parcela da faixa tem que ser um número inteiro a partir de 1.",
    );
  }
  if (Number.isInteger(min) && Number.isInteger(max) && max < min) {
    problemas.push(
      "A última parcela da faixa não pode ser menor que a primeira.",
    );
  }

  if (entrada.defineEntrada) {
    const pct = entrada.entradaPercentual;
    if (pct == null || !Number.isFinite(pct) || pct < 0 || pct > 100) {
      // ⚠️ A ARMADILHA DA FRAÇÃO: 0,1 aqui significa um DÉCIMO DE PONTO PERCENTUAL, não 10%. É o
      // mesmo erro que o CHECK de `temis_planos` existe para impedir desde a 0111.
      problemas.push(
        "A entrada da faixa tem que ser um percentual entre 0 e 100.",
      );
    }
  }

  if (entrada.defineJuros) {
    const taxa = entrada.jurosTaxa;
    // Nulo é VÁLIDO e quer dizer SEM JUROS — é a faixa "1 a 12" do exemplo do Lucas.
    if (taxa != null && (!Number.isFinite(taxa) || taxa < 0)) {
      problemas.push("Os juros da faixa não podem ser negativos.");
    }
    if (!PERIODICIDADES.has(entrada.jurosPeriodicidade)) {
      problemas.push("A periodicidade dos juros tem que ser mensal ou anual.");
    }
    if (!CONVENCOES.has(entrada.jurosConvencao)) {
      problemas.push(
        "A convenção dos juros tem que ser equivalente ou proporcional.",
      );
    }
  }

  if (entrada.defineIndice && !String(entrada.indiceCorrecao ?? "").trim()) {
    // ⚠️ "Não corrige" NÃO é ausência de índice: é o código SEM_CORRECAO, que é linha da tabela.
    // Deixar em branco aqui gravaria uma faixa que diz mandar no índice e não diz qual.
    problemas.push(
      "Escolha o índice da faixa — 'sem correção' também é uma escolha.",
    );
  }

  return problemas;
}
