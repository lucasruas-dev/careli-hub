import { describe, expect, it } from "vitest";

import {
  type EntradaDaCadDoComprador,
  enterpriseIdDaCad,
  garantirCadDoComprador,
  linhaDaCadDoComprador,
} from "./cad-do-comprador";

// A CAD DO COMPRADOR DA CARTEIRA (26/09/2026): nasce credenciada, na gravação da proposta, sem
// sobrescrever CAD nenhuma, e sem derrubar a proposta quando falha. O que está travado aqui:
//   • ONDE ela mora (o pai quando ele tem id no C2X, senão a unidade), que é onde a régua do titular
//     a acha de volta;
//   • O QUE vai na linha (etapa credenciado, origem comprador_da_carteira, imobiliária e corretor da
//     reserva, sem ficha);
//   • COMO grava: upsert com `ignoreDuplicates` na chave (entity_id, enterprise_id), que é o
//     `ON CONFLICT DO NOTHING` que não mexe em CAD existente e torna a chamada idempotente;
//   • e que ela NUNCA lança.

const PEDRO = "0b6f3c1e-5d7a-4c2b-9f10-3a2b1c0d9e8f";
const IMOBILIARIA = "1c7a4d2f-6e8b-4d3c-8a21-4b3c2d1e0f9a";
const CORRETOR = "2d8b5e3a-7f9c-4e4d-9b32-5c4d3e2f1a0b";

const CADASTRO = [
  { c2xEnterpriseId: "35", id: "vlo", paiId: null },
  { c2xEnterpriseId: "36", id: "vol", paiId: "vlo" },
  { c2xEnterpriseId: "37", id: "voc", paiId: "vlo" },
  { c2xEnterpriseId: "19", id: "vdo", paiId: null },
  // Um filho cujo pai ainda não tem id no C2X: a CAD fica no filho.
  { c2xEnterpriseId: null, id: "novo", paiId: null },
  { c2xEnterpriseId: "50", id: "filho-do-novo", paiId: "novo" },
];

function entrada(parcial: Partial<EntradaDaCadDoComprador> = {}): EntradaDaCadDoComprador {
  return {
    agora: "2026-09-26T17:05:00.000Z",
    atualizadoPor: "3e9c6f4b-8a0d-4f5e-8c43-6d5e4f3a2b1c",
    codigoDaVenda: "001011",
    compra: {
      c2xUserId: "7001",
      codigo: "000728",
      desde: "2024-03-10T12:00:00.000Z",
      enterpriseIdDaUnidade: "19",
      entityIdApontada: null,
      entityIdDoContrato: PEDRO,
      papel: "titular",
      propostaId: "prop-antiga",
      unidade: "VDO0728",
    },
    corretorEntityId: CORRETOR,
    corretorNome: "João Corretor",
    empreendimentoNome: "Veredas do Ouro",
    enterpriseId: "19",
    entityId: PEDRO,
    imobiliariaEntityId: IMOBILIARIA,
    imobiliariaNome: "GURGEL",
    ...parcial,
  };
}

/** O banco falso: guarda o que o upsert recebeu e responde como o PostgREST com `ignoreDuplicates`. */
function bancoFalso(cfg: { erro?: string; existentes?: Array<[string, string]>; lanca?: boolean } = {}) {
  const chaves = new Set((cfg.existentes ?? []).map(([e, emp]) => `${e}::${emp}`));
  const gravadas: Array<{ linha: Record<string, unknown>; opcoes: Record<string, unknown> }> = [];

  const client = {
    from(tabela: string) {
      if (tabela === "apolo_contacts") {
        const cadeia: Record<string, unknown> = {};
        for (const m of ["select", "eq", "order"]) cadeia[m] = () => cadeia;
        cadeia.limit = async () => ({ data: [{ value: " joao@imob.com " }], error: null });
        return cadeia;
      }
      if (cfg.lanca) throw new Error("rede caiu");
      return {
        upsert(linha: Record<string, unknown>, opcoes: Record<string, unknown>) {
          gravadas.push({ linha, opcoes });
          return {
            select: async () => {
              if (cfg.erro) return { data: null, error: { message: cfg.erro } };
              const chave = `${String(linha.entity_id)}::${String(linha.enterprise_id)}`;
              if (chaves.has(chave)) return { data: [], error: null };
              chaves.add(chave);
              return { data: [{ entity_id: linha.entity_id }], error: null };
            },
          };
        },
      };
    },
  };

  return { client: client as never, gravadas };
}

describe("enterpriseIdDaCad", () => {
  it("o PAI quando ele tem id no C2X: a CAD do VOC mora no 35, como as 692 do Vale do Ouro", () => {
    expect(enterpriseIdDaCad(CADASTRO, "37")).toBe("35");
    expect(enterpriseIdDaCad(CADASTRO, "36")).toBe("35");
  });

  it("sem pai, o próprio id da unidade: o Veredas grava no 19", () => {
    expect(enterpriseIdDaCad(CADASTRO, "19")).toBe("19");
  });

  it("pai sem id no C2X, ou empreendimento fora do cadastro: o id da unidade, nunca vazio", () => {
    expect(enterpriseIdDaCad(CADASTRO, "50")).toBe("50");
    expect(enterpriseIdDaCad(CADASTRO, "99")).toBe("99");
  });
});

describe("linhaDaCadDoComprador", () => {
  it("credenciada, marcada, com a imobiliária e o corretor da reserva, e sem ficha", () => {
    const linha = linhaDaCadDoComprador(entrada(), "joao@imob.com");
    expect(linha).toMatchObject({
      chegou_em: "2026-09-26T17:05:00.000Z",
      corretor: "João Corretor",
      corretor_email: "joao@imob.com",
      corretor_entity_id: CORRETOR,
      empreendimento: "Veredas do Ouro",
      enterprise_id: "19",
      entity_id: PEDRO,
      etapa: "credenciado",
      imobiliaria: "GURGEL",
      imobiliaria_entity_id: IMOBILIARIA,
      origem: "comprador_da_carteira",
    });
    // ⚠️ Nada de ficha, analista ou pagamento: a CAD não passou pela esteira.
    expect(linha).not.toHaveProperty("ficha");
    expect(linha).not.toHaveProperty("analista_id");
    expect(linha).not.toHaveProperty("pago_em");
    expect(String(linha.motivo)).toContain("Comprador da carteira");
    expect(String(linha.motivo)).toContain("000728");
    expect(String(linha.motivo)).toContain("001011");
    // Texto que aparece na tela, sem travessão.
    expect(String(linha.motivo)).not.toMatch(/[—–]/);
  });

  it("id que não é uuid não vai para coluna uuid (o insert inteiro cairia)", () => {
    const linha = linhaDaCadDoComprador(
      entrada({ atualizadoPor: "user-1", corretorEntityId: "corr-1", imobiliariaEntityId: "imob-1" }),
      null,
    );
    expect(linha.atualizado_por).toBeNull();
    expect(linha.corretor_entity_id).toBeNull();
    expect(linha.imobiliaria_entity_id).toBeNull();
  });
});

describe("garantirCadDoComprador", () => {
  it("⚠️ grava com ON CONFLICT DO NOTHING na chave da CAD, e diz que criou", async () => {
    const { client, gravadas } = bancoFalso();

    const r = await garantirCadDoComprador(client, entrada());

    expect(r).toEqual({ enterpriseId: "19", estado: "criada" });
    expect(gravadas).toHaveLength(1);
    expect(gravadas[0]?.opcoes).toEqual({ ignoreDuplicates: true, onConflict: "entity_id,enterprise_id" });
    expect(gravadas[0]?.linha.corretor_email).toBe("joao@imob.com");
  });

  it("⚠️ idempotente: a segunda chamada não cria outra, e a CAD existente não é sobrescrita", async () => {
    const { client } = bancoFalso({ existentes: [[PEDRO, "19"]] });

    const r = await garantirCadDoComprador(client, entrada());

    // `ignoreDuplicates` + `.select()` devolve lista vazia quando a linha já existia.
    expect(r).toEqual({ enterpriseId: "19", estado: "ja_existia" });
  });

  it("erro do banco volta como 'erro', sem lançar", async () => {
    const { client } = bancoFalso({ erro: "violates foreign key" });
    await expect(garantirCadDoComprador(client, entrada())).resolves.toEqual({
      estado: "erro",
      motivo: "violates foreign key",
    });
  });

  it("exceção no meio do caminho também vira 'erro': a proposta nunca cai por causa da CAD", async () => {
    const { client } = bancoFalso({ lanca: true });
    const r = await garantirCadDoComprador(client, entrada());
    expect(r.estado).toBe("erro");
  });

  it("⚠️ empreendimento vazio não grava: o CHECK da 0080 não existe em prod", async () => {
    const { client, gravadas } = bancoFalso();
    const r = await garantirCadDoComprador(client, entrada({ enterpriseId: "  " }));
    expect(r.estado).toBe("erro");
    expect(gravadas).toHaveLength(0);
  });

  it("sem a entidade do contrato não grava", async () => {
    const { client, gravadas } = bancoFalso();
    const r = await garantirCadDoComprador(client, entrada({ entityId: null }));
    expect(r.estado).toBe("erro");
    expect(gravadas).toHaveLength(0);
  });
});
