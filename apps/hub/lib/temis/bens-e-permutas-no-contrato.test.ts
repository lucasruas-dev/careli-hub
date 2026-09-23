import { describe, expect, it } from "vitest";

import { dadosDaProposta } from "./dados-do-contrato";
import { documentoParaHtml, type NoDoDocumento } from "./documento-html";
import { preencherContrato } from "./preencher-contrato";

// A PERMUTA NO CONTRATO — Lucas, 22/09/2026, perguntado onde o bem aparece: *"Já no contrato
// também"*.
//
// ⚠️ NADA DE BANCO: o cliente é um duplo por tabela. O que se prova aqui é o que sai no PAPEL — que
// o quadro fecha, que a cláusula da permuta só existe quando há permuta, e sobretudo que o contrato
// SEM permuta não muda uma vírgula.

type Linhas = Record<string, unknown>;

function clienteFalso(porTabela: Linhas, semColunaDeBens = false) {
  const construir = (tabela: string) => {
    let colunas = "";
    const resposta = () => {
      // ⚠️ A COLUNA `bens_e_permutas` PODE NÃO EXISTIR. A migration 0187 está escrita e NÃO foi
      // aplicada: conferido no banco em 22/09/2026, `information_schema.columns` não tem a coluna
      // em `hercules_propostas`. Pedir coluna inexistente devolve 42703, e sem o recuo a geração
      // de TODO contrato passaria a responder erro.
      if (semColunaDeBens && colunas.includes("bens_e_permutas")) {
        return {
          data: null,
          error: {
            code: "42703",
            message: "column hercules_propostas.bens_e_permutas does not exist",
          },
        };
      }
      return { data: porTabela[tabela] ?? null, error: null };
    };
    const encadeia: Record<string, unknown> = new Proxy(
      {},
      {
        get(_alvo, prop: string) {
          if (prop === "maybeSingle") return () => Promise.resolve(resposta());
          if (prop === "then") {
            return (resolver: (r: unknown) => unknown) => Promise.resolve(resolver(resposta()));
          }
          if (prop === "select") {
            return (lista: string) => {
              colunas = String(lista ?? "");
              return encadeia;
            };
          }
          return () => encadeia;
        },
      },
    );
    return encadeia;
  };
  return { from: (tabela: string) => construir(tabela) } as never;
}

const CARRO = {
  descricao: "Ford Ka 2019 placa ABC1D23",
  entraComo: "abatimento",
  tipo: "permuta",
  valor: 80_000,
};

/** O lote de R$ 200.000 com permuta de R$ 80.000 — o caso do Lucas, 22/09/2026. */
function proposta(over: Linhas = {}): Linhas {
  return {
    cliente_documento: "12345678900",
    cliente_nome: "THIAGO HENRIQUE DE SOUZA",
    compradores: [{ cpf: "123.456.789-00", nome: "THIAGO HENRIQUE DE SOUZA", titular: true }],
    condicoes: {
      anuais: [],
      entrada: [{ numero: 1, total: 1, valor: 20_000, vencimento: "2026-10-10" }],
      mensais: Array.from({ length: 100 }, (_, k) => ({
        numero: k + 1,
        total: 100,
        valor: 1_000,
        vencimento: "2026-11-10",
      })),
      totais: {
        anuais: 0,
        bensEPermutas: 80_000,
        entrada: 20_000,
        financiado: 100_000,
        geral: 200_000,
        mensais: 100_000,
      },
    },
    contrato_parcelas: 100,
    dia_vencimento: 10,
    empreendimento_id: "eeeeeeee-0000-0000-0000-000000000001",
    plano_nome: "NORMAL",
    unidade_id: "dddddddd-0000-0000-0000-000000000001",
    valor: 200_000,
    ...over,
  };
}

const UNIDADE = {
  area: 300,
  codigo: "JDG0617",
  lote: "07",
  preco_tabela: 200_000,
  quadra: "12",
  tipo_unidade: "lote",
};

const EMPREENDIMENTO = {
  c2x_enterprise_id: "39",
  cidade: "João Monlevade",
  codigo: "JDG",
  nome: "Jardim das Gerais",
  uf: "MG",
};

function tabelas(over: Linhas = {}): Linhas {
  return {
    hercules_empreendimentos: EMPREENDIMENTO,
    hercules_propostas: proposta(),
    hercules_unidades: UNIDADE,
    ...over,
  };
}

const html = (nos: readonly NoDoDocumento[]) => documentoParaHtml(nos as never);

/**
 * O valor em reais com o espaço que o `Intl` do pt-BR usa de verdade entre o símbolo e o número.
 *
 * ⚠️ É U+00A0 (não separável). O quadro sai de `Intl.NumberFormat`, e escrever o literal com espaço
 * comum produz um teste que parece idêntico na tela e falha mesmo assim.
 */
const moeda = (texto: string) => `R$\u00a0${texto}`;

describe("o bem e a permuta chegam ao contrato", () => {
  it("o quadro do contrato traz a permuta e fecha com o preço do lote", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso(tabelas({ hercules_propostas: proposta({ bens_e_permutas: [CARRO] }) })),
    ))!;

    const quadro = html(dados.gerados?.tabela_geral_pagamentos ?? []);
    expect(quadro).toContain("Ford Ka 2019 placa ABC1D23");
    expect(quadro).toContain(moeda("80.000,00"));
    // 20.000 de entrada + 80.000 de permuta + 100.000 de saldo = o 6.1 PREÇO DO LOTE.
    expect(quadro).toContain(moeda("200.000,00"));
    expect(quadro).not.toContain(moeda("120.000,00"));
  });

  // ⚠️ O VALOR PODE CHEGAR DO BANCO COMO TEXTO, e o contrato não pode contar três histórias por
  // causa disso. O jsonb aceita `"80000"` tanto quanto `80000` (carga, SQL direto, serialização
  // de outra ponta), e em 22/09/2026 esse caso produzia: cláusula anunciando "R$ 80.000,00",
  // variável `valor_bens_e_permutas` dizendo "R$ 0,00" e o quadro sem linha nenhuma do carro.
  // Quem lê o banco normaliza; quem soma usa a régua única. Este teste é o que prende as duas.
  it("valor gravado como texto vale o mesmo que valor gravado como número", async () => {
    const carroComValorEmTexto = { ...CARRO, valor: "80000" as unknown as number };
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso(tabelas({ hercules_propostas: proposta({ bens_e_permutas: [carroComValorEmTexto] }) })),
    ))!;

    expect(dados.gerais.valor_bens_e_permutas).toBe("R$ 80.000,00");
    expect(dados.condicoes?.tem_bens_e_permutas).toBe(true);

    const quadro = html(dados.gerados?.tabela_geral_pagamentos ?? []);
    expect(quadro).toContain("Ford Ka 2019 placa ABC1D23");
    expect(quadro).toContain(moeda("80.000,00"));
    // e o quadro continua fechando com o preço do lote, que é o que o 6.1 promete.
    expect(quadro).toContain(moeda("200.000,00"));
  });

  // ⚠️ E TEXTO QUE NÃO É NÚMERO CONTINUA FORA DE TUDO, sem meia entrada: o item some da cláusula,
  // do quadro e da variável ao mesmo tempo. Um bem que aparece num lugar e some no outro é pior
  // do que um bem que não aparece, porque ninguém desconfia do documento inteiro.
  it("valor que não é número deixa o contrato como se não houvesse bem", async () => {
    const carroSemValor = { ...CARRO, valor: "" as unknown as number };
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso(tabelas({ hercules_propostas: proposta({ bens_e_permutas: [carroSemValor] }) })),
    ))!;

    expect(dados.condicoes?.tem_bens_e_permutas).toBe(false);
    const quadro = html(dados.gerados?.tabela_geral_pagamentos ?? []);
    expect(quadro).not.toContain("Ford Ka 2019 placa ABC1D23");
  });

  it("liga o par [inicio_tem_bens_e_permutas] e escreve o que a cláusula precisa", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso(tabelas({ hercules_propostas: proposta({ bens_e_permutas: [CARRO] }) })),
    ))!;

    expect(dados.condicoes?.tem_bens_e_permutas).toBe(true);
    expect(dados.gerais.valor_bens_e_permutas).toBe("R$ 80.000,00");
    expect(dados.gerais.valor_bens_e_permutas_extenso).toBe("oitenta mil reais");
    expect(dados.gerais.bens_e_permutas_descricao).toBe(
      "Ford Ka 2019 placa ABC1D23, recebido em permuta, no valor de R$ 80.000,00",
    );
  });

  // Lucas, 22/09/2026, perguntado quantos bens cabem numa proposta: *"Vários"*.
  //
  // ⚠️ CADA ITEM LEVA O PRÓPRIO VALOR. "O carro e o lote, no valor total de R$ 95.000" obriga quem
  // lê a adivinhar quanto vale cada um — e é sobre o valor de CADA bem que se discute devolução
  // numa rescisão.
  it("com vários bens, a cláusula descreve item a item, com o valor de cada um", async () => {
    const lote = {
      descricao: "lote 12 da quadra 4 em Anápolis",
      entraComo: "entrada",
      tipo: "bem",
      valor: 15_000,
    };
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso(
        tabelas({ hercules_propostas: proposta({ bens_e_permutas: [CARRO, lote] }) }),
      ),
    ))!;

    expect(dados.gerais.bens_e_permutas_descricao).toBe(
      "Ford Ka 2019 placa ABC1D23, recebido em permuta, no valor de R$ 80.000,00; " +
        "e lote 12 da quadra 4 em Anápolis, recebido em pagamento, no valor de R$ 15.000,00",
    );
    expect(dados.gerais.valor_bens_e_permutas).toBe("R$ 95.000,00");
  });

  // ⚠️ AS 4.857 PROPOSTAS IMPORTADAS DO C2X TÊM `condicoes` NULO, e `condicoesDoContrato` devolvia
  // `{}` para elas. `preencher-contrato.ts` termina em `return true` para par desconhecido: com o
  // par fora do mapa, `[inicio_tem_bens_e_permutas]` sairia LIGADO em toda venda importada, e o
  // contrato prometeria uma permuta que ninguém deu.
  it("⚠️ proposta importada (condicoes nulo) DESLIGA o par, em vez de deixá-lo desconhecido", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso(
        tabelas({ hercules_propostas: proposta({ bens_e_permutas: [], condicoes: null }) }),
      ),
    ))!;

    expect(dados.condicoes).toHaveProperty("tem_bens_e_permutas");
    expect(dados.condicoes?.tem_bens_e_permutas).toBe(false);
  });

  it("proposta sem bem nenhum também desliga o par", async () => {
    const { dados } = (await dadosDaProposta("p1", clienteFalso(tabelas())))!;

    expect(dados.condicoes?.tem_bens_e_permutas).toBe(false);
    expect(dados.gerais.valor_bens_e_permutas).toBeUndefined();
    expect(dados.gerais.bens_e_permutas_descricao).toBeUndefined();
  });

  // ⚠️ A MIGRATION 0187 NÃO ESTÁ APLICADA. Medido no banco em 22/09/2026: `information_schema` não
  // tem `hercules_propostas.bens_e_permutas`. Sem este recuo, ler a coluna derrubaria a geração de
  // TODO contrato da casa com 42703 — inclusive a dos 4.857 importados, que nunca terão permuta.
  //
  // ⚠️ E ENQUANTO ELA NÃO ENTRA NÃO EXISTE PERMUTA NENHUMA para o quadro perder: a rota da proposta
  // grava `bens_e_permutas` no mesmo upsert, então sem a coluna nenhuma venda consegue cadastrar
  // bem. Ler sem ela é exato, não aproximado — é o mesmo argumento de `lerComColunasDoApartamento`.
  it("⚠️ sem a coluna no banco, o contrato sai como sempre saiu", async () => {
    const semColuna = (await dadosDaProposta("p1", clienteFalso(tabelas(), true)))!;
    const comColuna = (await dadosDaProposta("p1", clienteFalso(tabelas())))!;

    expect(semColuna.dados.condicoes?.tem_bens_e_permutas).toBe(false);
    expect(html(semColuna.dados.gerados?.tabela_geral_pagamentos ?? [])).toBe(
      html(comColuna.dados.gerados?.tabela_geral_pagamentos ?? []),
    );
    expect(semColuna.dados.gerais).toEqual(comColuna.dados.gerais);
  });
});

// ── A TRAVA: O CONTRATO SEM PERMUTA NÃO MUDA UMA VÍRGULA ─────────────────────
//
// ⚠️ A IMENSA MAIORIA DAS VENDAS NÃO TEM BEM NENHUM, e o documento delas precisa sair IDÊNTICO ao
// de hoje: sem linha vazia onde a cláusula sumiu, sem cláusula órfã, sem um espaço a mais. A prova
// é comparar o DOCUMENTO INTEIRO da minuta COM a cláusula nova contra o da mesma minuta SEM ela.
// Se o corte do par deixar qualquer resíduo, os dois HTML divergem.

const p = (...filhos: unknown[]): NoDoDocumento =>
  ({ children: filhos, type: "p" }) as NoDoDocumento;
const t = (text: string) => ({ text });
const v = (nome: string) => ({ children: [{ text: "" }], nome, type: "variavel" });

/** A minuta de hoje: as partes, o preço e o quadro. Nenhuma menção a permuta. */
const MINUTA_DE_HOJE: NoDoDocumento[] = [
  p(t("CLÁUSULA SEXTA — DO PREÇO")),
  p(t("O preço certo e ajustado da unidade é de "), v("preco_venda"), t(".")),
  p(v("tabela_geral_pagamentos")),
  p(t("CLÁUSULA SÉTIMA — DO REAJUSTE")),
];

/** A mesma minuta com a cláusula da permuta, entre o preço e o quadro. */
const MINUTA_COM_A_CLAUSULA: NoDoDocumento[] = [
  p(t("CLÁUSULA SEXTA — DO PREÇO")),
  p(t("O preço certo e ajustado da unidade é de "), v("preco_venda"), t(".")),
  p(
    v("inicio_tem_bens_e_permutas"),
    t("Do preço acima, a VENDEDORA recebe em permuta "),
    v("bens_e_permutas_descricao"),
    t(", no valor total de "),
    v("valor_bens_e_permutas"),
    t("."),
    v("fim_tem_bens_e_permutas"),
  ),
  p(v("tabela_geral_pagamentos")),
  p(t("CLÁUSULA SÉTIMA — DO REAJUSTE")),
];

describe("⚠️ o contrato sem permuta não muda uma vírgula", () => {
  it("o documento INTEIRO sai idêntico ao da minuta que nunca teve a cláusula", async () => {
    const { dados } = (await dadosDaProposta("p1", clienteFalso(tabelas())))!;

    const comAClausula = preencherContrato(MINUTA_COM_A_CLAUSULA, dados);
    const comoHoje = preencherContrato(MINUTA_DE_HOJE, dados);

    expect(html(comAClausula.nos)).toBe(html(comoHoje.nos));
    // E nada de marcador órfão cobrando valor na prévia.
    expect(comAClausula.semValor).toEqual(comoHoje.semValor);
  });

  it("vale também para a proposta importada do C2X, que não tem cronograma", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso(tabelas({ hercules_propostas: proposta({ condicoes: null }) })),
    ))!;

    expect(html(preencherContrato(MINUTA_COM_A_CLAUSULA, dados).nos)).toBe(
      html(preencherContrato(MINUTA_DE_HOJE, dados).nos),
    );
  });

  it("e com a permuta a cláusula SAI, escrita", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso(tabelas({ hercules_propostas: proposta({ bens_e_permutas: [CARRO] }) })),
    ))!;

    const saida = html(preencherContrato(MINUTA_COM_A_CLAUSULA, dados).nos);
    expect(saida).toContain("recebe em permuta");
    expect(saida).toContain("Ford Ka 2019 placa ABC1D23");
    expect(saida).toContain("R$ 80.000,00");
    expect(saida).toContain(moeda("80.000,00"));
    expect(saida).not.toContain("[inicio_tem_bens_e_permutas]");
  });
});

// ── A PERMUTA QUE FAZ AS VEZES DA ENTRADA ────────────────────────────────────
//
// ⚠️ A RÉGUA NOVA ACEITA ENTRADA EM DINHEIRO ZERO quando o bem apontado na entrada cobre o piso
// (`centavos(entradaValor) + centavos(bensNaEntrada) >= centavos(piso)`, `proposta.ts`). Antes da
// permuta essa composição não existia, e o quadro do contrato nunca tinha visto uma venda SEM
// parcela de entrada com comissão cadastrada.
//
// ⚠️ E ERA AÍ QUE A COMISSÃO SUMIA DO PAPEL. Medido em 22/09/2026 num lote de R$ 200.000 com
// comissão de R$ 12.000 e permuta de R$ 20.000 no ato: o rodapé do quadro fechava em
// R$ 200.000,00 e o `preco_do_lote` (6.1) da MESMA página dizia R$ 188.000,00.
const SETTINGS_COM_COMISSAO = {
  comissao_coordenadora_percentual: 2,
  comissao_imobiliaria_percentual: 4,
  coordenadora_entity_id: null,
};

const CARRO_NA_ENTRADA = {
  descricao: "Ford Ka 2019 placa ABC1D23",
  entraComo: "entrada",
  tipo: "permuta",
  valor: 20_000,
};

/** O mesmo lote de R$ 200.000, pago com a permuta no ato e 180 mensais. Nada em dinheiro no ato. */
function propostaSemDinheiroNoAto(over: Linhas = {}): Linhas {
  return proposta({
    condicoes: {
      anuais: [],
      entrada: [],
      mensais: Array.from({ length: 180 }, (_, k) => ({
        numero: k + 1,
        total: 180,
        valor: 1_000,
        vencimento: "2026-11-10",
      })),
      totais: {
        anuais: 0,
        bensEPermutas: 20_000,
        entrada: 0,
        financiado: 180_000,
        geral: 200_000,
        mensais: 180_000,
      },
    },
    contrato_parcelas: 180,
    ...over,
  });
}

describe("⚠️ o quadro fecha com o 6.1 mesmo sem dinheiro no ato", () => {
  it("a comissão continua saindo do quadro quando a permuta faz as vezes da entrada", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso(
        tabelas({
          apolo_enterprise_settings: SETTINGS_COM_COMISSAO,
          hercules_propostas: propostaSemDinheiroNoAto({ bens_e_permutas: [CARRO_NA_ENTRADA] }),
        }),
      ),
    ))!;

    expect(dados.gerais.valor_total_comissao).toBe("R$ 12.000,00");
    expect(dados.gerais.preco_do_lote).toBe("R$ 188.000,00");

    const quadro = html(dados.gerados?.tabela_geral_pagamentos ?? []);
    // O rodapé é o próprio 6.1 impresso duas linhas acima.
    expect(quadro).toContain(moeda("188.000,00"));
    expect(quadro).not.toContain(moeda("200.000,00"));
    // ⚠️ E A PERMUTA MANTÉM O VALOR CHEIO, igual ao da cláusula da mesma página.
    expect(quadro).toContain(moeda("20.000,00"));
    expect(dados.gerais.valor_bens_e_permutas).toBe("R$ 20.000,00");
  });

  // ⚠️ A TRAVA: com entrada em dinheiro o mesmo lote JÁ FECHAVA CERTO, e continua fechando do mesmo
  // jeito — por dentro das parcelas do ato, sem linha nova no quadro.
  it("com entrada em dinheiro, o quadro sai como sempre saiu", async () => {
    const { dados } = (await dadosDaProposta(
      "p1",
      clienteFalso(
        tabelas({
          apolo_enterprise_settings: SETTINGS_COM_COMISSAO,
          hercules_propostas: proposta({ bens_e_permutas: [CARRO] }),
        }),
      ),
    ))!;

    expect(dados.gerais.preco_do_lote).toBe("R$ 188.000,00");

    const quadro = html(dados.gerados?.tabela_geral_pagamentos ?? []);
    // 20.000 de entrada - 12.000 de corretagem = 8.000, mais 80.000 de permuta e 100.000 de saldo.
    expect(quadro).toContain(moeda("8.000,00"));
    expect(quadro).toContain(moeda("188.000,00"));
    expect(quadro).not.toContain("Comissão de corretagem");
  });
});
