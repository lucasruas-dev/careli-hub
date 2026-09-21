// A CADEIA MEDIDA CONTRA O CADASTRO DE PRODUÇÃO — a revisão de 21/09/2026.
//
// Não é teste de unidade: é a PROVA de que a inversão da escolha da minuta (a divisão da unidade
// passou a vir antes do empreendimento da proposta) não troca o modelo de nenhuma venda que hoje
// gera contrato, e não deixa nenhuma venda usar minuta de outro produto.
//
// ⚠️ O CADASTRO ABAIXO É CÓPIA DO BANCO DE PRODUÇÃO (bxgukywoxgivlrhjkwjx), lido por SELECT em
// 21/09/2026: as 38 linhas de `hercules_empreendimentos`, as 11 de `temis_minutas` e as 6 de
// `temis_categorias`. Nenhum dado de cliente entra aqui — só código de produto, nome de
// empreendimento e contagem.
//
// ⚠️ OS 41 RECORTES SÃO AS COMBINAÇÕES REAIS de (empreendimento da proposta, empreendimento da
// unidade, categoria da unidade) das 4.898 propostas. Rodar as 4.898 uma a uma leria o mesmo
// cadastro 4.898 vezes para responder 41 perguntas diferentes.

import { describe, expect, it } from "vitest";

import { lerAnexosDaVenda } from "./anexos-da-venda";
import { resolverCadeiaDoContrato } from "./cadeia-do-contrato";
import { clienteEmMemoria, type EstadoDoBanco, novoEstado } from "./fixtures/supabase-em-memoria";
import { escolherMinutaDaCadeia } from "./minuta-da-cadeia";
import { preencherContrato } from "./preencher-contrato";

// ── O CADASTRO DE PRODUÇÃO ──────────────────────────────────────────────────

type Emp = { c2x: null | string; codigo: string; id: string; nome: string; pai: null | string };

const LAB = "307c93d6-6a42-42b3-ab20-ee06ae879f42";
const LOX = "231581be-3130-4cc3-ae70-40383d601499";
const PDX = "887e5878-7071-40c3-a7aa-4317bc6836a3";
const RDX = "1dfaf133-572f-4149-a0d1-4a7506dc607f";
const VLO = "06923bf9-2a46-4639-bf29-9f18f6f93636";

const EMPREENDIMENTOS: Emp[] = [
  { c2x: "42", codigo: "ACP", id: "412be1ea-5a28-4e53-ab73-123bf0286f2b", nome: "Aldeia das Cachoeiras das Pedras", pai: null },
  { c2x: "22", codigo: "CDJ", id: "5f277e03-ae0c-4690-80c3-437d5b59cf0a", nome: "Cidade Jardim", pai: null },
  { c2x: "17", codigo: "EDL", id: "da2f6d32-3200-4d44-864f-aefaef221df9", nome: "Estancia do Lago", pai: null },
  { c2x: "39", codigo: "GDN", id: "e1dcc0c9-e3ad-4c93-9762-98a625f8a360", nome: "Garden", pai: null },
  { c2x: "26", codigo: "HDP", id: "686d59a9-ba1c-4ee3-b6a7-e92b5de44a5c", nome: "Haras do Passo", pai: null },
  { c2x: "40", codigo: "JDG", id: "86d5b9da-8797-4b8b-bcdb-8b09255b61c2", nome: "Jardim das Gerais", pai: null },
  { c2x: "31", codigo: "LAB", id: LAB, nome: "Lagoa Bonita", pai: null },
  { c2x: "33", codigo: "LBF", id: "a8bf9d2a-d6e1-4656-82b7-90204e58715b", nome: "Lagoa Bonita · LBF", pai: LAB },
  { c2x: "32", codigo: "LBP", id: "f8ff4cae-4671-4553-b6c1-602beb41ff6c", nome: "Lagoa Bonita · LBP", pai: LAB },
  { c2x: "27", codigo: "LBR", id: "e9f57a64-6f54-43d3-90f4-1d8c5d82b98c", nome: "Lagoa Bonita · LBR", pai: LAB },
  { c2x: null, codigo: "LOX", id: LOX, nome: "Lavra do Ouro", pai: null },
  { c2x: "4", codigo: "LOS", id: "5b43de39-1418-4913-8f5b-4e52c1556c43", nome: "Lavra do Ouro · LOS", pai: LOX },
  { c2x: "1", codigo: "LOU", id: "30655ae6-61d6-435c-a01e-1ffb6842b78b", nome: "Lavra do Ouro · LOU", pai: LOX },
  { c2x: "21", codigo: "MDB", id: "4316b1f8-5c52-4534-abdd-7df6d67a7fee", nome: "Morada da Brisa", pai: null },
  { c2x: "3", codigo: "MDS", id: "761b44c8-84de-41f3-857f-ceeb2ab150c4", nome: "Morada da Serra", pai: null },
  { c2x: "18", codigo: "MLC", id: "f96d153d-c675-4f9a-9d83-a0ba2613b39a", nome: "Milenium Mall", pai: null },
  { c2x: "12", codigo: "MLN", id: "4e7d0bc5-4f9c-47e8-ba6c-b2afe28ffd48", nome: "Milenium", pai: null },
  { c2x: null, codigo: "PDX", id: PDX, nome: "Portal dos Vales", pai: null },
  { c2x: "7", codigo: "PDV", id: "46b98087-2670-4af7-8ae0-a74a12068a45", nome: "Portal dos Vales · PDV", pai: PDX },
  { c2x: "10", codigo: "PVS", id: "fbb56a00-ccf0-4329-87f9-dfc22bc48dc1", nome: "Portal dos Vales · PVS", pai: PDX },
  { c2x: "24", codigo: "PRI", id: "65867ee0-6e71-49da-9342-b461497c4896", nome: "Privilege Residence", pai: null },
  { c2x: "43", codigo: "RDV", id: "3a2696a7-144e-4b17-94b8-461bcb09fdbb", nome: "Recanto do Vale", pai: null },
  { c2x: null, codigo: "RDX", id: RDX, nome: "Rio de Pedras", pai: null },
  { c2x: "13", codigo: "RDP", id: "82b8033b-2a0b-4e56-bda5-0c5ac9c9910b", nome: "Rio de Pedras · RDP", pai: RDX },
  { c2x: "15", codigo: "RPC", id: "0de5453e-c750-438e-8c68-c15c9db4b88c", nome: "Rio de Pedras · RPC", pai: RDX },
  { c2x: "14", codigo: "RPS", id: "25803134-638a-4d0a-9017-6cc4d16cc9fc", nome: "Rio de Pedras · RPS", pai: RDX },
  { c2x: "20", codigo: "REP", id: "bdb74a9c-a698-49bd-9982-9892d9dcf08b", nome: "Recanto do Pará", pai: null },
  { c2x: "38", codigo: "RVP", id: "223ed65d-8ff1-4cbf-86bd-23b5c5fb62e5", nome: "Villa Paris", pai: null },
  { c2x: "23", codigo: "SOU", id: "31013ab6-e586-4bac-8953-e55af411decf", nome: "Soul Ipanema", pai: null },
  { c2x: "9001", codigo: "TST", id: "1fa9b6a5-2275-4297-bab3-d887c456fa4a", nome: "ZZ TESTE - nao e empreendimento real", pai: null },
  { c2x: "29", codigo: "VAL", id: "a7a0c3f1-ee3d-45e5-9c92-a5f39b7765d4", nome: "Vista Alegre", pai: null },
  { c2x: "11", codigo: "VBL", id: "109d386b-99fc-4a39-b188-b4dcc80a203a", nome: "Viva Boulevard", pai: null },
  { c2x: "19", codigo: "VDO", id: "044f4f12-e9ac-444e-ba7a-27a40ee4f040", nome: "Veredas do Ouro", pai: null },
  { c2x: "28", codigo: "VDP", id: "f4d81a73-2ee9-4381-b22b-fbdb3ab73265", nome: "Vistas da Praia", pai: null },
  { c2x: "35", codigo: "VLO", id: VLO, nome: "Vale do Ouro", pai: null },
  { c2x: "37", codigo: "VOC", id: "ecbfe411-8569-4dd9-9b58-2b12a3d270a2", nome: "Vale do Ouro · VOC", pai: VLO },
  { c2x: "36", codigo: "VOL", id: "af45a402-c369-45ca-8403-a67ddbc82d8e", nome: "Vale do Ouro · VOL", pai: VLO },
  { c2x: "41", codigo: "VOR", id: "ba43aee5-fa64-4e7b-9ad9-6a99cea42d16", nome: "Vale do Ouro · VOR", pai: VLO },
];

/** As 11 linhas de `temis_minutas`. `conteudo` só precisa existir para a montagem não recusar. */
const MINUTAS = [
  { enterprise_id: "19", id: "8090f684-718e-4c3b-acae-941178563867", nome: "Contrato Veredas do Ouro", situacao: "publicada", tipo: "contrato", versao: 1 },
  { enterprise_id: "35", id: "fa8654ba-e304-4625-8d8a-b9792b864db6", nome: "VLO-MINUTA-COMPRA-VENDA", situacao: "rascunho", tipo: "contrato", versao: 1 },
  { enterprise_id: "36", id: "c97bf8ea-3c48-4089-bbf7-f6d0e0dd594b", nome: "VOL-MINUTA-COMPRA-VENDA-NORMAL", situacao: "arquivada", tipo: "contrato", versao: 1 },
  { enterprise_id: "36", id: "8bea7545-b391-4bf1-a981-25ab5f485478", nome: "VOL-MINUTA-COMPRA-VENDA-NORMAL", situacao: "arquivada", tipo: "contrato", versao: 2 },
  { enterprise_id: "36", id: "4730b259-c365-495f-abc0-5bb688ab8e96", nome: "VOL-MINUTA-COMPRA-VENDA-NORMAL", situacao: "arquivada", tipo: "contrato", versao: 3 },
  { enterprise_id: "36", id: "532d7cc3-e12c-4cb1-8a14-f583bff14a52", nome: "VOL-MINUTA-COMPRA-VENDA-NORMAL", situacao: "arquivada", tipo: "contrato", versao: 4 },
  { enterprise_id: "36", id: "67a3f1c7-68dd-4a17-994b-3fdc85a9c012", nome: "VOL-MINUTA-COMPRA-VENDA-NORMAL", situacao: "arquivada", tipo: "contrato", versao: 5 },
  { enterprise_id: "36", id: "84ee5ce7-0eb9-4c7d-891a-90c9c9fcad37", nome: "VOL-MINUTA-COMPRA-VENDA-NORMAL", situacao: "publicada", tipo: "contrato", versao: 6 },
  { enterprise_id: "38", id: "5fb5b115-8222-45ee-b8de-26ecbfe16bb2", nome: "RVP-MINUTA-COMPRA-VENDA-NORMAL", situacao: "arquivada", tipo: "contrato", versao: 1 },
  { enterprise_id: "38", id: "a872719c-7cfe-4369-8fc9-a4066dee1d5e", nome: "RVP-MINUTA-COMPRA-VENDA-NORMAL", situacao: "publicada", tipo: "contrato", versao: 2 },
  { enterprise_id: "9001", id: "ebb565f2-7be2-416a-9974-7aa13d0548d9", nome: "Teste", situacao: "rascunho", tipo: "contrato", versao: 1 },
].map((m) => ({ ...m, capa_nome: null, capa_path: null, conteudo: [{ type: "paragrafo" }] }));

const CAT_CONDOMINIO = "f459a47a-df1e-4dda-a65a-2e43a8e814b7";
const CAT_LOTEAMENTO = "e6c8173b-725c-4760-8aab-5cfb66fbda00";

/** As 6 linhas de `temis_categorias`. Todas com `minuta_id` NULO em produção. */
const CATEGORIAS = [
  { categoria_pai_id: null, enterprise_id: "19", id: "8f4c11eb-62cb-4958-87d5-fd53a9b1f460", minuta_id: null, nome: "CONDOMINIO" },
  { categoria_pai_id: null, enterprise_id: "19", id: "bd271572-34f3-415e-a0a8-f81229744091", minuta_id: null, nome: "LOTEAMENTO" },
  { categoria_pai_id: null, enterprise_id: "31", id: CAT_CONDOMINIO, minuta_id: null, nome: "Condomínio" },
  { categoria_pai_id: null, enterprise_id: "31", id: CAT_LOTEAMENTO, minuta_id: null, nome: "Loteamento" },
  { categoria_pai_id: null, enterprise_id: "42", id: "4b3c4241-c5e5-4403-9db1-72785cb3fb96", minuta_id: null, nome: "Lotes com Infraestrutura" },
  { categoria_pai_id: null, enterprise_id: "42", id: "52a51f9d-7411-475c-867c-166f6eebf161", minuta_id: null, nome: "Lotes sem Infraestrutura" },
];

/** Os 41 recortes reais das 4.898 propostas (empreendimento da proposta × unidade × categoria). */
const RECORTES: Array<{
  cat: string;
  empC2x: string;
  empCod: string;
  empNome: string;
  propostas: number;
  uniC2x: string;
}> = [
  { cat: "", empC2x: "", empCod: "RDX", empNome: "Rio de Pedras", propostas: 763, uniC2x: "13" },
  { cat: "", empC2x: "22", empCod: "CDJ", empNome: "Cidade Jardim", propostas: 567, uniC2x: "22" },
  { cat: "", empC2x: "19", empCod: "VDO", empNome: "Veredas do Ouro", propostas: 546, uniC2x: "19" },
  { cat: CAT_CONDOMINIO, empC2x: "31", empCod: "LAB", empNome: "Lagoa Bonita", propostas: 401, uniC2x: "27" },
  { cat: "", empC2x: "", empCod: "LOX", empNome: "Lavra do Ouro", propostas: 319, uniC2x: "4" },
  { cat: "", empC2x: "", empCod: "LOX", empNome: "Lavra do Ouro", propostas: 254, uniC2x: "1" },
  { cat: "", empC2x: "", empCod: "PDX", empNome: "Portal dos Vales", propostas: 254, uniC2x: "7" },
  { cat: "", empC2x: "", empCod: "PDX", empNome: "Portal dos Vales", propostas: 218, uniC2x: "10" },
  { cat: "", empC2x: "35", empCod: "VLO", empNome: "Vale do Ouro", propostas: 192, uniC2x: "37" },
  { cat: "", empC2x: "35", empCod: "VLO", empNome: "Vale do Ouro", propostas: 189, uniC2x: "36" },
  { cat: "", empC2x: "35", empCod: "VLO", empNome: "Vale do Ouro", propostas: 174, uniC2x: "35" },
  { cat: "", empC2x: "20", empCod: "REP", empNome: "Recanto do Pará", propostas: 160, uniC2x: "20" },
  { cat: "", empC2x: "17", empCod: "EDL", empNome: "Estancia do Lago", propostas: 147, uniC2x: "17" },
  { cat: CAT_CONDOMINIO, empC2x: "31", empCod: "LAB", empNome: "Lagoa Bonita", propostas: 135, uniC2x: "31" },
  { cat: CAT_LOTEAMENTO, empC2x: "31", empCod: "LAB", empNome: "Lagoa Bonita", propostas: 89, uniC2x: "27" },
  { cat: "", empC2x: "3", empCod: "MDS", empNome: "Morada da Serra", propostas: 79, uniC2x: "3" },
  { cat: "", empC2x: "29", empCod: "VAL", empNome: "Vista Alegre", propostas: 59, uniC2x: "29" },
  { cat: "", empC2x: "12", empCod: "MLN", empNome: "Milenium", propostas: 46, uniC2x: "12" },
  { cat: "", empC2x: "38", empCod: "RVP", empNome: "Villa Paris", propostas: 45, uniC2x: "38" },
  { cat: "", empC2x: "11", empCod: "VBL", empNome: "Viva Boulevard", propostas: 31, uniC2x: "11" },
  { cat: "", empC2x: "", empCod: "(sem emp)", empNome: "", propostas: 31, uniC2x: "30" },
  { cat: CAT_CONDOMINIO, empC2x: "31", empCod: "LAB", empNome: "Lagoa Bonita", propostas: 26, uniC2x: "33" },
  { cat: CAT_LOTEAMENTO, empC2x: "31", empCod: "LAB", empNome: "Lagoa Bonita", propostas: 21, uniC2x: "31" },
  { cat: "", empC2x: "42", empCod: "ACP", empNome: "Aldeia das Cachoeiras das Pedras", propostas: 20, uniC2x: "42" },
  { cat: CAT_CONDOMINIO, empC2x: "31", empCod: "LAB", empNome: "Lagoa Bonita", propostas: 17, uniC2x: "32" },
  { cat: "", empC2x: "", empCod: "(sem emp)", empNome: "", propostas: 16, uniC2x: "2" },
  { cat: "", empC2x: "23", empCod: "SOU", empNome: "Soul Ipanema", propostas: 14, uniC2x: "23" },
  { cat: "", empC2x: "", empCod: "RDX", empNome: "Rio de Pedras", propostas: 14, uniC2x: "15" },
  { cat: "", empC2x: "18", empCod: "MLC", empNome: "Milenium Mall", propostas: 12, uniC2x: "18" },
  { cat: "", empC2x: "28", empCod: "VDP", empNome: "Vistas da Praia", propostas: 12, uniC2x: "28" },
  { cat: "", empC2x: "21", empCod: "MDB", empNome: "Morada da Brisa", propostas: 12, uniC2x: "21" },
  { cat: "", empC2x: "40", empCod: "JDG", empNome: "Jardim das Gerais", propostas: 7, uniC2x: "40" },
  { cat: "", empC2x: "9001", empCod: "TST", empNome: "ZZ TESTE - nao e empreendimento real", propostas: 6, uniC2x: "9001" },
  { cat: "", empC2x: "24", empCod: "PRI", empNome: "Privilege Residence", propostas: 6, uniC2x: "24" },
  { cat: "", empC2x: "35", empCod: "VLO", empNome: "Vale do Ouro", propostas: 4, uniC2x: "41" },
  { cat: "", empC2x: "36", empCod: "VOL", empNome: "Vale do Ouro · VOL", propostas: 3, uniC2x: "36" },
  { cat: CAT_LOTEAMENTO, empC2x: "31", empCod: "LAB", empNome: "Lagoa Bonita", propostas: 3, uniC2x: "33" },
  { cat: "", empC2x: "", empCod: "(sem emp)", empNome: "", propostas: 2, uniC2x: "34" },
  { cat: "", empC2x: "26", empCod: "HDP", empNome: "Haras do Passo", propostas: 2, uniC2x: "26" },
  { cat: CAT_CONDOMINIO, empC2x: "33", empCod: "LBF", empNome: "Lagoa Bonita · LBF", propostas: 1, uniC2x: "33" },
  { cat: "", empC2x: "37", empCod: "VOC", empNome: "Vale do Ouro · VOC", propostas: 1, uniC2x: "37" },
];

// ── O BANCO DE MENTIRA, CARREGADO COM O CADASTRO REAL ───────────────────────

function bancoDeProducao(): EstadoDoBanco {
  const estado = novoEstado();
  estado.tabelas.hercules_empreendimentos = EMPREENDIMENTOS.map((e) => ({
    c2x_enterprise_id: e.c2x,
    codigo: e.codigo,
    id: e.id,
    nome: e.nome,
    pai_id: e.pai,
    workspace_id: "careli",
  }));
  estado.tabelas.temis_minutas = MINUTAS.map((m) => ({ ...m }));
  estado.tabelas.temis_categorias = CATEGORIAS.map((c) => ({ ...c, workspace_id: "careli" }));
  estado.tabelas.temis_anexos = [];
  return estado;
}

/**
 * A REGRA DE ATÉ 21/09/2026, copiada de `acharMinuta` (a versão em `HEAD`): igualdade exata com o
 * `c2x_enterprise_id` do empreendimento da proposta, caindo para o da unidade quando aquele é nulo.
 */
function minutaDaRegraAntiga(empC2x: string, uniC2x: string): null | string {
  const alvo = empC2x || uniC2x;
  if (!alvo) return null;
  const achadas = MINUTAS.filter(
    (m) => m.enterprise_id === alvo && m.situacao === "publicada" && m.tipo === "contrato",
  );
  return achadas[0]?.id ?? null;
}

/** Pai, avô, filhos e netos de um produto: a FAMÍLIA que pode responder por um contrato dele. */
function familiaDe(c2x: string): Set<string> {
  const familia = new Set<string>();
  if (!c2x) return familia;
  const eu = EMPREENDIMENTOS.find((e) => e.c2x === c2x);
  if (!eu) return new Set([c2x]);
  familia.add(c2x);

  const raizes: string[] = [eu.id];
  let cursor: null | string = eu.pai;
  while (cursor) {
    const pai: Emp | undefined = EMPREENDIMENTOS.find((e) => e.id === cursor);
    if (!pai) break;
    raizes.push(pai.id);
    if (pai.c2x) familia.add(pai.c2x);
    cursor = pai.pai;
  }
  for (const raiz of raizes) {
    for (const filho of EMPREENDIMENTOS.filter((e) => e.pai === raiz)) {
      if (filho.c2x) familia.add(filho.c2x);
    }
  }
  return familia;
}

async function escolher(recorte: (typeof RECORTES)[number], estado = bancoDeProducao()) {
  const sb = clienteEmMemoria(estado) as never;
  const cadeia = await resolverCadeiaDoContrato(sb, {
    categoriaId: recorte.cat,
    divisaoId: recorte.uniC2x,
    empreendimentoId: recorte.empC2x,
    empreendimentoNome: recorte.empNome,
    unidadeId: "11111111-1111-4111-8111-111111111111",
  });
  if (!cadeia.ok) throw new Error(`a cadeia recusou: ${cadeia.erro}`);
  const escolha = await escolherMinutaDaCadeia(sb, cadeia.cadeia);
  return { cadeia: cadeia.cadeia, escolha };
}

// ════════════════════════════════════════════════════════════════════════════

describe("a cadeia contra o cadastro de produção (21/09/2026)", () => {
  it("os 41 recortes cobrem as 4.898 propostas", () => {
    expect(RECORTES.reduce((s, r) => s + r.propostas, 0)).toBe(4898);
  });

  it("NENHUM contrato que sai hoje troca de modelo", async () => {
    const trocas: string[] = [];
    let propostasComModeloHoje = 0;

    for (const r of RECORTES) {
      const antiga = minutaDaRegraAntiga(r.empC2x, r.uniC2x);
      const { escolha } = await escolher(r);
      const nova = escolha.ok ? (escolha.minuta?.id ?? null) : null;
      if (antiga) propostasComModeloHoje += r.propostas;
      if (antiga && antiga !== nova) {
        trocas.push(`${r.empCod}/${r.uniC2x}: ${antiga} → ${nova ?? "(nenhuma)"} (${r.propostas})`);
      }
    }

    expect(propostasComModeloHoje).toBe(594);
    expect(trocas).toEqual([]);
  });

  it("a minuta escolhida é SEMPRE da família do empreendimento da proposta", async () => {
    const forasteiras: string[] = [];

    for (const r of RECORTES) {
      const { escolha } = await escolher(r);
      if (!escolha.ok || !escolha.minuta) continue;
      const dona = MINUTAS.find((m) => m.id === escolha.minuta?.id)?.enterprise_id ?? "";
      // Sem empreendimento na proposta, a família de referência é a da unidade.
      const familia = familiaDe(r.empC2x || r.uniC2x);
      if (!familia.has(dona)) {
        forasteiras.push(`${r.empCod}/${r.uniC2x} usaria a minuta de ${dona} (${r.propostas})`);
      }
    }

    expect(forasteiras).toEqual([]);
  });

  it("as 189 do Vale do Ouro passam a achar contrato, e SÓ elas", async () => {
    const destravadas: Array<{ onde: string; propostas: number; quem: string }> = [];

    for (const r of RECORTES) {
      const antiga = minutaDaRegraAntiga(r.empC2x, r.uniC2x);
      const { escolha } = await escolher(r);
      const nova = escolha.ok ? (escolha.minuta?.id ?? null) : null;
      if (!antiga && nova) {
        destravadas.push({
          onde: `${r.empCod} (unidade em ${r.uniC2x})`,
          propostas: r.propostas,
          quem: escolha.ok ? (escolha.minuta?.nome ?? "") : "",
        });
      }
    }

    expect(destravadas).toEqual([
      { onde: "VLO (unidade em 36)", propostas: 189, quem: "VOL-MINUTA-COMPRA-VENDA-NORMAL" },
    ]);
  });

  it("o empreendimento pai NÃO passa a enxergar a minuta do filho errado", async () => {
    // As 192 propostas do VLO com lote no VOC e as 4 com lote no VOR continuam sem modelo, porque
    // só o VOL tem minuta publicada. Emprestar o texto do VOL a elas é exatamente o acidente.
    for (const uni of ["37", "41", "35"]) {
      const r = RECORTES.find((x) => x.empC2x === "35" && x.uniC2x === uni);
      expect(r).toBeDefined();
      const { escolha } = await escolher(r!);
      expect(escolha.ok && escolha.minuta).toBeNull();
    }
  });

  it("o rascunho do pai (VLO v1) nunca é escolhido por nenhum recorte", async () => {
    const rascunho = "fa8654ba-e304-4625-8d8a-b9792b864db6";
    for (const r of RECORTES) {
      const { escolha } = await escolher(r);
      if (escolha.ok && escolha.minuta) expect(escolha.minuta.id).not.toBe(rascunho);
    }
  });

  it("nenhuma das 5 versões ARQUIVADAS do VOL entra no lugar da v6", async () => {
    const arquivadas = new Set(
      MINUTAS.filter((m) => m.situacao === "arquivada").map((m) => m.id),
    );
    for (const r of RECORTES) {
      const { escolha } = await escolher(r);
      if (escolha.ok && escolha.minuta) expect(arquivadas.has(escolha.minuta.id)).toBe(false);
    }
  });
});

// ════════════════════════════════════════════════════════════════════════════
// AS TENTATIVAS DE QUEBRAR
// ════════════════════════════════════════════════════════════════════════════
//
// ⚠️ ESTA METADE NASCEU FALHANDO DE PROPÓSITO, em 21/09/2026: cada caso escrevia um jeito de o
// contrato sair errado em silêncio, e a falha era a prova de que acontecia. Todos foram fechados
// na mesma data; o que se lê abaixo agora é a régua, medida contra o mesmo cadastro de produção.

describe("VOL e VOC com contratos diferentes", () => {
  it("cada divisão puxa a SUA minuta, e o pai não empresta a do irmão", async () => {
    const estado = bancoDeProducao();
    (estado.tabelas.temis_minutas as Array<Record<string, unknown>>).push({
      capa_nome: null,
      capa_path: null,
      conteudo: [{ type: "paragrafo" }],
      enterprise_id: "37",
      id: "aaaaaaaa-0000-4000-8000-000000000037",
      nome: "VOC-MINUTA-CONDOMINIO",
      situacao: "publicada",
      tipo: "contrato",
      versao: 1,
    });

    const doVoc = RECORTES.find((r) => r.empC2x === "35" && r.uniC2x === "37")!;
    const doVol = RECORTES.find((r) => r.empC2x === "35" && r.uniC2x === "36")!;
    const doPai = RECORTES.find((r) => r.empC2x === "35" && r.uniC2x === "35")!;

    const voc = await escolher(doVoc, estado);
    const vol = await escolher(doVol, estado);
    const pai = await escolher(doPai, estado);

    expect(voc.escolha.ok && voc.escolha.minuta?.nome).toBe("VOC-MINUTA-CONDOMINIO");
    expect(vol.escolha.ok && vol.escolha.minuta?.nome).toBe("VOL-MINUTA-COMPRA-VENDA-NORMAL");
    // O lote que mora no PAI continua sem modelo: o 35 só tem rascunho, e o texto do VOL não desce.
    expect(pai.escolha.ok && pai.escolha.minuta).toBeNull();
  });
});

describe("a categoria do PAI atravessa os filhos", () => {
  it("a minuta da categoria vence a minuta da DIVISÃO, e a categoria é do pai 31", async () => {
    // As duas categorias vivas moram no pai (enterprise_id 31) e carimbam lotes de QUATRO produtos
    // (27, 31, 32, 33): 907 unidades, medido em 21/09/2026. Uma minuta nessa categoria passa por
    // cima da minuta que a divisão publicar, e vale para os quatro de uma vez.
    const estado = bancoDeProducao();
    const minutas = estado.tabelas.temis_minutas as Array<Record<string, unknown>>;
    minutas.push({
      capa_nome: null, capa_path: null, conteudo: [{ type: "paragrafo" }],
      enterprise_id: "33", id: "aaaaaaaa-0000-4000-8000-000000000033",
      nome: "LBF-MINUTA-PROPRIA", situacao: "publicada", tipo: "contrato", versao: 1,
    });
    minutas.push({
      capa_nome: null, capa_path: null, conteudo: [{ type: "paragrafo" }],
      enterprise_id: "31", id: "aaaaaaaa-0000-4000-8000-000000000031",
      nome: "LAB-MINUTA-CONDOMINIO", situacao: "publicada", tipo: "contrato", versao: 1,
    });
    const categorias = estado.tabelas.temis_categorias as Array<Record<string, unknown>>;
    const condominio = categorias.find((c) => c.id === CAT_CONDOMINIO)!;
    condominio.minuta_id = "aaaaaaaa-0000-4000-8000-000000000031";

    const lbf = RECORTES.find((r) => r.empC2x === "31" && r.uniC2x === "33" && r.cat === CAT_CONDOMINIO)!;
    const { escolha } = await escolher(lbf, estado);

    expect(escolha.ok && escolha.minuta?.nome).toBe("LAB-MINUTA-CONDOMINIO");
    expect(escolha.ok && escolha.minuta?.origem).toBe("categoria");
  });
});

// ── O QUE A REVISÃO DE 21/09/2026 FECHOU ────────────────────────────────────
//
// Os quatro casos abaixo nasceram como testes "DEFEITO", falhando de propósito, e cada um descrevia
// um jeito de o contrato sair errado em silêncio. Os quatro estão fechados; o que se lê aqui agora
// é a régua, e a régua é medida contra o mesmo cadastro de produção do resto do arquivo.

describe("a régua de família, na cadeia inteira", () => {
  it("a minuta da categoria de OUTRO produto é recusada, nomeando as duas pontas", async () => {
    // O caminho irmão — `minutaPedida`, com `empreendimentosQueServem` — ganhou esta trava em
    // 16/09/2026, porque *"bastava trocar o minutaId para imprimir o contrato de um loteamento com
    // o modelo de outro"*. A categoria era a única peça da cadeia sem ela, e é a que mais pesa: a
    // categoria vence TODOS os outros degraus, então o erro não teria segundo dono.
    const estado = bancoDeProducao();
    const categorias = estado.tabelas.temis_categorias as Array<Record<string, unknown>>;
    const condominio = categorias.find((c) => c.id === CAT_CONDOMINIO)!;
    // A minuta publicada do VALE DO OURO (36), pendurada numa categoria do LAGOA BONITA (31).
    condominio.minuta_id = "84ee5ce7-0eb9-4c7d-891a-90c9c9fcad37";

    const lagoaBonita = RECORTES.find(
      (r) => r.empC2x === "31" && r.uniC2x === "27" && r.cat === CAT_CONDOMINIO,
    )!;
    const { escolha } = await escolher(lagoaBonita, estado);

    expect(escolha.ok).toBe(false);
    if (escolha.ok) return;
    // A frase nomeia a minuta intrusa e o empreendimento da venda: quem lê sabe o que desfazer.
    expect(escolha.erro).toContain("VOL-MINUTA-COMPRA-VENDA-NORMAL");
    expect(escolha.erro).toContain("Lagoa Bonita");
  });

  it("a divisão da unidade só vence o empreendimento da proposta DENTRO da família", async () => {
    // Hoje são ZERO as propostas nessa situação (medido em 21/09/2026: toda unidade mora no
    // empreendimento da proposta ou num filho dele). Nada no código garantia isso: a cadeia lia
    // `hercules_unidades.enterprise_id` e o transformava em degrau sem perguntar de quem ele era —
    // e como a divisão vem ANTES, ela decidiria a minuta.
    const estado = bancoDeProducao();
    const cidadeJardimComLoteDoVeredas = {
      cat: "",
      empC2x: "22",
      empCod: "CDJ",
      empNome: "Cidade Jardim",
      propostas: 0,
      uniC2x: "19",
    };
    const { cadeia, escolha } = await escolher(cidadeJardimComLoteDoVeredas, estado);

    // O modelo do Veredas do Ouro NÃO assina uma venda do Cidade Jardim.
    expect(escolha.ok && escolha.minuta).toBeNull();
    // E o degrau intruso não entra nem para os anexos.
    expect(cadeia.niveis.some((n) => n.id === "19")).toBe(false);
    // ⚠️ MAS NÃO EM SILÊNCIO: quem for gerar o papel lê o recado. Ver `CadeiaDoContrato.avisos`.
    expect((cadeia.avisos ?? []).join(" ")).toContain("Veredas do Ouro");
  });
});

describe("o anexo cadastrado na ficha CONSOLIDADA", () => {
  it("a peça gravada em group: entra no contrato do filho, pelo alias da raiz", async () => {
    // `apolo_enterprise_settings` tem `group:Lagoa Bonita` com `recepcao_cad = true`: ele APARECE
    // no seletor da Têmis, e o cadastro de anexos grava `enterprise_id` exatamente como a tela
    // mandou (`lerAlcance`, em estrutura-servico.ts). Até 21/09/2026 a cadeia só conhecia o id
    // numérico, e a peça sumia do PDF sem erro e sem aviso — com a MESMA tela listando o anexo.
    const estado = bancoDeProducao();
    estado.tabelas.temis_anexos = [
      {
        arquivo_bytes: 1024,
        ativo: true,
        categoria_id: null,
        enterprise_id: "group:Lagoa Bonita",
        id: "bbbbbbbb-0000-4000-8000-000000000001",
        nome: "Convenção do condomínio",
        posicao: 1,
        storage_path: "temis-anexos/empreendimento/group:Lagoa Bonita/convencao.pdf",
        unidade_id: null,
      },
    ];

    const lbf = RECORTES.find(
      (r) => r.empC2x === "31" && r.uniC2x === "33" && r.cat === CAT_CONDOMINIO,
    )!;
    const { cadeia } = await escolher(lbf, estado);
    const lidos = await lerAnexosDaVenda(clienteEmMemoria(estado) as never, cadeia);

    expect(lidos.ok && lidos.anexos.map((a) => a.nome)).toEqual(["Convenção do condomínio"]);
    // E ela se apresenta pelo nome do degrau, não pelo rótulo cru do catálogo.
    expect(lidos.ok && lidos.anexos[0]?.rotuloDoNivel).toBe("Lagoa Bonita");
  });
});

describe("o marcador que promete uma peça", () => {
  it("[anexo_3] sem arquivo cadastrado entra em semValor e trava a geração", () => {
    const r = preencherContrato(
      [
        {
          children: [
            { text: "Fica fazendo parte deste contrato o " },
            { children: [{ text: "" }], nome: "anexo_3", type: "variavel" },
            { text: ", devidamente rubricado." },
          ],
          type: "p",
        },
      ],
      { compradores: [], gerais: {} },
    );

    expect(r.marcadores).toEqual(["anexo_3"]);
    // ⚠️ É A MESMA TRAVA DE `[cpf_cliente]`, e pela mesma razão: o papel prometia em cláusula uma
    // peça que não ia junto, saía assim e nada denunciava. Custo medido: zero — nenhuma das 11
    // minutas usa `anexo_N` (a v6 do VOL usa `[inicio_tem_anexo_1]`, que é bloco e continua igual).
    expect(r.semValor).toEqual(["anexo_3"]);
  });

  it("[anexo_3] COM arquivo cadastrado sai calado, e não trava nada", () => {
    const r = preencherContrato(
      [
        {
          children: [
            { text: "Fica fazendo parte deste contrato o " },
            { children: [{ text: "" }], nome: "anexo_3", type: "variavel" },
            { text: "." },
          ],
          type: "p",
        },
      ],
      { anexos: { 3: "Memorial descritivo" }, compradores: [], gerais: {} },
    );

    expect(r.marcadores).toEqual(["anexo_3"]);
    expect(r.semValor).toEqual([]);
  });
});
