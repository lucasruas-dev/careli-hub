import { afterEach, describe, expect, it, vi } from "vitest";

import { type Banco, criarBanco, type Linha } from "./banco-em-memoria.para-teste";
import { type PassoDoCard, refletirCardNaVenda } from "./reflexo-da-temis-server";

// A ESCRITA DO REFLEXO, CONTRA UM BANCO EM MEMÓRIA.
//
// O que está travado aqui são as guardas: comparar-e-trocar na etapa lida, venda morta não ressuscita,
// a lista curta de origens, o histórico que falha sem derrubar a etapa, e a função que NUNCA lança e
// NUNCA escreve `hercules_unidades`, `data_assinatura` nem `data_faturamento`.

const bancos: Banco[] = [];

function banco(venda: Linha = {}): Banco {
  const b = criarBanco({
    hercules_proposta_etapas: [],
    hercules_propostas: [
      {
        data_assinatura: null,
        data_faturamento: null,
        etapa: "contrato",
        etapa_desde: "2026-09-20T12:00:00.000Z",
        etapa_por: "Coordenador",
        id: "venda-vitoria",
        workspace_id: "careli",
        ...venda,
      },
    ],
    hercules_unidades: [],
  });
  bancos.push(b);
  return b;
}

afterEach(() => {
  for (const b of bancos) expect(b.problemas).toEqual([]);
  bancos.length = 0;
  vi.restoreAllMocks();
});

const envio: PassoDoCard = {
  autorNome: "Nivea",
  de: "contrato",
  motivo: "Envio para assinatura na Têmis",
  para: "assinatura",
  propostaId: "venda-vitoria",
  trabalhoTipo: "contrato",
};

const escritas = (b: Banco) => b.consultas.filter((c) => c.operacao !== "select");

describe("a venda acompanha o card", () => {
  it("contrato para assinatura: etapa, etapa_desde, etapa_por e a linha do histórico", async () => {
    const b = banco();

    const r = await refletirCardNaVenda(b.cliente, envio);

    expect(r).toEqual({ de: "contrato", feito: "andou", para: "assinatura" });
    const venda = b.linha("hercules_propostas", "venda-vitoria");
    expect(venda).toMatchObject({ etapa: "assinatura", etapa_por: "Nivea" });
    expect(venda?.etapa_desde).not.toBe("2026-09-20T12:00:00.000Z");
    expect(b.linhas("hercules_proposta_etapas")).toEqual([
      expect.objectContaining({
        autor_nome: "Nivea",
        de: "contrato",
        motivo: "Envio para assinatura na Têmis",
        para: "assinatura",
        proposta_id: "venda-vitoria",
        quando: venda?.etapa_desde,
        workspace_id: "careli",
      }),
    ]);
  });

  it("etapa igual ao destino: já estava, nenhuma escrita", async () => {
    const b = banco({ etapa: "assinatura" });
    expect(await refletirCardNaVenda(b.cliente, envio)).toEqual({ feito: "ja_estava" });
    expect(escritas(b)).toEqual([]);
  });

  it("webhook (autor nulo): etapa_por nulo, como a passagem automática do card", async () => {
    const b = banco({ etapa: "contrato" });
    await refletirCardNaVenda(b.cliente, {
      ...envio,
      autorNome: null,
      de: "assinatura",
      motivo: "Contrato assinado por todos na Têmis",
      para: "prazo_legal",
    });
    expect(b.linha("hercules_propostas", "venda-vitoria")).toMatchObject({ etapa: "assinatura", etapa_por: null });
  });

  it("faturar nunca escreve o cadastro da unidade, data_assinatura nem data_faturamento", async () => {
    const b = banco({ etapa: "assinatura" });
    const r = await refletirCardNaVenda(b.cliente, {
      ...envio,
      de: "prazo_legal",
      motivo: "Contrato faturado na Têmis",
      para: "faturado",
    });
    expect(r.feito).toBe("andou");
    expect(b.linha("hercules_propostas", "venda-vitoria")).toMatchObject({
      data_assinatura: null,
      data_faturamento: null,
      etapa: "faturado",
    });
    expect(escritas(b).map((c) => c.tabela)).toEqual(["hercules_propostas", "hercules_proposta_etapas"]);
  });
});

describe("as recusas, sem escrever nada", () => {
  it.each(["cancelado", "distrato"])("venda em %s: recusado/venda_desfeita (nunca ressuscita)", async (etapa) => {
    const b = banco({ etapa });
    const r = await refletirCardNaVenda(b.cliente, { ...envio, de: "assinatura", para: "prazo_legal" });
    expect(r).toEqual({ etapaLida: etapa, feito: "recusado", porque: "venda_desfeita" });
    expect(escritas(b)).toEqual([]);
  });

  it("venda em proposta com card em assinatura: recusado/etapa_fora_da_origem", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const b = banco({ etapa: "proposta" });
    const r = await refletirCardNaVenda(b.cliente, envio);
    expect(r).toEqual({ etapaLida: "proposta", feito: "recusado", porque: "etapa_fora_da_origem" });
    expect(escritas(b)).toEqual([]);
  });

  it("venda em contrato com card faturado: recusa, não pula duas etapas, e o log diz venda atrasada", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const b = banco({ etapa: "contrato" });
    const r = await refletirCardNaVenda(b.cliente, { ...envio, de: "prazo_legal", para: "faturado" });
    expect(r).toMatchObject({ feito: "recusado", porque: "etapa_fora_da_origem" });
    expect(b.linha("hercules_propostas", "venda-vitoria")?.etapa).toBe("contrato");
    expect(String(aviso.mock.calls[0]?.[0])).toContain("Venda atrasada");
  });

  it("a venda muda entre a leitura e a escrita: recusado/mudou_no_meio e nenhuma linha de histórico", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const b = banco();
    b.depois(
      (c) => c.tabela === "hercules_propostas" && c.operacao === "select",
      (x) => {
        const venda = x.linha("hercules_propostas", "venda-vitoria");
        if (venda) venda.etapa = "cancelado";
      },
    );
    const r = await refletirCardNaVenda(b.cliente, envio);
    // A etapa do aviso é a RELIDA: é onde a venda está de verdade depois da outra mão.
    expect(r).toEqual({ etapaLida: "cancelado", feito: "recusado", porque: "mudou_no_meio" });
    expect(b.linha("hercules_propostas", "venda-vitoria")?.etapa).toBe("cancelado");
    expect(b.linhas("hercules_proposta_etapas")).toEqual([]);
  });

  // ⚠️ A REVISÃO DE 24/09/2026: zero linhas porque OUTRA MÃO levou a venda exatamente ao destino
  // (o webhook do assinado e o envio correndo juntos) não é falha, e virava o aviso "a venda mudou
  // enquanto o card andava" na tela de quem enviou.
  it("outra mão levou a venda ao destino entre a leitura e a escrita: já estava, sem aviso e sem histórico", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const b = banco();
    let primeira = true;
    b.depois(
      (c) => c.tabela === "hercules_propostas" && c.operacao === "select",
      (x) => {
        if (!primeira) return;
        primeira = false;
        const venda = x.linha("hercules_propostas", "venda-vitoria");
        if (venda) venda.etapa = "assinatura";
      },
    );
    const r = await refletirCardNaVenda(b.cliente, envio);
    expect(r).toEqual({ feito: "ja_estava" });
    expect(b.linha("hercules_propostas", "venda-vitoria")?.etapa).toBe("assinatura");
    expect(b.linhas("hercules_proposta_etapas")).toEqual([]);
  });

  it("zero linhas e a releitura falha: continua recusado/mudou_no_meio com a etapa da primeira leitura", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = banco();
    let selects = 0;
    b.depois(
      (c) => c.tabela === "hercules_propostas" && c.operacao === "select",
      (x) => {
        selects += 1;
        if (selects !== 1) return;
        const venda = x.linha("hercules_propostas", "venda-vitoria");
        if (venda) venda.etapa = "proposta";
      },
    );
    b.falhar((c) => c.tabela === "hercules_propostas" && c.operacao === "select" && selects >= 1);
    const r = await refletirCardNaVenda(b.cliente, envio);
    expect(r).toEqual({ etapaLida: "contrato", feito: "recusado", porque: "mudou_no_meio" });
  });

  it("insert do histórico que falha: a etapa fica, e o log grita", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = banco();
    b.falhar((c) => c.tabela === "hercules_proposta_etapas");
    const r = await refletirCardNaVenda(b.cliente, envio);
    expect(r.feito).toBe("andou");
    expect(b.linha("hercules_propostas", "venda-vitoria")?.etapa).toBe("assinatura");
    expect(erro.mock.calls.some((c) => String(c[0]).includes("[hercules][reflexo]"))).toBe(true);
  });

  it("leitura que falha: recusado/leitura_falhou, sem escrever e sem lançar", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = banco();
    b.falhar((c) => c.tabela === "hercules_propostas" && c.operacao === "select");
    await expect(refletirCardNaVenda(b.cliente, envio)).resolves.toEqual({
      etapaLida: null,
      feito: "recusado",
      porque: "leitura_falhou",
    });
    expect(escritas(b)).toEqual([]);
  });

  it("cliente que LANÇA (não devolve erro): nunca lança para quem chamou", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const quebrado = {
      from: () => {
        throw new Error("rede caiu");
      },
    } as unknown as Banco["cliente"];
    await expect(refletirCardNaVenda(quebrado, envio)).resolves.toMatchObject({ feito: "recusado" });
  });

  it("escrita que falha: recusado/escrita_falhou", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const b = banco();
    b.falhar((c) => c.tabela === "hercules_propostas" && c.operacao === "update");
    expect(await refletirCardNaVenda(b.cliente, envio)).toMatchObject({ feito: "recusado", porque: "escrita_falhou" });
    expect(b.linhas("hercules_proposta_etapas")).toEqual([]);
  });
});

describe("o que nem lê o banco", () => {
  it.each([
    ["cancelamento", "contrato", "faturado"],
    ["distrato", "analise", "faturado"],
    ["cessao", "assinatura", "faturado"],
    ["cancelamento_correcao", "assinatura", "faturado"],
    ["contrato", "analise", "indeferido"],
  ] as const)("card de %s de %s para %s: nao_se_aplica", async (tipo, de, para) => {
    const b = banco();
    expect(await refletirCardNaVenda(b.cliente, { ...envio, de, para, trabalhoTipo: tipo })).toEqual({
      feito: "nao_se_aplica",
    });
    expect(b.consultas).toEqual([]);
  });

  it("card sem venda ligada: nao_se_aplica, sem consulta", async () => {
    const b = banco();
    expect(await refletirCardNaVenda(b.cliente, { ...envio, propostaId: null })).toEqual({ feito: "nao_se_aplica" });
    expect(b.consultas).toEqual([]);
  });
});
