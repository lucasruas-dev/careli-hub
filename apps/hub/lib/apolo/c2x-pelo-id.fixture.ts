// A TABELA `enterprises` DO C2X COMO ELA ESTAVA EM 25/09/2026, só id e sigla. Fixture dos testes do
// PAN-124 (lib/apolo/c2x-pelo-id.test.ts e lib/guardian/c2x-analytics.test.ts).
//
// Medida só com SELECT (apps/hub/scratchpad/pan124-medir-1.ts): 37 empreendimentos, id máximo 43,
// nenhuma sigla repetida, nenhuma sigla nula ou vazia. É o retrato que prova que filtrar pelo id devolve
// o mesmo que filtrar pela sigla HOJE; quando o C2X mudar, este arquivo não muda junto, e é de propósito:
// ele é o "antes" da troca.
//
// ⚠️ O 30 JÁ FOI LAG (até 16/07/2026) e ADT (até 21/09/2026). O 43 foi RDV até 24/09/2026.

export const ENTERPRISES_DO_C2X_EM_25_09_2026: ReadonlyArray<{ code: string; id: number }> = [
  { code: "LOU", id: 1 },
  { code: "SDT", id: 2 },
  { code: "MDS", id: 3 },
  { code: "LOS", id: 4 },
  { code: "PDV", id: 7 },
  { code: "PVS", id: 10 },
  { code: "VBL", id: 11 },
  { code: "MLN", id: 12 },
  { code: "RDP", id: 13 },
  { code: "RPS", id: 14 },
  { code: "RPC", id: 15 },
  { code: "EDL", id: 17 },
  { code: "MLC", id: 18 },
  { code: "VDO", id: 19 },
  { code: "REP", id: 20 },
  { code: "MDB", id: 21 },
  { code: "CDJ", id: 22 },
  { code: "SOU", id: 23 },
  { code: "PRI", id: 24 },
  { code: "HDP", id: 26 },
  { code: "LBR", id: 27 },
  { code: "VDP", id: 28 },
  { code: "VAL", id: 29 },
  { code: "ACT", id: 30 },
  { code: "LAB", id: 31 },
  { code: "LBP", id: 32 },
  { code: "LBF", id: 33 },
  { code: "TSC", id: 34 },
  { code: "VLO", id: 35 },
  { code: "VOL", id: 36 },
  { code: "VOC", id: 37 },
  { code: "RVP", id: 38 },
  { code: "GDN", id: 39 },
  { code: "JDG", id: 40 },
  { code: "VOR", id: 41 },
  { code: "ACP", id: 42 },
  { code: "PDI", id: 43 },
];

/**
 * As linhas pai e filho de `hercules_empreendimentos` em 25/09/2026 (SELECT no Supabase de produção):
 * os cinco pais com divisões e as divisões deles. Os pais LOX, RDX e PDX não têm id do C2X.
 */
export const PAIS_E_DIVISOES_DO_PANTEON_EM_25_09_2026: ReadonlyArray<{
  c2xEnterpriseId: null | string;
  codigo: string;
  id: string;
  nome: string;
  paiId: null | string;
}> = [
  { c2xEnterpriseId: null, codigo: "LOX", id: "pai-lox", nome: "Lavra do Ouro", paiId: null },
  { c2xEnterpriseId: "1", codigo: "LOU", id: "f-lou", nome: "Lavra do Ouro · LOU", paiId: "pai-lox" },
  { c2xEnterpriseId: "4", codigo: "LOS", id: "f-los", nome: "Lavra do Ouro · LOS", paiId: "pai-lox" },
  { c2xEnterpriseId: null, codigo: "RDX", id: "pai-rdx", nome: "Rio de Pedras", paiId: null },
  { c2xEnterpriseId: "13", codigo: "RDP", id: "f-rdp", nome: "Rio de Pedras · RDP", paiId: "pai-rdx" },
  { c2xEnterpriseId: "14", codigo: "RPS", id: "f-rps", nome: "Rio de Pedras · RPS", paiId: "pai-rdx" },
  { c2xEnterpriseId: "15", codigo: "RPC", id: "f-rpc", nome: "Rio de Pedras · RPC", paiId: "pai-rdx" },
  { c2xEnterpriseId: null, codigo: "PDX", id: "pai-pdx", nome: "Portal dos Vales", paiId: null },
  { c2xEnterpriseId: "7", codigo: "PDV", id: "f-pdv", nome: "Portal dos Vales · PDV", paiId: "pai-pdx" },
  { c2xEnterpriseId: "10", codigo: "PVS", id: "f-pvs", nome: "Portal dos Vales · PVS", paiId: "pai-pdx" },
  { c2xEnterpriseId: "31", codigo: "LAB", id: "pai-lab", nome: "Lagoa Bonita", paiId: null },
  { c2xEnterpriseId: "27", codigo: "LBR", id: "f-lbr", nome: "Lagoa Bonita · LBR", paiId: "pai-lab" },
  { c2xEnterpriseId: "32", codigo: "LBP", id: "f-lbp", nome: "Lagoa Bonita · LBP", paiId: "pai-lab" },
  { c2xEnterpriseId: "33", codigo: "LBF", id: "f-lbf", nome: "Lagoa Bonita · LBF", paiId: "pai-lab" },
  { c2xEnterpriseId: "35", codigo: "VLO", id: "pai-vlo", nome: "Vale do Ouro", paiId: null },
  { c2xEnterpriseId: "36", codigo: "VOL", id: "f-vol", nome: "Vale do Ouro · VOL", paiId: "pai-vlo" },
  { c2xEnterpriseId: "37", codigo: "VOC", id: "f-voc", nome: "Vale do Ouro · VOC", paiId: "pai-vlo" },
  { c2xEnterpriseId: "41", codigo: "VOR", id: "f-vor", nome: "Vale do Ouro · VOR", paiId: "pai-vlo" },
  // Um simples, o 43 já com o nome novo no Panteon, e o produto de teste que não existe no C2X.
  { c2xEnterpriseId: "43", codigo: "PDI", id: "s-pdi", nome: "Portal do Ibituruna", paiId: null },
  { c2xEnterpriseId: "9001", codigo: "TST", id: "s-tst", nome: "ZZ TESTE", paiId: null },
];
