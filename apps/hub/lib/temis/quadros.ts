// OS QUADROS DA TÊMIS — um por serviço, mais o "Todos" que resume a operação.
//
// Lucas, 21/09/2026: *"vamos agrupar kanbans com o fluxo igual, cancelamento e distrato, kanbans
// para contrato novo, cessão de direitos, termos aditivos, correção de fluxo"*, e depois, corrigindo
// o meu entendimento: *"é para seguir o que a gente já desenhou. Por exemplo, contrato novo tem
// toda essa sessões (...) Já o cancelado e o distrato não precisa do faturado. (...) a única
// alteração é que quando abrir essa parte do board da Têmis, a gente vai ter um todos e nesse todos
// a gente terá três sessões somente. Que é novo em andamento e finalizado só para a gente ter um
// overview geral da operação"*.
//
// ⚠️ AS TRÊS SEÇÕES NÃO SUBSTITUEM OS FLUXOS: elas são uma leitura POR CIMA. Cada quadro de serviço
// continua com o caminho que já tem, e o estágio gravado no card não muda. O "Todos" só traduz.
//
// ⚠️ CANCELAMENTO E DISTRATO NO MESMO QUADRO porque o serviço é o mesmo: desfazer a venda. O que os
// separa é se já assinou e se já pagou (`classificarCancelamento`), e isso muda uma coluna, não o
// trabalho. O quadro mostra a união dos dois caminhos, e o cancelamento simplesmente não aparece na
// coluna de assinatura, que ele pula (`EXIGE_ASSINATURA`).
//
// ⚠️ INDEFERIDO É COLUNA, E ISSO CONSERTA UM SUMIÇO. Medido em 21/09/2026: o quadro desenhava só as
// cinco entradas de `ESTAGIOS`, e `indeferido` não é uma delas — os 4 cards indeferidos (2 de
// contrato e 2 de cancelamento) eram carregados pelo servidor e descartados no desenho. Só abriam
// por link direto.

import {
  type EstagioDoTrabalho,
  ESTAGIOS,
  estagiosDoTipo,
  nomeDoEstagio,
  type TipoDeTrabalho,
} from "./trabalhos";

/** Um quadro do board: o que ele mostra e de quais tipos. */
export type QuadroDaTemis = {
  /** Vazio = o resumo, com todos os tipos. */
  id: string;
  nome: string;
  tipos: readonly TipoDeTrabalho[];
};

/** Uma coluna desenhada, já com o nome que a operação lê. */
export type ColunaDoQuadro = {
  descricao: string;
  /** O estágio (ou o balde, no resumo) que cai nesta coluna. */
  id: string;
  nome: string;
};

export const QUADRO_RESUMO = "todos" as const;

/**
 * Os quadros, na ordem em que aparecem.
 *
 * ⚠️ "TERMO ADITIVO" AINDA NÃO EXISTE como tipo de trabalho (o banco só aceita contrato, cessao,
 * distrato, cancelamento e cancelamento_correcao, por CHECK). Ele entra aqui no dia em que nascer,
 * com uma migration para o vocabulário; inventar o quadro antes só criaria uma aba sempre vazia.
 */
export const QUADROS: readonly QuadroDaTemis[] = [
  { id: QUADRO_RESUMO, nome: "Todos", tipos: [] },
  { id: "contrato", nome: "Contrato novo", tipos: ["contrato"] },
  { id: "desfazer", nome: "Cancelamento e distrato", tipos: ["cancelamento", "distrato"] },
  { id: "cessao", nome: "Cessão de direitos", tipos: ["cessao"] },
  { id: "correcao", nome: "Correção de fluxo", tipos: ["cancelamento_correcao"] },
];

/** Os três baldes do resumo. */
export type BaldeDoResumo = "andamento" | "finalizado" | "novo";

export const COLUNAS_DO_RESUMO: readonly ColunaDoQuadro[] = [
  { descricao: "Chegou e ninguém pegou.", id: "novo", nome: "Novo" },
  { descricao: "Alguém está tocando.", id: "andamento", nome: "Em andamento" },
  { descricao: "Acabou, com serviço feito ou indeferido.", id: "finalizado", nome: "Finalizado" },
];

/**
 * Em qual das três seções o card cai.
 *
 * ⚠️ INDEFERIDO É FINALIZADO, E NÃO SOME. Ele acabou sem fazer o serviço, mas acabou — e tirá-lo do
 * resumo esconderia da operação um pedido que alguém ainda vai cobrar. A etiqueta do card continua
 * dizendo que foi indeferido.
 */
export function baldeDoEstagio(estagio: EstagioDoTrabalho): BaldeDoResumo {
  if (estagio === "analise") return "novo";
  if (estagio === "faturado" || estagio === "indeferido") return "finalizado";
  return "andamento";
}

/** O quadro de um tipo de trabalho. O resumo não conta: ele mostra todos. */
export function quadroDoTipo(tipo: TipoDeTrabalho): string {
  return QUADROS.find((q) => q.id !== QUADRO_RESUMO && q.tipos.includes(tipo))?.id ?? QUADRO_RESUMO;
}

/** O quadro pelo id, ou o resumo quando o id não existe (link velho, aba removida). */
export function acharQuadro(id: null | string | undefined): QuadroDaTemis {
  const alvo = String(id ?? "").trim();
  return QUADROS.find((q) => q.id === alvo) ?? QUADROS[0]!;
}

/**
 * As colunas de um quadro.
 *
 * ⚠️ A UNIÃO DOS CAMINHOS, NA ORDEM CANÔNICA. Com dois tipos no mesmo quadro (cancelamento e
 * distrato), a coluna de assinatura existe porque o distrato passa por ela; o cancelamento, que
 * pula, simplesmente nunca tem card ali. Ordenar por `ESTAGIOS` evita que a ordem dependa de qual
 * tipo foi lido primeiro.
 *
 * ⚠️ O NOME SAI DE `nomeDoEstagio`, que já existia e o quadro não usava. É por isso que a operação
 * via "Faturado" num cancelamento: a palavra certa ("Concluído") estava escrita no código desde o
 * início, e a tela imprimia o nome cru da coluna.
 */
export function colunasDoQuadro(quadro: QuadroDaTemis): ColunaDoQuadro[] {
  if (quadro.tipos.length === 0) return [...COLUNAS_DO_RESUMO];

  const doCaminho = new Set<EstagioDoTrabalho>();
  for (const tipo of quadro.tipos) for (const e of estagiosDoTipo(tipo)) doCaminho.add(e);

  // O primeiro tipo manda no vocabulário: num quadro de um serviço só, é o dele; no de desfazer a
  // venda, cancelamento e distrato escrevem a última coluna igual ("Concluído").
  const vocabulario = quadro.tipos[0]!;

  const colunas = ESTAGIOS.filter((e) => doCaminho.has(e.id)).map((e) => ({
    descricao: e.descricao,
    id: e.id,
    nome: nomeDoEstagio(e.id, vocabulario),
  }));

  colunas.push({
    descricao: "Recusado na análise, sem seguir adiante.",
    id: "indeferido",
    nome: "Indeferido",
  });

  return colunas;
}

/** A coluna em que um card cai, dentro de um quadro. */
export function colunaDoCard(
  quadro: QuadroDaTemis,
  estagio: EstagioDoTrabalho,
): string {
  return quadro.tipos.length === 0 ? baldeDoEstagio(estagio) : estagio;
}
