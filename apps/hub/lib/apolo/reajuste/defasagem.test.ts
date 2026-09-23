import { describe, expect, it } from "vitest";

import { type ExtratoClienteParcelaBruta } from "@/lib/apolo/extrato-cliente";
import {
  defasagemDoContrato,
  type LinhaDaDefasagem,
  resumirDefasagem,
} from "@/lib/apolo/reajuste/defasagem";

let proximoId = 1;

function parcela(
  sobrescreve: Partial<ExtratoClienteParcelaBruta> = {},
): ExtratoClienteParcelaBruta {
  return {
    aExcluir: false,
    boletoUrl: null,
    competencia: null,
    descricao: null,
    faturaUrl: null,
    id: proximoId++,
    juros: 0,
    multa: 0,
    pagamento: null,
    parcelaAtual: 1,
    parcelaTotal: 144,
    sinalAtual: 0,
    sinalTotal: 0,
    statusId: 6,
    tipo: "Parcela",
    tipoId: 3,
    valorInicial: 535.99,
    valorPago: 0,
    vencimento: "2030-01-20",
    ...sobrescreve,
  };
}

/** Reproduz a forma do AR 206, que é o caso que revelou o mecanismo. */
function serieDoAr206(): ExtratoClienteParcelaBruta[] {
  const serie: ExtratoClienteParcelaBruta[] = [];

  // 3 parcelas já cobradas ao patamar antigo, com boleto.
  for (let i = 0; i < 3; i += 1) {
    serie.push(
      parcela({
        boletoUrl: "https://asaas/b",
        valorInicial: 566.81,
        vencimento: `2026-0${4 + i}-20`,
      }),
    );
  }
  // 6 parcelas ao patamar novo, com boleto: é o que a cobrança pratica.
  for (let i = 0; i < 6; i += 1) {
    serie.push(
      parcela({
        boletoUrl: "https://asaas/b",
        valorInicial: 657.27,
        vencimento: `2026-${String(8 + i).padStart(2, "0")}-20`,
      }),
    );
  }
  // 135 futuras, sem boleto, congeladas no contratual.
  for (let i = 0; i < 135; i += 1) {
    const ano = 2027 + Math.floor(i / 12);
    const mes = (i % 12) + 1;
    serie.push(
      parcela({ valorInicial: 535.99, vencimento: `${ano}-${String(mes).padStart(2, "0")}-20` }),
    );
  }
  return serie;
}

describe("defasagemDoContrato", () => {
  it("mede o AR 206: cobra 657,27 e as futuras ainda estão em 535,99", () => {
    const d = defasagemDoContrato(serieDoAr206());

    expect(d.apurada).toBe(true);
    expect(d.cobrado).toBe(657.27);
    expect(d.contratual).toBe(535.99);
    expect(d.percentual).toBeCloseTo(22.63, 2);
    expect(d.porParcela).toBeCloseTo(121.28, 2);
    expect(d.futurasDefasadas).toBe(135);
  });

  it("⚠️ pega o MAIOR valor com boleto, não o mais recente: a emissão não é cronológica", () => {
    const serie = [
      // Um avulso de parcela antiga, emitido por último, com valor velho.
      parcela({ boletoUrl: "b", valorInicial: 500, vencimento: "2026-01-20" }),
      parcela({ boletoUrl: "b", valorInicial: 650, vencimento: "2026-05-20" }),
      parcela({ valorInicial: 500, vencimento: "2027-01-20" }),
      parcela({ valorInicial: 500, vencimento: "2027-02-20" }),
    ];
    expect(defasagemDoContrato(serie).cobrado).toBe(650);
  });

  it("⚠️ ACORDO ESCALONADO: a majoração temporária NÃO é o valor praticado (AR 417)", () => {
    // A forma medida no C2X em 23/09/2026, LOS Q16 L14: a base de R$ 452,43 em 133 parcelas SEM
    // boleto, quatro de R$ 672,80 com boleto vencendo ANTES, e seis de R$ 557,37 com boleto
    // vencendo DEPOIS. O máximo cru publicava 48,71% onde o real é 23,19%, e jogava este contrato
    // para o topo da lista. É a mesma armadilha que o extrato matou em `mensalidadeVigente`.
    const serie: ExtratoClienteParcelaBruta[] = [];
    let n = 1;
    for (let i = 0; i < 4; i += 1) {
      serie.push(
        parcela({
          boletoUrl: "b",
          parcelaAtual: n++,
          valorInicial: 672.8,
          vencimento: `2026-${String(7 + i).padStart(2, "0")}-25`,
        }),
      );
    }
    for (let i = 0; i < 6; i += 1) {
      serie.push(
        parcela({
          boletoUrl: "b",
          parcelaAtual: n++,
          valorInicial: 557.37,
          vencimento: `2026-${String(8 + i).padStart(2, "0")}-18`,
        }),
      );
    }
    for (let i = 0; i < 60; i += 1) {
      serie.push(
        parcela({
          parcelaAtual: n++,
          valorInicial: 452.43,
          vencimento: `2027-${String((i % 12) + 1).padStart(2, "0")}-20`,
        }),
      );
    }

    const d = defasagemDoContrato(serie);
    expect(d.cobrado).toBe(557.37);
    expect(d.percentual).toBeCloseTo(23.19, 1);
    expect(d.porParcela).toBeCloseTo(104.94, 1);
  });

  it("contrato em dia: apurada, com zero, e não 'não consegui'", () => {
    const serie = [
      parcela({ boletoUrl: "b", valorInicial: 600, vencimento: "2026-05-20" }),
      parcela({ valorInicial: 600, vencimento: "2027-01-20" }),
      parcela({ valorInicial: 600, vencimento: "2027-02-20" }),
    ];
    const d = defasagemDoContrato(serie);
    expect(d.apurada).toBe(true);
    expect(d.percentual).toBe(0);
    expect(d.porParcela).toBe(0);
    expect(d.futurasDefasadas).toBe(0);
  });

  it("⚠️ o BALÃO disfarçado de mensal sai da conta (a régua do AR 3716)", () => {
    const serie = [
      ...Array.from({ length: 10 }, (_, i) =>
        parcela({ boletoUrl: "b", valorInicial: 500, vencimento: `2026-0${(i % 9) + 1}-20` }),
      ),
      // O balão: 22 mil marcado como parcel_type_id 3.
      parcela({ boletoUrl: "b", valorInicial: 22250.25, vencimento: "2026-06-20" }),
      parcela({ valorInicial: 486.63, vencimento: "2027-01-20" }),
      parcela({ valorInicial: 486.63, vencimento: "2027-02-20" }),
    ];
    const d = defasagemDoContrato(serie);
    // Sem o filtro isto daria 4.472%. Com ele, a conta fica sobre a mensalidade de verdade.
    expect(d.cobrado).toBe(500);
    expect(d.percentual).toBeCloseTo(2.75, 1);
  });

  it("⚠️ o patamar é a MODA das futuras, e não a média: uma parcela torta não puxa", () => {
    const serie = [
      parcela({ boletoUrl: "b", valorInicial: 700, vencimento: "2026-05-20" }),
      ...Array.from({ length: 20 }, (_, i) =>
        parcela({ valorInicial: 600, vencimento: `2027-${String((i % 12) + 1).padStart(2, "0")}-20` }),
      ),
      // Uma futura fora do patamar (acordo, quitação parcial).
      parcela({ valorInicial: 900, vencimento: "2028-06-20" }),
    ];
    const d = defasagemDoContrato(serie);
    expect(d.contratual).toBe(600);
    expect(d.futurasDefasadas).toBe(20);
  });

  it("sem boleto nenhum: NÃO apurada, e diz por quê em vez de devolver zero", () => {
    const serie = [parcela({ vencimento: "2027-01-20" }), parcela({ vencimento: "2027-02-20" })];
    const d = defasagemDoContrato(serie);
    expect(d.apurada).toBe(false);
    expect(d.percentual).toBe(0);
    expect(d.motivo).toContain("Nenhum boleto");
  });

  it("tudo já emitido: não apurada, mas informa o que se cobra", () => {
    const serie = [
      parcela({ boletoUrl: "b", valorInicial: 600, vencimento: "2026-05-20" }),
      parcela({ boletoUrl: "b", valorInicial: 600, vencimento: "2026-06-20" }),
    ];
    const d = defasagemDoContrato(serie);
    expect(d.apurada).toBe(false);
    expect(d.cobrado).toBe(600);
    expect(d.motivo).toContain("parcela futura");
  });

  it("contrato sem mensalidade nenhuma", () => {
    expect(defasagemDoContrato([]).motivo).toContain("sem mensalidade");
  });

  it("parcela futura ACIMA do cobrado não vira defasagem negativa", () => {
    const serie = [
      parcela({ boletoUrl: "b", valorInicial: 500, vencimento: "2026-05-20" }),
      parcela({ valorInicial: 600, vencimento: "2027-01-20" }),
      parcela({ valorInicial: 600, vencimento: "2027-02-20" }),
    ];
    const d = defasagemDoContrato(serie);
    expect(d.percentual).toBe(0);
    expect(d.porParcela).toBe(0);
  });
});

describe("resumirDefasagem", () => {
  function linha(percentual: number, porParcela: number, apurada = true): LinhaDaDefasagem {
    return {
      cliente: "Fulano",
      code: "LOU",
      contratoId: proximoId++,
      defasagem: {
        apurada,
        cobrado: 0,
        contratual: 0,
        futurasDefasadas: 0,
        percentual,
        porParcela,
        ultimoBoletoEm: null,
      },
      unidade: "Q01 L01",
    };
  }

  it("soma o que a carteira deixa de cobrar por mês", () => {
    const r = resumirDefasagem([linha(22.63, 121.28), linha(23.19, 104.91), linha(0, 0)]);
    expect(r.comDefasagem).toBe(2);
    expect(r.emDia).toBe(1);
    expect(r.porMes).toBeCloseTo(226.19, 2);
  });

  it("a mediana é dos DEFASADOS, e não da carteira toda", () => {
    const r = resumirDefasagem([linha(10, 1), linha(20, 1), linha(30, 1), linha(0, 0)]);
    expect(r.medianaPct).toBe(20);
  });

  it("separa o que não deu para apurar, em vez de contar como em dia", () => {
    const r = resumirDefasagem([linha(0, 0, false), linha(0, 0, true)]);
    expect(r.naoApurados).toBe(1);
    expect(r.emDia).toBe(1);
    expect(r.comDefasagem).toBe(0);
  });

  it("carteira vazia não quebra", () => {
    const r = resumirDefasagem([]);
    expect(r).toEqual({
      comDefasagem: 0,
      emDia: 0,
      medianaPct: 0,
      naoApurados: 0,
      porMes: 0,
      total: 0,
    });
  });
});
