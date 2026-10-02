// O SELO DE ASSINATURA DO CARD, POR ETAPA. Uma folha pura, sem banco: o quadro da Têmis é "use client".
//
// Lucas, 02/10/2026: *"vamos mudar esse 3/11 eu preciso ver somente dos compradores. se tiver um
// comprador 1/1 ou 0/1 se tiver mais a mesma logica"* e, logo depois, *"quando mover para o
// pre-faturamento mostrar o quadro real de assinatura, ae vale trazer a visao que temos hoje do 3/11
// pois se esta no prefaturamento eu sei que os compradores ja assinaram"*.
//
// ⚠️ SÃO DUAS PERGUNTAS, UMA POR ETAPA. Em "Em assinatura" a pergunta é "o card já pode andar?", e
// quem responde são os compradores (é com eles que o card vai ao Pré-faturamento). No Pré-faturamento
// a pergunta vira "o contrato fechou?", e aí vale o quadro inteiro, testemunha e vendedora incluídas.
// O número do contrato inteiro não some da etapa de assinatura: fica no `title`, para quem passa o
// mouse.

/** O que o selo precisa da contagem (os nomes de `ContagemDeAssinaturas`, `trabalhos-db.ts`). */
export type ContagemParaOSelo = {
  assinaram: number;
  /** Opcional: a rota antiga não manda. Ausente ou `null` = o quadro não tem comprador marcado. */
  compradores?: null | { assinaram: number; total: number };
  total: number;
};

/** O selo pronto para desenhar: o número, a palavra ao lado e a frase do `title`. */
export type SeloDoCard = {
  numero: string;
  palavra: string;
  titulo: string;
};

/**
 * O selo de assinatura do card nesta etapa. `null` = sem selo. Puro.
 *
 *   • "Em assinatura" com compradores no quadro: "0/1 comprador" ou "1/2 compradores", e o `title`
 *     diz também o contrato inteiro ("0 de 1 comprador assinou · 3 de 11 no contrato").
 *   • "Em assinatura" sem comprador marcado no quadro: o total, como sempre foi ("3/11 assinaram").
 *     Sem comprador não há o que contar, e um "0/0" seria ruído.
 *   • Qualquer outra etapa (o Pré-faturamento): o total ("3/11 assinaram").
 */
export function seloDeAssinaturaDoCard(estagio: string, contagem: ContagemParaOSelo | null | undefined): null | SeloDoCard {
  if (!contagem) return null;
  const doContrato = `${contagem.assinaram} de ${contagem.total}`;
  const compradores = contagem.compradores;
  if (estagio === "assinatura" && compradores && compradores.total > 0) {
    const um = compradores.total === 1;
    return {
      numero: `${compradores.assinaram}/${compradores.total}`,
      palavra: um ? "comprador" : "compradores",
      titulo: `${compradores.assinaram} de ${compradores.total} ${um ? "comprador assinou" : "compradores assinaram"} · ${doContrato} no contrato`,
    };
  }
  return {
    numero: `${contagem.assinaram}/${contagem.total}`,
    palavra: "assinaram",
    titulo: `${doContrato} assinaram.`,
  };
}
