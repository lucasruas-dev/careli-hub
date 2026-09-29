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
    ).toEqual({ assinaram: 1, conviteNaoEntregue: false, estado: "parcial", total: 3 });
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
    expect(contagens.get("p-1")).toEqual({ assinaram: 1, conviteNaoEntregue: false, estado: "aguardando", total: 2 });
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
