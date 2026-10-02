import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acharOuCriarCliente,
  apenasDaCompetencia,
  atualizarCobranca,
  criarBoleto,
  descricaoDoBoleto,
  diferencaDoArredondamento,
  ENCARGOS_DE_ATRASO,
  JUROS_AO_MES,
  lerReferencia,
  MULTA_PERCENTUAL,
  referenciaDaCobranca,
  valorParaOAsaas,
} from "./emissao";

// ⚠️ ISTO É DINHEIRO INDO PARA O BOLETO DE UMA PESSOA. Cada caso aqui é um centavo que sai errado
// na conta de alguém — para mais ou para menos — e ninguém confere 142 boletos à mão.

describe("o arredondamento para cima", () => {
  it("sobe o centavo quando há casas além da segunda", () => {
    // Decisão do Lucas (01/09/2026): "arredonda para cima". Os valores da planilha vêm com 13 casas.
    expect(valorParaOAsaas(2207.1729284232347)).toBe(2207.18);
    expect(valorParaOAsaas(2231.973092376779)).toBe(2231.98);
    expect(valorParaOAsaas(10.001)).toBe(10.01);
  });

  it("NÃO mexe em valor que já tem duas casas", () => {
    // ⚠️ ESTE É O TESTE QUE IMPEDE O CENTAVO A MAIS DE GRAÇA. Sem limpar o ruído de ponto flutuante
    // antes, `1.09 * 100` dá 109.00000000000001 e o arredondamento para cima o transformaria em
    // R$ 1,10. Achei seis casos assim só entre R$ 0,01 e R$ 50,00.
    for (const v of [0.07, 0.14, 0.28, 0.55, 0.56, 1.09, 8.11, 1.15, 100.1, 2207.17]) {
      expect(valorParaOAsaas(v), `${v} não devia subir`).toBe(v);
    }
  });

  it("nunca devolve valor MENOR que o da planilha", () => {
    // É o que "para cima" garante: a diferença nunca é contra a empresa.
    for (const v of [1.001, 99.999, 1234.5678, 0.011, 7.4999999]) {
      expect(valorParaOAsaas(v)).toBeGreaterThanOrEqual(v);
    }
  });

  it("a diferença nunca passa de um centavo", () => {
    // Se passar, o arredondamento está errado, não generoso.
    for (const v of [2207.1729284232347, 1.001, 99.999, 0.011, 33.077777]) {
      expect(valorParaOAsaas(v) - v).toBeLessThan(0.01);
    }
  });

  it("valor com duas casas exatas atravessa sem toque, do centavo ao milhão", () => {
    for (let centavos = 1; centavos <= 2000; centavos += 1) {
      const v = centavos / 100;
      expect(valorParaOAsaas(v), `R$ ${v}`).toBe(v);
    }
    expect(valorParaOAsaas(1_000_000.99)).toBe(1_000_000.99);
  });

  it("zero continua zero", () => {
    expect(valorParaOAsaas(0)).toBe(0);
  });
});

describe("o que a tela mostra antes do clique", () => {
  it("soma a planilha e o emitido, e conta quantas linhas subiram", () => {
    const valores = [100.005, 200.5, 300.12];
    const d = diferencaDoArredondamento(valores);

    expect(d.planilha).toBe(600.63);
    // 100.005 -> 100.01 | 200.5 -> 200.5 | 300.12 -> 300.12
    expect(d.emitido).toBe(600.63);
    expect(d.linhasAjustadas).toBe(1);
  });

  it("com os valores reais da planilha, a diferença aparece", () => {
    const d = diferencaDoArredondamento([2207.1729284232347, 2231.973092376779]);
    expect(d.linhasAjustadas).toBe(2);
    expect(d.emitido).toBeGreaterThan(d.planilha);
    // Dois boletos, no máximo dois centavos.
    expect(d.emitido - d.planilha).toBeLessThan(0.02);
  });

  it("lote sem nenhuma casa sobrando não acusa ajuste", () => {
    const d = diferencaDoArredondamento([100.5, 200.25, 300.1]);
    expect(d.linhasAjustadas).toBe(0);
    expect(d.emitido).toBe(d.planilha);
  });
});

describe("a referência que identifica a cobrança", () => {
  it("junta empreendimento, unidade e competência", () => {
    // ⚠️ É por ela que a próxima rodada descobre que o boleto já existe. Sem isso, a única saída
    // seria casar por nome e valor — que é como se emite o mesmo boleto duas vezes.
    expect(
      referenciaDaCobranca({ competencia: "2026-09", empreendimento: "guaimbe", unidade: "307" }),
    ).toBe("boleto:guaimbe:307:2026-09");
  });

  it("unidade com espaço não quebra a referência", () => {
    // O Vale do Sol traz unidades como "00000430"; outras abas trazem "QD 3 LT 10".
    expect(
      referenciaDaCobranca({ competencia: "2026-09", empreendimento: "vale-do-sol", unidade: "QD 3 LT 10" }),
    ).toBe("boleto:vale-do-sol:QD-3-LT-10:2026-09");
  });

  it("a mesma unidade em meses diferentes gera referências diferentes", () => {
    const a = referenciaDaCobranca({ competencia: "2026-09", empreendimento: "on-sky", unidade: "101" });
    const b = referenciaDaCobranca({ competencia: "2026-10", empreendimento: "on-sky", unidade: "101" });
    expect(a).not.toBe(b);
  });
});

describe("a descrição que separa as carteiras no extrato", () => {
  it("nomeia o empreendimento, a unidade e a competência", () => {
    // ⚠️ Jade, Ruby, Cristal e Esmeralda emitem todos pela conta CER. No extrato dela as quatro
    // carteiras chegam misturadas: sem o nome na descrição, a conciliação não sabe de qual prédio
    // veio cada pagamento.
    expect(
      descricaoDoBoleto({ competencia: "2026-09", empreendimento: "Ed. Rubi", unidade: "301" }),
    ).toBe("Ed. Rubi - Unidade 301 - Competência 09/2026");
  });

  it("cada edifício da CER sai com o próprio nome", () => {
    const nomes = ["Ed. Jade", "Ed. Rubi", "Ed. Cristal", "Ed. Esmeralda"];
    const saidas = nomes.map((e) =>
      descricaoDoBoleto({ competencia: "2026-09", empreendimento: e, unidade: "101" }),
    );
    expect(new Set(saidas).size).toBe(4);
    for (const [i, s] of saidas.entries()) expect(s).toContain(nomes[i]!);
  });

  it("unidade em branco não vira 'Unidade null' no boleto do cliente", () => {
    expect(
      descricaoDoBoleto({ competencia: "2026-09", empreendimento: "On Sky", unidade: null }),
    ).toBe("On Sky - Competência 09/2026");
    expect(
      descricaoDoBoleto({ competencia: "2026-09", empreendimento: "On Sky", unidade: "  " }),
    ).not.toContain("Unidade");
  });

  it("usa a grafia da planilha, não a de uma lista nossa", () => {
    // "segue o que está na planilha" (Lucas). A planilha escreve "Ed. Rubi"; uma conversa dizia
    // "EDIFICIO RUBY". Quem manda é o arquivo que o administrativo confere.
    const d = descricaoDoBoleto({ competencia: "2026-09", empreendimento: "Ed. Rubi", unidade: "1" });
    expect(d).toContain("Ed. Rubi");
    expect(d).not.toContain("RUBY");
  });
});

describe("ler de volta o que foi emitido", () => {
  const cobranca = (ref: null | string) =>
    ({ customer: "c", dueDate: "2026-09-15", externalReference: ref, id: "p", status: "PENDING", value: 10 });

  it("separa as cobranças desta tela das outras da conta", () => {
    // ⚠️ A conta CER também recebe cobranças de outras origens. Sem o filtro, a tela mostraria
    // pagamentos que não têm nada a ver com o lote do mês.
    const lista = [
      cobranca("boleto:guaimbe:307:2026-09"),
      cobranca("proposta-avulsa-123"),
      cobranca(null),
      cobranca("boleto:guaimbe:307:2026-08"),
    ];
    const so = apenasDaCompetencia(lista as never, "2026-09");
    expect(so).toHaveLength(1);
    expect(so[0]!.externalReference).toBe("boleto:guaimbe:307:2026-09");
  });

  it("lê o empreendimento e a unidade de volta", () => {
    expect(lerReferencia("boleto:ed-rubi:301:2026-09")).toEqual({
      competencia: "2026-09",
      empreendimento: "ed-rubi",
      // A referência de sempre não diz sequência, e ela é 1: é a primeira (e única) cobrança da
      // unidade no mês. Todas as já emitidas têm este formato.
      sequencia: 1,
      unidade: "301",
    });
  });

  it("referência de outra origem devolve nulo em vez de inventar", () => {
    expect(lerReferencia("proposta-avulsa-123")).toBeNull();
    expect(lerReferencia(null)).toBeNull();
    expect(lerReferencia("boleto:incompleta")).toBeNull();
    // Sexta parte, ou sequência que não é número: não é referência nossa.
    expect(lerReferencia("boleto:garden:Q07-L24:2026-09:2:3")).toBeNull();
    expect(lerReferencia("boleto:garden:Q07-L24:2026-09:x")).toBeNull();
    expect(lerReferencia("boleto:garden:Q07-L24:2026-09:0")).toBeNull();
  });
});

// ── DUAS COBRANÇAS NA MESMA UNIDADE, NO MESMO MÊS ───────────────────────────
//
// O LUCAS AGUIAR SOARES (Vale do Ouro - 2, Q10 L03) tem em setembro/2026 a mensal de R$ 1.666,67
// vencendo dia 10 e a ENTRADA de R$ 8.750,00 vencendo dia 20. Pedido do Lucas (08/09/2026):
// *"Cria duas linhas vou verificar, ae se for o caso fazemos emissão separado"*.
describe("a segunda cobrança da mesma unidade no mesmo mês", () => {
  const cobranca = (ref: null | string) => ({
    customer: "c",
    dueDate: "2026-09-20",
    externalReference: ref,
    id: "p",
    status: "PENDING",
    value: 8750,
  });

  it("tem referência PRÓPRIA — senão a consulta acha a primeira e ela nunca sai", () => {
    const mensal = referenciaDaCobranca({
      competencia: "2026-09",
      empreendimento: "vale-do-ouro-2",
      sequencia: 1,
      unidade: "Q10 L03",
    });
    const entrada = referenciaDaCobranca({
      competencia: "2026-09",
      empreendimento: "vale-do-ouro-2",
      sequencia: 2,
      unidade: "Q10 L03",
    });

    expect(mensal).toBe("boleto:vale-do-ouro-2:Q10-L03:2026-09");
    expect(entrada).toBe("boleto:vale-do-ouro-2:Q10-L03:2026-09:2");
    expect(mensal).not.toBe(entrada);
  });

  it("a sequência 1 não muda a referência de NENHUM boleto já emitido", () => {
    // ⚠️ É A CONDIÇÃO DE NÃO QUEBRAR O PASSADO. O Asaas casa `externalReference` por igualdade
    // exata: se a sequência 1 acrescentasse `:1`, as 315 cobranças de setembro deixariam de casar e
    // voltariam TODAS para a lista de "a emitir", prontas para serem cobradas de novo.
    const semSequencia = referenciaDaCobranca({
      competencia: "2026-09",
      empreendimento: "guaimbe",
      unidade: "307",
    });
    for (const seq of [undefined, null, 1]) {
      expect(
        referenciaDaCobranca({
          competencia: "2026-09",
          empreendimento: "guaimbe",
          sequencia: seq,
          unidade: "307",
        }),
      ).toBe(semSequencia);
    }
    expect(semSequencia).toBe("boleto:guaimbe:307:2026-09");
  });

  it("volta da referência com a sequência intacta", () => {
    expect(lerReferencia("boleto:vale-do-ouro-2:Q10-L03:2026-09:2")).toEqual({
      competencia: "2026-09",
      empreendimento: "vale-do-ouro-2",
      sequencia: 2,
      unidade: "Q10-L03",
    });
  });

  it("a listagem do mês NÃO deixa a segunda de fora", () => {
    // ⚠️ ERA O FILTRO POR `endsWith(":2026-09")`. A entrada termina em `:2026-09:2` e sumiria da
    // listagem inteira: não apareceria em "emitidos", não seria achada para reenviar nem cancelar,
    // e a linha voltaria para "a emitir" como se nunca tivesse saído.
    const lista = [
      cobranca("boleto:vale-do-ouro-2:Q10-L03:2026-09"),
      cobranca("boleto:vale-do-ouro-2:Q10-L03:2026-09:2"),
      cobranca("boleto:vale-do-ouro-2:Q10-L03:2026-08:2"),
      cobranca("proposta-avulsa-123"),
    ];
    const so = apenasDaCompetencia(lista as never, "2026-09");
    expect(so).toHaveLength(2);
    expect(so.map((c) => lerReferencia(c.externalReference)!.sequencia)).toEqual([1, 2]);
  });
});

// ── O QUE VAI PARA O ASAAS ──────────────────────────────────────────────────
//
// Pedido do Lucas (02/10/2026): sem as notificações do próprio Asaas, e com multa de 2% e juros de
// 1% ao mês. Os testes leem o corpo que sai pelo fetch, porque é ele que o Asaas recebe; conferir a
// função por dentro não prova nada sobre o boleto do cliente.
describe("o que vai para o Asaas", () => {
  type Chamada = { body: Record<string, unknown> | undefined; method: string; url: string };
  let chamadas: Chamada[] = [];

  function responder(...respostas: { body: unknown; status?: number }[]) {
    chamadas = [];
    const fila = [...respostas];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        chamadas.push({
          body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
          method: init?.method ?? "GET",
          url: String(url),
        });
        const resposta = fila.shift() ?? { body: {} };
        return new Response(JSON.stringify(resposta.body), { status: resposta.status ?? 200 });
      }),
    );
  }

  const pagador = { contato: "(37) 99999-0000", documento: "123.456.789-09", nome: "Pagador" };

  beforeEach(() => {
    vi.stubEnv("ASAAS_CER_API_KEY", "chave-de-teste");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("cliente novo já nasce sem notificação", async () => {
    responder({ body: { data: [] } }, { body: { id: "cus_novo", notificationDisabled: true } });

    const r = await acharOuCriarCliente("cer", pagador);

    expect(r).toMatchObject({ data: { criado: true }, ok: true });
    // A resposta confirmou: não há chamada a mais.
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]!.method).toBe("POST");
    expect(chamadas[1]!.url).toMatch(/\/v3\/customers$/);
    // ⚠️ BOOLEANO, NÃO TEXTO: a documentação do Asaas pede `true`, e "true" não é a mesma coisa.
    expect(chamadas[1]!.body!.notificationDisabled).toBe(true);
  });

  it("cliente que JÁ EXISTE com notificação ligada é calado antes de voltar", async () => {
    // ⚠️ É O CASO DE OUTUBRO: quase todo CPF já tem cadastro desde setembro, com as oito
    // notificações padrão ligadas. Sem esta chamada, a emissão dispararia o e-mail e o SMS do Asaas.
    responder(
      { body: { data: [{ id: "cus_velho", notificationDisabled: false }] } },
      { body: { id: "cus_velho", notificationDisabled: true } },
    );

    const r = await acharOuCriarCliente("cer", pagador);

    expect(r).toMatchObject({
      data: { cliente: { id: "cus_velho", notificationDisabled: true }, criado: false },
      ok: true,
    });
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1]!.method).toBe("PUT");
    expect(chamadas[1]!.url).toMatch(/\/v3\/customers\/cus_velho$/);
    expect(chamadas[1]!.body).toEqual({ notificationDisabled: true });
  });

  it("cliente novo cuja resposta não confirma o desligamento é calado antes do boleto", async () => {
    responder(
      { body: { data: [] } },
      { body: { id: "cus_novo" } },
      { body: { id: "cus_novo", notificationDisabled: true } },
    );

    const r = await acharOuCriarCliente("cer", pagador);

    expect(r).toMatchObject({ data: { cliente: { notificationDisabled: true }, criado: true }, ok: true });
    expect(chamadas.map((c) => c.method)).toEqual(["GET", "POST", "PUT"]);
  });

  it("busca sem o campo também cala: só o `true` explícito dispensa a atualização", async () => {
    responder(
      { body: { data: [{ id: "cus_sem_campo" }] } },
      { body: { id: "cus_sem_campo", notificationDisabled: true } },
    );

    const r = await acharOuCriarCliente("cer", pagador);

    expect(r.ok).toBe(true);
    expect(chamadas.map((c) => c.method)).toEqual(["GET", "PUT"]);
  });

  it("cliente já calado não gera chamada a mais", async () => {
    responder({ body: { data: [{ id: "cus_calado", notificationDisabled: true }] } });

    const r = await acharOuCriarCliente("cer", pagador);

    expect(r).toMatchObject({ data: { cliente: { id: "cus_calado" }, criado: false }, ok: true });
    expect(chamadas).toHaveLength(1);
  });

  it("⚠️ se o Asaas recusar calar o cliente, NÃO devolve o cliente (e o boleto não sai)", async () => {
    responder(
      { body: { data: [{ id: "cus_velho", notificationDisabled: false }] } },
      { body: { errors: [{ description: "Cliente removido." }] }, status: 400 },
    );

    const r = await acharOuCriarCliente("cer", pagador);

    expect(r).toEqual({ erro: "Cliente removido.", ok: false, status: 400 });
  });

  it("⚠️ se o Asaas responder que a notificação continua ligada, também falha", async () => {
    responder(
      { body: { data: [{ id: "cus_velho", notificationDisabled: false }] } },
      { body: { id: "cus_velho", notificationDisabled: false } },
    );

    const r = await acharOuCriarCliente("cer", pagador);

    expect(r.ok).toBe(false);
  });

  it("⚠️ resposta 200 VAZIA ou sem o campo não conta como calado", async () => {
    // Um proxy ou uma URL errada podem devolver 200 com corpo que não é o cliente. Aceitar isso
    // seria emitir com a notificação ligada achando que não.
    for (const corpo of [{}, null, { id: "cus_velho" }]) {
      responder({ body: { data: [{ id: "cus_velho", notificationDisabled: false }] } }, { body: corpo });
      const r = await acharOuCriarCliente("cer", pagador);
      expect(r.ok, JSON.stringify(corpo)).toBe(false);
    }
  });

  it("o boleto sai com multa de 2% e juros de 1% ao mês", async () => {
    responder({ body: { dueDate: "2026-10-10", id: "pay_1", status: "PENDING", value: 1051.57 } });

    await criarBoleto("cer", {
      cliente: "cus_1",
      descricao: "Ed. Cristal - Unidade 201 - Competência 10/2026",
      referencia: "boleto:ed-cristal:201:2026-10",
      valor: 1051.5655,
      vencimento: "2026-10-10",
    });

    expect(chamadas[0]!.method).toBe("POST");
    expect(chamadas[0]!.url).toMatch(/\/v3\/payments$/);
    expect(chamadas[0]!.body).toMatchObject({
      billingType: "BOLETO",
      fine: { type: "PERCENTAGE", value: 2 },
      interest: { value: 1 },
      // O arredondamento para cima continua igual: os encargos não mexem no valor de face.
      value: 1051.57,
    });
  });

  it("os encargos ficam no teto legal, e a multa é PERCENTUAL", () => {
    // ⚠️ O ASAAS ACEITA ATÉ 10%. O teto é nosso: multa de 2% (CDC, art. 52, § 1º) e juros de 1% ao
    // mês. E `FIXED` transformaria a multa de 2% em R$ 2,00.
    expect(MULTA_PERCENTUAL).toBeLessThanOrEqual(2);
    expect(JUROS_AO_MES).toBeLessThanOrEqual(1);
    expect(ENCARGOS_DE_ATRASO.fine.type).toBe("PERCENTAGE");
  });

  it("corrigir valor ou vencimento reenvia os encargos; corrigir só a descrição, não", async () => {
    responder({ body: {} }, { body: {} }, { body: {} });

    await atualizarCobranca("cer", "pay_1", { vencimento: "2026-10-15" });
    await atualizarCobranca("cer", "pay_1", { valor: 1100 });
    await atualizarCobranca("cer", "pay_1", { descricao: "Ed. Cristal - Unidade 201" });

    expect(chamadas.map((c) => c.method)).toEqual(["PUT", "PUT", "PUT"]);
    expect(chamadas[0]!.body).toEqual({
      dueDate: "2026-10-15",
      fine: { type: "PERCENTAGE", value: 2 },
      interest: { value: 1 },
    });
    expect(chamadas[1]!.body).toMatchObject({ fine: { value: 2 }, interest: { value: 1 }, value: 1100 });
    // Um boleto já entregue não ganha encargo calado por causa de uma troca de texto.
    expect(chamadas[2]!.body).toEqual({ description: "Ed. Cristal - Unidade 201" });
  });
});
