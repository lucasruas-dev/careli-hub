import { describe, expect, it } from "vitest";

import {
  compraDaPessoa,
  compradoresDoContrato,
  contratoAtivoNoEscopo,
  escolherEntidadeDoContrato,
  type LinhaDoContrato,
} from "./compra-ativa";

// A RÉGUA PURA DO COMPRADOR DA CARTEIRA (26/09/2026). Os dois formatos de `compradores` que existem
// hoje (a carga do C2X e a venda nativa), a PJ de fora, o co-comprador, e a escolha da entidade em
// que a CAD nasce. A leitura do banco é testada em cliente-credenciado.test.ts.

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
    expect(compradores.map((c) => [c.cpf, c.compra.papel, c.compra.c2xUserId])).toEqual([
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
    expect(compradores[1]?.cpf).toBe("11144477735");
  });

  it("⚠️ PJ fica de fora: CNPJ não vira comprador da carteira", () => {
    expect(compradoresDoContrato(linha({ cliente_documento: "12.345.678/0001-95", compradores: [] }))).toEqual([]);
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

    const compra = compraDaPessoa([comoCo, antiga, nova], { cpf: CPF, entityIds: [], escopo: ["19"] });
    expect(compra?.propostaId).toBe("prop-nova");
    expect(compra?.papel).toBe("titular");
  });

  it("acha o titular da venda nativa pela entidade apontada, mesmo sem o CPF no contrato", () => {
    const nativa = linha({ cliente_documento: null, cliente_entity_id: "ent-1", compradores: [] });
    expect(compraDaPessoa([nativa], { cpf: CPF, entityIds: ["ent-1"], escopo: ["19"] })?.propostaId).toBe(
      "prop-a",
    );
    expect(compraDaPessoa([nativa], { cpf: CPF, entityIds: ["ent-2"], escopo: ["19"] })).toBeNull();
  });

  it("fora do escopo, ou com CPF incompleto, não há compra", () => {
    expect(compraDaPessoa([linha()], { cpf: CPF, entityIds: [], escopo: ["35"] })).toBeNull();
    expect(compraDaPessoa([linha()], { cpf: "529.982", entityIds: [], escopo: ["19"] })).toBeNull();
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
