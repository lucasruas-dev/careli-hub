// A ORDEM DA TABELA DE EMPREENDIMENTOS.
//
// Lucas (07/09/2026): *"o botão de ordenar nessa tabela, e sempre inicia com ordem alfabética"*.
//
// ⚠️ A TABELA VINHA ORDENADA POR TAMANHO, e ninguém tinha escolhido isso. A ordem era a que o SQL
// devolvia — unidades decrescente —, então o Cidade Jardim ficava sempre em cima por ter 532 lotes
// e o Jardim das Gerais aparecia na décima linha. Para quem PROCURA um empreendimento pelo nome,
// tamanho é a ordem menos útil que existe: obriga a varrer a lista inteira sempre.
//
// ⚠️ E A ORDEM É DO CLIENTE, e não do banco. São 38 linhas na tela toda; reordenar aqui é imediato
// e não gasta uma ida ao servidor a cada clique de cabeçalho.

/** As colunas por onde dá para ordenar. `nome` é a inicial. */
export type ColunaDaOrdem =
  | "bloqueado"
  | "disponivel"
  | "negociacao"
  | "nome"
  | "reservado"
  | "unidades"
  | "vendido"
  | "vgv";

export type Direcao = "asc" | "desc";

export type Ordem = { coluna: ColunaDaOrdem; direcao: Direcao };

/**
 * ⚠️ A ORDEM INICIAL É O NOME, EM ORDEM ALFABÉTICA — é o pedido, e é o que serve a quem procura.
 * Os números só respondem "quem é o maior", uma pergunta que se faz de vez em quando; o nome
 * responde "onde está o meu", que é a de todo dia.
 */
export const ORDEM_INICIAL: Ordem = { coluna: "nome", direcao: "asc" };

/**
 * O clique num cabeçalho.
 *
 * ⚠️ COLUNA NOVA COMEÇA NO SENTIDO ÚTIL DELA, e não sempre em crescente. Clicar em "Vendido"
 * querendo ver quem vendeu MENOS é raro; querendo ver quem vendeu MAIS é o caso comum. Já o nome
 * começa em A→Z, porque lista alfabética de trás para frente não ajuda ninguém. Clicar de novo na
 * MESMA coluna inverte — aí a intenção é explícita.
 */
export function aoClicarNaColuna(atual: Ordem, coluna: ColunaDaOrdem): Ordem {
  if (atual.coluna === coluna) {
    return { coluna, direcao: atual.direcao === "asc" ? "desc" : "asc" };
  }
  return { coluna, direcao: coluna === "nome" ? "asc" : "desc" };
}

/** O que a tabela precisa de cada linha para ser ordenada. */
export type LinhaOrdenavel = {
  name: string;
  scenario: {
    bloqueado: { units: number };
    disponivel: { units: number };
    negociacao: { units: number };
    reservado: { units: number };
    total: { units: number; value: number };
    vendido: { units: number };
  };
};

function valorDaColuna(linha: LinhaOrdenavel, coluna: ColunaDaOrdem): number {
  switch (coluna) {
    case "bloqueado":
      return linha.scenario.bloqueado.units;
    case "disponivel":
      return linha.scenario.disponivel.units;
    case "negociacao":
      return linha.scenario.negociacao.units;
    case "reservado":
      return linha.scenario.reservado.units;
    case "unidades":
      return linha.scenario.total.units;
    case "vendido":
      return linha.scenario.vendido.units;
    case "vgv":
      return linha.scenario.total.value;
    default:
      return 0;
  }
}

/**
 * A lista ordenada.
 *
 * ⚠️ O NOME É O DESEMPATE DE TODA ORDENAÇÃO NUMÉRICA. Sem ele, empreendimentos com o mesmo número
 * — e há muitos com zero reservado — trocam de lugar entre uma renderização e outra, porque `sort`
 * não promete estabilidade para valores iguais em toda implementação. A tabela ficaria "pulando"
 * debaixo do olho de quem está lendo.
 *
 * ⚠️ E A COMPARAÇÃO DE NOME USA `localeCompare` COM `pt-BR`: sem isso "Área" cai depois de "Zona",
 * porque a ordem de bytes põe o acento no fim do alfabeto.
 */
export function ordenarEmpreendimentos<T extends LinhaOrdenavel>(linhas: T[], ordem: Ordem): T[] {
  const sinal = ordem.direcao === "asc" ? 1 : -1;

  return [...linhas].sort((a, b) => {
    if (ordem.coluna === "nome") {
      return sinal * a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
    }

    const diferenca = valorDaColuna(a, ordem.coluna) - valorDaColuna(b, ordem.coluna);
    if (diferenca !== 0) return sinal * diferenca;

    return a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" });
  });
}
