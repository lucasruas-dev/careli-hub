// EQUIVALÊNCIA DE EMPREENDIMENTO: o grupo e as divisões dele são a MESMA coisa.
//
// Regra do Lucas (17/08/2026): "quando clicar em Lagoa Bonita, tem que habilitar todos os Lagoa
// Bonita" · "para eles não tem essa de divisão, isso é interno".
//
// ⚠️ O PROBLEMA QUE ISTO RESOLVE, medido em produção:
//
// Um empreendimento pode existir em dois formatos de id, e os dois estão gravados hoje:
//   • o do GRUPO      — "group:Lagoa Bonita", que é o que o portal público oferece;
//   • o das DIVISÕES  — 33 (LBF), 27 (LBR), 32 (LBP), que é o que o C2X conhece.
//
// Cada ponta do sistema comparava só um deles, e por isso NENHUM formato funcionava dos dois
// lados:
//   • o botão Habilitar expandia o que o operador marcou para as divisões e comparava contra o
//     pedido, que estava gravado como grupo. Resultado: "Empreendimento que esta imobiliaria nao
//     pediu: 33, 27, 32" — sobre o empreendimento que ela tinha acabado de pedir;
//   • o portal do corretor cruzava o vínculo contra a lista de empreendimentos, onde Lagoa Bonita
//     aparece como UM item de id "group:Lagoa Bonita". A DANY CASTRO, habilitada (`verified`) nas
//     três divisões desde sempre, simplesmente NÃO via o Lagoa Bonita — e nada na tela dizia isso.
//     Habilitação que existe no banco e não existe na prática é pior que habilitação ausente.
//
// A saída é ter UM lugar que decide o que é equivalente a quê, e usá-lo nas duas pontas.

/** O empreendimento como o catálogo entrega: o id e as divisões reais por trás dele. */
export type ComDivisoes = {
  id: string;
  /** enterprise_id reais do C2X. Para o empreendimento simples, vazio ou o próprio id. */
  stageIds?: string[];
};

/** Todos os ids que significam ESTE empreendimento: o próprio e cada divisão. */
export function idsDoEmpreendimento(emp: ComDivisoes): string[] {
  const ids = new Set<string>([String(emp.id).trim()]);
  for (const divisao of emp.stageIds ?? []) {
    const limpo = String(divisao).trim();
    if (limpo) ids.add(limpo);
  }
  return [...ids].filter(Boolean);
}

/**
 * Traduz qualquer id (grupo ou divisão) para o id CANÔNICO do empreendimento — o do grupo, quando
 * ele existe.
 *
 * É o que permite comparar um pedido gravado como "group:Lagoa Bonita" com uma escolha que chegou
 * como 33, sem precisar migrar o que já está no banco.
 */
export function canonizador(catalogo: ComDivisoes[]): (id: string) => string {
  const canonPorId = new Map<string, string>();

  for (const emp of catalogo) {
    for (const id of idsDoEmpreendimento(emp)) {
      canonPorId.set(id, String(emp.id).trim());
    }
  }

  // Id fora do catálogo volta como veio: não é papel desta função inventar equivalência para o
  // que ela não conhece, e engolir o desconhecido esconderia empreendimento removido do C2X.
  return (id: string) => canonPorId.get(String(id).trim()) ?? String(id).trim();
}

/**
 * O empreendimento está coberto por algum destes vínculos?
 *
 * Aceita vínculo gravado no formato do grupo OU no de qualquer divisão — os dois existem no banco,
 * e os dois significam a mesma habilitação.
 */
export function cobertoPor(emp: ComDivisoes, vinculos: Iterable<string>): boolean {
  const equivalentes = new Set(idsDoEmpreendimento(emp));
  for (const vinculo of vinculos) {
    const limpo = String(vinculo ?? "").trim();
    if (limpo && equivalentes.has(limpo)) return true;
  }
  return false;
}
