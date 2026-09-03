import { describe, expect, it } from "vitest";

import { agregarFluxo, ETAPAS_DO_FLUXO, type PropostaDaCarga, type UnidadeDoMapa } from "./fluxo-de-venda";

const proposta = (p: Partial<PropostaDaCarga> & { etapa: string }): PropostaDaCarga => ({
  cliente_documento: null,
  cliente_nome: "FULANO DE TAL",
  codigo: "JDG1",
  criado_em_c2x: "2026-08-01T10:00:00Z",
  data_assinatura: null,
  data_ato: null,
  data_faturamento: null,
  empreendimento_codigo: "JDG",
  etapa_c2x: 1,
  etapa_desde: "2026-08-10T10:00:00Z",
  id: Math.random().toString(36).slice(2),
  imobiliaria_nome: "GURGEL",
  motivo: null,
  plano_nome: null,
  unidade_id: "u1",
  unidade_nome: "Q07 L12",
  valor: 100_000,
  ...p,
});

const unidade = (u: Partial<UnidadeDoMapa> & { codigo: string }): UnidadeDoMapa => ({
  enterprise_id: "JDG",
  id: Math.random().toString(36).slice(2),
  lote: null,
  preco_tabela: null,
  quadra: null,
  situacao: "disponivel",
  ...u,
});

describe("agregarFluxo", () => {
  it("soma cada passo do fluxo em quantidade e VGV", () => {
    const r = agregarFluxo({
      propostas: [
        proposta({ etapa: "reservado", valor: 10 }),
        proposta({ etapa: "reservado", valor: 20 }),
        proposta({ etapa: "faturado", valor: 100 }),
      ],
      unidades: [],
    });

    expect(r.fluxo.find((f) => f.etapa === "reservado")).toEqual({
      etapa: "reservado",
      propostas: 2,
      vgv: 30,
    });
    expect(r.totais.vgvFaturado).toBe(100);
  });

  it("⚠️ cancelado e distrato NÃO entram na faixa do fluxo", () => {
    // Eles são saídas do caminho, não passos dele: contá-los como pipeline faria o coordenador
    // planejar em cima de venda morta.
    const r = agregarFluxo({
      propostas: [
        proposta({ etapa: "cancelado", valor: 50 }),
        proposta({ etapa: "distrato", valor: 70 }),
        proposta({ etapa: "faturado", valor: 100 }),
      ],
      unidades: [],
    });

    expect(r.fluxo.map((f) => f.propostas)).toEqual([0, 0, 0, 0, 1]);
    expect(r.fluxo.reduce((a, f) => a + f.vgv, 0)).toBe(100);
    expect(r.perdas).toEqual({ canceladas: 1, distratos: 1, vgvCancelado: 120 });
  });

  it("mantém os cinco passos mesmo quando não há nenhuma proposta neles", () => {
    // A faixa é o PROCESSO: uma etapa que some da tela faria o coordenador achar que ela não existe.
    const r = agregarFluxo({ propostas: [], unidades: [] });
    expect(r.fluxo.map((f) => f.etapa)).toEqual([...ETAPAS_DO_FLUXO]);
    expect(r.fluxo.every((f) => f.propostas === 0)).toBe(true);
  });

  it("o ranking separa proposta aberta de venda fechada", () => {
    const r = agregarFluxo({
      propostas: [
        proposta({ etapa: "reservado", imobiliaria_nome: "ALFA", valor: 10 }),
        proposta({ etapa: "cancelado", imobiliaria_nome: "ALFA", valor: 10 }),
        proposta({ etapa: "faturado", imobiliaria_nome: "ALFA", valor: 90 }),
        proposta({ etapa: "faturado", imobiliaria_nome: "BETA", valor: 200 }),
      ],
      unidades: [],
    });

    expect(r.ranking).toEqual([
      { imobiliaria: "BETA", propostas: 1, vendidas: 1, vgv: 200 },
      { imobiliaria: "ALFA", propostas: 3, vendidas: 1, vgv: 90 },
    ]);
  });

  it("⚠️ a faturada entra no mês do FATURAMENTO, não no da última mexida", () => {
    // Corrigir hoje uma venda de março não pode empurrar a venda para setembro no gráfico.
    const r = agregarFluxo({
      propostas: [
        proposta({
          data_faturamento: "2026-03-15",
          etapa: "faturado",
          etapa_desde: "2026-09-03T12:00:00Z",
        }),
        proposta({ etapa: "cancelado", etapa_desde: "2026-09-01T12:00:00Z" }),
      ],
      unidades: [],
    });

    expect(r.serie).toEqual([
      { canceladas: 0, faturadas: 1, mes: "2026-03" },
      { canceladas: 1, faturadas: 0, mes: "2026-09" },
    ]);
  });

  it("agrupa o mapa por quadra e conta o estoque por situação", () => {
    const r = agregarFluxo({
      propostas: [],
      unidades: [
        unidade({ codigo: "Q02 L01", lote: "01", quadra: "Q02", situacao: "vendida" }),
        unidade({ codigo: "Q10 L02", lote: "02", quadra: "Q10", situacao: "disponivel" }),
        unidade({ codigo: "Q02 L10", lote: "10", quadra: "Q02", situacao: "disponivel" }),
      ],
    });

    // Ordem natural: Q02 antes de Q10, e L02 antes de L10 (numérica, não alfabética).
    expect(r.mapa.map((g) => g.grupo)).toEqual(["Q02", "Q10"]);
    expect(r.mapa[0]?.unidades.map((u) => u.lote)).toEqual(["01", "10"]);
    expect(r.totais.estoque).toEqual({ disponivel: 2, vendida: 1 });
  });

  it("sem quadra, o grupo sai do prefixo do código", () => {
    const r = agregarFluxo({
      propostas: [],
      unidades: [unidade({ codigo: "Q07 L12" }), unidade({ codigo: "302" })],
    });
    expect(r.mapa.map((g) => g.grupo)).toEqual(["Q07", "Unidades"]);
  });

  it("valor em texto (o numeric do Postgres chega como string) vira número", () => {
    const r = agregarFluxo({
      propostas: [proposta({ etapa: "faturado", valor: "1234.56" })],
      unidades: [],
    });
    expect(r.totais.vgvFaturado).toBe(1234.56);
  });

  it("só lista motivo de cancelamento quando ele existe", () => {
    // No legado, 2 de 2.263 canceladas têm motivo: o quadro precisa dizer isso, não fingir dado.
    const r = agregarFluxo({
      propostas: [
        proposta({ etapa: "cancelado", motivo: "DATA DE VENCIMENTO DIVERGENTE" }),
        proposta({ etapa: "cancelado", motivo: null }),
        proposta({ etapa: "cancelado", motivo: "   " }),
      ],
      unidades: [],
    });

    expect(r.motivos).toEqual([{ motivo: "DATA DE VENCIMENTO DIVERGENTE", n: 1 }]);
    expect(r.perdas.canceladas).toBe(3);
  });
});
