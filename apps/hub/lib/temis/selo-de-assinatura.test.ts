import { afterEach, describe, expect, it } from "vitest";

import { type Banco, criarBanco, type Linha } from "@/lib/hercules/banco-em-memoria.para-teste";

import { contagemDoSelo, contarAssinaturasDasPropostas } from "./trabalhos-db";

// O SELO "x/y" DO CARD (F3 da fonte única): conta `assinado_em` do quadro, dos dois provedores; o
// histórico dos payloads da Clicksign fica como piso até a F6. Pessoas fictícias.

const item = (chave: string, extra: Record<string, string> = {}) => ({
  chave,
  email: `${chave}@exemplo.test`,
  nome: chave,
  ordem: 1,
  papel: null,
  ...extra,
});

describe("contagemDoSelo", () => {
  it("D4Sign: conta as marcas do quadro (sem histórico de eventos)", () => {
    expect(
      contagemDoSelo(
        {
          estado: "parcial",
          signatarios: [item("c2x:1", { assinado_em: "2026-09-27T10:00:00-03:00" }), item("c2x:2"), item("c2x:3")],
        },
        undefined,
      ),
    ).toEqual({ assinaram: 1, compradores: null, conviteNaoEntregue: false, estado: "parcial", total: 3 });
  });

  it("Clicksign: vale o MAIOR entre marcas e histórico, nunca a soma", () => {
    const r = contagemDoSelo(
      { estado: "parcial", signatarios: [item("k1", { assinado_em: "2026-09-27T10:00:00-03:00" }), item("k2"), item("k3")] },
      { assinaram: 2, conviteNaoEntregue: false },
    );
    expect(r?.assinaram).toBe(2);
  });

  it("assinado manda: todos", () => {
    expect(contagemDoSelo({ estado: "assinado", signatarios: [item("a"), item("b")] }, undefined)?.assinaram).toBe(2);
  });

  it("convite que voltou pelas marcas acende; entregue depois apaga", () => {
    const voltou = contagemDoSelo(
      { estado: "aguardando", signatarios: [item("a", { convite_falhou_em: "2026-09-27T10:00:00-03:00" })] },
      undefined,
    );
    expect(voltou?.conviteNaoEntregue).toBe(true);
    const entregueDepois = contagemDoSelo(
      {
        estado: "aguardando",
        signatarios: [
          item("a", { convite_entregue_em: "2026-09-27T11:00:00-03:00", convite_falhou_em: "2026-09-27T10:00:00-03:00" }),
        ],
      },
      undefined,
    );
    expect(entregueDepois?.conviteNaoEntregue).toBe(false);
  });

  it("quadro vazio: sem selo", () => {
    expect(contagemDoSelo({ estado: "aguardando", signatarios: [] }, undefined)).toBeNull();
  });
});

// ── OS COMPRADORES NO SELO (02/10/2026) ─────────────────────────────────────────────────────────
//
// Lucas: *"vamos mudar esse 3/11 eu preciso ver somente dos compradores. se tiver um comprador 1/1 ou
// 0/1 se tiver mais a mesma logica"*. A conta sai do QUADRO, pela régua da porta que move o card.

describe("contagemDoSelo: os compradores", () => {
  const assinou = { assinado_em: "2026-10-01T10:00:00-03:00" };

  it("Clicksign: comprador e cônjuge contam; vendedora, testemunha e coordenadora não", () => {
    const r = contagemDoSelo(
      {
        estado: "parcial",
        signatarios: [
          item("k1", { papel: "comprador", ...assinou }),
          item("k2", { papel: "conjuge" }),
          item("k3", { papel: "vendedora", ...assinou }),
          item("k4", { papel: "testemunha", ...assinou }),
          item("k5", { papel: "coordenadora" }),
        ],
      },
      undefined,
    );
    expect(r).toMatchObject({ assinaram: 3, compradores: { assinaram: 1, total: 2 }, total: 5 });
  });

  it("⚠️ D4Sign (papel nulo): o comprador é o perfil 'Comprador'; 'Sem perfil' não conta", () => {
    const r = contagemDoSelo(
      {
        estado: "parcial",
        signatarios: [
          item("c2x:1", { perfil: "Comprador", ...assinou }),
          item("c2x:2", { perfil: "Sem perfil", ...assinou }),
          item("c2x:3", { perfil: "Coordenadora de venda" }),
        ],
      },
      undefined,
    );
    expect(r?.compradores).toEqual({ assinaram: 1, total: 1 });
  });

  it("sem comprador marcado no quadro: `compradores` nulo (a tela mostra o total)", () => {
    const r = contagemDoSelo({ estado: "parcial", signatarios: [item("a", assinou), item("b")] }, undefined);
    expect(r).toMatchObject({ assinaram: 1, compradores: null, total: 2 });
  });

  it("envelope assinado: todos os compradores assinaram, mesmo sem a marca", () => {
    const r = contagemDoSelo(
      { estado: "assinado", signatarios: [item("k1", { papel: "comprador" }), item("k2", { papel: "vendedora" })] },
      undefined,
    );
    expect(r?.compradores).toEqual({ assinaram: 1, total: 1 });
  });

  it("marca ilegível não conta (a mesma régua da porta: o selo nunca diz 1/1 num card que não anda)", () => {
    const r = contagemDoSelo(
      { estado: "parcial", signatarios: [item("k1", { assinado_em: "ontem", papel: "comprador" })] },
      undefined,
    );
    expect(r?.compradores).toEqual({ assinaram: 0, total: 1 });
  });
});

describe("os filtros do selo no Board (contarAssinaturasDasPropostas)", () => {
  const bancos: Banco[] = [];
  const novoBanco = (envelopes: Linha[]) => {
    const banco = criarBanco({ temis_envelopes: envelopes });
    bancos.push(banco);
    return banco;
  };
  afterEach(() => {
    const problemas = bancos.flatMap((b) => b.problemas);
    bancos.length = 0;
    expect(problemas).toEqual([]);
  });

  const envelope = (patch: Linha): Linha => ({
    envelope_id: `env-${String(patch.id)}`,
    estado: "aguardando",
    falha: null,
    proposta_id: "p-1",
    provedor_documento_id: `doc-${String(patch.id)}`,
    workspace_id: "careli",
    ...patch,
  });

  it("da D4Sign só conta o envelope de CONTRATO: o de tipo não mapeado (finalidade nula), mais novo, não vira o selo", async () => {
    const banco = novoBanco([
      envelope({
        criado_em: "2026-09-25T10:00:00Z",
        finalidade: null,
        id: "d4-sem-finalidade",
        provedor: "d4sign",
        signatarios: [
          item("c2x:1", { assinado_em: "2026-09-26T10:00:00-03:00" }),
          item("c2x:2", { assinado_em: "2026-09-26T10:00:00-03:00" }),
          item("c2x:3", { assinado_em: "2026-09-26T10:00:00-03:00" }),
        ],
      }),
      envelope({
        criado_em: "2026-09-20T10:00:00Z",
        finalidade: "contrato",
        id: "d4-contrato",
        provedor: "d4sign",
        signatarios: [item("c2x:10", { assinado_em: "2026-09-21T10:00:00-03:00" }), item("c2x:11")],
      }),
    ]);
    const contagens = await contarAssinaturasDasPropostas(banco.cliente, ["p-1"]);
    expect(contagens.get("p-1")).toEqual({
      assinaram: 1,
      compradores: null,
      conviteNaoEntregue: false,
      estado: "aguardando",
      total: 2,
    });
  });

  it("o envelope da D4Sign fica FORA do histórico de eventos (só a Clicksign tem webhook guardado)", async () => {
    const soD4Sign = novoBanco([
      envelope({ criado_em: "2026-09-20T10:00:00Z", finalidade: "contrato", id: "d4", provedor: "d4sign", signatarios: [item("c2x:1")] }),
    ]);
    await contarAssinaturasDasPropostas(soD4Sign.cliente, ["p-1"]);
    expect(soD4Sign.consultas.filter((c) => c.tabela === "temis_assinatura_eventos")).toHaveLength(0);

    const comClicksign = novoBanco([
      envelope({ criado_em: "2026-09-20T10:00:00Z", finalidade: "contrato", id: "cs", provedor: "clicksign", signatarios: [item("k1")] }),
    ]);
    await contarAssinaturasDasPropostas(comClicksign.cliente, ["p-1"]);
    expect(comClicksign.consultas.filter((c) => c.tabela === "temis_assinatura_eventos").length).toBeGreaterThan(0);
  });
});

// ── O SELO E A REVISÃO DE 02/10/2026 ────────────────────────────────────────
describe("contagemDoSelo: o que a revisão de 02/10/2026 pediu", () => {
  const assinou = { assinado_em: "2026-10-01T10:00:00-03:00" };

  it("envelope de finalidade nula não conta compradores: ele não move card nenhum", () => {
    const r = contagemDoSelo(
      { estado: "parcial", finalidade: null, signatarios: [item("k1", { papel: "comprador", ...assinou }), item("k2")] },
      undefined,
    );
    expect(r?.compradores).toBeNull();
    expect(r).toMatchObject({ assinaram: 1, total: 2 });
  });

  it("envelope de contrato conta os compradores", () => {
    const r = contagemDoSelo(
      { estado: "parcial", finalidade: "contrato", signatarios: [item("k1", { papel: "comprador", ...assinou }), item("k2")] },
      undefined,
    );
    expect(r?.compradores).toEqual({ assinaram: 1, total: 1 });
  });

  it("contrato fechado não acende o convite devolvido, nem com bounce no histórico", () => {
    const r = contagemDoSelo(
      { estado: "assinado", signatarios: [item("k1", { papel: "comprador" }), item("k2")] },
      { assinaram: 2, conviteNaoEntregue: true },
    );
    expect(r?.conviteNaoEntregue).toBe(false);
  });
});
