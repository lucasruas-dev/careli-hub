import { beforeEach, describe, expect, it, vi } from "vitest";

// A CHECAGEM DO CPF, extraída da rota do hub (16/09/2026) para o CRM do portal usar a mesma.
//
// Travado aqui: a frase do hub continua a de sempre (nomeia o empreendimento), o conflito sai com a
// CATEGORIA ao lado (é por ela que o portal traduz sem nomear ninguém), leitura da esteira que
// falha devolve `null` ("não conferido") e o núcleo familiar só roda quando o documento passou.

const estado = vi.hoisted(() => ({
  cads: vi.fn(),
  nucleo: vi.fn(),
}));

vi.mock("@/lib/guardian/db", () => ({ getHadesDbPool: () => ({ ok: false }) }));

vi.mock("@/lib/apolo/esteira-cad", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/esteira-cad")>()),
  lerCadsDaEsteira: estado.cads,
}));

vi.mock("@/lib/apolo/nucleo-familiar", async (original) => ({
  ...(await original<typeof import("@/lib/apolo/nucleo-familiar")>()),
  conflitoDeNucleoFamiliar: estado.nucleo,
}));

import { conferirCpfNoEmpreendimento } from "./cadastro-checar-cpf";

function clienteFalso(fichas: string[]) {
  const builder = {
    eq: () => builder,
    select: () => builder,
    then: (resolver: (valor: unknown) => unknown) =>
      Promise.resolve(resolver({ data: fichas.map((id) => ({ entity_id: id, id })), error: null })),
  };
  return { from: () => builder } as never;
}

beforeEach(() => {
  estado.cads.mockReset();
  estado.nucleo.mockReset();
  estado.nucleo.mockResolvedValue(null);
});

describe("conferirCpfNoEmpreendimento", () => {
  const pedido = { cpf: "52998224725", cpfConjuge: "", enterpriseId: "37" };

  it("CAD no mesmo empreendimento: a frase do hub e a categoria", async () => {
    estado.cads.mockResolvedValue([{ empreendimento: "VALE DO OURO", enterprise_id: "37" }]);
    expect(await conferirCpfNoEmpreendimento(clienteFalso(["ent-1"]), pedido)).toEqual({
      conflito: {
        mensagem: "Este CPF já possui CAD para o empreendimento VALE DO OURO.",
        tipo: "cpf-ja-tem-cad",
      },
    });
    expect(estado.nucleo).not.toHaveBeenCalled();
  });

  it("CAD só em outro empreendimento: livre, e confere o núcleo sem as fichas do titular", async () => {
    estado.cads.mockResolvedValue([{ empreendimento: "GARDEN", enterprise_id: "50" }]);
    expect(await conferirCpfNoEmpreendimento(clienteFalso(["ent-1"]), pedido)).toEqual({
      conflito: null,
    });
    expect(estado.nucleo).toHaveBeenCalledWith(
      expect.objectContaining({ cpfTitular: "52998224725", enterpriseId: "37", ignorarEntityIds: ["ent-1"] }),
    );
  });

  it("leitura da esteira falhou: não conferido (null), a trava do salvar decide", async () => {
    estado.cads.mockRejectedValue(new Error("rede"));
    expect(await conferirCpfNoEmpreendimento(clienteFalso(["ent-1"]), pedido)).toBeNull();
  });

  it("núcleo familiar: frase do hub com o tipo do conflito", async () => {
    estado.cads.mockResolvedValue([]);
    estado.nucleo.mockResolvedValue({
      cpfParcial: "529.***.***-**",
      empreendimento: "VALE DO OURO",
      motivo: "titular-ja-e-conjuge-de-quem-tem-cad",
      nomeExistente: "JOÃO DA SILVA",
    });
    const r = await conferirCpfNoEmpreendimento(clienteFalso([]), pedido);
    expect(r?.conflito).toEqual({
      mensagem: "O CPF do cônjuge do JOÃO DA SILVA já possui CAD para o empreendimento VALE DO OURO.",
      tipo: "titular-ja-e-conjuge-de-quem-tem-cad",
    });
  });
});
