import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A CAD REGENERADA PELO SERVIDOR (a de toda troca de etapa, a do anexo da reprovação, a da cobrança
// de pré-venda). Até 24/09/2026 não havia teste de `montarCadDeEntidade`. O que está travado aqui é
// o que o caso do Jonatas mostrou:
//   • o EMPREENDIMENTO sai da MESMA linha da esteira que dá imobiliária e corretor (id + texto de
//     reserva), e a ficha da imobiliária não leva empreendimento;
//   • "Enviado em" é a chegada REAL da CAD (`chegou_em`), no fuso de Brasília. O Lucas leu 15:23
//     (UTC da regeneração) numa CAD enviada em 21/09/2026 às 15:14;
//   • o nome do arquivo é a hora da GERAÇÃO, também em Brasília;
//   • SEM o id da CAD e com DUAS OU MAIS CADs, a linha Empreendimento NÃO sai (revisão de
//     24/09/2026: a "mais recente" pode ser outra CAD, e a cobrança do 20 sairia com "Villa Paris");
//   • COM o id, a ficha que nasceu imobiliária e tem CAD de cliente imprime o empreendimento (D7).

const estado = vi.hoisted(() => ({
  // `lerCadDaEsteira`: a leitura COM o id da CAD.
  esteira: vi.fn(),
  // `lerCadsDaEsteira`: a leitura SEM o id (até duas linhas, a mais recente primeiro).
  esteiras: vi.fn(),
  mercado: vi.fn(async () => "Vale do Ouro"),
}));

vi.mock("@/lib/apolo/esteira-cad", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/esteira-cad")>()),
  lerCadDaEsteira: estado.esteira,
  lerCadsDaEsteira: estado.esteiras,
}));
vi.mock("@/lib/apolo/empreendimento-de-mercado", () => ({
  nomeDeMercadoDoEmpreendimento: estado.mercado,
}));
vi.mock("@/lib/apolo/server", () => ({
  createApoloAdminClient: vi.fn(),
  fetchC2xCadastroByEntity: vi.fn(async () => ({ cadastro: new Map() })),
}));
vi.mock("@/lib/apolo/cadastro-persist", () => ({ gerarCodigoAutenticacao: () => "CAD-GERADO" }));
vi.mock("@/lib/apolo/limite-credito", () => ({ resolverLimiteCredito: vi.fn(async () => null) }));

import { dataHoraEmBrasilia, montarCadDeEntidade } from "./cad-de-entidade";

const JONATAS = {
  created_at: "2026-09-21T18:14:51.000Z",
  display_name: "JONATAS BRUCE DE OLIVEIRA",
  document_masked: "529.982.247-25",
  entity_kind: "pf",
  id: "c34d4b6c-ac71-43ca-b7c2-6a7ec7f69c29",
  legal_name: null,
  metadata: { autenticacao: { codigo: "CAD-2026-90D26E89" }, bornRole: "prospect" },
  trade_name: null,
};

// A linha da CAD do Jonatas no 35, como a esteira devolve.
const LINHA_DO_35 = {
  chegou_em: "2026-09-21T18:14:52.000Z",
  corretor: null,
  empreendimento: "VALE DO OURO",
  enterprise_id: "35",
  ficha: null,
  imobiliaria: null,
};

const IMOBILIARIA = {
  ...JONATAS,
  entity_kind: "pj",
  legal_name: "IMOB ALFA LTDA",
  metadata: { bornRole: "imobiliaria" },
};

// Cliente falso: toda cadeia de consulta devolve lista vazia, e o `maybeSingle` só acha a entidade
// (e a consulta de crédito, quando o teste passa uma).
function clienteFalso(entidade: Record<string, unknown>, consulta: null | Record<string, unknown> = null) {
  return {
    from(tabela: string) {
      const builder: Record<string, unknown> = {
        eq: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({
          data:
            tabela === "apolo_entities" ? entidade : tabela === "serasa_consultas" ? consulta : null,
          error: null,
        }),
        order: () => builder,
        select: () => builder,
        then: (ok: (v: unknown) => unknown, falha: (e: unknown) => unknown) =>
          Promise.resolve({ data: [], error: null }).then(ok, falha),
      };
      return builder;
    },
  } as never;
}

// ⚠️ O PROCESSO RODA EM UTC, COMO NA VERCEL. Numa máquina em Brasília, formatar sem `timeZone` já
// sairia certo por acaso, e o teste não pegaria a volta do defeito. O Node relê `TZ` em tempo de
// execução.
const TZ_ORIGINAL = process.env.TZ;

beforeEach(() => {
  process.env.TZ = "UTC";
  // Regenerada em 24/09/2026 15:23:36 UTC = 12:23 em Brasília (o PDF que o Lucas abriu).
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T15:23:36.000Z"));
  estado.esteira.mockReset();
  estado.esteiras.mockReset();
  estado.mercado.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  if (TZ_ORIGINAL === undefined) delete process.env.TZ;
  else process.env.TZ = TZ_ORIGINAL;
});

describe("montarCadDeEntidade: cabeçalho", () => {
  it("empreendimento da MESMA linha da esteira, pelo id, com o texto só de reserva", async () => {
    estado.esteira.mockResolvedValue({
      chegou_em: "2026-09-21T18:14:52.000Z",
      corretor: "RONILSON BELTRÃO DINIZ",
      empreendimento: "VALE DO OURO",
      enterprise_id: "35",
      ficha: null,
      imobiliaria: "BELTRAO DINIZ IMOVEIS LTDA",
    });
    const client = clienteFalso(JONATAS);
    const cad = await montarCadDeEntidade(client, JONATAS.id, { enterpriseId: "35" });

    // A leitura é UMA linha, a do empreendimento pedido, com as colunas novas junto das antigas.
    expect(estado.esteira).toHaveBeenCalledTimes(1);
    const [, entityId, colunas, opcoes] = estado.esteira.mock.calls[0]!;
    expect(entityId).toBe(JONATAS.id);
    expect(String(colunas).split(",").map((c) => c.trim())).toEqual(
      expect.arrayContaining(["corretor", "imobiliaria", "empreendimento", "enterprise_id", "chegou_em"]),
    );
    expect(opcoes).toEqual({ enterpriseId: "35" });

    expect(estado.mercado).toHaveBeenCalledWith(client, "35", "VALE DO OURO");
    expect(cad).toMatchObject({
      corretor: "RONILSON BELTRÃO DINIZ",
      empreendimento: "Vale do Ouro",
      imobiliaria: "BELTRAO DINIZ IMOVEIS LTDA",
    });
  });

  it("'Enviado em' é a chegada REAL, em Brasília; o arquivo leva a hora da geração, em Brasília", async () => {
    estado.esteiras.mockResolvedValue([LINHA_DO_35]);
    const cad = await montarCadDeEntidade(clienteFalso(JONATAS), JONATAS.id);
    expect(cad?.data).toBe("21/09/2026");
    expect(cad?.hora).toBe("15:14");
    expect(cad?.arquivo).toBe("CAD - Jonatas Bruce De Oliveira - 24/09/2026 12:23");
  });

  it("sem chegou_em (ou sem esteira), 'Enviado em' é a hora atual, em Brasília e não em UTC", async () => {
    estado.esteiras.mockResolvedValue([]);
    const cad = await montarCadDeEntidade(clienteFalso(JONATAS), JONATAS.id);
    expect(cad?.data).toBe("24/09/2026");
    expect(cad?.hora).toBe("12:23");
    // Sem linha na esteira não há CAD: nada a imprimir, e o cadastro nem é consultado.
    expect(estado.mercado).not.toHaveBeenCalled();
    expect(cad?.empreendimento).toBeUndefined();
  });

  it("resolvedor sem nome confiável: a linha não sai (campo ausente, não string vazia)", async () => {
    estado.esteiras.mockResolvedValue([
      { ...LINHA_DO_35, chegou_em: null, empreendimento: "EMPREENDIMENTO 30", enterprise_id: "30" },
    ]);
    estado.mercado.mockResolvedValueOnce("");
    const cad = await montarCadDeEntidade(clienteFalso(JONATAS), JONATAS.id);
    expect(cad?.empreendimento).toBeUndefined();
  });

  it("a ficha da IMOBILIÁRIA (sem o id da CAD) sai sem empreendimento e nem consulta o cadastro", async () => {
    estado.esteiras.mockResolvedValue([LINHA_DO_35]);
    const cad = await montarCadDeEntidade(clienteFalso(IMOBILIARIA), IMOBILIARIA.id);
    expect(estado.mercado).not.toHaveBeenCalled();
    expect(cad?.empreendimento).toBeUndefined();
    expect(cad?.titulo).toBe("Cadastro de Imobiliária");
  });
});

// ⚠️ REVISÃO DE 24/09/2026: CAD montada SEM o id (a cobrança antiga da pré-venda, a CACÁ, a bancada, o
// teste de disparo, o botão CAD do Board) caía na "mais recente". Com a linha nova do cabeçalho, uma
// pessoa com CAD no 38 e no 20 recebia na cobrança do 20 um PDF escrito "Villa Paris".
describe("montarCadDeEntidade: de qual CAD é o PDF", () => {
  it("SEM o id e com UMA CAD: a leitura pede até duas linhas, e a linha Empreendimento sai", async () => {
    estado.esteiras.mockResolvedValue([LINHA_DO_35]);
    const client = clienteFalso(JONATAS);
    const cad = await montarCadDeEntidade(client, JONATAS.id);

    expect(estado.esteira).not.toHaveBeenCalled();
    expect(estado.esteiras).toHaveBeenCalledTimes(1);
    const [, entityId, colunas, opcoes] = estado.esteiras.mock.calls[0]!;
    expect(entityId).toBe(JONATAS.id);
    expect(String(colunas).split(",").map((c) => c.trim())).toEqual(
      expect.arrayContaining(["corretor", "imobiliaria", "empreendimento", "enterprise_id", "chegou_em"]),
    );
    expect(opcoes).toEqual({ limite: 2 });
    expect(estado.mercado).toHaveBeenCalledWith(client, "35", "VALE DO OURO");
    expect(cad?.empreendimento).toBe("Vale do Ouro");
  });

  it("SEM o id e com DUAS CADs: a linha Empreendimento NÃO sai (a mais recente pode ser a outra)", async () => {
    estado.esteiras.mockResolvedValue([
      { ...LINHA_DO_35, corretor: "CORRETOR DO 38", empreendimento: "VILLA PARIS", enterprise_id: "38" },
      { ...LINHA_DO_35, empreendimento: "RECANTO DO PARA", enterprise_id: "20" },
    ]);
    const cad = await montarCadDeEntidade(clienteFalso(JONATAS), JONATAS.id);

    expect(estado.mercado).not.toHaveBeenCalled();
    expect(cad?.empreendimento).toBeUndefined();
    // O resto do cabeçalho continua vindo da mais recente, como sempre veio (fora deste recorte).
    expect(cad?.corretor).toBe("CORRETOR DO 38");
  });

  it("COM o id e duas CADs: é a daquele empreendimento, e a linha sai", async () => {
    estado.esteira.mockResolvedValue({ ...LINHA_DO_35, empreendimento: "RECANTO DO PARA", enterprise_id: "20" });
    estado.mercado.mockResolvedValueOnce("Recanto do Pará");
    const cad = await montarCadDeEntidade(clienteFalso(JONATAS), JONATAS.id, { enterpriseId: 20 });

    expect(estado.esteiras).not.toHaveBeenCalled();
    expect(estado.esteira.mock.calls[0]?.[3]).toEqual({ enterpriseId: "20" });
    expect(cad?.empreendimento).toBe("Recanto do Pará");
  });

  it("COM o id e sem CAD naquele empreendimento: nada a imprimir", async () => {
    estado.esteira.mockResolvedValue(null);
    const cad = await montarCadDeEntidade(clienteFalso(JONATAS), JONATAS.id, { enterpriseId: "20" });
    expect(estado.mercado).not.toHaveBeenCalled();
    expect(cad?.empreendimento).toBeUndefined();
  });

  // D7 (Zeus, 24/09/2026): quem decide é a EXISTÊNCIA da CAD, não o perfil. Medido em 24/09/2026: uma
  // entidade nascida imobiliária tem CAD publico-cad no 20.
  it("ficha nascida IMOBILIÁRIA com CAD de cliente, pedida pelo id: a linha sai", async () => {
    estado.esteira.mockResolvedValue({ ...LINHA_DO_35, empreendimento: "RECANTO DO PARA", enterprise_id: "20" });
    estado.mercado.mockResolvedValueOnce("Recanto do Pará");
    const cad = await montarCadDeEntidade(clienteFalso(IMOBILIARIA), IMOBILIARIA.id, {
      enterpriseId: "20",
    });
    expect(cad?.empreendimento).toBe("Recanto do Pará");
  });
});

describe("montarCadDeEntidade: análise de crédito", () => {
  it("'Consultado em' também é o dia de Brasília (consulta às 22h30 não vira o dia seguinte)", async () => {
    estado.esteiras.mockResolvedValue([]);
    const consulta = {
      created_at: "2026-09-22T01:30:00.000Z",
      report_name: null,
      resposta: {},
      resumo: null,
      status: "sucesso",
    };
    const cad = await montarCadDeEntidade(clienteFalso(JONATAS, consulta), JONATAS.id);
    const secao = cad?.secoes.find((s) => s.title === "Análise de crédito");
    expect(secao?.fields.find((f) => f.label === "Consultado em")?.value).toBe("21/09/2026");
  });
});

describe("dataHoraEmBrasilia", () => {
  it("converte de UTC para Brasília, inclusive na virada do dia", () => {
    expect(dataHoraEmBrasilia(new Date("2026-09-21T18:14:52.000Z"))).toEqual({
      data: "21/09/2026",
      hora: "15:14",
    });
    // 01:30 UTC do dia 22 ainda é dia 21 em Brasília.
    expect(dataHoraEmBrasilia(new Date("2026-09-22T01:30:00.000Z"))).toEqual({
      data: "21/09/2026",
      hora: "22:30",
    });
  });

  it("instante inválido devolve null (quem chama cai na hora atual)", () => {
    expect(dataHoraEmBrasilia(new Date("não é data"))).toBeNull();
  });
});
