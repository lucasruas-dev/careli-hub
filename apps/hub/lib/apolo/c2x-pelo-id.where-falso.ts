// O WHERE DO C2X, DE MENTIRA: só para os testes do PAN-124 (lote do financeiro interno).
//
// Os testes das leituras convertidas precisam provar duas coisas: que o SQL vai pelo id (e não pela
// sigla) e que um RENOME no C2X não muda o resultado. A segunda só se prova com um banco que responda
// de verdade ao filtro que recebeu: este arquivo lê as cláusulas de empreendimento do SQL (`e.id in`,
// `e.id not in`, `e.code in`, `e.code not in`, `e.code = ?`), pega os parâmetros delas pela posição
// dos `?` e diz quais empreendimentos passam. A consulta antiga, pela sigla, recebe a mesma resposta
// que o MySQL daria a ela, e é por isso que o teste falha com ela.
//
// ⚠️ NÃO É UM PARSER DE SQL. Entende só essas cinco cláusulas, sempre com o alias `e` de
// `enterprises`, e ignora o resto do WHERE (quem testa escolhe linhas que já passam no resto).

export type EmpreendimentoFalso = { code: string; id: number; name: string };

/**
 * O C2X depois de dois renomes: o 43 foi de RDV para PDI (24/09/2026, o caso real) e o 34, que é o
 * TESTE SPLIT CARELI, aparece renomeado de TSC para TSX (hipotético: é o renome que a lista de
 * exclusão por sigla não aguenta, como não aguentou o LAG em 16/07/2026).
 */
export const C2X_DEPOIS_DO_RENOME: readonly EmpreendimentoFalso[] = [
  { code: "SDT", id: 2, name: "SERVIDOR DE TREINAMENTO" },
  { code: "LAB", id: 31, name: "LAGOA BONITA - MASTERPLAN" },
  { code: "TSX", id: 34, name: "TESTE SPLIT CARELI" },
  { code: "VOL", id: 36, name: "VALE DO OURO - LOTES" },
  { code: "VOC", id: 37, name: "VALE DO OURO - CHACARAS" },
  { code: "PDI", id: 43, name: "PORTAL DO IBITURUNA" },
];

const CLAUSULAS: Array<{
  mantem: (emp: EmpreendimentoFalso, valores: unknown[]) => boolean;
  padrao: RegExp;
}> = [
  { mantem: (emp, v) => v.map(Number).includes(emp.id), padrao: /e\.id in \([?, ]+\)/ },
  { mantem: (emp, v) => !v.map(Number).includes(emp.id), padrao: /e\.id not in \([?, ]+\)/ },
  { mantem: (emp, v) => v.map(maiuscula).includes(emp.code), padrao: /e\.code in \([?, ]+\)/ },
  { mantem: (emp, v) => !v.map(maiuscula).includes(emp.code), padrao: /e\.code not in \([?, ]+\)/ },
  { mantem: (emp, v) => v.map(maiuscula).includes(emp.code), padrao: /e\.code = \?/ },
];

function maiuscula(valor: unknown): string {
  return String(valor ?? "").trim().toUpperCase();
}

function contarMarcadores(texto: string): number {
  return (texto.match(/\?/g) ?? []).length;
}

/** Os empreendimentos de `c2x` que passam nas cláusulas de empreendimento deste SQL. */
export function empreendimentosDoWhere(
  sql: string,
  params: readonly unknown[],
  c2x: readonly EmpreendimentoFalso[] = C2X_DEPOIS_DO_RENOME,
): EmpreendimentoFalso[] {
  let passam = [...c2x];
  for (const clausula of CLAUSULAS) {
    const achado = clausula.padrao.exec(sql);
    if (!achado) continue;
    const antes = contarMarcadores(sql.slice(0, achado.index));
    const valores = params.slice(antes, antes + contarMarcadores(achado[0]));
    passam = passam.filter((emp) => clausula.mantem(emp, valores));
  }
  return passam;
}

/** O SQL filtra empreendimento pela sigla? (`e.code in`, `e.code not in`, `e.code = ?`) */
export function filtraPelaSigla(sql: string): boolean {
  return /e\.code\s+(not\s+)?in\s*\(|e\.code\s*=\s*\?/i.test(sql);
}
