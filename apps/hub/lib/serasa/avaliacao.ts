// Regra de aprovação/reprovação da análise de crédito.
//
// Critério do Lucas (21/jul), para o Vale do Ouro: REPROVADO se o total em R$ das restrições
// passar do LIMITE (R$ 1.000 no Vale do Ouro). O limite é POR EMPREENDIMENTO — por isso é
// parâmetro, não constante: cada empreendimento pode ter o seu.
//
// O total soma o `balance` de todos os blocos de negativeData (pefin, refin, notary, check,
// collectionRecords). No fixture: refin 964,89 + collectionRecords 4.534,88 = 5.499,77 → acima
// de 1.000 → REPROVADO.

const LIMITE_PADRAO_BRL = 1000;

function comoRegistro(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

// Soma em R$ das restrições (balance de cada bloco de negativeData). Nunca lança.
export function totalRestricoes(cru: unknown): number {
  try {
    const relatorio = comoRegistro((comoRegistro(cru)?.reports as unknown[] | undefined)?.[0]);
    const negativeData = comoRegistro(relatorio?.negativeData);
    if (!negativeData) return 0;

    let total = 0;
    for (const bloco of Object.values(negativeData)) {
      const balance = Number(comoRegistro(comoRegistro(bloco)?.summary)?.balance);
      if (Number.isFinite(balance) && balance > 0) total += balance;
    }
    return Math.round(total * 100) / 100;
  } catch {
    return 0;
  }
}

export type Veredito = {
  // APROVADO (true) x REPROVADO (false).
  aprovado: boolean;
  limite: number;
  motivo: string;
  total: number;
};

// APROVA quando o total das restrições NÃO passa do limite. `limite` vem do empreendimento
// (default R$ 1.000, o do Vale do Ouro).
export function avaliarCredito(cru: unknown, limite: number = LIMITE_PADRAO_BRL): Veredito {
  const total = totalRestricoes(cru);
  const aprovado = total <= limite;
  const fmt = (n: number) => n.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
  return {
    aprovado,
    limite,
    motivo: aprovado
      ? `Restrições de ${fmt(total)} dentro do limite de ${fmt(limite)}.`
      : `Restrições de ${fmt(total)} acima do limite de ${fmt(limite)}.`,
    total,
  };
}
