import { describe, expect, it } from "vitest";

import { hashIdentifier } from "@/lib/apolo/server";

import {
  compraDaPessoa,
  compradoresDoContrato,
  contratoAtivoNoEscopo,
  entidadesDosDocumentos,
  escolherEntidadeDoContrato,
  type LinhaDoContrato,
} from "./compra-ativa";

// A RÉGUA PURA DO COMPRADOR DA CARTEIRA (26/09/2026). Os dois formatos de `compradores` que existem
// hoje (a carga do C2X e a venda nativa), a PJ (que entrou na junção com a v1.384.0), o
// co-comprador, e a escolha da entidade em que a CAD nasce. A leitura do banco é testada em
// cliente-credenciado.test.ts.

const CPF = "529.982.247-25";
const DIGITOS = "52998224725";

function linha(parcial: Partial<LinhaDoContrato> = {}): LinhaDoContrato {
  return {
    cancelada_em: null,
    cliente_c2x_id: 7001,
    cliente_documento: CPF,
    cliente_entity_id: null,
    cliente_nome: "MARIA DA SILVA",
    codigo: "000728",
    compradores: [
      { c2x_user_id: 7001, documento: CPF, nome: "MARIA DA SILVA", percentual: 100, titular: true },
    ],
    etapa: "faturado",
    etapa_desde: "2024-03-10T12:00:00.000Z",
    id: "prop-a",
    unidade: { codigo: "VDO0728", enterprise_id: 19, id: "uni-728" },
    ...parcial,
  };
}

describe("contratoAtivoNoEscopo", () => {
  it("só 'faturado', sem cancelamento, com a unidade dentro do escopo (pelo id, número ou texto)", () => {
    const escopo = new Set(["19"]);
    expect(contratoAtivoNoEscopo(linha(), escopo)).toBe(true);
    expect(contratoAtivoNoEscopo(linha({ etapa: "assinatura" }), escopo)).toBe(false);
    expect(contratoAtivoNoEscopo(linha({ etapa: "distrato" }), escopo)).toBe(false);
    expect(contratoAtivoNoEscopo(linha({ cancelada_em: "2026-09-01" }), escopo)).toBe(false);
    expect(
      contratoAtivoNoEscopo(linha({ unidade: { codigo: "X", enterprise_id: "35", id: "u" } }), escopo),
    ).toBe(false);
    // O PostgREST pode devolver o embutido como lista.
    expect(
      contratoAtivoNoEscopo(linha({ unidade: [{ codigo: "X", enterprise_id: "19", id: "u" }] }), escopo),
    ).toBe(true);
    expect(contratoAtivoNoEscopo(linha({ unidade: null }), escopo)).toBe(false);
  });

  it("⚠️ faturado com PEDIDO de cancelamento ou distrato em curso não conta (a etapa só muda no fim)", () => {
    const escopo = new Set(["19"]);
    expect(contratoAtivoNoEscopo(linha({ cancelamento_pedido_em: "2026-09-20T12:00:00.000Z" }), escopo)).toBe(
      false,
    );
    expect(contratoAtivoNoEscopo(linha({ cancelamento_pedido_em: null }), escopo)).toBe(true);
  });
});

describe("compradoresDoContrato", () => {
  it("a carga do C2X: titular pelo documento do cliente, co pela lista, com o usuário do C2X de cada um", () => {
    const compradores = compradoresDoContrato(
      linha({
        compradores: [
          { c2x_user_id: 7001, documento: CPF, nome: "MARIA DA SILVA", percentual: 50, titular: true },
          { c2x_user_id: 8001, documento: "11144477735", nome: "JOÃO", percentual: 50, titular: false },
        ],
      }),
    );
    expect(compradores.map((c) => [c.documento, c.compra.papel, c.compra.c2xUserId])).toEqual([
      [DIGITOS, "titular", "7001"],
      ["11144477735", "co", "8001"],
    ]);
  });

  it("a venda nativa: `cpf` em vez de `documento`, e a entidade apontada do titular", () => {
    const compradores = compradoresDoContrato(
      linha({
        cliente_c2x_id: null,
        cliente_entity_id: "ent-nativa",
        compradores: [
          { cpf: CPF, nome: "Maria", participacao: 60, telefone: null, titular: true },
          { cpf: "111.444.777-35", nome: "João", participacao: 40, telefone: null, titular: false },
        ],
      }),
    );
    expect(compradores[0]?.compra.entityIdApontada).toBe("ent-nativa");
    expect(compradores[0]?.compra.c2xUserId).toBeNull();
    expect(compradores[1]?.documento).toBe("11144477735");
  });

  // (26/09/2026, junção com a v1.384.0) Até aqui este teste dizia "PJ fica de fora: CNPJ não vira
  // comprador da carteira", porque a régua do titular exigia CPF. A régua passou a aceitar CNPJ, e a
  // carteira segue a mesma peça (`tipoDePessoa`). O que continua de fora é documento que não é CPF
  // nem CNPJ: vazio e os 12 dígitos que a carga deixou.
  it("⚠️ PJ entra pelo CNPJ (só dígitos), e a filial é outro documento", () => {
    const compradores = compradoresDoContrato(
      linha({
        cliente_documento: "12.345.678/0001-95",
        compradores: [{ documento: "12.345.678/0001-95", titular: true }],
      }),
    );
    expect(compradores.map((c) => [c.documento, c.compra.papel])).toEqual([["12345678000195", "titular"]]);
  });

  it("⚠️ documento que não é CPF nem CNPJ não vira comprador (vazio, 12 dígitos)", () => {
    expect(compradoresDoContrato(linha({ cliente_documento: "123456789012", compradores: [] }))).toEqual([]);
    expect(compradoresDoContrato(linha({ cliente_documento: "", compradores: [] }))).toEqual([]);
    expect(
      compradoresDoContrato(
        linha({
          compradores: [
            { documento: CPF, titular: true },
            { documento: "123456789012", titular: false },
          ],
        }),
      ).map((c) => c.compra.papel),
    ).toEqual(["titular"]);
  });

  it("co-comprador desligado: só o titular conta", () => {
    const compradores = compradoresDoContrato(
      linha({
        compradores: [
          { documento: CPF, titular: true },
          { documento: "11144477735", titular: false },
        ],
      }),
      { coComprador: false },
    );
    expect(compradores.map((c) => c.compra.papel)).toEqual(["titular"]);
  });
});

describe("compraDaPessoa", () => {
  it("prefere o contrato em que a pessoa é TITULAR, e entre eles o mais recente", () => {
    const comoCo = linha({
      cliente_documento: "111.444.777-35",
      compradores: [
        { documento: "111.444.777-35", titular: true },
        { documento: CPF, titular: false },
      ],
      etapa_desde: "2026-01-01T00:00:00.000Z",
      id: "prop-co",
    });
    const antiga = linha({ etapa_desde: "2023-01-01T00:00:00.000Z", id: "prop-antiga" });
    const nova = linha({ etapa_desde: "2025-01-01T00:00:00.000Z", id: "prop-nova" });

    const compra = compraDaPessoa([comoCo, antiga, nova], { documento: CPF, entityIds: [], escopo: ["19"] });
    expect(compra?.propostaId).toBe("prop-nova");
    expect(compra?.papel).toBe("titular");
  });

  it("acha o titular da venda nativa pela entidade apontada, mesmo sem o CPF no contrato", () => {
    const nativa = linha({ cliente_documento: null, cliente_entity_id: "ent-1", compradores: [] });
    expect(compraDaPessoa([nativa], { documento: CPF, entityIds: ["ent-1"], escopo: ["19"] })?.propostaId).toBe(
      "prop-a",
    );
    expect(compraDaPessoa([nativa], { documento: CPF, entityIds: ["ent-2"], escopo: ["19"] })).toBeNull();
  });

  it("fora do escopo, ou com CPF incompleto, não há compra", () => {
    expect(compraDaPessoa([linha()], { documento: CPF, entityIds: [], escopo: ["35"] })).toBeNull();
    expect(compraDaPessoa([linha()], { documento: "529.982", entityIds: [], escopo: ["19"] })).toBeNull();
  });

  it("⚠️ a empresa é achada pelo CNPJ inteiro, e a matriz não responde pela filial", () => {
    const daEmpresa = linha({
      cliente_documento: "12345678000195",
      compradores: [{ documento: "12.345.678/0001-95", titular: true }],
      id: "prop-pj",
    });
    expect(
      compraDaPessoa([daEmpresa], { documento: "12.345.678/0001-95", entityIds: [], escopo: ["19"] })?.propostaId,
    ).toBe("prop-pj");
    expect(
      compraDaPessoa([daEmpresa], { documento: "12.345.678/0002-76", entityIds: [], escopo: ["19"] }),
    ).toBeNull();
    // O CPF que começa com os mesmos dígitos não é a empresa.
    expect(compraDaPessoa([daEmpresa], { documento: "12345678000", entityIds: [], escopo: ["19"] })).toBeNull();
  });
});

describe("escolherEntidadeDoContrato", () => {
  const compra = compradoresDoContrato(linha({ cliente_entity_id: "ent-apontada" }))[0]!.compra;

  it("a ligada ao usuário do C2X ganha, se for mesmo desta pessoa", () => {
    expect(escolherEntidadeDoContrato(compra, ["ent-aaa", "ent-ligada", "ent-apontada"], "ent-ligada")).toBe(
      "ent-ligada",
    );
  });

  it("⚠️ ligada a uma entidade que NÃO carrega o CPF não vale: cai na apontada, depois na primeira", () => {
    expect(escolherEntidadeDoContrato(compra, ["ent-aaa", "ent-apontada"], "ent-de-outro")).toBe("ent-apontada");
    expect(escolherEntidadeDoContrato(compra, ["ent-zzz", "ent-aaa"], null)).toBe("ent-aaa");
    expect(escolherEntidadeDoContrato(compra, [], null)).toBeNull();
  });
});

describe("entidadesDosDocumentos", () => {
  // ⚠️ O NAMESPACE DO HASH SAI DO DOCUMENTO: um CNPJ hasheado como "cpf" não casa com nada
  // (`apolo-identifier:TIPO:valor`). É a mesma peça de `entidadesDoDocumento`, em lote.
  function clienteQueGuardaOsHashes(linhas: {
    entidades: Array<{ document_hash: string; id: string }>;
    identificadores: Array<{ entity_id: string; value_hash: string }>;
  }) {
    const pedidos: unknown[][] = [];
    const client = {
      from(tabela: string) {
        let valores: unknown[] = [];
        const builder: Record<string, unknown> = {
          in: (_coluna: string, lista: unknown[]) => {
            valores = lista;
            pedidos.push(lista);
            return builder;
          },
          select: () => builder,
          then: (resolver: (v: unknown) => unknown) => {
            const fonte =
              tabela === "apolo_entities"
                ? linhas.entidades.filter((l) => valores.includes(l.document_hash))
                : linhas.identificadores.filter((l) => valores.includes(l.value_hash));
            return Promise.resolve(resolver({ data: fonte, error: null }));
          },
        };
        return builder;
      },
    };
    return { client: client as never, pedidos };
  }

  it("CPF no namespace cpf e CNPJ no namespace cnpj, com a chave em dígitos", async () => {
    const hashDoCpf = hashIdentifier("cpf", "52998224725");
    const hashDoCnpj = hashIdentifier("cnpj", "12345678000195");
    const { client, pedidos } = clienteQueGuardaOsHashes({
      entidades: [{ document_hash: hashDoCnpj, id: "ent-empresa-apolo" }],
      identificadores: [
        { entity_id: "ent-maria", value_hash: hashDoCpf },
        { entity_id: "ent-empresa-c2x", value_hash: hashDoCnpj },
        // O CNPJ hasheado no namespace errado: existe no fixture para provar que não é pedido.
        { entity_id: "ent-errada", value_hash: hashIdentifier("cpf", "12345678000195") },
      ],
    });

    const mapa = await entidadesDosDocumentos(client, [CPF, "12.345.678/0001-95", "123"]);

    expect(mapa.get(DIGITOS)).toEqual(["ent-maria"]);
    expect(mapa.get("12345678000195")).toEqual(["ent-empresa-apolo", "ent-empresa-c2x"]);
    // Documento que não é CPF nem CNPJ nem vira pergunta.
    expect(mapa.has("123")).toBe(false);
    expect(pedidos.flat()).not.toContain(hashIdentifier("cpf", "12345678000195"));
  });
});
