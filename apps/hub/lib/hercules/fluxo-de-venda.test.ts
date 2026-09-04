import { describe, expect, it } from "vitest";

import { agregarFluxo, ETAPAS_DO_FLUXO, type PropostaDaCarga, type UnidadeDoMapa,
  estoquePorEmpreendimento,
} from "./fluxo-de-venda";

const proposta = (p: Partial<PropostaDaCarga> & { etapa: string }): PropostaDaCarga => ({
  cliente_documento: null,
  cliente_nome: "FULANO DE TAL",
  contrato_parcelas: null,
  plano_correcao: null,
  plano_juros: null,
  plano_parcelas: null,
  plano_personalizado: null,
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
      quantidade: 2,
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

    // Seis passos agora: o estoque na frente (zero aqui, porque o teste não passa unidades).
    expect(r.fluxo.map((f) => f.quantidade)).toEqual([0, 0, 0, 0, 0, 1]);
    expect(r.fluxo.reduce((a, f) => a + f.vgv, 0)).toBe(100);
    expect(r.perdas).toEqual({ canceladas: 1, distratos: 1, vgvCancelado: 120 });
  });

  it("mantém os seis passos mesmo quando não há nada neles", () => {
    // A faixa é o PROCESSO: uma etapa que some da tela faria o coordenador achar que ela não existe.
    const r = agregarFluxo({ propostas: [], unidades: [] });
    expect(r.fluxo.map((f) => f.etapa)).toEqual(["disponivel", ...ETAPAS_DO_FLUXO]);
    expect(r.fluxo.every((f) => f.quantidade === 0)).toBe(true);
  });

  it("⚠️ vendida SEM proposta viva NÃO vira disponível", () => {
    // São 114 unidades assim na base: o cadastro diz vendida e nenhuma proposta no caminho explica
    // em que etapa está. Cair em "disponível" faria a grade oferecer lote vendido — e a faixa
    // contaria estoque que não existe.
    const r = agregarFluxo({
      propostas: [],
      unidades: [
        unidade({ codigo: "Q01 L01", situacao: "vendida" }),
        unidade({ codigo: "Q01 L02", situacao: "reservada" }),
        unidade({ codigo: "Q01 L03", situacao: "disponivel" }),
        unidade({ codigo: "Q01 L04", situacao: "coisa-nova-do-c2x" }),
      ],
    });

    expect(r.mapa[0]?.unidades.map((u) => u.etapa)).toEqual([
      "vendida",
      "reservada",
      "disponivel",
      // Situação desconhecida fica FORA da oferta: na dúvida, bloqueada.
      "bloqueada",
    ]);
    expect(r.fluxo.find((f) => f.etapa === "disponivel")?.quantidade).toBe(1);
  });

  it("a proposta viva REFINA a situação da unidade", () => {
    // O cadastro diz "vendida"; a proposta diz em que ponto do caminho ela está. Quem sabe mais
    // manda — e é isso que faz a grade mostrar contrato e assinatura em vez de um verde só.
    const r = agregarFluxo({
      propostas: [proposta({ etapa: "contrato", unidade_id: "u-9" })],
      unidades: [unidade({ codigo: "Q01 L01", id: "u-9", situacao: "vendida" })],
    });

    expect(r.mapa[0]?.unidades[0]?.etapa).toBe("contrato");
    expect(r.totais.estoque).toEqual({ contrato: 1 });
  });

  it("entre duas propostas vivas na mesma unidade, vale a mais recente", () => {
    // Revenda: a unidade acumula propostas. A antiga pintaria o lote de faturado depois de ele
    // voltar para o estoque e ser reservado de novo.
    const r = agregarFluxo({
      propostas: [
        proposta({ etapa: "faturado", etapa_desde: "2024-05-01T10:00:00Z", unidade_id: "u-1" }),
        proposta({ etapa: "reservado", etapa_desde: "2026-08-20T10:00:00Z", unidade_id: "u-1" }),
      ],
      unidades: [unidade({ codigo: "Q01 L01", id: "u-1", situacao: "vendida" })],
    });

    expect(r.mapa[0]?.unidades[0]?.etapa).toBe("reservado");
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
    // O estoque conta por ETAPA do espelho, e sem proposta a vendida segue vendida.
    expect(r.totais.estoque).toEqual({ disponivel: 2, vendida: 1 });
  });

  it("⚠️ o mapa e a lista carregam a chave que LIGA um ao outro", () => {
    // O clique no lote do mapa acha a proposta pelo id da unidade. Sem `id` no mapa ou sem
    // `unidadeId` na lista, clicar no lote não mostra nada — foi o que aconteceu na primeira
    // versão da tela, e por isso os dois campos têm teste.
    const r = agregarFluxo({
      propostas: [proposta({ etapa: "faturado", unidade_id: "unidade-1" })],
      unidades: [unidade({ codigo: "Q07 L12", id: "unidade-1", preco_tabela: "142800.00" })],
    });

    const noMapa = r.mapa[0]?.unidades[0];
    expect(noMapa?.id).toBe("unidade-1");
    expect(noMapa?.preco).toBe(142800);
    expect(r.lista[0]?.unidadeId).toBe("unidade-1");
    // O casamento que a tela faz:
    expect(r.lista.find((l) => l.unidadeId === noMapa?.id)?.etapa).toBe("faturado");
  });

  it("⚠️ o PERÍODO nao mexe na faixa do fluxo, so no desempenho", () => {
    // A faixa e o pipeline VIVO: "3 em assinatura" e verdade hoje, independente do mes escolhido.
    // Filtrar a faixa pela janela faria a proposta em assinatura desde julho desaparecer da tela
    // em setembro — o coordenador perderia de vista justamente o que esta parado.
    const propostas = [
      proposta({ data_faturamento: "2026-03-10", etapa: "faturado", valor: 100 }),
      proposta({ data_faturamento: "2026-09-01", etapa: "faturado", valor: 700 }),
      proposta({ etapa: "assinatura", etapa_desde: "2026-07-05T10:00:00Z", valor: 500 }),
    ];

    const tudo = agregarFluxo({ propostas, unidades: [] });
    const setembro = agregarFluxo({ periodo: { ate: "2026-09", de: "2026-09" }, propostas, unidades: [] });

    // A faixa: igual nos dois.
    const faixa = (r: ReturnType<typeof agregarFluxo>) => r.fluxo.map((f) => [f.etapa, f.quantidade, f.vgv]);
    expect(faixa(setembro)).toEqual(faixa(tudo));
    expect(setembro.fluxo.find((f) => f.etapa === "assinatura")?.quantidade).toBe(1);

    // O desempenho: so setembro.
    expect(tudo.totais.vgvFaturado).toBe(800);
    expect(setembro.totais.vgvFaturado).toBe(700);
    expect(setembro.periodo).toEqual({ ate: "2026-09", de: "2026-09", propostasNoPeriodo: 1 });
  });

  it("as CADs entram no funil, e vêm de outra fonte", () => {
    // CAD e do Apolo (apolo_esteira); proposta e do C2X importado. Pedido do Lucas: as duas na
    // mesma escada. Sem CADs a chamada continua valida — o funil comeca na reserva.
    const cads = { credenciados: 287, emAndamento: 61, emCorrecao: 12, reprovadas: 64, total: 412 };
    const comCads = agregarFluxo({ cads, propostas: [], unidades: [] });
    const semCads = agregarFluxo({ propostas: [], unidades: [] });

    expect(comCads.cads).toEqual(cads);
    expect(semCads.cads).toBeNull();
  });

  it("proposta sem data nenhuma fica FORA de uma janela, e dentro do total", () => {
    // Com janela, "sem data" nao pode virar "aconteceu neste mes": inflaria o mes corrente com
    // registro velho. Sem janela, ela conta normalmente.
    const propostas = [proposta({ criado_em_c2x: null, etapa: "cancelado", etapa_desde: null })];

    expect(agregarFluxo({ propostas, unidades: [] }).perdas.canceladas).toBe(1);
    expect(
      agregarFluxo({ periodo: { ate: "2026-09", de: "2026-09" }, propostas, unidades: [] }).perdas
        .canceladas,
    ).toBe(0);
  });

  it("⚠️ o juro sai com a unidade CERTA: 0,72 é ao mês, 8 é ao ano", () => {
    // O legado grava `contractual_interest` sem dizer a unidade — 8.0000 ao ano na Lavra do Ouro e
    // 0.7207 ao mês em outro produto, a mesma taxa econômica de dois jeitos. Chutar "a.a." errava
    // em um terço dos contratos com juros, e foi o Lucas quem viu: "acho que esse juros é ao mês
    // não?".
    const mensal = agregarFluxo({
      propostas: [
        proposta({
          contrato_parcelas: 156,
          etapa: "faturado",
          plano_correcao: "IPCA ANUAL",
          plano_juros: 0.7207,
        }),
      ],
      unidades: [],
    });
    const anual = agregarFluxo({
      propostas: [
        proposta({ contrato_parcelas: 60, etapa: "faturado", plano_correcao: "IPCA ANUAL", plano_juros: 8 }),
      ],
      unidades: [],
    });

    expect(mensal.lista[0]?.plano).toBe("156x · IPCA anual · juros 0,72% a.m.");
    expect(anual.lista[0]?.plano).toBe("60x · IPCA anual · juros 8% a.a.");
  });

  it("o parcelamento do CONTRATO vence o do molde", () => {
    // `commercial_plans.parcels` descreve o produto que a mesa vende; um molde serve centenas de
    // contratos. Foi ele que fez o extrato do TIAGO estampar 144x num contrato de 62 parcelas.
    const r = agregarFluxo({
      propostas: [proposta({ contrato_parcelas: 62, etapa: "faturado", plano_parcelas: 144 })],
      unidades: [],
    });
    expect(r.lista[0]?.plano).toBe("62x");

    // Sem o do contrato, o do molde entra — é melhor que nada.
    const semContrato = agregarFluxo({
      propostas: [proposta({ contrato_parcelas: null, etapa: "faturado", plano_parcelas: 144 })],
      unidades: [],
    });
    expect(semContrato.lista[0]?.plano).toBe("144x");
  });

  it("sem nenhum dos três, o nome do plano é melhor que um travessão", () => {
    const r = agregarFluxo({
      propostas: [proposta({ etapa: "faturado", plano_nome: "PLANO NORMAL" })],
      unidades: [],
    });
    expect(r.lista[0]?.plano).toBe("PLANO NORMAL");
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

// ── UMA FONTE SÓ PARA AS UNIDADES ───────────────────────────────────────────
describe("estoquePorEmpreendimento", () => {
  const unidade = (
    id: string,
    enterpriseId: string,
    situacao: string,
    preco = 100_000,
  ): UnidadeDoMapa => ({
    codigo: `U${id}`,
    enterprise_id: enterpriseId,
    id,
    lote: null,
    preco_tabela: preco,
    quadra: null,
    situacao,
  });

  const proposta = (unidadeId: string, etapa: string, desde: string) =>
    ({
      cliente_documento: null,
      cliente_nome: null,
      codigo: null,
      contrato_parcelas: null,
      criado_em_c2x: desde,
      data_assinatura: null,
      data_ato: null,
      data_faturamento: null,
      empreendimento_codigo: null,
      etapa,
      etapa_c2x: null,
      etapa_desde: desde,
      id: `p-${unidadeId}-${etapa}`,
      imobiliaria_nome: null,
      motivo: null,
      plano_correcao: null,
      plano_juros: null,
      plano_nome: null,
      plano_parcelas: null,
      plano_personalizado: null,
      unidade_id: unidadeId,
      unidade_nome: null,
      valor: 100_000,
    }) as PropostaDaCarga;

  it("separa por empreendimento e soma o valor", () => {
    const estoque = estoquePorEmpreendimento({
      propostas: [],
      unidades: [
        unidade("1", "39", "disponivel", 150_000),
        unidade("2", "39", "bloqueada", 200_000),
        unidade("3", "40", "vendida", 90_000),
      ],
    });

    expect(estoque.get("39")?.disponivel.units).toBe(1);
    expect(estoque.get("39")?.disponivel.value).toBe(150_000);
    expect(estoque.get("39")?.bloqueado.units).toBe(1);
    expect(estoque.get("39")?.total).toEqual({ units: 2, value: 350_000 });
    expect(estoque.get("40")?.vendido.units).toBe(1);
  });

  it("⚠️ a NEGOCIAÇÃO volta pela proposta, e não pela situação", () => {
    // O C2X tinha cinco estados (`sale_status_id`), `hercules_unidades.situacao` tem quatro: "em
    // negociação" se perdeu na importação. A proposta viva devolve isso — e com mais detalhe.
    const estoque = estoquePorEmpreendimento({
      propostas: [
        proposta("1", "proposta", "2026-08-01"),
        proposta("2", "contrato", "2026-08-02"),
        proposta("3", "assinatura", "2026-08-03"),
        proposta("4", "faturado", "2026-08-04"),
        proposta("5", "reservado", "2026-08-05"),
      ],
      unidades: [
        unidade("1", "39", "disponivel"),
        unidade("2", "39", "disponivel"),
        unidade("3", "39", "disponivel"),
        unidade("4", "39", "disponivel"),
        unidade("5", "39", "disponivel"),
      ],
    });

    expect(estoque.get("39")?.negociacao.units).toBe(3);
    expect(estoque.get("39")?.vendido.units).toBe(1);
    expect(estoque.get("39")?.reservado.units).toBe(1);
    expect(estoque.get("39")?.disponivel.units).toBe(0);
  });

  it("⚠️ a proposta REFINA, mas nunca rebaixa para livre", () => {
    // Sem proposta vale o cadastro, e vendida continua ocupada: dizer que um lote vendido está
    // livre é convidar a segunda venda.
    const estoque = estoquePorEmpreendimento({
      propostas: [proposta("1", "cancelado", "2026-08-01")],
      unidades: [unidade("1", "39", "vendida")],
    });
    expect(estoque.get("39")?.vendido.units).toBe(1);
    expect(estoque.get("39")?.disponivel.units).toBe(0);
  });

  it("entre duas propostas vivas vale a MAIS RECENTE", () => {
    const estoque = estoquePorEmpreendimento({
      propostas: [proposta("1", "faturado", "2026-01-01"), proposta("1", "reservado", "2026-08-01")],
      unidades: [unidade("1", "39", "vendida")],
    });
    expect(estoque.get("39")?.reservado.units).toBe(1);
    expect(estoque.get("39")?.vendido.units).toBe(0);
  });

  it("empreendimento sem unidade não vira linha", () => {
    expect(estoquePorEmpreendimento({ propostas: [], unidades: [] }).size).toBe(0);
  });
});
