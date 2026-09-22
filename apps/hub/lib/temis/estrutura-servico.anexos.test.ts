import { beforeEach, describe, expect, it, vi } from "vitest";

import { clienteEmMemoria, type EstadoDoBanco, novoEstado } from "./fixtures/supabase-em-memoria";

// AS DUAS TRAVAS DO CADASTRO DE ANEXO, medidas contra o banco de produção em 22/09/2026 e
// travadas aqui para não voltarem.
//
// ⚠️ 1. A CHAVE. `temis_anexos.enterprise_id` guarda o ID DO C2X — o mesmo que a unidade carrega e
// que `temis_minutas` usa. A coluna é texto e aceitava qualquer coisa: mandar o uuid do Panteon
// gravava com 200, a peça aparecia na lista da própria tela e o contrato saía SEM ELA, para sempre
// e sem aviso. Medido com a venda da VITORIA: pelo uuid o contrato trouxe 0 anexos; pelo id do C2X
// (36), trouxe 1.
//
// ⚠️ 2. A POSIÇÃO. Os índices únicos da 0156 são POR NÍVEL: o banco aceita posição 1 no pai e
// posição 1 na divisão sem um pio. Quem soma os níveis é a montagem do contrato, e lá a colisão não
// é aviso, é RECUSA TOTAL (409) — o contrato não sai e ninguém vence. A conta chegava dias depois
// do cadastro, longe da causa, em cima de uma venda pronta para assinar.
//
// Cadastro usado: VLO = 35 (pai), VOL = 36 (divisão), ambos com uuid próprio.

const estado: { atual: EstadoDoBanco } = { atual: novoEstado() };

vi.mock("@/lib/apolo/server", () => ({
  APOLO_DOCS_BUCKET: "apolo-documents",
  createApoloAdminClient: () => clienteEmMemoria(estado.atual),
}));

const UUID_DO_VOL = "af45a402-c369-45ca-8403-a67ddbc82d8e";
const UUID_DO_VLO = "06923bf9-2a46-4639-bf29-9f18f6f93636";

const ATOR = {
  nome: "Zeus",
  papel: "escrita" as const,
  tipo: "hub" as const,
  userId: "11111111-1111-1111-1111-111111111111",
};

const CAMINHO = "temis-anexos/empreendimento/36/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee-peca.pdf";

function pedido(corpo: unknown): Request {
  return new Request("https://c2x.app.br/api/temis/anexos", {
    body: JSON.stringify(corpo),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

beforeEach(() => {
  estado.atual = novoEstado();
  estado.atual.tabelas.hercules_empreendimentos = [
    { c2x_enterprise_id: "35", id: UUID_DO_VLO, nome: "Vale do Ouro", pai_id: null, workspace_id: "careli" },
    { c2x_enterprise_id: "36", id: UUID_DO_VOL, nome: "Vale do Ouro · VOL", pai_id: UUID_DO_VLO, workspace_id: "careli" },
  ];
  estado.atual.tabelas.temis_categorias = [];
  estado.atual.tabelas.temis_anexos = [];
});

/** As tabelas do fixture são `Record<string, Linha[]>`: o índice pode vir vazio. */
const tabela = (nome: string) => (estado.atual.tabelas[nome] ??= []);

async function confirmar(enterpriseId: string, posicao: number, nome: string) {
  const { gravarAnexo } = await import("./estrutura-servico");
  const resposta = await gravarAnexo(
    ATOR,
    pedido({ acao: "confirmar", enterpriseId, nome, path: CAMINHO, posicao }),
  );
  return { corpo: (await resposta.json()) as Record<string, unknown>, status: resposta.status };
}

describe("a chave do empreendimento no anexo", () => {
  it("⚠️ o uuid do Panteon vira o id do C2X, que é o que a cadeia do contrato procura", async () => {
    const r = await confirmar(UUID_DO_VOL, 1, "Matrícula");

    expect(r.status).toBe(200);
    const anexo = r.corpo.anexo as Record<string, unknown>;
    expect(anexo.enterpriseId).toBe("36");
  });

  it("o id do C2X passa direto, sem conversão", async () => {
    const r = await confirmar("36", 1, "Matrícula");

    expect(r.status).toBe(200);
    expect((r.corpo.anexo as Record<string, unknown>).enterpriseId).toBe("36");
  });

  it("id que não existe no cadastro é recusado, em vez de virar peça órfã", async () => {
    const r = await confirmar("99999", 1, "Matrícula");

    expect(r.status).toBe(400);
    expect(String(r.corpo.error)).toContain("Não encontrei este empreendimento");
  });

  it("empreendimento sem id do sistema de vendas é recusado NOMEANDO a saída", async () => {
    const semC2x = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    tabela("hercules_empreendimentos").push({
      c2x_enterprise_id: null,
      id: semC2x,
      nome: "Lavra do Ouro",
      pai_id: null,
      workspace_id: "careli",
    });

    const r = await confirmar(semC2x, 1, "Matrícula");

    expect(r.status).toBe(400);
    expect(String(r.corpo.error)).toContain("Lavra do Ouro");
    expect(String(r.corpo.error)).toContain("Escolha a divisão");
  });
});

describe("a posição é única na FAMÍLIA, e não só no nível", () => {
  it("⚠️ posição ocupada no pai recusa a mesma posição no filho", async () => {
    const primeiro = await confirmar("35", 1, "Matrícula do Vale do Ouro");
    expect(primeiro.status).toBe(200);

    const segundo = await confirmar("36", 1, "Memorial do VOL");

    expect(segundo.status).toBe(409);
    expect(String(segundo.corpo.error)).toContain("Matrícula do Vale do Ouro");
    expect(String(segundo.corpo.error)).toContain("outro nível deste mesmo produto");
  });

  it("e o contrário também: ocupada no filho, recusa no pai", async () => {
    expect((await confirmar("36", 3, "Peça do VOL")).status).toBe(200);

    const noPai = await confirmar("35", 3, "Peça do pai");

    expect(noPai.status).toBe(409);
  });

  it("posição livre na família passa, e é assim que os níveis se somam", async () => {
    expect((await confirmar("35", 1, "Matrícula")).status).toBe(200);
    expect((await confirmar("36", 2, "Memorial")).status).toBe(200);

    const gravados = tabela("temis_anexos");
    expect(gravados).toHaveLength(2);
    expect(gravados.map((a) => `${String(a.enterprise_id)}:${String(a.posicao)}`).sort()).toEqual([
      "35:1",
      "36:2",
    ]);
  });

  it("anexo DESATIVADO não segura a posição", async () => {
    await confirmar("35", 1, "Peça antiga");
    const antiga = tabela("temis_anexos")[0];
    if (antiga) antiga.ativo = false;

    expect((await confirmar("36", 1, "Peça nova")).status).toBe(200);
  });

  it("família de outro produto não interfere", async () => {
    tabela("hercules_empreendimentos").push({
      c2x_enterprise_id: "39",
      id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      nome: "Garden",
      pai_id: null,
      workspace_id: "careli",
    });

    expect((await confirmar("35", 1, "Matrícula do Vale do Ouro")).status).toBe(200);
    expect((await confirmar("39", 1, "Matrícula do Garden")).status).toBe(200);
  });
});
