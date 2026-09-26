import { beforeEach, describe, expect, it, vi } from "vitest";

// A BUSCA DE PROPONENTES FORA DO COMERCIAL (revisão de 16/09/2026). A família do VOC (37) é 35 + 36
// + 37 + 41, e o 36 é a carteira do Lino: com a família inteira, o time do Cecílio varria prefixos de
// CPF e levava nome, CPF e etapa de qualquer comprador do Vale do Ouro. A rota é chamada de verdade,
// com o banco falso abaixo.

type Linha = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  permitidos: ["37", "39"] as string[],
  tipo: "incorporador" as "comercial" | "incorporador",
}));

const ESTEIRA: Linha[] = [
  // O cliente do próprio Cecílio, com CAD no VOC.
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "37", entity_id: "e-voc", etapa: "credenciado" },
  // O cliente do Lino, com CAD no VOL.
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "36", entity_id: "e-lino", etapa: "credenciado" },
  // O cliente com a CAD no espelho do pai (onde mora quase toda CAD do Vale do Ouro).
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "35", entity_id: "e-espelho", etapa: "credenciado" },
  // (26/09/2026) AS EMPRESAS, do mesmo jeito: uma no espelho do pai, outra na carteira do Lino.
  // Lucas: *"temos que habilitar pessoa fisica e pessoa juridica, hoje só atende pessoa fisica"*.
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "35", entity_id: "e-pj-espelho", etapa: "credenciado" },
  { atualizado_em: "2026-09-10", chegou_em: null, created_at: "2026-09-01", enterprise_id: "36", entity_id: "e-pj-lino", etapa: "credenciado" },
];

const ENTIDADES: Linha[] = [
  { display_name: "Ana do VOC", document_masked: "111.111.111-11", document_hash: null, id: "e-voc", legal_name: null, trade_name: null },
  { display_name: "Ana do Lino", document_masked: "222.222.222-22", document_hash: null, id: "e-lino", legal_name: null, trade_name: null },
  { display_name: "Ana do Espelho", document_masked: "333.333.333-33", document_hash: null, id: "e-espelho", legal_name: null, trade_name: null },
  { display_name: "ACME do Espelho", document_masked: "12.345.678/0001-95", document_hash: null, id: "e-pj-espelho", legal_name: "ACME Construtora Ltda", trade_name: "ACME do Espelho" },
  { display_name: "BETA do Lino", document_masked: "11.222.333/0001-81", document_hash: null, id: "e-pj-lino", legal_name: "BETA Empreendimentos Ltda", trade_name: "BETA do Lino" },
];

const IDENTIFICADORES: Linha[] = [
  { entity_id: "e-voc", value_hash: "hash:cpf:11111111111" },
  { entity_id: "e-lino", value_hash: "hash:cpf:22222222222" },
  { entity_id: "e-espelho", value_hash: "hash:cpf:33333333333" },
  // ⚠️ NAMESPACE `cnpj`, E ISSO É O PONTO. `hashIdentifier` concatena "apolo-identifier:TIPO:valor":
  // hasheado como "cpf", um CNPJ gera uma chave que não existe em lugar nenhum do banco. MEDIDO em
  // 26/09/2026 (produção, só SELECT): as 11 CADs de entidade pj da esteira têm identificador `cnpj`
  // cujo `value_hash` é igual ao `document_hash` da entidade em 11 de 11 casos, e ZERO delas casa
  // com um hash de namespace `cpf`.
  { entity_id: "e-pj-espelho", value_hash: "hash:cnpj:12345678000195" },
  { entity_id: "e-pj-lino", value_hash: "hash:cnpj:11222333000181" },
];

function clienteFalso() {
  const from = (tabela: string) => {
    const filtros: Array<(linha: Linha) => boolean> = [];
    const base = (): Linha[] => {
      if (tabela === "hercules_unidades") return [{ enterprise_id: "37", id: "u-voc", workspace_id: "careli" }];
      if (tabela === "apolo_esteira") return ESTEIRA;
      if (tabela === "apolo_entities") return ENTIDADES;
      if (tabela === "apolo_entity_identifiers") return IDENTIFICADORES;
      return [];
    };
    const resultado = () => ({ data: base().filter((l) => filtros.every((f) => f(l))), error: null });
    const cadeia = {
      eq: (coluna: string, valor: unknown) => {
        filtros.push((l) => l[coluna] === valor);
        return cadeia;
      },
      in: (coluna: string, valores: unknown[]) => {
        filtros.push((l) => valores.includes(l[coluna]));
        return cadeia;
      },
      limit: () => cadeia,
      maybeSingle: () => Promise.resolve({ data: resultado().data[0] ?? null, error: null }),
      select: () => cadeia,
      then: (ok: (valor: ReturnType<typeof resultado>) => unknown) => Promise.resolve(resultado()).then(ok),
    };
    return cadeia;
  };
  return { from };
}

vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: () => clienteFalso(),
  hashIdentifier: (tipo: string, valor: string) => `hash:${tipo}:${valor}`,
}));

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({
    ok: true,
    sessao: { slug: "cecilio-rocha", tipo: estado.tipo, usuarioId: "u", usuarioNome: "Maria" },
  }),
}));

vi.mock("@/lib/apolo/incorporador/escopo", () => ({
  idsDaSessao: async () => estado.permitidos,
}));

vi.mock("@/lib/apolo/catalogo-empreendimentos", () => ({
  catalogoDeEmpreendimentos: async () => [
    { codes: ["VOL", "VOC", "VOR"], id: "group:Vale do Ouro", name: "Vale do Ouro", stageIds: ["36", "37", "41"] },
    { codes: ["VLO"], id: "35", name: "Vale do Ouro", stageIds: ["35"] },
    { codes: ["GDN"], id: "39", name: "Garden", stageIds: ["39"] },
  ],
}));

vi.mock("@/lib/hercules/cadastro", () => ({
  carregarCadastroDeEmpreendimentos: async () => [
    { c2xEnterpriseId: "35", codigo: "VLO", id: "vlo", nome: "Vale do Ouro", paiId: null },
    { c2xEnterpriseId: "36", codigo: "VOL", id: "vol", nome: "VOL", paiId: "vlo" },
    { c2xEnterpriseId: "37", codigo: "VOC", id: "voc", nome: "VOC", paiId: "vlo" },
    { c2xEnterpriseId: "41", codigo: "VOR", id: "vor", nome: "VOR", paiId: "vlo" },
    { c2xEnterpriseId: "39", codigo: "GDN", id: "gdn", nome: "Garden", paiId: null },
  ],
}));

import { GET } from "./route";

async function buscar(q: string): Promise<string[]> {
  const resposta = await GET(
    new Request(`https://c2x.app.br/api/incorporador/venda/proponentes?unidade=u-voc&q=${encodeURIComponent(q)}`),
  );
  expect(resposta.status).toBe(200);
  const corpo = (await resposta.json()) as { data: { encontrados: Array<{ nome: string }> } };
  return corpo.data.encontrados.map((p) => p.nome).sort();
}

beforeEach(() => {
  estado.permitidos = ["37", "39"];
  estado.tipo = "incorporador";
});

describe("GET /api/incorporador/venda/proponentes fora do comercial", () => {
  it("⚠️ pelo nome, só quem tem CAD na família que a sessão alcança (nem o Lino, nem o espelho)", async () => {
    expect(await buscar("ana")).toEqual(["Ana do VOC"]);
  });

  it("⚠️ prefixo de CPF não abre a lista do Vale do Ouro", async () => {
    expect(await buscar("2222")).toEqual([]);
    expect(await buscar("3333")).toEqual([]);
  });

  it("o CPF INTEIRO acha o cliente cuja CAD mora no espelho do pai", async () => {
    expect(await buscar("333.333.333-33")).toEqual(["Ana do Espelho"]);
  });

  it("⚠️ nem com o CPF inteiro sai o cliente do irmão de outro dono (36)", async () => {
    expect(await buscar("22222222222")).toEqual([]);
  });

  // ── AS MESMAS DUAS PERGUNTAS, COM CNPJ ─────────────────────────────────────
  //
  // (26/09/2026) O ramo do documento inteiro deixou de ser `digitos.length === 11` e passou a
  // `tipoDePessoa(termo.digitos) !== null`, ou seja, o oráculo "este documento existe na base da
  // Careli" passou a valer para CNPJ também, no espelho do pai e fora do comercial. É ramo de
  // PRIVACIDADE: foi aqui que a busca já devolveu o VOL do Lino (ver o comentário de
  // `familia-no-portal.ts`), e sem o par de casos o único caminho coberto seria o de 11 dígitos.
  it("o CNPJ INTEIRO acha a empresa cuja CAD mora no espelho do pai", async () => {
    expect(await buscar("12.345.678/0001-95")).toEqual(["ACME do Espelho"]);
    expect(await buscar("12345678000195")).toEqual(["ACME do Espelho"]);
  });

  it("⚠️ prefixo de CNPJ não abre a lista do Vale do Ouro", async () => {
    expect(await buscar("1234567800")).toEqual([]);
  });

  it("⚠️ nem com o CNPJ inteiro sai a empresa do irmão de outro dono (36)", async () => {
    expect(await buscar("11.222.333/0001-81")).toEqual([]);
  });
});

describe("GET /api/incorporador/venda/proponentes no comercial", () => {
  it("continua lendo a família inteira, como antes", async () => {
    estado.tipo = "comercial";
    estado.permitidos = ["35", "36", "37", "41", "group:Vale do Ouro"];
    expect(await buscar("ana")).toEqual(["Ana do Espelho", "Ana do Lino", "Ana do VOC"]);
  });
});
