// Regressões do EXTRATO DO CLIENTE COMPRADOR.
//
// Este relatório vai para a mão do cliente, então cada teste aqui existe por causa de um jeito
// específico de o C2X mentir — todos medidos no banco, não imaginados. O cabeçalho de
// `extrato-cliente.ts` explica cada um; aqui eles viram trava.
//
// O último bloco é o CASO REAL LOU1819 (AR 183), reduzido: os mesmos 20.061,50 pagos e
// 43.229,66 de saldo nominal que o Lucas usou como exemplo, com a mesma defasagem de 22,6%.
import { describe, expect, it } from "vitest";

import { descricaoDoPlano } from "./extrato-cliente-pdf";

import {
  contarParcelas,
  detectarEventosDeValor,
  mascararDocumento,
  mensaisDoContrato,
  mensalidadeVigente,
  montarExtratoDoContrato,
  parcelaAtiva,
  parcelaPaga,
  percentualSimples,
  resumoPorAno,
  serieMensal,
  situacaoParaOComprador,
  temBoleto,
  valorEfetivo,
  valoresCorroborados,
  vencimentosEmpilhados,
  TIPO_ATO,
  TIPO_AVULSO,
  TIPO_MENSAL,
  TIPO_SINAL,
  type ExtratoClienteContrato,
  type ExtratoClienteParcelaBruta,
} from "./extrato-cliente";

const HOJE = "2026-08-27";

function parcela(
  over: Partial<ExtratoClienteParcelaBruta> & { id: number },
): ExtratoClienteParcelaBruta {
  return {
    aExcluir: false,
    boletoUrl: null,
    competencia: null,
    descricao: null,
    faturaUrl: null,
    juros: 0,
    multa: 0,
    pagamento: null,
    parcelaAtual: null,
    parcelaTotal: null,
    sinalAtual: null,
    sinalTotal: null,
    statusId: 6,
    tipo: "Parcela",
    tipoId: TIPO_MENSAL,
    valorInicial: 0,
    valorPago: 0,
    vencimento: null,
    ...over,
  };
}

/** Uma mensal "normal": número, competência e vencimento derivados do índice. */
function mensal(
  n: number,
  valor: number,
  over: Partial<ExtratoClienteParcelaBruta> = {},
): ExtratoClienteParcelaBruta {
  const mes = ((n - 1) % 12) + 1;
  const ano = 2024 + Math.floor((n - 1) / 12);
  const mm = String(mes).padStart(2, "0");

  return parcela({
    competencia: `${ano}-${mm}-01`,
    id: 1000 + n,
    parcelaAtual: n,
    parcelaTotal: 120,
    valorInicial: valor,
    vencimento: `${ano}-${mm}-10`,
    ...over,
  });
}

function pago(p: ExtratoClienteParcelaBruta, valor: number, data: string) {
  return { ...p, pagamento: data, statusId: 5, valorPago: valor };
}

function comBoleto(p: ExtratoClienteParcelaBruta) {
  return { ...p, boletoUrl: "https://asaas.test/boleto/1" };
}

const contratoBase: ExtratoClienteContrato = {
  area: 300,
  codigo: "LOU1819",
  dataAssinatura: null,
  dataAto: "2023-12-02",
  empreendimentoCodigo: "LOU",
  empreendimentoNome: "LAVRA DO OURO",
  encerrado: false,
  estagio: 4,
  estagioNome: "Faturado",
  id: 183,
  indiceCorrecao: "IPCA ANUAL",
  jurosContratuais: 8,
  lote: "19",
  planoPadraoParcelas: 144,
  planoParcelas: 144,
  planoPersonalizado: false,
  precoTabela: 62366,
  quadra: "18",
  titulares: [],
};

function montar(
  parcelas: ExtratoClienteParcelaBruta[],
  contrato: Partial<ExtratoClienteContrato> = {},
) {
  return montarExtratoDoContrato({
    contrato: { ...contratoBase, ...contrato },
    hoje: HOJE,
    parcelas,
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// AS ARMADILHAS
// ────────────────────────────────────────────────────────────────────────────────────────────

describe("armadilha: paid_value sem payment_date", () => {
  it("nao conta como pago a parcela vencida que o Asaas pre-preencheu", () => {
    // Caso real AR 292 (MDS0802): status 7, sem data de pagamento, boleto emitido e
    // paid_value = 899,77. Somar isso inventaria recebimento.
    const fantasma = comBoleto(
      parcela({ id: 1, statusId: 7, valorInicial: 899.77, valorPago: 899.77, vencimento: "2025-01-20" }),
    );

    expect(parcelaPaga(fantasma)).toBe(false);

    const extrato = montar([fantasma]);
    expect(extrato.totais.totalPago).toBe(0);
    expect(extrato.totais.parcelasPagas).toBe(0);
    expect(extrato.totais.vencidasQuantidade).toBe(1);
    expect(extrato.totais.saldoNominal).toBe(899.77);
  });

  it("conta o Ato de valor zero que foi pago (paid_value 0,00 legitimo)", () => {
    // As 114 linhas "pagas com zero" do banco sao Ato de valor 0,00 - o initial_value tambem e
    // zero. Elas contam como parcela quitada, so nao somam dinheiro.
    const ato = parcela({
      id: 2,
      pagamento: "2024-01-10",
      statusId: 5,
      tipo: "Ato",
      tipoId: TIPO_ATO,
      valorInicial: 0,
      valorPago: 0,
    });

    const extrato = montar([ato]);
    expect(extrato.totais.parcelasPagas).toBe(1);
    expect(extrato.totais.totalPago).toBe(0);
    expect(extrato.realizados[0]?.numero).toBe("1/1");
  });
});

describe("armadilha: payment_to_delete e status fora da carteira", () => {
  it("ignora a linha marcada para exclusao e o status que nao e 5/6/7", () => {
    const viva = mensal(1, 400);
    const excluida = { ...mensal(2, 400), aExcluir: true };
    const foraDaCarteira = { ...mensal(3, 400), statusId: 2 };

    expect(parcelaAtiva(viva)).toBe(true);
    expect(parcelaAtiva(excluida)).toBe(false);
    expect(parcelaAtiva(foraDaCarteira)).toBe(false);

    const extrato = montar([viva, excluida, foraDaCarteira]);
    expect(extrato.totais.parcelasTotal).toBe(1);
    expect(extrato.totais.saldoNominal).toBe(400);
  });
});

describe("armadilha: parcelas empilhadas no mesmo vencimento (acordo)", () => {
  const acordo = [
    mensal(9, 495.63, { vencimento: "2026-04-23" }),
    mensal(10, 490.81, { vencimento: "2026-04-23" }),
    mensal(11, 486.15, { vencimento: "2026-04-23" }),
    mensal(12, 426.81),
    mensal(13, 497.72, { vencimento: "2026-04-23" }),
    mensal(14, 426.81),
    mensal(15, 426.81),
  ];

  it("reconhece o vencimento compartilhado", () => {
    expect(vencimentosEmpilhados(acordo)).toEqual(new Set(["2026-04-23"]));
  });

  it("tira as empilhadas da serie de degraus", () => {
    expect(serieMensal(acordo).map((p) => p.parcelaAtual)).toEqual([12, 14, 15]);
  });

  it("marca a linha como empilhada no extrato, mas mantem ela no saldo", () => {
    const extrato = montar(acordo);
    const linha = extrato.abertas.find((p) => p.id === 1009);

    expect(linha?.empilhada).toBe(true);
    // Nenhuma some: sao dividas reais, so nao servem para medir reajuste.
    expect(extrato.totais.parcelasAbertas).toBe(7);
  });

  it("nao inventa reajuste com a cascata decrescente do acordo", () => {
    expect(detectarEventosDeValor(serieMensal(acordo))).toEqual([]);
  });
});

describe("armadilha: paid_value diferente do initial_value", () => {
  it("usa o pago no extrato e o pago LIMPO de encargos na serie", () => {
    const comMora = pago(mensal(1, 389.79), 412.2, "2025-02-14");
    const comJuros = { ...pago(mensal(2, 389.79), 400, "2025-03-14"), juros: 10.21 };

    // No extrato o cliente ve o que saiu do bolso dele.
    const extrato = montar([comMora, comJuros]);
    expect(extrato.totais.totalPago).toBe(812.2);

    // Na serie, os juros voltam para fora: mora nao e correcao. E o valor pago so vale como
    // valor de parcela quando se REPETE (ver o bloco de corroboracao abaixo).
    const corroborados = new Set([41220]);
    expect(valorEfetivo(comMora, corroborados)).toBe(412.2);
    expect(valorEfetivo(comJuros, corroborados)).toBeCloseTo(389.79, 2);
  });
});

describe("armadilha: mora paga que o C2X nao gravou em interest_value", () => {
  // AR 67 (LOU0234): as parcelas 3 a 6 tem todas initial_value 389,79, mas foram pagas com
  // valores de mora diferentes (411,63 / 503,92 / 374,20 / 395,71) ate a serie chegar em
  // 412,20 -- o reajuste REAL do plano. Sem corroboracao o extrato anunciava ao cliente
  // "de R$ 395,71 para R$ 412,20 (+4,2%)" quando o contrato diz 389,79 -> 412,20 (+5,75%).
  const serie = [
    pago(mensal(1, 389.79), 389.79, "2024-02-22"),
    pago(mensal(2, 389.79), 389.79, "2024-03-21"),
    pago(mensal(3, 389.79), 411.63, "2024-12-08"),
    pago(mensal(4, 389.79), 503.92, "2025-02-26"),
    pago(mensal(5, 389.79), 374.2, "2025-02-26"),
    pago(mensal(6, 389.79), 395.71, "2025-02-26"),
    pago(mensal(7, 412.2), 412.2, "2025-03-21"),
    pago(mensal(8, 412.2), 412.2, "2025-04-15"),
    pago(mensal(9, 412.2), 412.2, "2025-05-12"),
    pago(mensal(10, 412.2), 412.2, "2025-07-07"),
  ];

  it("so aceita como valor de parcela o pago que se repete", () => {
    const corroborados = valoresCorroborados(serie);

    expect(corroborados.has(41220)).toBe(true); // 412,20 em quatro parcelas: e a mensalidade
    expect(corroborados.has(50392)).toBe(false); // 503,92 uma vez so: e mora
    expect(corroborados.has(39571)).toBe(false);
  });

  it("mede o reajuste a partir do valor de CONTRATO, nao do valor com mora", () => {
    const eventos = detectarEventosDeValor(serie, mensalidadeVigente(serie, HOJE));

    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ de: 389.79, para: 412.2, tipo: "reajuste" });
    expect(eventos[0]?.variacao).toBeCloseTo(0.0575, 4);
  });
});

describe("armadilha: dois boletos no mesmo dia nao podem derrubar a ancora", () => {
  // AR 207 (LOU0114): o backoffice emitiu a competencia atrasada e a do mes no mesmo dia; as
  // duas parcelas MAIS RECENTES (as de 477,98) compartilham vencimento e saem da serie de
  // degraus. A ancora recuava para 416,78 e a peca dizia, na mesma pagina, que a parcela
  // vigente era 416,78, que a proxima era 477,98 e que houve reajuste para 477,98.
  const parcelas = [
    ...[28, 29, 30].map((n) =>
      pago(comBoleto(mensal(n, 416.78, { vencimento: "2026-06-10" })), 416.78, "2026-06-10"),
    ),
    pago(comBoleto(mensal(31, 477.98, { vencimento: "2026-08-25" })), 477.98, "2026-08-25"),
    pago(comBoleto(mensal(32, 477.98, { vencimento: "2026-08-25" })), 477.98, "2026-08-24"),
    ...[33, 34, 35, 36].map((n) =>
      mensal(n, 477.98, { vencimento: `2026-${String(n - 24).padStart(2, "0")}-10` }),
    ),
    ...[37, 38, 39].map((n) =>
      mensal(n, 389.79, { vencimento: `2027-${String(n - 36).padStart(2, "0")}-10` }),
    ),
  ];

  it("le a mensalidade vigente na parcela empilhada, que a serie de degraus descarta", () => {
    expect(serieMensal(parcelas).map((p) => p.parcelaAtual)).not.toContain(31);
    expect(mensalidadeVigente(mensaisDoContrato(parcelas), HOJE)).toBe(477.98);
  });

  it("nao subestima o saldo das parcelas que ainda estao no valor velho", () => {
    const extrato = montar(parcelas);

    expect(extrato.totais.mensalidadeVigente).toBe(477.98);
    // 4 de 477,98 (33-36) + 3 de 389,79 levantadas para 477,98 (37-39).
    expect(extrato.totais.saldoAValorDeHoje).toBe(7 * 477.98);
    expect(extrato.totais.defasagem).toBeCloseTo(477.98 / 389.79 - 1, 4);
  });
});

describe("armadilha: o valor novo pode estar numa parcela SEM boleto", () => {
  // AR 242 (LOU1836): as parcelas 26-28 ja estao em 403,95, e as 29-30 receberam boleto com o
  // valor VELHO (383,94). Perseguir "a ultima com boleto" fazia a ancora andar para tras no
  // tempo e o extrato saia sem nenhuma ressalva de defasagem.
  const parcelas = [
    ...[26, 27, 28].map((n) =>
      pago(comBoleto(mensal(n, 403.95, { vencimento: "2026-06-20" })), 403.95, "2026-06-01"),
    ),
    ...[29, 30].map((n) =>
      comBoleto(mensal(n, 383.94, { vencimento: `2026-${String(n - 20).padStart(2, "0")}-20` })),
    ),
    ...[31, 32, 33].map((n) =>
      mensal(n, 383.94, { vencimento: `2027-${String(n - 30).padStart(2, "0")}-20` }),
    ),
  ];

  it("ancora no maior valor vivo, nao na parcela mais recente", () => {
    expect(mensalidadeVigente(mensaisDoContrato(parcelas), HOJE)).toBe(403.95);
    expect(montar(parcelas).totais.defasagem).toBeCloseTo(403.95 / 383.94 - 1, 4);
  });
});

describe("armadilha: parcela majorada por acordo escalonado", () => {
  // AR 417 (LOS1614): as parcelas 20-23 em 672,80, as 24-25 em 557,37 e as 30+ na base de
  // 452,43 -- tudo gravado, com boleto. Ancorar no maior transformava uma parcela majorada por
  // tres meses na "mensalidade do cliente" e levantava as futuras em 48,7%.
  const parcelas = [
    ...[1, 2, 3].map((n) => pago(mensal(n, 452.43), 452.43, `2026-0${n}-21`)),
    ...[20, 21, 22, 23].map((n) => comBoleto(mensal(n, 672.8, { vencimento: "2026-07-27" }))),
    ...[24, 25].map((n) => comBoleto(mensal(n, 557.37, { vencimento: "2026-09-27" }))),
    ...[26, 27, 28].map((n) => mensal(n, 452.43, { vencimento: `2027-0${n - 25}-27` })),
  ];

  it("nao ancora numa parcela que o proprio C2X ja superou com boleto menor", () => {
    expect(mensalidadeVigente(mensaisDoContrato(parcelas), HOJE)).toBe(557.37);
  });

  it("continua ancorando na maior quando a cobranca posterior menor e a linha do contrato", () => {
    // O contraste: no AR 242 a cobranca posterior menor E o valor original, ou seja, o boleto
    // saiu com o valor velho. Ali a parcela maior continua sendo a mensalidade vigente.
    const defasado = [
      ...[1, 2, 3].map((n) => pago(mensal(n, 383.94), 383.94, `2024-0${n}-20`)),
      ...[26, 27].map((n) => pago(comBoleto(mensal(n, 403.95, { vencimento: "2026-06-20" })), 403.95, "2026-06-01")),
      comBoleto(mensal(28, 383.94, { vencimento: "2026-09-20" })),
    ];

    expect(mensalidadeVigente(mensaisDoContrato(defasado), HOJE)).toBe(403.95);
  });
});

describe("armadilha: intermediaria gravada como parcela mensal", () => {
  // AR 3716 (VALA01): 87 mensais de 674,25 e a parcela 88 e um balao de 22.250,25, com boleto e
  // paga. Como ancora, ela levantava as 83 mensais em aberto e imprimia "SALDO DEVEDOR
  // R$ 1.846.770,75" e "3200,0% abaixo da parcela vigente" num contrato de R$ 56 mil.
  const parcelas = [
    ...Array.from({ length: 5 }, (_, i) =>
      pago(
        comBoleto(mensal(i + 1, 674.25, { vencimento: `2026-0${i + 1}-25` })),
        674.25,
        `2026-0${i + 1}-25`,
      ),
    ),
    pago(comBoleto(mensal(6, 22_250.25, { vencimento: "2026-06-25" })), 22_250.25, "2026-06-25"),
    ...Array.from({ length: 4 }, (_, i) =>
      mensal(i + 7, 674.25, { vencimento: `2026-0${i + 7}-25` }),
    ),
  ];

  it("nao deixa o balao virar mensalidade vigente", () => {
    expect(mensalidadeVigente(mensaisDoContrato(parcelas), HOJE)).toBe(674.25);
  });

  it("mantem o balao no saldo pelo valor dele, sem levantar as mensais", () => {
    const extrato = montar(parcelas);

    expect(extrato.totais.mensalidadeVigente).toBe(674.25);
    expect(extrato.totais.saldoAValorDeHoje).toBe(4 * 674.25);
    expect(extrato.totais.defasagem).toBe(0);
    expect(extrato.abertas.every((linha) => !linha.trazidaAValorDeHoje)).toBe(true);
  });
});

describe("armadilha: parcela sem boleto carrega o valor contratual cru", () => {
  const serie = [
    ...Array.from({ length: 6 }, (_, i) => comBoleto(mensal(i + 1, 477.98))),
    ...Array.from({ length: 10 }, (_, i) => mensal(i + 7, 389.79)),
  ];

  it("le a mensalidade vigente na ultima parcela COM boleto", () => {
    expect(temBoleto(serie[0]!)).toBe(true);
    expect(temBoleto(serie[6]!)).toBe(false);
    expect(mensalidadeVigente(serie, HOJE)).toBe(477.98);
  });

  it("traz as sem boleto para a vigente no saldo, e mantem o nominal visivel", () => {
    const extrato = montar(serie);

    expect(extrato.totais.saldoNominal).toBe(6765.78);
    expect(extrato.totais.saldoAValorDeHoje).toBe(7647.68);
    expect(extrato.totais.defasagem).toBeCloseTo(477.98 / 389.79 - 1, 4);

    const trazida = extrato.abertas.find((p) => p.id === 1007);
    expect(trazida?.trazidaAValorDeHoje).toBe(true);
    expect(trazida?.valorContratual).toBe(389.79);
    expect(trazida?.valorAtual).toBe(477.98);
  });

  it("nao levanta Ato, Sinal nem Avulso - so mensal e corrigida por indice", () => {
    const outros = [
      ...serie,
      parcela({ id: 5001, tipo: "Sinal", tipoId: TIPO_SINAL, valorInicial: 100, vencimento: "2026-12-10" }),
      parcela({ id: 5002, tipo: "Avulso", tipoId: TIPO_AVULSO, valorInicial: 396.43, vencimento: "2026-12-11" }),
    ];
    const extrato = montar(outros);

    expect(extrato.abertas.find((p) => p.id === 5001)?.valorAtual).toBe(100);
    // O Avulso de acordo ENTRA no saldo (e divida real), mas pelo valor negociado.
    expect(extrato.abertas.find((p) => p.id === 5002)?.valorAtual).toBe(396.43);
    expect(extrato.totais.saldoAValorDeHoje).toBe(8144.11);
  });
});

describe("armadilha: competencia duplicada e reference_date reescrito", () => {
  it("ordena a serie por current_total_parcel, nao pela competencia", () => {
    // As parcelas 9 e 10 tiveram a competencia reescrita para 04/2026 no acordo; a 11 ficou
    // com a original. Ordenar por competencia embaralharia a serie.
    const bagunca = [
      mensal(11, 430, { competencia: "2024-11-01", vencimento: "2026-11-10" }),
      mensal(9, 410, { competencia: "2026-04-01", vencimento: "2026-09-10" }),
      mensal(10, 420, { competencia: "2026-04-01", vencimento: "2026-10-10" }),
    ];

    expect(serieMensal(bagunca).map((p) => p.parcelaAtual)).toEqual([9, 10, 11]);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// DETECÇÃO DE DEGRAUS
// ────────────────────────────────────────────────────────────────────────────────────────────

describe("detectarEventosDeValor", () => {
  it("chama de reajuste a alta persistente de 2% ou mais", () => {
    const serie = [
      ...Array.from({ length: 12 }, (_, i) => comBoleto(pago(mensal(i + 1, 389.79), 389.79, "2025-01-10"))),
      ...Array.from({ length: 6 }, (_, i) => comBoleto(mensal(i + 13, 412.2))),
    ];

    const eventos = detectarEventosDeValor(serie);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ de: 389.79, para: 412.2, parcela: 13, tipo: "reajuste" });
    expect(eventos[0]?.variacao).toBeCloseTo(0.0575, 4);
    expect(eventos[0]?.rotulo).toContain("Reajuste contratual aplicado");
  });

  it("descarta o degrau curto - e ruido de mora, nao reajuste", () => {
    const serie = [
      mensal(1, 400),
      mensal(2, 400),
      pago(mensal(3, 400), 403.1, "2025-03-20"), // 2 dias de juros do Asaas
      pago(mensal(4, 400), 401.9, "2025-04-19"),
      mensal(5, 400),
      mensal(6, 400),
    ];

    expect(detectarEventosDeValor(serie)).toEqual([]);
  });

  it("chama de alteracao a queda persistente que nao volta a linha contratual", () => {
    // AR 2519 (REPD131): acordo derrubou as parcelas de 696,75 para 396,43.
    const serie = [
      comBoleto(pago(mensal(1, 696.75), 733.41, "2026-01-20")),
      ...Array.from({ length: 3 }, (_, i) => comBoleto(mensal(i + 2, 396.43))),
    ];

    const eventos = detectarEventosDeValor(serie);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]?.tipo).toBe("alteracao");
    expect(eventos[0]?.rotulo).toContain("Alteração de valor");
  });

  it("marca como fronteira - e nao como queda - o retorno ao valor de contrato", () => {
    // Linha contratual 389,79; reajuste para 477,98 na p7 (essas tem boleto); da p13 em diante
    // as parcelas nunca receberam boleto e continuam no valor cru. Esse "tombo" nao e queda de
    // preco: e o ponto onde a correcao parou de alcancar as linhas do banco.
    const serie = [
      ...Array.from({ length: 6 }, (_, i) => comBoleto(mensal(i + 1, 389.79))),
      ...Array.from({ length: 6 }, (_, i) => comBoleto(mensal(i + 7, 477.98))),
      ...Array.from({ length: 10 }, (_, i) => mensal(i + 13, 389.79)),
    ];
    const eventos = detectarEventosDeValor(serie, mensalidadeVigente(serie, HOJE));

    expect(eventos.map((evento) => evento.tipo)).toEqual(["reajuste", "fronteira"]);
    expect(eventos[1]?.parcela).toBe(13);
    // A fronteira nunca vira linha de "alteracao de valor" na peca.
    expect(eventos[1]?.rotulo).toContain("sem a correção anual aplicada");
  });

  it("NAO inventa fronteira quando a queda nao vem da mensalidade vigente", () => {
    // AR 292: a parcela 1 foi paga com R$ 25,46 de mora que o C2X nao gravou em
    // interest_value; sem a trava, a parcela 2 "caia" de volta a base e virava fronteira -
    // anunciando ao cliente uma defasagem que aquele contrato nao tem.
    const serie = [
      comBoleto(pago(mensal(1, 899.77), 925.23, "2024-12-17")),
      ...Array.from({ length: 8 }, (_, i) => mensal(i + 2, 899.77)),
    ];

    expect(detectarEventosDeValor(serie, mensalidadeVigente(serie, HOJE))).toEqual([]);
    expect(montar(serie).totais.defasagem).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// TOTAIS, SALDO E A PEÇA
// ────────────────────────────────────────────────────────────────────────────────────────────

describe("totais e saldo", () => {
  const parcelas = [
    pago(comBoleto(parcela({ id: 1, tipo: "Ato", tipoId: TIPO_ATO, valorInicial: 800, vencimento: "2023-12-02" })), 800, "2023-12-02"),
    pago(comBoleto(mensal(1, 400)), 400, "2024-01-10"),
    pago(comBoleto(mensal(2, 400)), 412, "2024-02-14"),
    comBoleto(mensal(3, 440, { vencimento: "2026-08-10" })), // vencida (hoje = 27/08/2026)
    comBoleto(mensal(4, 440, { vencimento: "2026-09-10" })), // proxima a vencer
    mensal(5, 400, { vencimento: "2026-10-10" }), // sem boleto: sobe para 440
  ];

  const extrato = montar(parcelas);

  it("separa pagos, vencidas e a vencer", () => {
    expect(extrato.totais.parcelasPagas).toBe(3);
    expect(extrato.totais.parcelasAbertas).toBe(3);
    expect(extrato.totais.vencidasQuantidade).toBe(1);
    expect(extrato.totais.vencidaMaisAntiga).toBe("2026-08-10");
    expect(extrato.totais.diasAtrasoMax).toBe(17);
  });

  it("soma o que o cliente pagou de fato", () => {
    expect(extrato.totais.totalPago).toBe(1612);
    expect(extrato.totais.primeiroPagamento).toBe("2023-12-02");
    expect(extrato.totais.ultimoPagamento).toBe("2024-02-14");
  });

  it("entrega o saldo nominal E o saldo a valor de hoje", () => {
    expect(extrato.totais.mensalidadeVigente).toBe(440);
    expect(extrato.totais.saldoNominal).toBe(1280);
    expect(extrato.totais.saldoAValorDeHoje).toBe(1320);
  });

  it("aponta o proximo vencimento pelo valor de cobranca", () => {
    expect(extrato.totais.proximoVencimento).toEqual({ valor: 440, vencimento: "2026-09-10" });
  });

  it("agrupa as abertas por ano de vencimento", () => {
    expect(resumoPorAno(extrato.abertas)).toEqual([
      { ano: "2026", atualizado: 1320, nominal: 1280, quantidade: 3 },
    ]);
  });

  it("poe a ressalva da defasagem e a de juros NA PECA", () => {
    // O Intl usa espaco NAO separavel depois de "R$"; normaliza antes de comparar.
    const juntas = extrato.notas.join(" ").replace(new RegExp("\u00a0", "g"), " ");
    expect(juntas).toContain("parcela vigente de R$ 440,00");
    expect(juntas).toContain("IPCA ANUAL");
    // A DIRECAO. `defasagem` e vigente/base - 1: e a VIGENTE que esta 10% ACIMA do original.
    expect(juntas).toContain("a parcela vigente está 10,0% acima desse valor");
    expect(juntas).not.toContain("abaixo da parcela vigente");
    expect(juntas).toContain("não incluem juros e multa");
    expect(juntas).toContain("quitação antecipada");
  });

  it("nao nomeia indice que o contrato nao tem", () => {
    const semIndice = montar(parcelas, { indiceCorrecao: null });
    expect(semIndice.notas.join(" ")).toContain("conforme a cláusula de correção do contrato");
    expect(semIndice.notas.join(" ")).not.toContain("IPCA");
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// AS DUAS COLUNAS DE VALOR DA TABELA "PAGAMENTOS REALIZADOS"
// ────────────────────────────────────────────────────────────────────────────────────────────

describe("valor da parcela x total pago", () => {
  /** Mesma regra da lib: arredonda no fim, senao a soma em ponto flutuante rende 43229,6599... */
  const somar = (valores: number[]) =>
    Math.round(valores.reduce((total, valor) => total + valor, 0) * 100) / 100;

  // O extrato imprime os DOIS numeros lado a lado e nao decompoe a diferenca: o C2X guarda o
  // total recebido, nao a composicao (mulct_value e 0,00 nas 15.655 parcelas pagas do banco, e
  // 5.153 das 5.742 que pagaram a mais nao tem interest_value). O que os testes travam aqui e
  // que o rodape SEMPRE fecha com as linhas impressas acima dele, nos tres jeitos de pagar.

  it("pagou exatamente o valor da parcela: as duas colunas batem", () => {
    const extrato = montar([
      pago(comBoleto(mensal(1, 452.43)), 452.43, "2024-01-10"),
      pago(comBoleto(mensal(2, 452.43)), 452.43, "2024-02-10"),
    ]);

    expect(extrato.totais.totalContratualPago).toBe(904.86);
    expect(extrato.totais.totalPago).toBe(904.86);
    // A frase de acrescimo do PDF sai desta subtracao: zero = frase nenhuma.
    expect(extrato.totais.totalPago - extrato.totais.totalContratualPago).toBe(0);
  });

  it("pagou a MAIS (mora que o C2X nao gravou): LOS0617 real, +R$ 49,10", () => {
    // Caso medido no banco (Thiago Bruno, AR 1066): 10 parcelas quitadas, quatro delas com
    // acrescimo de 11,45 / 12,50 / 12,95 / 12,20 e interest_value ZERADO nas quatro. E por isso
    // que a peca mostra os dois valores em vez de anunciar "juros R$ 0,00".
    const parcelas = [
      pago(
        comBoleto(parcela({ id: 800, tipo: "Ato", tipoId: TIPO_ATO, valorInicial: 1000, vencimento: "2024-08-02" })),
        1000,
        "2024-08-02",
      ),
      pago(
        comBoleto(parcela({ id: 801, tipo: "Sinal", tipoId: TIPO_SINAL, valorInicial: 6238.8, vencimento: "2024-08-06" })),
        6238.8,
        "2024-09-14",
      ),
      pago(comBoleto(mensal(2, 452.43)), 452.43, "2024-10-22"),
      pago(comBoleto(mensal(3, 452.43)), 452.43, "2024-11-27"),
      pago(comBoleto(mensal(4, 452.43)), 452.43, "2024-12-27"),
      pago(comBoleto(mensal(5, 452.43)), 463.88, "2025-02-07"),
      pago(comBoleto(mensal(6, 452.43)), 464.93, "2025-03-20"),
      pago(comBoleto(mensal(7, 452.43)), 452.43, "2025-04-07"),
      pago(comBoleto(mensal(8, 452.43)), 465.38, "2025-06-16"),
      pago(comBoleto(mensal(12, 452.43)), 464.63, "2025-09-10"),
    ];

    const extrato = montar(parcelas);

    expect(extrato.totais.parcelasPagas).toBe(10);
    expect(extrato.totais.totalContratualPago).toBe(10858.24);
    expect(extrato.totais.totalPago).toBe(10907.34);
    expect(
      Math.round((extrato.totais.totalPago - extrato.totais.totalContratualPago) * 100) / 100,
    ).toBe(49.1);
  });

  it("pagou a MENOS (baixa parcial): o total contratual fica ACIMA do recebido", () => {
    // 158 parcelas do banco foram baixadas por menos que o valor de contrato; a maior delas e
    // uma de R$ 125.746,40 com R$ 44.011,24 recebidos. Quem le o par de numeros nao pode supor
    // que a diferenca e sempre positiva - o PDF tem uma frase propria para este lado.
    const extrato = montar([
      pago(comBoleto(mensal(1, 452.43)), 452.43, "2024-01-10"),
      pago(
        comBoleto(
          parcela({
            id: 810,
            tipo: "Avulso",
            tipoId: TIPO_AVULSO,
            valorInicial: 125746.4,
            vencimento: "2024-02-10",
          }),
        ),
        44011.24,
        "2024-02-12",
      ),
    ]);

    expect(extrato.totais.totalContratualPago).toBe(126198.83);
    expect(extrato.totais.totalPago).toBe(44463.67);
    expect(extrato.totais.totalPago).toBeLessThan(extrato.totais.totalContratualPago);
  });

  it("soma so as pagas, e o rodape fecha com as linhas impressas", () => {
    const extrato = montar([
      pago(comBoleto(mensal(1, 452.43)), 463.88, "2024-01-15"),
      comBoleto(mensal(2, 452.43, { vencimento: "2026-09-10" })), // em aberto: fica de fora
      mensal(3, 452.43, { vencimento: "2026-10-10" }), // sem boleto: fica de fora
    ]);

    expect(extrato.realizados).toHaveLength(1);
    expect(extrato.totais.totalContratualPago).toBe(452.43);
    expect(extrato.totais.totalContratualPago).toBe(
      somar(extrato.realizados.map((linha) => linha.valorContratual)),
    );
    expect(extrato.totais.totalPago).toBe(
      somar(extrato.realizados.map((linha) => linha.valorPago ?? 0)),
    );
  });

  it("contrato encerrado leva as duas somas do historico, sem saldo", () => {
    const encerrado = montar(
      [
        pago(comBoleto(mensal(1, 452.43)), 464.93, "2024-01-18"),
        mensal(2, 452.43, { vencimento: "2026-12-10" }),
      ],
      { encerrado: true, estagio: 7, estagioNome: "Cancelado" },
    );

    expect(encerrado.totais.totalContratualPago).toBe(452.43);
    expect(encerrado.totais.totalPago).toBe(464.93);
    expect(encerrado.totais.saldoNominal).toBe(0);
  });
});

describe("contrato encerrado", () => {
  // AR 271 (MDS0203, cancelado) tem 120 parcelas em aberto no C2X, 3 delas vencidas: a premissa
  // de que o cancelamento apaga a carteira e FALSA. Zerar so os totais deixava o PDF imprimir
  // "PARCELAS EM ATRASO (3)" com tres linhas de R$ 1.204,87 e "Total em atraso: R$ 0,00" logo
  // abaixo da tarja que diz que nao ha saldo a apresentar.
  const encerrado = montar(
    [
      pago(mensal(1, 400), 400, "2024-01-10"),
      mensal(2, 1204.87, { vencimento: "2026-06-20" }), // vencida, residuo do cancelamento
      mensal(3, 1204.87, { vencimento: "2026-12-10" }),
    ],
    { encerrado: true, estagio: 7, estagioNome: "Cancelado" },
  );

  it("mostra o historico pago e suprime o saldo", () => {
    expect(encerrado.totais.totalPago).toBe(400);
    expect(encerrado.totais.saldoNominal).toBe(0);
    expect(encerrado.totais.saldoAValorDeHoje).toBe(0);
    expect(encerrado.totais.vencidasTotal).toBe(0);
    expect(encerrado.notas[0]).toContain("apenas os valores já pagos");
  });

  it("nao deixa NENHUMA linha em aberto de pe para virar cobranca fantasma", () => {
    expect(encerrado.abertas).toEqual([]);
    expect(encerrado.totais.parcelasAbertas).toBe(0);
    expect(encerrado.totais.vencidasQuantidade).toBe(0);
    expect(encerrado.totais.proximoVencimento).toBeNull();
    // "1 de 1 parcela quitada", nao "1 de 3": as outras duas nao existem mais para o cliente.
    expect(encerrado.totais.parcelasTotal).toBe(1);
  });

  it("nao imprime jargao de sistema na peca do cliente", () => {
    expect(encerrado.notas.join(" ")).not.toContain("C2X");
    expect(encerrado.notas.join(" ")).toContain("central de atendimento");
  });
});

describe("armadilha: parcela com baixa (status 5) e sem data de pagamento", () => {
  // Duas linhas assim no banco (AR 67 parcela 29 e o Ato do AR 4853). O C2X declara a parcela
  // paga; cobrar de novo o que o sistema deu por quitado e o pior erro possivel nesta peca.
  const semData = parcela({
    id: 7001,
    parcelaAtual: 29,
    statusId: 5,
    valorInicial: 477.98,
    valorPago: 412.2,
    vencimento: "2026-06-20",
  });

  it("conta como paga, pelo valor pago", () => {
    expect(parcelaPaga(semData)).toBe(true);

    const extrato = montar([pago(mensal(1, 400), 400, "2024-01-10"), semData]);

    expect(extrato.totais.parcelasPagas).toBe(2);
    expect(extrato.totais.totalPago).toBe(812.2);
    expect(extrato.abertas).toEqual([]);
    expect(extrato.totais.vencidasQuantidade).toBe(0);
  });

  it("nao deixa a baixa sem data virar o primeiro pagamento do cliente", () => {
    const extrato = montar([pago(mensal(1, 400), 400, "2024-01-10"), semData]);

    expect(extrato.totais.primeiroPagamento).toBe("2024-01-10");
    expect(extrato.totais.ultimoPagamento).toBe("2024-01-10");
  });
});

describe("a peca nao promete acordo que nao houve", () => {
  it("descreve a alteracao sem chamar de renegociacao", () => {
    // AR 2519 (REPD131) e o UNICO evento do banco com acordo registrado; a nota antiga
    // atribuia acordo a todos os 134, dos quais 109 eram mora e 5, defasagem.
    const serie = [
      comBoleto(pago(mensal(1, 696.75), 696.75, "2026-01-20")),
      ...Array.from({ length: 3 }, (_, i) => comBoleto(mensal(i + 2, 396.43, { vencimento: `2026-0${i + 2}-10` }))),
    ];
    const notas = montar(serie).notas.join(" ");

    expect(notas).toContain("apuradas pela variação do valor das parcelas");
    expect(notas).not.toContain("renegociações ou acordos registrados");
  });

  it("nao chama de alteracao a queda para um patamar anterior em parcela sem boleto", () => {
    // Contrato com DOIS reajustes: a correcao parou no patamar do meio, e da parcela 10 em
    // diante as linhas continuam em 412,20 porque nunca receberam boleto. Isso e defasagem;
    // impresso como "Alteracao de valor" virava uma reducao por escrito que ninguem combinou.
    const serie = [
      ...Array.from({ length: 3 }, (_, i) => comBoleto(mensal(i + 1, 389.79))),
      ...Array.from({ length: 3 }, (_, i) => comBoleto(mensal(i + 4, 412.2))),
      ...Array.from({ length: 3 }, (_, i) => comBoleto(mensal(i + 7, 477.98))),
      ...Array.from({ length: 6 }, (_, i) => mensal(i + 10, 412.2)),
    ];
    const eventos = detectarEventosDeValor(serie, mensalidadeVigente(serie, HOJE));

    // Vira FRONTEIRA (a nota da defasagem), nunca "alteracao" - que e o rotulo impresso.
    expect(eventos.map((evento) => evento.tipo)).toEqual(["reajuste", "reajuste", "fronteira"]);
    expect(eventos.some((evento) => evento.tipo === "alteracao")).toBe(false);
  });
});

describe("o texto que vai impresso", () => {
  it("concorda o singular", () => {
    expect(contarParcelas(1)).toBe("1 parcela");
    expect(contarParcelas(3)).toBe("3 parcelas");
  });

  it("separa o milhar no percentual", () => {
    expect(percentualSimples(32)).toBe("3.200,0%");
    expect(percentualSimples(0.226)).toBe("22,6%");
  });

  it("traduz o estagio do C2X para o vocabulario do comprador", () => {
    const situacao = (estagio: number, nome: string, encerrado = false) =>
      situacaoParaOComprador({ ...contratoBase, encerrado, estagio, estagioNome: nome });

    expect(situacao(4, "Faturado")).toBe("Contrato ativo");
    expect(situacao(5, "Em assinatura")).toBe("Contrato ativo");
    expect(situacao(1, "Reservado")).toBe("Em contratação");
    expect(situacao(7, "Cancelado", true)).toBe("Cancelado");
    expect(situacao(11, "Distratado", true)).toBe("Distratado");
  });
});

describe("mascararDocumento", () => {
  it("esconde o comeco e o fim do CPF, preserva o miolo", () => {
    expect(mascararDocumento("114.071.886-07")).toBe("***.071.886-**");
    expect(mascararDocumento("11407188607")).toBe("***.071.886-**");
  });

  it("mascara CNPJ e devolve o que nao reconhece sem quebrar", () => {
    expect(mascararDocumento("12345678000199")).toBe("**.345.678/0001-**");
    expect(mascararDocumento(null)).toBeNull();
    expect(mascararDocumento("  ")).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────
// O CASO REAL: LOU1819 (AR 183), reduzido
// ────────────────────────────────────────────────────────────────────────────────────────────

describe("LOU1819 (AR 183) - o exemplo do Lucas", () => {
  // Reproduz o formato do contrato real: Ato + 146 mensais, os dois degraus de reajuste
  // (389,79 -> 412,20 na p13 e -> 477,98 na p30), boleto ate a p35 e o resto no valor cru.
  function contratoReal(): ExtratoClienteParcelaBruta[] {
    const linhas: ExtratoClienteParcelaBruta[] = [
      pago(
        comBoleto(parcela({ id: 900, tipo: "Ato", tipoId: TIPO_ATO, valorInicial: 800, vencimento: "2023-12-02" })),
        800,
        "2023-12-02",
      ),
    ];

    for (let n = 1; n <= 146; n += 1) {
      const contratual = n < 13 ? 389.79 : n < 30 ? 412.2 : n < 36 ? 477.98 : 389.79;
      const base = mensal(n, contratual, { parcelaTotal: 146 });
      const linha = n <= 35 ? comBoleto(base) : base;

      // 36 mensais pagas + o Ato = 37 parcelas quitadas.
      linhas.push(n <= 36 ? pago(linha, contratual, `2024-${String(((n - 1) % 12) + 1).padStart(2, "0")}-10`) : linha);
    }

    return linhas;
  }

  const extrato = montar(contratoReal());

  it("conta 37 parcelas quitadas de 147", () => {
    expect(extrato.totais.parcelasTotal).toBe(147);
    expect(extrato.totais.parcelasPagas).toBe(37);
    expect(extrato.totais.parcelasAbertas).toBe(110);
  });

  it("acha a mensalidade vigente e a defasagem de 22,6%", () => {
    expect(extrato.totais.mensalidadeBase).toBe(389.79);
    expect(extrato.totais.mensalidadeVigente).toBe(477.98);
    expect(extrato.totais.defasagem).toBeCloseTo(0.226, 3);
  });

  it("o saldo a valor de hoje fica ACIMA do nominal - e por isso que ele existe", () => {
    expect(extrato.totais.saldoAValorDeHoje).toBeGreaterThan(extrato.totais.saldoNominal);
    // 110 abertas: 111..146 sem boleto e a 37..110 -> todas a 389,79 sobem para 477,98.
    expect(extrato.totais.saldoAValorDeHoje).toBe(110 * 477.98);
    expect(extrato.totais.saldoNominal).toBe(110 * 389.79);
  });

  it("lista os dois reajustes e nao rotula a fronteira como evento", () => {
    const rotulados = extrato.eventos.filter((evento) => evento.tipo !== "fronteira");

    expect(rotulados.map((evento) => evento.parcela)).toEqual([13, 30]);
    expect(rotulados.every((evento) => evento.tipo === "reajuste")).toBe(true);
    expect(extrato.eventos.at(-1)?.tipo).toBe("fronteira");
  });
});

describe("descricaoDoPlano", () => {
  const contrato = (extra: Partial<ExtratoClienteContrato>): ExtratoClienteContrato => ({
    ...contratoBase,
    ...extra,
  });

  it("⚠️ 0,72 é ao MÊS, 8 é ao ano", () => {
    // O `contractual_interest` do C2X não diz a unidade: guarda 8.0000 ao ano na Lavra do Ouro e
    // 0.7207 ao mês em outro produto — a mesma taxa econômica gravada de dois jeitos. Escrever
    // "a.a." fixo saía errado em 853 contratos (662 clientes), num documento que vai para a mão do
    // comprador. Foi o Lucas quem viu, olhando a ficha do Hércules: "acho que esse juros é ao mês
    // não?".
    expect(descricaoDoPlano(contrato({ jurosContratuais: 0.7207 }))).toContain("0,72% a.m.");
    expect(descricaoDoPlano(contrato({ jurosContratuais: 8 }))).toContain("8% a.a.");
    // Os valores que existem no banco, dos dois lados do vão:
    expect(descricaoDoPlano(contrato({ jurosContratuais: 0.8 }))).toContain("a.m.");
    expect(descricaoDoPlano(contrato({ jurosContratuais: 6 }))).toContain("a.a.");
  });

  it("junta parcelamento, correção e juros — os três, porque um só não se confere", () => {
    expect(descricaoDoPlano(contrato({ jurosContratuais: 8, planoParcelas: 60 }))).toBe(
      "60x · IPCA ANUAL · juros 8% a.a.",
    );
  });

  it("sem juros, não inventa a linha", () => {
    const sem = descricaoDoPlano(contrato({ jurosContratuais: 0 }));
    expect(sem).not.toContain("juros");
    expect(sem).toContain("IPCA ANUAL");
  });
});
