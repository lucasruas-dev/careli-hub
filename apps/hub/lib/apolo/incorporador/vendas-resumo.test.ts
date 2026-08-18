import { describe, expect, it } from "vitest";

import type { ApoloEnterpriseVendas, ApoloVendaStage, ApoloVendaUnit } from "@/lib/apolo/vendas";

import {
  baldeDaUnidade,
  mesDe,
  resumoDeVendas,
  ritmoDeVendas,
  unidadesParaOPortal,
} from "./vendas-resumo";

// O NÚMERO DE REFERÊNCIA É O VISTA ALEGRE (VAL, enterprise 29), o empreendimento do portal de
// teste (slug `bill`), medido no C2X em 17/08/2026:
//
//   126 unidades · R$ 10.471.900 de VGV
//   59 disponíveis (R$ 4.852.100) · 39 vendidas (R$ 3.334.100) · 28 bloqueadas (R$ 2.285.700)
//   0 reservadas · 0 em negociação · 19 propostas canceladas
//
// É o mesmo conjunto que a ficha do empreendimento mostra no Apolo interno. Se este teste
// quebrar, ou a dobra dos estágios mudou ou a tela do cliente passou a contar diferente da nossa,
// e as duas coisas terminam na mesma reunião.
const VENDAS_DO_VISTA_ALEGRE: ApoloEnterpriseVendas = {
  bloqueadas: { units: 28, vgv: 2285700 },
  funnel: [
    { stage: "disponivel", units: 59, vgv: 4852100 },
    { stage: "reservado", units: 0, vgv: 0 },
    { stage: "proposta", units: 0, vgv: 0 },
    { stage: "contrato", units: 0, vgv: 0 },
    { stage: "assinatura", units: 0, vgv: 0 },
    { stage: "faturado", units: 39, vgv: 3334100 },
  ],
  movements: [],
  terminalItems: [],
  terminals: [
    { proposals: 19, terminal: "cancelado", vgv: 1608100 },
    { proposals: 0, terminal: "distrato", vgv: 0 },
  ],
  totalUnits: 126,
  units: [],
};

function unidade(
  stage: ApoloVendaStage,
  stageSince: null | string,
  vgv = 89900,
  blocked = false,
): ApoloVendaUnit {
  return {
    arId: null,
    block: "Q02",
    blocked,
    client: stage === "disponivel" ? null : { code: null, entityId: "e1", name: "Fulano" },
    code: "VALQ0218",
    id: "1",
    imobiliaria:
      stage === "disponivel" ? null : { code: null, entityId: "e2", name: "Imobiliária X" },
    lot: "L18",
    stage,
    stageSince,
    vgv,
  };
}

describe("o resumo de vendas do portal", () => {
  const resumo = resumoDeVendas(VENDAS_DO_VISTA_ALEGRE);

  it("⚠️ o total SOMA as bloqueadas: é o VGV do empreendimento, não o do funil", () => {
    // A tela interna soma só os baldes do funil e mostra R$ 8.186.200. Para o dono do loteamento,
    // a unidade que ele tirou da oferta não deixou de ser dele.
    expect(resumo.total).toEqual({ units: 126, vgv: 10471900 });
  });

  it("bate com a ficha do Vista Alegre, balde a balde", () => {
    const porBalde = Object.fromEntries(
      resumo.baldes.map((balde) => [balde.balde, { units: balde.units, vgv: balde.vgv }]),
    );

    expect(porBalde.disponivel).toEqual({ units: 59, vgv: 4852100 });
    expect(porBalde.vendido).toEqual({ units: 39, vgv: 3334100 });
    expect(porBalde.bloqueada).toEqual({ units: 28, vgv: 2285700 });
    expect(porBalde.reservado).toEqual({ units: 0, vgv: 0 });
    expect(porBalde.negociacao).toEqual({ units: 0, vgv: 0 });
  });

  it("os baldes fecham o total, sem unidade contada duas vezes", () => {
    const somaUnidades = resumo.baldes.reduce((soma, balde) => soma + balde.units, 0);

    expect(somaUnidades).toBe(126);
  });

  it("o percentual vendido é sobre o VGV do empreendimento inteiro", () => {
    expect(resumo.vendidoPct).toBeCloseTo(31.84, 1);
  });

  it("as perdas saem só como contagem: nada de motivo nem de nome", () => {
    expect(resumo.perdas).toEqual({ canceladas: 19, distratos: 0 });
  });

  it("dobra proposta, contrato e assinatura num balde só, e guarda o detalhe", () => {
    const comNegociacao = resumoDeVendas({
      ...VENDAS_DO_VISTA_ALEGRE,
      funnel: [
        { stage: "disponivel", units: 10, vgv: 1000 },
        { stage: "reservado", units: 1, vgv: 100 },
        { stage: "proposta", units: 2, vgv: 200 },
        { stage: "contrato", units: 3, vgv: 300 },
        { stage: "assinatura", units: 4, vgv: 400 },
        { stage: "faturado", units: 5, vgv: 500 },
      ],
    });

    const negociacao = comNegociacao.baldes.find((balde) => balde.balde === "negociacao")!;

    expect(negociacao.units).toBe(9);
    expect(negociacao.vgv).toBe(900);
    expect(negociacao.etapas.map((etapa) => etapa.rotulo)).toEqual([
      "Proposta emitida",
      "Contrato gerado",
      "Em assinatura",
    ]);
  });

  it("etapa zerada não vira linha na legenda", () => {
    const vendido = resumo.baldes.find((balde) => balde.balde === "vendido")!;
    const reservado = resumo.baldes.find((balde) => balde.balde === "reservado")!;

    expect(vendido.etapas).toHaveLength(1);
    expect(reservado.etapas).toHaveLength(0);
  });
});

describe("o ritmo de vendas", () => {
  // As 39 do Vista Alegre, no mês em que cada uma foi concluída (medido no C2X).
  const VENDIDAS = [
    ...Array.from({ length: 26 }, () => unidade("faturado", "2026-01-20T12:00:00.000Z", 85092)),
    ...Array.from({ length: 4 }, () => unidade("faturado", "2026-04-10T12:00:00.000Z", 90650)),
    ...Array.from({ length: 5 }, () => unidade("faturado", "2026-05-12T12:00:00.000Z", 81900)),
    ...Array.from({ length: 2 }, () => unidade("faturado", "2026-06-15T12:00:00.000Z", 89900)),
    unidade("faturado", "2026-07-18T12:00:00.000Z", 89900),
    unidade("faturado", "2026-08-05T12:00:00.000Z", 79900),
  ];

  const AGORA = Date.parse("2026-08-17T15:00:00.000Z");

  it("fecha com o total vendido: 39 unidades espalhadas por seis meses", () => {
    const ritmo = ritmoDeVendas(VENDIDAS, AGORA);
    const total = ritmo.meses.reduce((soma, mes) => soma + mes.units, 0);

    expect(total).toBe(39);
    expect(ritmo.meses.filter((mes) => mes.units > 0)).toHaveLength(6);
  });

  it("a janela tem doze meses e termina no mês de hoje", () => {
    const ritmo = ritmoDeVendas(VENDIDAS, AGORA);

    expect(ritmo.meses).toHaveLength(12);
    expect(ritmo.meses[0]?.mes).toBe("2025-09");
    expect(ritmo.meses[11]?.mes).toBe("2026-08");
  });

  it("mês sem venda aparece com zero, e não sumindo do eixo", () => {
    const ritmo = ritmoDeVendas(VENDIDAS, AGORA);
    const fevereiro = ritmo.meses.find((mes) => mes.mes === "2026-02");

    expect(fevereiro).toEqual({ mes: "2026-02", units: 0, vgv: 0 });
  });

  it("só entra o que está vendido: estoque e negociação ficam de fora", () => {
    const ritmo = ritmoDeVendas(
      [
        unidade("faturado", "2026-08-05T12:00:00.000Z"),
        unidade("assinatura", "2026-08-06T12:00:00.000Z"),
        unidade("reservado", "2026-08-07T12:00:00.000Z"),
        unidade("disponivel", null),
      ],
      AGORA,
    );

    expect(ritmo.meses.reduce((soma, mes) => soma + mes.units, 0)).toBe(1);
  });

  it("⚠️ o mês é o de São Paulo: venda das 22h de 31 de janeiro é de JANEIRO", () => {
    // Em UTC a mesma venda cairia em fevereiro, e o gráfico contaria no mês seguinte ao que o
    // time comemorou.
    const ritmo = ritmoDeVendas([unidade("faturado", "2026-02-01T01:00:00.000Z")], AGORA);

    expect(ritmo.meses.find((mes) => mes.mes === "2026-01")?.units).toBe(1);
    expect(ritmo.meses.find((mes) => mes.mes === "2026-02")?.units).toBe(0);
  });

  it("venda mais antiga que a janela é somada à parte, nunca descartada em silêncio", () => {
    const ritmo = ritmoDeVendas(
      [unidade("faturado", "2024-03-10T12:00:00.000Z", 50000)],
      AGORA,
    );

    expect(ritmo.anteriores).toEqual({ units: 1, vgv: 50000 });
    expect(ritmo.meses.reduce((soma, mes) => soma + mes.units, 0)).toBe(0);
  });

  it("vendida sem data fica fora do gráfico e é contada para a tela avisar", () => {
    const ritmo = ritmoDeVendas([unidade("faturado", null)], AGORA);

    expect(ritmo.semData).toBe(1);
    expect(ritmo.anteriores.units).toBe(0);
  });

  it("a média conta a partir do primeiro mês com venda, não da janela inteira", () => {
    // Duas vendas em julho e uma em agosto: dois meses de atividade, média 1,5. Dividir pelos
    // doze meses da janela daria 0,25 e faria o empreendimento parecer parado.
    const ritmo = ritmoDeVendas(
      [
        unidade("faturado", "2026-07-02T12:00:00.000Z"),
        unidade("faturado", "2026-07-20T12:00:00.000Z"),
        unidade("faturado", "2026-08-04T12:00:00.000Z"),
      ],
      AGORA,
    );

    expect(ritmo.mediaMensal).toBe(1.5);
  });

  it("sem nenhuma venda, a média é zero e não NaN", () => {
    const ritmo = ritmoDeVendas([], AGORA);

    expect(ritmo.mediaMensal).toBe(0);
  });
});

describe("a unidade no portal", () => {
  it("bloqueada sem venda ativa é bloqueada; com venda em andamento, o estágio manda", () => {
    expect(baldeDaUnidade(unidade("disponivel", null, 1000, true))).toBe("bloqueada");
    expect(baldeDaUnidade(unidade("assinatura", null, 1000, true))).toBe("negociacao");
    expect(baldeDaUnidade(unidade("disponivel", null, 1000, false))).toBe("disponivel");
  });

  it("⚠️ não expõe id interno além do unitId: nada de arId nem entityId", () => {
    const [linha] = unidadesParaOPortal([unidade("faturado", "2026-08-05T12:00:00.000Z")]);

    expect(Object.keys(linha!).sort()).toEqual([
      "balde",
      "bloco",
      "comprador",
      "desde",
      "etapa",
      "imobiliaria",
      "lote",
      "situacao",
      "unidade",
      "unitId",
      "valor",
    ]);
  });

  it("carrega o unitId (a chave do popup da proposta); id que não é número sai nulo", () => {
    const [linha] = unidadesParaOPortal([unidade("faturado", "2026-08-05T12:00:00.000Z")]);
    expect(linha?.unitId).toBe(1);

    const [semId] = unidadesParaOPortal([
      { ...unidade("faturado", null), id: "não-numérico" },
    ]);
    expect(semId?.unitId).toBeNull();
  });

  it("carrega a chave do estágio, para o Pipeline agrupar colunas iguais às do Apolo", () => {
    const [faturada] = unidadesParaOPortal([unidade("faturado", "2026-08-05T12:00:00.000Z")]);
    const [emAssinatura] = unidadesParaOPortal([unidade("assinatura", null)]);

    expect(faturada?.etapa).toBe("faturado");
    expect(emAssinatura?.etapa).toBe("assinatura");
    // O balde continua dobrando ("assinatura" cai em negociação); a etapa preserva o detalhe.
    expect(emAssinatura?.balde).toBe("negociacao");
  });

  it("unidade disponível não carrega comprador nem imobiliária", () => {
    const [linha] = unidadesParaOPortal([unidade("disponivel", null)]);

    expect(linha?.comprador).toBeNull();
    expect(linha?.imobiliaria).toBeNull();
  });

  it("a situação da bloqueada não diz 'Disponível'", () => {
    const [linha] = unidadesParaOPortal([unidade("disponivel", null, 1000, true)]);

    expect(linha?.situacao).toBe("Bloqueada");
  });
});

describe("mesDe", () => {
  it("devolve nulo para data inválida, em vez de estourar", () => {
    expect(mesDe("nao é data")).toBeNull();
  });
});
