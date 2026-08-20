import { describe, expect, it } from "vitest";

import type { PoliticaDoEmpreendimento } from "@/lib/apolo/liquido-incorporador";

import {
  EXTRATO_TETO,
  agregarPorUnidade,
  lerSplit,
  type LinhaCruaDaCarteira,
  montarIndicadores,
  perfilDaParcela,
  situacaoDaLinha,
} from "./carteira-liquida";

// O DIA DO TESTE É FIXO: 17/08/2026 (a data do pedido do Lucas). Toda classificação de "vencida"
// e a janela de 12 meses da série dependem de "hoje", e teste que depende do relógio da máquina é
// teste que quebra em janeiro sem ninguém ter mexido em nada.
const HOJE = "2026-08-17";
const AGORA_MS = Date.parse("2026-08-17T12:00:00Z");

// Gestão de carteira de 50% de propósito: 0,5 é exato em ponto flutuante, então as somas do
// teste comparam com toEqual sem tolerância. (O C2X grava percentuais como 50 e como 0,50 — a
// regra normaliza os dois formatos.)
const POLITICA: PoliticaDoEmpreendimento = {
  comissaoPct: 7,
  entradaPct: 30,
  gestaoCarteiraPct: 50,
};

const POLITICAS = new Map<string, PoliticaDoEmpreendimento>([["VAL", POLITICA]]);

/** Linha crua de fábrica: parcela mensal PAGA de R$ 1.000 na unidade Q01 L01. */
function linha(sobrescreve: Partial<LinhaCruaDaCarteira> = {}): LinhaCruaDaCarteira {
  return {
    cliente: "Maria da Silva",
    competence: "07/2026",
    due_date: "2026-07-10",
    enterprise_code: "VAL",
    entrada_contratada: 30,
    imobiliaria: "Imobiliária X",
    parcel_type: "Parcela",
    parcela_n: 3,
    parcela_total: 120,
    payment_date: "2026-07-12",
    payment_id: 1,
    plano_personalizado: null,
    // O par de contadores do SINAL. No padrão do helper a linha é uma "Parcela", então eles vêm
    // zerados — igual ao C2X, que só preenche este par no tipo "Sinal".
    sinal_n: null,
    sinal_total: null,
    split_data: null,
    status_id: 5,
    unit_block: "Q01",
    unit_id: 10,
    unit_lot: "L01",
    unit_price: 100000,
    valor: 1000,
    valor_previsto: 1000,
    ...sobrescreve,
  };
}

/** O cenário-padrão dos indicadores: 4 parcelas, 2 unidades, 2 clientes. */
function cenario(): LinhaCruaDaCarteira[] {
  return [
    // Paga em julho, com split real apontando o incorporador: líquido 970.
    linha({
      payment_id: 1,
      split_data: JSON.stringify([
        { fixedValue: 970, name: "LOTEADORA VAL", profile: "Incorporador" },
      ]),
    }),
    // Vencida (venceu 01/08 e "hoje" é 17/08), ainda não paga: entra como inadimplente, pela
    // fórmula (50% de gestão): líquido 250.
    linha({
      cliente: "MARIA DA SILVA", // caixa diferente de propósito: é o MESMO cliente.
      due_date: "2026-08-01",
      payment_date: null,
      payment_id: 2,
      status_id: 6,
      valor: null,
      valor_previsto: 500,
    }),
    // A vencer em setembro (fora da janela da série, dentro dos KPIs): líquido 400.
    linha({
      cliente: "João Pereira",
      due_date: "2026-09-10",
      payment_date: null,
      payment_id: 3,
      status_id: 6,
      unit_block: "Q02",
      unit_id: 20,
      unit_lot: "L05",
      valor: null,
      valor_previsto: 800,
    }),
    // Ato pago em junho com split ÍNTEGRO SEM o incorporador: o rateio real diz que ele não
    // recebe nada nesta parcela — líquido 0 é FATO, não lacuna.
    linha({
      cliente: "João Pereira",
      due_date: "2026-06-05",
      parcel_type: "Ato",
      payment_date: "2026-06-06",
      payment_id: 4,
      split_data: JSON.stringify([{ name: "IMOBILIÁRIA X", value: 2000 }]),
      unit_block: "Q02",
      unit_id: 20,
      unit_lot: "L05",
      valor: 2000,
      valor_previsto: 2000,
    }),
  ];
}

describe("situacaoDaLinha", () => {
  it("paga quando há valor pago e data de pagamento", () => {
    expect(situacaoDaLinha(linha(), HOJE)).toBe("paga");
  });

  it("vencida pelo status 7, mesmo sem data de vencimento", () => {
    expect(
      situacaoDaLinha(
        linha({ due_date: null, payment_date: null, status_id: 7, valor: null }),
        HOJE,
      ),
    ).toBe("vencida");
  });

  it("vencida quando o vencimento passou e o status é cobrável", () => {
    expect(
      situacaoDaLinha(
        linha({ due_date: "2026-08-01", payment_date: null, status_id: 6, valor: null }),
        HOJE,
      ),
    ).toBe("vencida");
  });

  it("a vencer quando o vencimento ainda não chegou", () => {
    expect(
      situacaoDaLinha(
        linha({ due_date: "2026-09-01", payment_date: null, status_id: 6, valor: null }),
        HOJE,
      ),
    ).toBe("a_vencer");
  });

  it("status não cobrável (1, 2) vencido no papel NÃO vira inadimplência", () => {
    expect(
      situacaoDaLinha(
        linha({ due_date: "2026-01-01", payment_date: null, status_id: 2, valor: null }),
        HOJE,
      ),
    ).toBe("a_vencer");
  });
});

describe("agregarPorUnidade", () => {
  it("soma o líquido POR unidade, contando só as pagas, ordenado pelo rótulo", () => {
    const unidades = agregarPorUnidade(cenario(), POLITICAS, "Loteadora VAL", HOJE);

    // As duas em aberto (payment_id 2 e 3) ficam de fora: carteira é o que já entrou.
    expect(unidades).toEqual([
      {
        bruto: 1000,
        liquido: 970,
        parcelasPagas: 1,
        semLiquido: 0,
        unidade: "Q01 L01",
        unitId: "10",
      },
      {
        // O Ato com split íntegro sem o incorporador: líquido 0 é o rateio real, não falta de dado.
        bruto: 2000,
        liquido: 0,
        parcelasPagas: 1,
        semLiquido: 0,
        unidade: "Q02 L05",
        unitId: "20",
      },
    ]);
  });

  it("parcela sem como calcular entra em semLiquido, nunca como R$ 0", () => {
    const semPolitica = new Map<string, PoliticaDoEmpreendimento>();
    const unidades = agregarPorUnidade([linha()], semPolitica, null, HOJE);

    expect(unidades).toEqual([
      {
        bruto: 1000,
        liquido: 0,
        parcelasPagas: 1,
        semLiquido: 1,
        unidade: "Q01 L01",
        unitId: "10",
      },
    ]);
  });
});

describe("montarIndicadores", () => {
  const indicadores = montarIndicadores(cenario(), {
    agoraMs: AGORA_MS,
    nomeDoIncorporador: "Loteadora VAL",
    nomePorCode: new Map([["VAL", "Vista Alegre"]]),
    politicaPorCode: POLITICAS,
  });

  it("os KPIs do BI: receita, transferida, inadimplente e a % já em 0–100", () => {
    // Receita líquida = TODAS: 970 (paga) + 250 (vencida) + 400 (a vencer) + 0 (ato) = 1620.
    expect(indicadores.kpis.receitaLiquida).toEqual({
      bruto: 4300,
      liquido: 1620,
      parcelas: 4,
      semLiquido: 0,
    });
    // Transferida = só as pagas, e o ato entra com líquido 0.
    expect(indicadores.kpis.transferida).toEqual({
      bruto: 3000,
      liquido: 970,
      parcelas: 2,
      semLiquido: 0,
    });
    // Inadimplente = vencida não paga.
    expect(indicadores.kpis.inadimplente).toEqual({
      bruto: 500,
      liquido: 250,
      parcelas: 1,
      semLiquido: 0,
    });
    // O DENOMINADOR DO VALOR PRESENTE: só o que já venceu. As duas pagas (bruto 3000 / líquido
    // 970) mais a vencida (500 / 250). A parcela A VENCER fica de fora — é justamente ela que
    // inflava o denominador antigo e fazia o percentual parecer pequeno.
    expect(indicadores.kpis.previstoAteHoje).toEqual({
      bruto: 3500,
      liquido: 1220,
      parcelas: 3,
      semLiquido: 0,
    });

    // ⚠️ JÁ multiplicado por 100 — a lição do bug da TelaCarteira (0,3% onde era 30%).
    // ⚠️ E SOBRE O PREVISTO ATÉ HOJE, não sobre a receita da carteira inteira: dividir por 1620
    // (que inclui parcela futura) dava 15,4%; a conta certa é 20,5% no líquido.
    expect(indicadores.kpis.inadimplenciaPct.bruta).toBeCloseTo((500 / 3500) * 100, 6);
    expect(indicadores.kpis.inadimplenciaPct.liquida).toBeCloseTo((250 / 1220) * 100, 6);

    // A LÍQUIDA É MAIOR QUE A BRUTA aqui, e isso não é erro: o rateio tira do incorporador uma
    // fatia maior das parcelas PAGAS do que da vencida. É exatamente por isso que o Lucas pediu
    // as duas visões — a bruta esconde o efeito do rateio no cenário dele.
    expect(indicadores.kpis.inadimplenciaPct.liquida).toBeGreaterThan(
      indicadores.kpis.inadimplenciaPct.bruta,
    );
  });

  it("a parcela que ainda NÃO venceu fica fora do denominador da inadimplência", () => {
    // A conta antiga usava a receita inteira (1620), então uma carteira longa diluía o vencido e
    // o número afundava sozinho. Aqui a diferença fica explícita.
    const comBaseAntiga = (250 / 1620) * 100;
    expect(indicadores.kpis.inadimplenciaPct.liquida).toBeGreaterThan(comBaseAntiga);
    // O previsto até hoje é MENOR que a receita da carteira: é essa distância que o número mede.
    expect(indicadores.kpis.previstoAteHoje.liquido).toBeLessThan(
      indicadores.kpis.receitaLiquida.liquido,
    );
  });

  it("sem nenhum vencimento ainda, a inadimplência é 0 e não divisão por zero", () => {
    // Carteira nova: a única parcela vence no futuro. Não há inadimplência POSSÍVEL.
    const soFuturo = montarIndicadores(
      [linha({ due_date: "2030-01-10", payment_date: null, status_id: 6, valor: null })],
      {
        agoraMs: AGORA_MS,
        nomeDoIncorporador: "Loteadora VAL",
        nomePorCode: new Map([["VAL", "Vista Alegre"]]),
        politicaPorCode: POLITICAS,
      },
    );

    expect(soFuturo.kpis.previstoAteHoje.bruto).toBe(0);
    expect(soFuturo.kpis.inadimplenciaPct.bruta).toBe(0);
    expect(soFuturo.kpis.inadimplenciaPct.liquida).toBe(0);
  });

  it("contadores: clientes únicos por nome (ignorando caixa) e unidades únicas", () => {
    expect(indicadores.contadores).toEqual({ clientes: 2, parcelas: 4, unidades: 2 });
  });

  it("série mensal: 12 meses terminando no mês atual, previsto pelo VENCIMENTO e transferido pelo PAGAMENTO", () => {
    expect(indicadores.serieMensal).toHaveLength(12);
    expect(indicadores.serieMensal[0]?.mes).toBe("2025-09");
    expect(indicadores.serieMensal[11]?.mes).toBe("2026-08");

    const porMes = Object.fromEntries(indicadores.serieMensal.map((m) => [m.mes, m]));

    // Julho: a parcela paga venceu E foi paga no mês.
    expect(porMes["2026-07"]).toEqual({
      inadimplenciaPct: 0,
      inadimplente: 0,
      mes: "2026-07",
      previsto: 970,
      transferido: 970,
    });
    // Agosto: só a vencida — 100% de inadimplência no mês.
    expect(porMes["2026-08"]).toEqual({
      inadimplenciaPct: 100,
      inadimplente: 250,
      mes: "2026-08",
      previsto: 250,
      transferido: 0,
    });
    // Junho: o ato tem líquido 0 dos dois lados — presença sem valor.
    expect(porMes["2026-06"]).toEqual({
      inadimplenciaPct: 0,
      inadimplente: 0,
      mes: "2026-06",
      previsto: 0,
      transferido: 0,
    });
    // Setembro está FORA da janela (o mês atual fecha a série), mas a parcela conta nos KPIs.
    expect(porMes["2026-09"]).toBeUndefined();
  });

  it("extrato: vencimento CRESCENTE por padrão, com nome de mercado e SEM dado sensível", () => {
    expect(indicadores.extratoTotal).toBe(4);

    // ⚠️ A ORDEM VIROU CRESCENTE em 20/08/2026, e é uma decisão de produto, não um detalhe:
    // descendente punha 2039 na primeira linha, ou seja, a informação mais distante possível
    // ocupando o lugar mais nobre da tela. Lucas: *"assim se o usuário quiser saber o que vai
    // vencer no próximo mês ele sabe"*.
    expect(indicadores.extrato.map((p) => p.vencimento)).toEqual([
      "2026-06-05",
      "2026-07-10",
      "2026-08-01",
      "2026-09-10",
    ]);

    // A última continua sendo a mais distante — a mesma linha que antes vinha primeiro.
    expect(indicadores.extrato.at(-1)).toEqual({
      cliente: "João Pereira",
      empreendimento: "Vista Alegre",
      imobiliaria: "Imobiliária X",
      liquido: 400,
      motivo: undefined,
      numero: "3/120",
      pagoEm: null,
      perfil: "Parcela",
      situacao: "a_vencer",
      unidade: "Q02 L05",
      valor: 800,
      vencimento: "2026-09-10",
    });

    // ⚠️ A REGRA DO PORTAL: nenhuma linha do extrato carrega documento, telefone, e-mail, link de
    // boleto ou id interno de entidade. Se alguém adicionar um campo desses, este teste acusa.
    for (const parcela of indicadores.extrato) {
      const chaves = Object.keys(parcela);
      for (const proibida of ["cpf", "cnpj", "document", "documento", "email", "entityId", "phone", "telefone", "url"]) {
        expect(chaves.some((c) => c.toLowerCase().includes(proibida.toLowerCase()))).toBe(false);
      }
    }
  });

  it("parcela sem política entra nos motivos e em semLiquido, sem sumir da conta", () => {
    const semPolitica = montarIndicadores([linha()], {
      agoraMs: AGORA_MS,
      politicaPorCode: new Map(),
    });

    expect(semPolitica.kpis.receitaLiquida.semLiquido).toBe(1);
    expect(semPolitica.motivos.length).toBeGreaterThan(0);
  });
});

describe("perfilDaParcela", () => {
  it("traduz os nomes de negócio do C2X para os quatro perfis do rateio", () => {
    expect(perfilDaParcela("Ato")).toBe("ato");
    expect(perfilDaParcela("Sinal")).toBe("sinal");
    expect(perfilDaParcela("Parcela")).toBe("parcela");
    expect(perfilDaParcela("Balão")).toBe("parcela");
    expect(perfilDaParcela("Taxa de acordo")).toBe("outro");
    expect(perfilDaParcela(null)).toBe("outro");
  });
});

describe("lerSplit", () => {
  it("lê o formato em lista e o formato { splits: [...] }, string ou objeto", () => {
    const linhas = lerSplit(JSON.stringify([{ fixedValue: 970, name: "A", profile: "Incorporador" }]));
    expect(linhas).toEqual([{ nome: "A", perfil: "Incorporador", valor: 970 }]);

    const aninhado = lerSplit({ splits: [{ nome: "B", perfil: null, valor: 30 }] });
    expect(aninhado).toEqual([{ nome: "B", perfil: null, valor: 30 }]);
  });

  it("JSON estragado ou vazio devolve null, nunca lança", () => {
    expect(lerSplit("{quebrado")).toBeNull();
    expect(lerSplit(null)).toBeNull();
    expect(lerSplit([])).toBeNull();
  });
});

// ⚠️ O BUG QUE ESTES TESTES EXISTEM PARA IMPEDIR (Lucas, 20/08/2026): *"nos indicadores quando eu
// seleciono paga ou vencida vem em branco"*. O extrato era ordenado por vencimento DECRESCENTE e
// cortado em `EXTRATO_TETO` ANTES de o filtro rodar — e como o filtro rodava na TELA, sobre o que
// tinha sobrado, procurar "Paga" varria um recorte só de parcelas futuras e não achava nada.
//
// O caso abaixo reproduz exatamente isso: muito mais parcelas que o teto, com as pagas no passado
// e as a vencer no futuro. Se o filtro voltar para depois do corte, ele quebra.
describe("filtro do extrato, no servidor", () => {
  /**
   * Uma carteira maior que o teto: 2.400 PAGAS antigas e 300 A VENCER no futuro.
   *
   * A proporção não é decorativa. Como a ordem padrão é por vencimento crescente, as 2.400 pagas
   * ocupam o teto inteiro e as 300 a vencer ficam FORA do envio — que é a situação em que o
   * filtro da tela devolvia vazio. É o mesmo desenho do CER (12.614 parcelas), só que invertido
   * no tempo, porque lá a ordem era decrescente.
   */
  function carteiraGrande(): LinhaCruaDaCarteira[] {
    const linhas: LinhaCruaDaCarteira[] = [];

    for (let i = 0; i < 2400; i += 1) {
      // ⚠️ DEZ ANOS, NÃO DUZENTOS. Espalhar 2.400 parcelas em meses sequenciais jogaria a maior
      // parte delas para depois de `AGORA_MS`, e o teste passaria a medir outra coisa: as
      // "pagas" cairiam no futuro e deixariam de ser pagas.
      const ano = 2016 + (i % 10);
      const mes = String((i % 12) + 1).padStart(2, "0");
      linhas.push(
        linha({
          due_date: `${ano}-${mes}-10`,
          payment_date: `${ano}-${mes}-12`,
          payment_id: 100000 + i,
          status_id: 5,
        }),
      );
    }

    for (let i = 0; i < 300; i += 1) {
      const mes = String((i % 12) + 1).padStart(2, "0");
      linhas.push(
        linha({
          // Cliente PRÓPRIO: o helper repete "Maria da Silva" em todas, e sem um nome distinto a
          // busca por texto não teria como separar um grupo do outro.
          cliente: "Cliente Do Futuro",
          due_date: `2030-${mes}-10`,
          payment_date: null,
          payment_id: 200000 + i,
          status_id: 6,
          valor: null,
        }),
      );
    }

    return linhas;
  }

  const base = {
    agoraMs: AGORA_MS,
    nomeDoIncorporador: "Loteadora VAL",
    nomePorCode: new Map([["VAL", "Vista Alegre"]]),
    politicaPorCode: POLITICAS,
  };

  it("acha o que está ALÉM do teto de envio, que é o bug relatado", () => {
    const semFiltro = montarIndicadores(carteiraGrande(), base);

    // O envio para no teto, e as 2.000 primeiras (vencimento crescente) são todas pagas: as
    // a vencer não chegam ao navegador de jeito nenhum.
    expect(semFiltro.extrato.length).toBe(EXTRATO_TETO);
    expect(semFiltro.extrato.every((p) => p.situacao === "paga")).toBe(true);
    expect(semFiltro.extrato.some((p) => p.situacao === "a_vencer")).toBe(false);

    // Era AQUI que a tela devolvia vazio, porque filtrava o que já tinha sido cortado.
    const aVencer = montarIndicadores(carteiraGrande(), {
      ...base,
      filtroDoExtrato: { situacao: "a_vencer" },
    });

    expect(aVencer.extratoTotal).toBe(300);
    expect(aVencer.extrato.length).toBe(300);
    expect(aVencer.extrato.every((p) => p.situacao === "a_vencer")).toBe(true);

    // E o contrário também: pedir as pagas devolve as 2.400, com o total certo mesmo que o
    // ENVIO continue limitado pelo teto.
    const pagas = montarIndicadores(carteiraGrande(), {
      ...base,
      filtroDoExtrato: { situacao: "paga" },
    });
    expect(pagas.extratoTotal).toBe(2400);
    expect(pagas.extrato.length).toBe(EXTRATO_TETO);
  });

  it("os seletores oferecem os anos de TODA a carteira, não os do recorte enviado", () => {
    const { opcoesDoExtrato } = montarIndicadores(carteiraGrande(), base);

    // O ano das A VENCER tem que estar na lista, ainda que nenhuma delas caiba no envio — era
    // exatamente isto que fazia o seletor do CER oferecer só 2037, 2038 e 2039.
    expect(opcoesDoExtrato.anos).toContain("2030");
    expect(opcoesDoExtrato.anos).toContain("2016");
    expect(opcoesDoExtrato.anos[0]).toBe("2016");
  });

  it("filtra por ano, mês e busca, e o total é o do FILTRO, não o do envio", () => {
    const emMarco = carteiraGrande().filter((l) => (l.due_date ?? "").startsWith("2030-03")).length;
    const marco = montarIndicadores(carteiraGrande(), {
      ...base,
      filtroDoExtrato: { ano: "2030", mes: "03" },
    });

    // Contado a partir do próprio cenário, e não cravado: número mágico em teste vira falso
    // negativo assim que alguém mexe no gerador.
    expect(marco.extratoTotal).toBe(emMarco);
    expect(emMarco).toBeGreaterThan(0);
    expect(marco.extrato.every((p) => (p.vencimento ?? "").startsWith("2030-03"))).toBe(true);

    // A busca varre unidade, cliente e imobiliária, e é insensível a caixa.
    const porCliente = montarIndicadores(carteiraGrande(), {
      ...base,
      filtroDoExtrato: { busca: "cliente DO futuro" },
    });
    expect(porCliente.extratoTotal).toBe(300);
  });

  it("ordena pela coluna pedida, nos dois sentidos", () => {
    const cresc = montarIndicadores(cenario(), {
      ...base,
      filtroDoExtrato: { direcao: "asc", ordenarPor: "valor" },
    });
    const desc = montarIndicadores(cenario(), {
      ...base,
      filtroDoExtrato: { direcao: "desc", ordenarPor: "valor" },
    });

    const valores = cresc.extrato.map((p) => p.valor);
    expect(valores).toEqual([...valores].sort((a, b) => a - b));
    expect(desc.extrato.map((p) => p.valor)).toEqual([...valores].reverse());
  });

  it("parcela sem data de pagamento vai para o FIM, ordenando nos dois sentidos", () => {
    // Ordenar por pagamento com string vazia jogaria as não pagas para o topo — e o topo é onde
    // o usuário procura o que ACONTECEU, não o que não aconteceu.
    for (const direcao of ["asc", "desc"] as const) {
      const { extrato } = montarIndicadores(cenario(), {
        ...base,
        filtroDoExtrato: { direcao, ordenarPor: "pagamento" },
      });

      const semData = extrato.findIndex((p) => !p.pagoEm);
      const comDataDepois = extrato.slice(semData).some((p) => p.pagoEm);
      expect(comDataDepois).toBe(false);
    }
  });
});

// ⚠️ O DEFEITO QUE ESTE BLOCO IMPEDE (Lucas, 20/08/2026): *"tem uma divergência de informação, no
// gráfico fala que 6,1%, nos indicadores eu tenho 7% e tenho 10,3, estamos em agosto ainda deve
// ter alguma coisa errada"*.
//
// Estava: a barra do mês CORRENTE somava no previsto todas as parcelas com vencimento no mês,
// inclusive as que ainda não tinham chegado na data. O vencido ficava diluído por um denominador
// que ainda ia crescer até o dia 31, e a barra mostrava menos inadimplência do que a real — o
// mesmo erro do card antigo (dividir pelo que ainda não venceu), sobrevivendo no gráfico.
describe("série mensal: o mês corrente só conta o que já venceu", () => {
  const base = {
    agoraMs: AGORA_MS, // 17/08/2026
    nomeDoIncorporador: "Loteadora VAL",
    nomePorCode: new Map([["VAL", "Vista Alegre"]]),
    politicaPorCode: POLITICAS,
  };

  it("parcela que vence DEPOIS de hoje, no mesmo mês, fica fora do previsto", () => {
    const { serieMensal } = montarIndicadores(
      [
        // Venceu dia 10 e não foi paga: inadimplente.
        linha({ due_date: "2026-08-10", payment_date: null, status_id: 7, valor: null }),
        // Vence dia 25 — ainda não chegou a data, então não pode entrar no denominador de hoje.
        linha({ due_date: "2026-08-25", payment_date: null, status_id: 6, valor: null }),
      ],
      base,
    );

    const agosto = serieMensal.find((m) => m.mes === "2026-08");
    expect(agosto).toBeDefined();

    // Só a do dia 10 entra no previsto. Com a do dia 25 junto, o percentual cairia pela metade
    // sem que nada tivesse sido pago.
    expect(agosto!.inadimplente).toBeGreaterThan(0);
    expect(agosto!.previsto).toBe(agosto!.inadimplente);
    expect(agosto!.inadimplenciaPct).toBeCloseTo(100, 6);
  });

  it("mês passado continua contando o mês inteiro", () => {
    const { serieMensal } = montarIndicadores(
      [
        linha({ due_date: "2026-07-10", payment_date: "2026-07-11", status_id: 5 }),
        // Dia 25 de julho já passou: entra normalmente, como sempre entrou.
        linha({ due_date: "2026-07-25", payment_date: "2026-07-26", status_id: 5 }),
      ],
      base,
    );

    const julho = serieMensal.find((m) => m.mes === "2026-07");
    expect(julho!.previsto).toBeGreaterThan(0);
    // Tudo pago: inadimplência zero, e as duas parcelas no denominador.
    expect(julho!.inadimplente).toBe(0);
    expect(julho!.inadimplenciaPct).toBe(0);
  });

  it("o mês corrente fecha com a MESMA base do card de inadimplência", () => {
    // Quando toda a carteira vence no mês corrente — o caso do Vale do Ouro —, a barra do mês e o
    // card acumulado têm que dar o mesmo número. Era a divergência que o Lucas viu na tela.
    const linhas = [
      linha({ due_date: "2026-08-05", payment_date: "2026-08-06", status_id: 5 }),
      linha({ due_date: "2026-08-10", payment_date: null, status_id: 7, valor: null }),
      linha({ due_date: "2026-08-28", payment_date: null, status_id: 6, valor: null }),
    ];

    const { kpis, serieMensal } = montarIndicadores(linhas, base);
    const agosto = serieMensal.find((m) => m.mes === "2026-08")!;

    expect(agosto.previsto).toBeCloseTo(kpis.previstoAteHoje.liquido, 6);
    expect(agosto.inadimplenciaPct).toBeCloseTo(kpis.inadimplenciaPct.liquida, 6);
  });
});
