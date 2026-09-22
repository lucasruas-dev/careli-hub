import { describe, expect, it } from "vitest";

import { agregarFluxo, type PropostaDaCarga, type UnidadeDoMapa,
  andaresDoGrupo,
  baldeDaEtapa,
  ETAPAS_DA_FAIXA,
  linhaEmCancelamento,
  compararApartamentos,
  type EtapaDoEspelho,
  type LinhaDaFicha,
  linhaDaFicha,
  processoDaFicha,
  vocabularioDoEstoque,
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

    // Sete passos agora: o estoque na frente (zero aqui, porque o teste não passa unidades) e o
    // cancelamento no fim.
    expect(r.fluxo.map((f) => f.quantidade)).toEqual([0, 0, 0, 0, 0, 1, 0]);
    expect(r.fluxo.reduce((a, f) => a + f.vgv, 0)).toBe(100);
    expect(r.perdas).toEqual({ canceladas: 1, distratos: 1, vgvCancelado: 120 });
  });

  it("mantém os sete passos mesmo quando não há nada neles", () => {
    // A faixa é o PROCESSO: uma etapa que some da tela faria o coordenador achar que ela não existe.
    const r = agregarFluxo({ propostas: [], unidades: [] });
    expect(r.fluxo.map((f) => f.etapa)).toEqual([...ETAPAS_DA_FAIXA]);
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

// ── O PRÉDIO NA GRADE ───────────────────────────────────────────────────────
// Lucas (16/09/2026): apartamento nunca vira quadra/lote. A grade do prédio agrupa por TORRE e lê de
// cima para baixo; o loteamento continua exatamente como era (os testes acima não mudaram).

const apto = (
  apartamento: string,
  andar: null | number,
  torre: null | string,
  extra: Partial<UnidadeDoMapa> = {},
): UnidadeDoMapa =>
  unidade({
    andar,
    apartamento,
    codigo: torre ? `JAD-${torre}-${apartamento}` : `JAD-${apartamento}`,
    enterprise_id: "100001",
    torre,
    ...extra,
  });

describe("agregarFluxo no prédio", () => {
  it("agrupa por torre, e dentro da torre do andar mais alto para o mais baixo", () => {
    const r = agregarFluxo({
      propostas: [],
      unidades: [
        apto("101", 1, "B"),
        apto("1202", 12, "A"),
        apto("102", 1, "A"),
        apto("1201", 12, "A"),
        apto("21", 0, "A"),
        apto("1001", 10, "Torre 10"),
        apto("201", 2, "2"),
      ],
    });

    // Ordem natural das torres: "2" antes de "10".
    expect(r.mapa.map((g) => [g.grupo, g.tipoProduto])).toEqual([
      ["Torre 2", "vertical"],
      ["Torre 10", "vertical"],
      ["Torre A", "vertical"],
      ["Torre B", "vertical"],
    ]);
    const torreA = r.mapa.find((g) => g.grupo === "Torre A");
    expect(torreA?.unidades.map((u) => [u.andar, u.apartamento])).toEqual([
      [12, "1201"],
      [12, "1202"],
      [1, "102"],
      [0, "21"],
    ]);
    // A torre sai na forma canônica ("Torre 10" gravado à mão vira "10"), e não "Torre Torre 10".
    expect(r.mapa[1]?.unidades[0]?.torre).toBe("10");
    // ⚠️ E NADA DE QUADRA E LOTE NO APARTAMENTO.
    expect(torreA?.unidades.every((u) => u.quadra === null && u.lote === null)).toBe(true);
    expect(torreA?.unidades.every((u) => u.tipoProduto === "vertical")).toBe(true);
  });

  it("sem torre (torre única), o grupo é Unidades e fica depois das torres", () => {
    const r = agregarFluxo({
      propostas: [],
      unidades: [apto("304", 3, null), apto("0101", 1, null), apto("A1", null, "A")],
    });
    expect(r.mapa.map((g) => g.grupo)).toEqual(["Torre A", "Unidades"]);
    // "0101" chega na forma canônica: o índice único da 0171 compara "101".
    expect(r.mapa[1]?.unidades.map((u) => u.apartamento)).toEqual(["304", "101"]);
  });

  it("⚠️ o tipo do produto basta quando a leitura não trouxe as colunas", () => {
    const r = agregarFluxo({
      propostas: [],
      tiposDeProduto: { "100001": "vertical" },
      unidades: [unidade({ codigo: "JAD-A-304", enterprise_id: "100001" })],
    });
    expect(r.mapa[0]?.tipoProduto).toBe("vertical");
    expect(r.mapa[0]?.grupo).toBe("Unidades");
  });

  it("carrega tipologia e vagas só no prédio, e o estoque conta igual", () => {
    const r = agregarFluxo({
      propostas: [proposta({ etapa: "contrato", unidade_id: "apto-1" })],
      unidades: [
        apto("304", 3, "A", { id: "apto-1", preco_tabela: "480000", tipologia: " 2 quartos ", vagas: 1 }),
        apto("305", 3, "A", { preco_tabela: 500_000, situacao: "disponivel", vagas: 0 }),
      ],
    });
    const [contrato, livre] = r.mapa[0]?.unidades ?? [];
    expect(contrato?.etapa).toBe("contrato");
    expect(contrato?.tipologia).toBe("2 quartos");
    expect(contrato?.vagas).toBe(1);
    expect(livre?.vagas).toBe(0);
    expect(r.fluxo.find((f) => f.etapa === "disponivel")).toEqual({
      etapa: "disponivel",
      quantidade: 1,
      vgv: 500_000,
    });
  });

  it("⚠️ escopo com loteamento e prédio: quadras primeiro, e 'Unidades' dos dois não se mistura", () => {
    const r = agregarFluxo({
      propostas: [],
      unidades: [
        apto("304", 3, null),
        unidade({ codigo: "302" }),
        unidade({ codigo: "Q07 L12", lote: "12", quadra: "07" }),
      ],
    });
    expect(r.mapa.map((g) => [g.grupo, g.tipoProduto])).toEqual([
      ["07", "loteamento"],
      ["Unidades", "loteamento"],
      ["Unidades", "vertical"],
    ]);
    // O lote segue com as colunas do prédio nulas.
    expect(r.mapa[0]?.unidades[0]).toMatchObject({
      andar: null,
      apartamento: null,
      lote: "12",
      quadra: "07",
      tipologia: null,
      tipoProduto: "loteamento",
      torre: null,
      vagas: null,
    });
  });

  it("⚠️ tipo 'vertical' de outro produto não contamina o loteamento", () => {
    const r = agregarFluxo({
      propostas: [],
      tiposDeProduto: { "100001": "vertical" },
      unidades: [unidade({ codigo: "JDG0617", enterprise_id: "39", lote: "17", quadra: "06" })],
    });
    expect(r.mapa[0]).toMatchObject({ grupo: "06", tipoProduto: "loteamento" });
  });
});

describe("andaresDoGrupo e compararApartamentos", () => {
  it("uma linha por andar, de cima para baixo, com andar não informado no fim", () => {
    const linhas = andaresDoGrupo([
      { andar: 1, apartamento: "102", codigo: "JAD-102" },
      { andar: null, apartamento: "X", codigo: "JAD-X" },
      { andar: 2, apartamento: "201", codigo: "JAD-201" },
      { andar: 1, apartamento: "101", codigo: "JAD-101" },
      { andar: -1, apartamento: "S1", codigo: "JAD-S1" },
    ]);
    expect(linhas.map((l) => [l.andar, l.unidades.map((u) => u.apartamento)])).toEqual([
      [2, ["201"]],
      [1, ["101", "102"]],
      [-1, ["S1"]],
      [null, ["X"]],
    ]);
  });

  it("apartamento em ordem natural dentro do andar", () => {
    const base = { andar: 9, codigo: "" };
    expect(compararApartamentos({ ...base, apartamento: "902" }, { ...base, apartamento: "910" })).toBeLessThan(0);
    expect(compararApartamentos({ ...base, apartamento: null }, { ...base, apartamento: "901" })).toBeGreaterThan(0);
  });
});

describe("vocabularioDoEstoque", () => {
  it("quadra no loteamento, torre no prédio, os dois no consolidado", () => {
    expect(vocabularioDoEstoque(["loteamento"]).todos).toBe("Todas as quadras");
    expect(vocabularioDoEstoque([]).todos).toBe("Todas as quadras");
    expect(vocabularioDoEstoque(["vertical", "vertical"])).toEqual({
      busca: "Buscar torre, apartamento ou código",
      todos: "Todas as torres",
    });
    expect(vocabularioDoEstoque(["vertical", "loteamento"]).todos).toBe("Todas as quadras e torres");
    // O texto de sempre, para o loteamento não mudar de cara.
    expect(vocabularioDoEstoque(["loteamento"]).busca).toBe("Buscar quadra, lote ou código");
  });
});

// ── A SITUAÇÃO VINDA DA RÉGUA ÚNICA ─────────────────────────────────────────
// Lucas (18/09/2026): *"esses status tem que morar em um so lugar"*. Com `situacaoPorUnidade`, a
// grade e o estoque pintam pela régua de `situacao-da-unidade.ts` (o terreno inteiro, a reserva do
// Hércules e a do evento), e a conta local não roda. O funil e a lista continuam das propostas.

describe("agregarFluxo com a situação da régua única", () => {
  it("⚠️ a régua manda na grade, mesmo contra o cadastro e as propostas da linha", () => {
    // O caso que motivou a mudança: lote livre no cadastro, sem proposta nesta linha, mas reservado
    // no evento de lançamento (ou com proposta na linha antiga do terreno). A conta local dizia
    // "disponível"; a régua diz o que o Apolo também vai dizer.
    const r = agregarFluxo({
      propostas: [proposta({ etapa: "faturado", unidade_id: "u-2" })],
      situacaoPorUnidade: new Map([
        ["u-1", "reservado"],
        ["u-2", "contrato"],
        ["u-3", "disponivel"],
      ]),
      unidades: [
        unidade({ codigo: "Q01 L01", id: "u-1", lote: "01", preco_tabela: 100, situacao: "disponivel" }),
        unidade({ codigo: "Q01 L02", id: "u-2", lote: "02", preco_tabela: 200, situacao: "vendida" }),
        unidade({ codigo: "Q01 L03", id: "u-3", lote: "03", preco_tabela: 300, situacao: "disponivel" }),
      ],
    });

    expect(r.mapa[0]?.unidades.map((u) => u.etapa)).toEqual(["reservado", "contrato", "disponivel"]);
    // O dado cru continua indo junto, para quem precisar dele.
    expect(r.mapa[0]?.unidades.map((u) => u.situacao)).toEqual(["disponivel", "vendida", "disponivel"]);
    expect(r.totais.estoque).toEqual({ contrato: 1, disponivel: 1, reservado: 1 });
    // O passo `disponivel` da faixa é contado pelas unidades: só a livre pela régua entra.
    expect(r.fluxo.find((f) => f.etapa === "disponivel")).toEqual({ etapa: "disponivel", quantidade: 1, vgv: 300 });
  });

  it("o funil, a lista e o VGV continuam saindo das propostas", () => {
    const r = agregarFluxo({
      propostas: [proposta({ etapa: "faturado", unidade_id: "u-2", valor: 500 })],
      situacaoPorUnidade: new Map([["u-2", "contrato"]]),
      unidades: [unidade({ codigo: "Q01 L02", id: "u-2", situacao: "vendida" })],
    });

    expect(r.fluxo.find((f) => f.etapa === "faturado")).toEqual({ etapa: "faturado", quantidade: 1, vgv: 500 });
    expect(r.fluxo.find((f) => f.etapa === "contrato")?.quantidade).toBe(0);
    expect(r.lista.map((l) => l.etapa)).toEqual(["faturado"]);
    expect(r.totais.vgvFaturado).toBe(500);
  });

  it("⚠️ unidade que a régua não trouxe NUNCA vira livre", () => {
    // Só acontece numa corrida (a unidade nasceu entre as duas leituras). Na dúvida, fora da oferta.
    const r = agregarFluxo({
      propostas: [],
      situacaoPorUnidade: new Map(),
      unidades: [unidade({ codigo: "Q01 L01", id: "u-nova", situacao: "disponivel" })],
    });

    expect(r.mapa[0]?.unidades[0]?.etapa).toBe("bloqueada");
    expect(r.fluxo.find((f) => f.etapa === "disponivel")?.quantidade).toBe(0);
  });

  it("sem o mapa, a conta de sempre (quem ainda não passa a situação não muda)", () => {
    const r = agregarFluxo({
      propostas: [proposta({ etapa: "contrato", unidade_id: "u-9" })],
      unidades: [unidade({ codigo: "Q01 L01", id: "u-9", situacao: "vendida" })],
    });
    expect(r.mapa[0]?.unidades[0]?.etapa).toBe("contrato");
  });
});

// ── OS BOTÕES DA FICHA, COERENTES COM A RÉGUA ───────────────────────────────
// Lucas (18/09/2026): *"eu não posso vender dois lotes para pessoas diferentes"*. A grade pinta pela
// régua única, que vê o terreno inteiro e a reserva do salão; os botões e as rotas agem na linha da
// própria unidade. Quando a régua vê um processo que a lista não tem, os botões apagam com uma frase
// que não inventa origem.

describe("processoDaFicha", () => {
  const linha = (l: Partial<LinhaDaFicha> & { etapa: string; id: string }): LinhaDaFicha => ({
    origem: null,
    unidadeId: "u-1",
    ...l,
  });
  const lote = (etapa: EtapaDoEspelho) => ({ etapa, id: "u-1" });

  const reservaDoHercules = linha({ etapa: "reservado", id: "reserva:r-1" });
  const propostaNativa = linha({ etapa: "proposta", id: "p-nativa", origem: "panteon" });
  const propostaDoC2x = linha({ etapa: "proposta", id: "p-c2x", origem: "c2x" });

  it("⚠️ em cancelamento, quem sustenta a cor é a linha MARCADA, e não a etapa", () => {
    // No banco a venda segue em contrato/assinatura/faturado. Procurar uma linha "na etapa
    // em_cancelamento" não acharia nenhuma, e a ficha apagaria os botões dizendo que a situação do
    // lote não bate com a lista — sobre o lote em que ela bate.
    const pedida = linha({
      cancelamentoPedidoEm: "2026-09-18T12:00:00Z",
      etapa: "assinatura",
      id: "p-pedida",
    });
    expect(processoDaFicha(lote("em_cancelamento"), [pedida])).toEqual({
      linha: pedida,
      tipo: "na-lista",
    });
  });

  it("em cancelamento sem a linha marcada na lista: botões apagados, e não um palpite", () => {
    expect(processoDaFicha(lote("em_cancelamento"), [linha({ etapa: "assinatura", id: "p-1" })])).toMatchObject(
      { causa: "divergente", tipo: "apagado" },
    );
  });

  it("fora do fluxo e sem processo na lista: os botões de sempre", () => {
    for (const etapa of ["disponivel", "bloqueada", "vendida", "reservada"] as const) {
      expect(processoDaFicha(lote(etapa), [])).toEqual({ tipo: "sem-processo" });
    }
  });

  it("a reserva do Hércules da própria unidade é a que os botões operam", () => {
    expect(processoDaFicha(lote("reservado"), [reservaDoHercules])).toEqual({
      linha: reservaDoHercules,
      tipo: "na-lista",
    });
    expect(processoDaFicha(lote("proposta"), [propostaNativa])).toEqual({
      linha: propostaNativa,
      tipo: "na-lista",
    });
  });

  it("⚠️ reservado pela régua SEM linha na lista (salão, linha do pai): apagado, sem inventar origem", () => {
    // O caso que acendia "Gerar proposta" e "Cancelar reserva" para a rota recusar.
    const r = processoDaFicha(lote("reservado"), []);
    expect(r).toMatchObject({ causa: "fora-da-lista", tipo: "apagado" });
    const frase = r.tipo === "apagado" ? r.frase : "";
    expect(frase).toContain("não mostra");
    expect(frase).toContain("pode ser do salão do lançamento ou de outra linha do lote");
    expect(frase).toContain("Fale com a coordenação");
    expect(frase).not.toContain("C2X");
  });

  it("⚠️ proposta pela régua SEM linha na lista NÃO vira \"veio do C2X\"", () => {
    // A ficha dizia que a proposta veio do C2X quando não achava linha nenhuma: origem inventada.
    for (const etapa of ["proposta", "contrato", "assinatura", "faturado"] as const) {
      const r = processoDaFicha(lote(etapa), []);
      expect(r).toMatchObject({ causa: "fora-da-lista", tipo: "apagado" });
      expect(r.tipo === "apagado" ? r.frase : "").not.toContain("C2X");
    }
  });

  it("só conta linha VIVA da PRÓPRIA unidade", () => {
    const lista = [
      linha({ etapa: "cancelado", id: "p-velha", origem: "panteon" }),
      linha({ etapa: "reservado", id: "reserva:de-outro", unidadeId: "u-2" }),
    ];
    expect(processoDaFicha(lote("reservado"), lista)).toMatchObject({ causa: "fora-da-lista" });
    expect(processoDaFicha(lote("disponivel"), lista)).toEqual({ tipo: "sem-processo" });
  });

  it("⚠️ reserva do Hércules ao lado de outra linha viva: dois donos, tudo apagado", () => {
    const r = processoDaFicha(lote("proposta"), [reservaDoHercules, propostaDoC2x]);
    expect(r).toMatchObject({ causa: "dois-processos", tipo: "apagado" });
    expect(processoDaFicha(lote("reservado"), [reservaDoHercules, linha({ etapa: "reservado", id: "p-1", origem: "c2x" })]))
      .toMatchObject({ causa: "dois-processos" });
  });

  it("a lista tem processo, mas não na etapa que a régua pintou: apagado", () => {
    // A reserva está aqui e a proposta que pinta o lote mora em outra linha do terreno.
    expect(processoDaFicha(lote("proposta"), [reservaDoHercules])).toMatchObject({
      causa: "divergente",
      tipo: "apagado",
    });
  });

  it("⚠️ livre pela régua com processo vivo na lista: Reservar NÃO acende", () => {
    // As duas leituras da rota se desencontraram (alguém reservou no meio da carga).
    const r = processoDaFicha(lote("disponivel"), [reservaDoHercules]);
    expect(r).toMatchObject({ causa: "divergente", tipo: "apagado" });
    expect(r.tipo === "apagado" ? r.frase : "").toContain("Recarregue");
  });

  it("reserva importada do C2X: a origem está na linha, e só aí a frase diz C2X", () => {
    const r = processoDaFicha(lote("reservado"), [linha({ etapa: "reservado", id: "p-1", origem: "c2x" })]);
    expect(r).toMatchObject({ causa: "reserva-do-legado", tipo: "apagado" });
    expect(r.tipo === "apagado" ? r.frase : "").toContain("C2X");
  });

  it("proposta do C2X na etapa certa segue para os botões (que explicam o legado)", () => {
    expect(processoDaFicha(lote("proposta"), [propostaDoC2x])).toEqual({ linha: propostaDoC2x, tipo: "na-lista" });
  });

  it("entre linhas vivas, vale a da etapa que a régua pintou", () => {
    const contrato = linha({ etapa: "contrato", id: "p-contrato", origem: "panteon" });
    expect(processoDaFicha(lote("contrato"), [propostaDoC2x, contrato])).toEqual({ linha: contrato, tipo: "na-lista" });
  });

  it("nenhuma frase tem travessão", () => {
    const casos: Array<[EtapaDoEspelho, LinhaDaFicha[]]> = [
      ["reservado", []],
      ["proposta", []],
      ["contrato", []],
      ["assinatura", []],
      ["faturado", []],
      ["proposta", [reservaDoHercules]],
      ["proposta", [reservaDoHercules, propostaDoC2x]],
      ["reservado", [linha({ etapa: "reservado", id: "p-1", origem: "c2x" })]],
    ];
    for (const [etapa, lista] of casos) {
      const r = processoDaFicha(lote(etapa), lista);
      expect(r.tipo).toBe("apagado");
      expect(r.tipo === "apagado" ? r.frase : "—").not.toContain("—");
    }
  });
});

describe("linhaDaFicha", () => {
  const linha = (l: Partial<LinhaDaFicha> & { etapa: string; id: string }): LinhaDaFicha => ({
    origem: null,
    unidadeId: "u-1",
    ...l,
  });

  it("é a mesma linha que os botões operam", () => {
    const c2x = linha({ etapa: "proposta", id: "p-c2x", origem: "c2x" });
    const contrato = linha({ etapa: "contrato", id: "p-contrato", origem: "panteon" });
    expect(linhaDaFicha({ etapa: "contrato", id: "u-1" }, [c2x, contrato])).toBe(contrato);
  });

  it("sem linha que sustente a cor, a primeira viva da unidade (a regra de antes); sem nenhuma, nulo", () => {
    const reserva = linha({ etapa: "reservado", id: "reserva:r-1" });
    expect(linhaDaFicha({ etapa: "proposta", id: "u-1" }, [reserva])).toBe(reserva);
    expect(linhaDaFicha({ etapa: "reservado", id: "u-1" }, [])).toBeNull();
  });
});

// A VENDA EM CANCELAMENTO (21/09/2026). Lucas: *"hoje ele aponta para contrato e polui nossos
// indicadores, acho que devemos separar"* · *"e um card novo"*.
describe("a venda com cancelamento pedido", () => {
  const marcada = (p: Partial<PropostaDaCarga> & { etapa: string }) =>
    proposta({ cancelamento_pedido_em: "2026-09-18T12:00:00Z", ...p });

  it("sai do cartão da etapa dela e conta no cartão do cancelamento", () => {
    const r = agregarFluxo({
      propostas: [
        marcada({ etapa: "assinatura", valor: 200 }),
        proposta({ etapa: "assinatura", valor: 300 }),
      ],
      unidades: [],
    });

    expect(r.fluxo.find((f) => f.etapa === "assinatura")).toEqual({
      etapa: "assinatura",
      quantidade: 1,
      vgv: 300,
    });
    expect(r.fluxo.find((f) => f.etapa === "em_cancelamento")).toEqual({
      etapa: "em_cancelamento",
      quantidade: 1,
      vgv: 200,
    });
  });

  it("⚠️ conta UMA vez só: a soma dos cartões é o número de vendas vivas", () => {
    // Somar a mesma venda nos dois cartões seria o defeito oposto ao que este trabalho conserta:
    // em vez de poluir o contrato, inflaria o total.
    const r = agregarFluxo({
      propostas: [marcada({ etapa: "contrato", valor: 50 }), proposta({ etapa: "proposta", valor: 10 })],
      unidades: [],
    });
    expect(r.fluxo.reduce((a, f) => a + f.quantidade, 0)).toBe(2);
    expect(r.fluxo.reduce((a, f) => a + f.vgv, 0)).toBe(60);
  });

  it("⚠️ a marca SÓ vale depois do contrato", () => {
    // Antes dele o cancelamento é ato do coordenador e a etapa muda na hora; a marca que sobra numa
    // reserva ou proposta é história, e tirá-la do cartão esconderia venda viva.
    const r = agregarFluxo({
      propostas: [marcada({ etapa: "proposta", valor: 10 }), marcada({ etapa: "reservado", valor: 20 })],
      unidades: [],
    });
    expect(r.fluxo.find((f) => f.etapa === "em_cancelamento")?.quantidade).toBe(0);
    expect(r.fluxo.find((f) => f.etapa === "proposta")?.quantidade).toBe(1);
    expect(r.fluxo.find((f) => f.etapa === "reservado")?.quantidade).toBe(1);
  });

  it("a linha da lista responde pela MESMA régua do cartão", () => {
    expect(linhaEmCancelamento({ cancelamentoPedidoEm: "2026-09-18", etapa: "contrato" })).toBe(true);
    expect(linhaEmCancelamento({ cancelamentoPedidoEm: "2026-09-18", etapa: "proposta" })).toBe(false);
    expect(linhaEmCancelamento({ cancelamentoPedidoEm: null, etapa: "contrato" })).toBe(false);
  });
});

describe("baldeDaEtapa", () => {
  it("proposta, contrato e assinatura são negociação; faturado e vendida, vendido", () => {
    expect(
      (["disponivel", "reservado", "reservada", "proposta", "contrato", "assinatura", "faturado", "vendida", "bloqueada"] as const).map(
        baldeDaEtapa,
      ),
    ).toEqual([
      "disponivel",
      "reservado",
      "reservado",
      "negociacao",
      "negociacao",
      "negociacao",
      "vendido",
      "vendido",
      "bloqueado",
    ]);
  });

  it("⚠️ em cancelamento é VENDIDO, e nunca disponível", () => {
    // O `default` desta função devolve `disponivel`: sem o caso próprio, a tela Produtos contaria
    // como estoque livre um lote cujo contrato ainda está de pé — e a trava recusaria a venda.
    expect(baldeDaEtapa("em_cancelamento")).toBe("vendido");
    expect(baldeDaEtapa("em_cancelamento")).not.toBe("disponivel");
  });
});
