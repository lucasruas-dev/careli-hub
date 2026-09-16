import { describe, expect, it } from "vitest";

import type { PlanoComercial } from "@/lib/apolo/planos-comerciais";
import type { PlanosDoEmpreendimento } from "@/lib/apolo/planos-comerciais-c2x";
import { comoPlano, lerPlanosDoPanteon } from "@/lib/hercules/planos-do-panteon";
import type { FaixaDePrazo } from "@/lib/hercules/premissa-do-prazo";

import {
  faixaParaATela,
  type LinhaDaCategoria,
  type LinhaDoPlanoDoPortal,
  lerPlanosDoPortal,
  montarPoliticasDoProduto,
  type PlanoLido,
  planoLidoDoPanteon,
  planoParaATela,
  type ProdutoDoRecorte,
  type UnidadeComCategoria,
} from "./politicas-do-produto";

// O PORTAL TEM DE MOSTRAR O QUE A MESA VENDE. Cada caso abaixo é uma das três réguas da Mesa
// (Panteon antes do C2X, o menor recorte ganha, faixa sem herança) ou uma das frases que a tela não
// pode trocar ("nenhum plano" x "não consegui consultar").

// ── Fábricas ────────────────────────────────────────────────────────────────
const plano = (p: Partial<PlanoLido> & { enterpriseId: string; id: string }): PlanoLido => ({
  anuaisQuantidade: null,
  anuaisValor: null,
  categoriaId: null,
  entradaPercentual: 10,
  fonte: "panteon",
  indiceCorrecao: "IPCA_ANUAL",
  jurosPeriodicidade: "anual",
  jurosTaxa: 6,
  nome: "Normal",
  ordem: 0,
  parcelas: 84,
  ressalva: null,
  sistemaAmortizacao: "sacoc",
  slot: null,
  ...p,
});

const produto = (p: Partial<ProdutoDoRecorte> & { enterpriseId: string }): ProdutoDoRecorte => ({
  codigo: `COD${p.enterpriseId}`,
  nome: `Produto ${p.enterpriseId}`,
  paiEnterpriseId: null,
  ...p,
});

const categoria = (
  p: Partial<LinhaDaCategoria> & { enterprise_id: string; id: string },
): LinhaDaCategoria => ({
  ativa: true,
  categoria_pai_id: null,
  nome: p.id,
  ordem: 0,
  ...p,
});

const faixa = (p: Partial<FaixaDePrazo>): FaixaDePrazo => ({
  defineEntrada: true,
  defineIndice: true,
  defineJuros: true,
  entradaPercentual: 10,
  indiceCorrecao: "IPCA_ANUAL",
  jurosConvencao: "equivalente",
  jurosPeriodicidade: "anual",
  jurosTaxa: 6,
  parcelaMaxima: 84,
  parcelaMinima: 37,
  ...p,
});

const doC2x = (enterpriseId: string, planos: Partial<PlanoComercial>[]): PlanosDoEmpreendimento => ({
  code: `COD${enterpriseId}`,
  enterpriseId,
  planos: planos.map((p) => ({
    entradaPercentual: 20,
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "anual",
    jurosTaxa: 8,
    nome: "PLANO NORMAL",
    parcelas: 120,
    sistemaAmortizacao: "sacoc",
    slot: "normal",
    ...p,
  })),
  tabelaDoEmpreendimento: "SACOOC",
});

const vazio = {
  categorias: [] as LinhaDaCategoria[],
  faixas: {} as Record<string, FaixaDePrazo[]>,
  planosDoC2x: [] as PlanosDoEmpreendimento[],
  planosDoPanteon: [] as PlanoLido[],
  unidades: [] as UnidadeComCategoria[],
};

const unidadesEm = (enterpriseId: string, categoriaId: string, quantas: number) =>
  Array.from({ length: quantas }, () => ({ categoria_id: categoriaId, enterprise_id: enterpriseId }));

// ── A linha do banco ────────────────────────────────────────────────────────
// (16/09/2026) A conversão da linha é UMA, a da Mesa (`comoPlano`, em planos-do-panteon.ts); a aba
// só troca nomes (`planoLidoDoPanteon`). Os casos abaixo passam pelas duas, como a leitura passa.
const planoDaLinha = (linha: LinhaDoPlanoDoPortal): PlanoLido => planoLidoDoPanteon(comoPlano(linha));

describe("a linha do banco (comoPlano + planoLidoDoPanteon)", () => {
  const linha = (p: Partial<LinhaDoPlanoDoPortal> = {}): LinhaDoPlanoDoPortal => ({
    anuais_quantidade: null,
    anuais_valor: null,
    categoria_id: null,
    enterprise_id: "39",
    entrada_percentual: "8.000",
    id: "p1",
    indice_correcao: "IPCA_ANUAL",
    juros_periodicidade: "anual",
    juros_taxa: "6.000000",
    nome: " Investidor Parcelado ",
    ordem: 1,
    parcelas: 84,
    ressalva: "  válido para as\u00A0próximas 16 unidades ",
    sistema_amortizacao: "sacoc",
    slot: "investidor",
    ...p,
  });

  it("converte o numeric que chega como texto e limpa nome e ressalva", () => {
    const lido = planoDaLinha(linha());
    expect(lido.entradaPercentual).toBe(8);
    expect(lido.jurosTaxa).toBe(6);
    expect(lido.nome).toBe("Investidor Parcelado");
    expect(lido.ressalva).toBe("válido para as próximas 16 unidades");
    expect(lido.fonte).toBe("panteon");
  });

  it("sem a coluna da ressalva (0168 pendente) o plano vem sem etiqueta, e não quebra", () => {
    const semColuna = linha();
    delete semColuna.ressalva;
    expect(planoDaLinha(semColuna).ressalva).toBeNull();
    expect(planoDaLinha(linha({ ressalva: "   " })).ressalva).toBeNull();
  });

  it("anual pela metade não é anual nenhuma", () => {
    expect(planoDaLinha(linha({ anuais_quantidade: 4, anuais_valor: null })).anuaisQuantidade).toBeNull();
    const completa = planoDaLinha(linha({ anuais_quantidade: "4", anuais_valor: "25000.00" }));
    expect([completa.anuaisQuantidade, completa.anuaisValor]).toEqual([4, 25000]);
  });

  it("sistema estranho cai no SACOC da casa, e slot estranho vira nulo", () => {
    const lido = planoDaLinha(linha({ sistema_amortizacao: "SACOOC", slot: "vip" }));
    expect(lido.sistemaAmortizacao).toBe("sacoc");
    expect(lido.slot).toBeNull();
  });

  it("⚠️ índice que o build não conhece: a CONTA cai em sem correção, a TELA mostra o código", () => {
    const cru = comoPlano(linha({ indice_correcao: "tr_anual" }));
    expect(cru.indiceCorrecao).toBe("SEM_CORRECAO");
    expect(cru.indiceDoCadastro).toBe("TR_ANUAL");
    expect(planoLidoDoPanteon(cru).indiceCorrecao).toBe("TR_ANUAL");
  });

  it("a Mesa e a aba recebem a MESMA ressalva, id e anuais da mesma linha", () => {
    const cru = comoPlano(linha({ anuais_quantidade: 2, anuais_valor: "10000" }));
    const lido = planoLidoDoPanteon(cru);
    expect([cru.ressalva, cru.id, cru.anuaisQuantidade]).toEqual([
      lido.ressalva,
      lido.id,
      lido.anuaisQuantidade,
    ]);
    expect(cru.ressalva).toBe("válido para as próximas 16 unidades");
  });
});

// ── O texto da tela ─────────────────────────────────────────────────────────
describe("planoParaATela", () => {
  it("escreve entrada, juros, correção, tabela e anuais sem travessão", () => {
    const tela = planoParaATela(
      plano({
        anuaisQuantidade: 4,
        anuaisValor: 25000,
        enterpriseId: "39",
        entradaPercentual: 8,
        id: "p1",
        nome: "Investidor Parcelado",
        ressalva: "válido para as próximas 16 unidades",
        slot: "investidor",
      }),
    );

    expect(tela).toMatchObject({
      anuais: "4 anuais de R$\u00A025.000,00",
      entrada: "8%",
      indice: "IPCA anual",
      juros: "6% a.a.",
      nome: "Investidor Parcelado",
      // O nome cadastrado não é o da folha: a tela diz como ele sai na proposta.
      nomeNaProposta: "INVESTIDOR",
      parcelas: 84,
      ressalva: "válido para as próximas 16 unidades",
      tabela: "Tabela SACOC",
      tabelaDetalhe: "amortização pura",
    });
    expect(JSON.stringify(tela)).not.toContain("—");
  });

  it("sem juros, sem entrada e sem anual são frases, não buracos", () => {
    const tela = planoParaATela(
      plano({ enterpriseId: "39", entradaPercentual: 0, id: "p2", jurosTaxa: null, parcelas: 1 }),
    );
    expect(tela.juros).toBe("sem juros");
    expect(tela.entrada).toBe("sem entrada");
    expect(tela.anuais).toBeNull();
  });

  it("não repete o nome da folha quando o nome cadastrado já é ele", () => {
    const tela = planoParaATela(
      plano({ enterpriseId: "39", id: "p3", nome: "Investidor", slot: "investidor" }),
    );
    expect(tela.nomeNaProposta).toBeNull();
  });

  it("índice que o build não conhece aparece cru, nunca como 'sem correção'", () => {
    const tela = planoParaATela(plano({ enterpriseId: "39", id: "p4", indiceCorrecao: "TR_ANUAL" }));
    expect(tela.indice).toBe("TR_ANUAL");
  });
});

describe("faixaParaATela", () => {
  it("faixa que não opina devolve nulo (a tela escreve 'segue o plano')", () => {
    const tela = faixaParaATela(
      faixa({ defineIndice: false, defineJuros: false, indiceCorrecao: null, jurosTaxa: null }),
    );
    expect(tela).toEqual({ entrada: "10%", indice: null, juros: null, prazo: "37 a 84 parcelas" });
  });

  it("'sem juros' da faixa é afirmação, e não ausência", () => {
    const tela = faixaParaATela(faixa({ jurosTaxa: null, parcelaMaxima: 1, parcelaMinima: 1 }));
    expect(tela.juros).toBe("sem juros");
    expect(tela.prazo).toBe("1 parcela");
  });
});

// ── A montagem ──────────────────────────────────────────────────────────────
describe("montarPoliticasDoProduto", () => {
  it("mostra os planos do próprio produto, na ordem do cadastro, com a ressalva", () => {
    const r = montarPoliticasDoProduto({
      ...vazio,
      planosDoPanteon: [
        plano({ enterpriseId: "39", id: "b", nome: "Investidor", ordem: 2, parcelas: 36 }),
        plano({
          enterpriseId: "39",
          id: "a",
          nome: "Investidor Parcelado",
          ordem: 1,
          ressalva: "válido para as próximas 16 unidades",
        }),
      ],
      produtos: [produto({ enterpriseId: "39" })],
    });

    expect(r.vazio).toBe(false);
    expect(r.blocos).toHaveLength(1);
    const [bloco] = r.blocos;
    expect(bloco?.origemDosPlanos).toBe("filho");
    expect(bloco?.planos.map((p) => p.id)).toEqual(["a", "b"]);
    expect(bloco?.planos[0]?.ressalva).toBe("válido para as próximas 16 unidades");
  });

  it("produto sem plano herda o do pai; com plano próprio, o pai não soma", () => {
    const doPai = plano({ enterpriseId: "35", id: "pai-normal" });
    const herdando = montarPoliticasDoProduto({
      ...vazio,
      planosDoPanteon: [doPai],
      produtos: [produto({ enterpriseId: "37", paiEnterpriseId: "35" })],
    });
    expect(herdando.blocos[0]?.origemDosPlanos).toBe("pai");
    expect(herdando.blocos[0]?.planos.map((p) => p.id)).toEqual(["pai-normal"]);

    // ⚠️ O defeito dos "seis planos onde existem três": o pai não entra junto com o filho.
    const proprio = montarPoliticasDoProduto({
      ...vazio,
      planosDoPanteon: [doPai, plano({ enterpriseId: "37", id: "filho-normal" })],
      produtos: [produto({ enterpriseId: "37", paiEnterpriseId: "35" })],
    });
    expect(proprio.blocos[0]?.origemDosPlanos).toBe("filho");
    expect(proprio.blocos[0]?.planos.map((p) => p.id)).toEqual(["filho-normal"]);
  });

  it("o C2X entra só para o empreendimento sem plano no Panteon", () => {
    const semPanteon = montarPoliticasDoProduto({
      ...vazio,
      planosDoC2x: [doC2x("39", [{ nome: "PLANO NORMAL", slot: "normal" }])],
      produtos: [produto({ enterpriseId: "39" })],
    });
    expect(semPanteon.blocos[0]?.planos).toHaveLength(1);
    expect(semPanteon.blocos[0]?.planos[0]?.fonte).toBe("c2x");

    const comPanteon = montarPoliticasDoProduto({
      ...vazio,
      planosDoC2x: [doC2x("39", [{ nome: "PLANO NORMAL", slot: "normal" }])],
      planosDoPanteon: [plano({ enterpriseId: "39", id: "p1" })],
      produtos: [produto({ enterpriseId: "39" })],
    });
    expect(comPanteon.blocos[0]?.planos.map((p) => p.fonte)).toEqual(["panteon"]);
  });

  it("C2X fora do ar não vira 'nenhum plano': o bloco sai incompleto e não vazio", () => {
    const r = montarPoliticasDoProduto({
      ...vazio,
      planosDoC2x: null,
      produtos: [produto({ enterpriseId: "39" })],
    });
    expect(r.vazio).toBe(false);
    expect(r.blocos[0]?.consultaIncompleta).toBe(true);
    expect(r.blocos[0]?.planos).toEqual([]);

    // Quem tem plano no Panteon não dependia do C2X.
    const comPanteon = montarPoliticasDoProduto({
      ...vazio,
      planosDoC2x: null,
      planosDoPanteon: [plano({ enterpriseId: "39", id: "p1" })],
      produtos: [produto({ enterpriseId: "39" })],
    });
    expect(comPanteon.blocos[0]?.consultaIncompleta).toBe(false);
  });

  it("nada cadastrado e tudo respondeu: vazio", () => {
    const r = montarPoliticasDoProduto({ ...vazio, produtos: [produto({ enterpriseId: "39" })] });
    expect(r.vazio).toBe(true);
  });

  it("a faixa é a do próprio empreendimento, em ordem de prazo, sem herdar do pai", () => {
    const r = montarPoliticasDoProduto({
      ...vazio,
      faixas: {
        "35": [faixa({ parcelaMaxima: 200, parcelaMinima: 1 })],
        "37": [
          faixa({ parcelaMaxima: 120, parcelaMinima: 85 }),
          faixa({ parcelaMaxima: 36, parcelaMinima: 1 }),
        ],
      },
      produtos: [produto({ enterpriseId: "37", paiEnterpriseId: "35" })],
    });
    expect(r.blocos[0]?.faixas.map((f) => f.prazo)).toEqual(["1 a 36 parcelas", "85 a 120 parcelas"]);
  });

  it("categoria do pai só aparece com unidade deste produto; a própria aparece mesmo sem", () => {
    const r = montarPoliticasDoProduto({
      ...vazio,
      categorias: [
        categoria({ enterprise_id: "31", id: "condominio", nome: "Condomínio", ordem: 1 }),
        categoria({ enterprise_id: "31", id: "loteamento", nome: "Loteamento", ordem: 2 }),
        categoria({ enterprise_id: "33", id: "esquina", nome: "Esquina", ordem: 3 }),
        categoria({ ativa: false, enterprise_id: "33", id: "antiga", nome: "Antiga", ordem: 4 }),
      ],
      produtos: [produto({ enterpriseId: "33", paiEnterpriseId: "31" })],
      unidades: [
        ...unidadesEm("33", "condominio", 39),
        // Lotes do Loteamento só na gleba de OUTRO dono: não é assunto desta ficha.
        ...unidadesEm("27", "loteamento", 186),
      ],
    });

    expect(r.blocos[0]?.categorias.map((c) => [c.nome, c.unidades])).toEqual([
      ["Condomínio", 39],
      ["Esquina", 0],
    ]);
  });

  it("categoria com plano próprio lista os dela; sem plano próprio segue os gerais", () => {
    const r = montarPoliticasDoProduto({
      ...vazio,
      categorias: [
        categoria({ enterprise_id: "31", id: "condominio", nome: "Condomínio" }),
        categoria({ categoria_pai_id: "condominio", enterprise_id: "31", id: "bloco-a", nome: "Bloco A" }),
      ],
      planosDoPanteon: [
        plano({ enterpriseId: "31", id: "geral" }),
        plano({ categoriaId: "condominio", enterpriseId: "31", id: "so-condominio", parcelas: 60 }),
      ],
      produtos: [produto({ enterpriseId: "31" })],
      unidades: [...unidadesEm("31", "condominio", 2), ...unidadesEm("31", "bloco-a", 1)],
    });

    const [bloco] = r.blocos;
    // O plano de categoria não vaza para os gerais.
    expect(bloco?.planos.map((p) => p.id)).toEqual(["geral"]);
    const condominio = bloco?.categorias.find((c) => c.id === "condominio");
    const blocoA = bloco?.categorias.find((c) => c.id === "bloco-a");
    expect(condominio?.planos.map((p) => p.id)).toEqual(["so-condominio"]);
    expect(blocoA?.planos).toEqual([]);
    expect(blocoA?.dentroDe).toBe("Condomínio");
  });

  it("produtos que resolvem igual viram um bloco só, com as unidades somadas", () => {
    const r = montarPoliticasDoProduto({
      ...vazio,
      categorias: [categoria({ enterprise_id: "31", id: "condominio", nome: "Condomínio" })],
      planosDoPanteon: [plano({ enterpriseId: "31", id: "do-pai" })],
      produtos: [
        produto({ codigo: "LBF", enterpriseId: "33", paiEnterpriseId: "31" }),
        produto({ codigo: "LBR", enterpriseId: "27", paiEnterpriseId: "31" }),
      ],
      unidades: [...unidadesEm("33", "condominio", 39), ...unidadesEm("27", "condominio", 186)],
    });

    expect(r.blocos).toHaveLength(1);
    expect(r.blocos[0]?.produtos.map((p) => p.codigo)).toEqual(["LBF", "LBR"]);
    expect(r.blocos[0]?.categorias[0]?.unidades).toBe(225);
  });

  it("produtos com políticas diferentes ficam em blocos separados", () => {
    const r = montarPoliticasDoProduto({
      ...vazio,
      planosDoPanteon: [
        plano({ enterpriseId: "31", id: "do-pai" }),
        plano({ enterpriseId: "33", id: "do-lbf" }),
      ],
      produtos: [
        produto({ codigo: "LBF", enterpriseId: "33", paiEnterpriseId: "31" }),
        produto({ codigo: "LBR", enterpriseId: "27", paiEnterpriseId: "31" }),
      ],
    });
    expect(r.blocos.map((b) => [b.produtos[0]?.codigo, b.planos[0]?.id])).toEqual([
      ["LBF", "do-lbf"],
      ["LBR", "do-pai"],
    ]);
  });
});

// ── A leitura tolerante ─────────────────────────────────────────────────────
describe("lerPlanosDoPortal", () => {
  /** Um cliente falso que responde, em ordem, as respostas dadas, e anota cada `select`. */
  function clienteFalso(respostas: Array<{ data?: unknown[]; error?: { code: string; message: string } }>) {
    const selects: string[] = [];
    let chamada = 0;
    const construtor = {
      eq: () => construtor,
      in: () => construtor,
      order: () => construtor,
      range: () => {
        const resposta = respostas[chamada] ?? { data: [] };
        chamada += 1;
        return Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null });
      },
      select: (colunas: string) => {
        selects.push(colunas);
        return construtor;
      },
    };
    const cliente = { from: () => construtor } as unknown as Parameters<typeof lerPlanosDoPortal>[0];
    return { cliente, selects };
  }

  const linhaCrua = {
    anuais_quantidade: null,
    anuais_valor: null,
    categoria_id: null,
    enterprise_id: "39",
    entrada_percentual: "10",
    id: "p1",
    indice_correcao: "IPCA_ANUAL",
    juros_periodicidade: "anual",
    juros_taxa: null,
    nome: "Normal",
    ordem: 0,
    parcelas: 60,
    sistema_amortizacao: "sacoc",
    slot: "normal",
  };

  it("sem a coluna da ressalva, repete a leitura sem ela", async () => {
    const { cliente, selects } = clienteFalso([
      { error: { code: "42703", message: 'column temis_planos.ressalva does not exist' } },
      { data: [linhaCrua] },
    ]);

    const planos = await lerPlanosDoPortal(cliente, ["39"]);
    expect(planos.map((p) => p.id)).toEqual(["p1"]);
    expect(selects[0]).toContain("ressalva");
    expect(selects[1]).not.toContain("ressalva");
    // Nada interno é pedido ao banco.
    expect(selects.join(",")).not.toMatch(/observacao|minuta/);
  });

  it("qualquer outro erro lança: falha não vira 'nenhum plano'", async () => {
    const { cliente } = clienteFalso([
      { error: { code: "42703", message: 'column temis_planos.anuais_valor does not exist' } },
    ]);
    await expect(lerPlanosDoPortal(cliente, ["39"])).rejects.toThrow(/anuais_valor/);
  });

  it("sem empreendimento, nem consulta", async () => {
    const { cliente, selects } = clienteFalso([]);
    expect(await lerPlanosDoPortal(cliente, [" ", ""])).toEqual([]);
    expect(selects).toEqual([]);
  });
});

// ── A leitura da Mesa: a ressalva chega ao simulador ────────────────────────
describe("lerPlanosDoPanteon (a Mesa de Venda)", () => {
  /** Responde em ordem e anota cada `select`; a Mesa termina a cadeia em `order`, sem `range`. */
  function clienteDaMesa(respostas: Array<{ data?: unknown[]; error?: { code: string; message: string } }>) {
    const selects: string[] = [];
    let chamada = 0;
    const construtor = {
      eq: () => construtor,
      in: () => construtor,
      order: () => {
        const resposta = respostas[chamada] ?? { data: [] };
        chamada += 1;
        return Promise.resolve({ data: resposta.data ?? null, error: resposta.error ?? null });
      },
      select: (colunas: string) => {
        selects.push(colunas);
        return construtor;
      },
    };
    const cliente = { from: () => construtor } as unknown as Parameters<typeof lerPlanosDoPanteon>[0];
    return { cliente, selects };
  }

  const linhaDaMesa = {
    anuais_quantidade: null,
    anuais_valor: null,
    ativo: true,
    categoria_id: null,
    enterprise_id: "39",
    entrada_percentual: "8",
    id: "p-inv",
    indice_correcao: "IPCA_ANUAL",
    juros_convencao: "equivalente",
    juros_periodicidade: "anual",
    juros_taxa: "6",
    nome: "Investidor Parcelado",
    ordem: 1,
    parcelas: 84,
    sistema_amortizacao: "sacoc",
    slot: "investidor",
  };

  it("⚠️ com a 0168, a ressalva do plano chega à Mesa junto do plano", async () => {
    const { cliente, selects } = clienteDaMesa([
      { data: [{ ...linhaDaMesa, ressalva: " válido para as próximas 16 unidades " }] },
    ]);
    const [grupo] = await lerPlanosDoPanteon(cliente, ["39"]);
    const investidor = grupo?.planos[0] as undefined | { ressalva?: null | string };
    expect(selects[0]).toContain("ressalva");
    expect(investidor?.ressalva).toBe("válido para as próximas 16 unidades");
  });

  it("sem a 0168, repete a leitura sem a coluna e o plano vem sem etiqueta", async () => {
    const { cliente, selects } = clienteDaMesa([
      { error: { code: "42703", message: "column temis_planos.ressalva does not exist" } },
      { data: [linhaDaMesa] },
    ]);
    const [grupo] = await lerPlanosDoPanteon(cliente, ["39"]);
    const investidor = grupo?.planos[0] as undefined | { nome: string; ressalva?: null | string };
    expect(selects[1]).not.toContain("ressalva");
    expect(investidor?.nome).toBe("Investidor Parcelado");
    expect(investidor?.ressalva).toBeNull();
  });

  it("qualquer outro erro continua lançando: a Mesa cai na conta simples, não num plano pela metade", async () => {
    const { cliente } = clienteDaMesa([
      { error: { code: "42703", message: "column temis_planos.anuais_valor does not exist" } },
    ]);
    await expect(lerPlanosDoPanteon(cliente, ["39"])).rejects.toThrow(/anuais_valor/);
  });
});
