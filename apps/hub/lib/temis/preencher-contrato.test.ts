import { describe, expect, it } from "vitest";

import { documentoParaHtml, type NoDoDocumento } from "./documento-html";
import { type DadosDoComprador, preencherContrato } from "./preencher-contrato";

const v = (nome: string): NoDoDocumento => ({
  children: [{ text: "" }],
  nome,
  type: "variavel",
});

const p = (...filhos: (NoDoDocumento | string)[]): NoDoDocumento => ({
  children: filhos.map((f) => (typeof f === "string" ? { text: f } : f)),
  type: "p",
});

const comprador = (
  nome: string,
  extras: Partial<DadosDoComprador> = {},
): DadosDoComprador => ({
  ehPessoaFisica: true,
  temConjuge: false,
  valores: { cpf_cliente: "111.222.333-44", nome_cliente: nome },
  ...extras,
});

// ⚠️ O FECHAMENTO DE BLOCO VIRA ESPAÇO antes de as tags caírem. Sem isso, dois parágrafos vizinhos
// saem colados ("COMPRADORES:THIAGO") e o teste acusaria um defeito que é do próprio teste.
const texto = (nos: NoDoDocumento[]) =>
  documentoParaHtml(nos)
    .replace(/<\/(p|div|td|tr|table|h[1-6]|li)>/g, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("as variáveis viram valor", () => {
  it("troca a variável pelo dado do comprador", () => {
    const r = preencherContrato([p("Eu, ", v("nome_cliente"), ", compro.")], {
      compradores: [comprador("THIAGO SOUZA")],
      gerais: {},
    });
    expect(texto(r.nos)).toBe("Eu, THIAGO SOUZA, compro.");
  });

  it("troca também as variáveis gerais", () => {
    const r = preencherContrato([p("Lote ", v("numero_lote"), " do ", v("empreendimento_nome"))], {
      compradores: [comprador("X")],
      gerais: { empreendimento_nome: "Jardim das Gerais", numero_lote: "07" },
    });
    expect(texto(r.nos)).toBe("Lote 07 do Jardim das Gerais");
  });

  // ⚠️ A DECISÃO MAIS IMPORTANTE DESTE MÓDULO. Um contrato que imprime `[cpf_cliente]` no papel é
  // constrangedor e salta aos olhos de quem confere; um contrato onde o CPF simplesmente NÃO ESTÁ
  // passa por todo mundo e chega ao cartório.
  it("o que não tem valor volta a aparecer, e é reportado", () => {
    const r = preencherContrato([p("CPF ", v("cpf_do_avalista"))], {
      compradores: [comprador("X")],
      gerais: {},
    });
    expect(texto(r.nos)).toBe("CPF [cpf_do_avalista]");
    expect(r.semValor).toEqual(["cpf_do_avalista"]);
  });

  it("o valor herda as marcas do chip — negrito na minuta sai negrito no contrato", () => {
    const chip = { ...v("nome_cliente"), bold: true } as NoDoDocumento;
    const r = preencherContrato([p(chip)], { compradores: [comprador("MARIA")], gerais: {} });
    expect(documentoParaHtml(r.nos)).toContain("<strong>MARIA</strong>");
  });
});

describe("o laço de compradores", () => {
  const minuta = [
    p("COMPRADORES:"),
    v("inicio_cada_comprador"),
    p(v("nome_cliente"), ", CPF ", v("cpf_cliente")),
    v("fim_cada_comprador"),
    p("FIM."),
  ];

  it("escreve uma vez para um comprador", () => {
    const r = preencherContrato(minuta, {
      compradores: [comprador("THIAGO")],
      gerais: {},
    });
    expect(texto(r.nos)).toBe("COMPRADORES: THIAGO, CPF 111.222.333-44 FIM.");
    expect(r.vezesDoLaco).toBe(1);
  });

  // ⚠️ É ISTO QUE APOSENTOU OS SUFIXOS `_2`…`_5`. A minuta escreve a qualificação UMA vez; o motor
  // repete quantas a venda pedir — e não para no quinto, como o legado parava.
  it("repete para três compradores, cada um com o seu dado", () => {
    const r = preencherContrato(minuta, {
      compradores: [
        comprador("THIAGO", { valores: { cpf_cliente: "111", nome_cliente: "THIAGO" } }),
        comprador("MARIA", { valores: { cpf_cliente: "222", nome_cliente: "MARIA" } }),
        comprador("JOÃO", { valores: { cpf_cliente: "333", nome_cliente: "JOÃO" } }),
      ],
      gerais: {},
    });
    expect(texto(r.nos)).toBe(
      "COMPRADORES: THIAGO, CPF 111 MARIA, CPF 222 JOÃO, CPF 333 FIM.",
    );
    expect(r.vezesDoLaco).toBe(3);
  });

  it("sem comprador nenhum, o trecho some inteiro", () => {
    const r = preencherContrato(minuta, { compradores: [], gerais: {} });
    expect(texto(r.nos)).toBe("COMPRADORES: FIM.");
  });

  // ⚠️ PAR QUEBRADO NÃO ENGOLE O CONTRATO. É o defeito que `conferirBlocos` acusa antes de publicar
  // e que já saiu impresso no Villa Paris — aqui ele custa um marcador perdido, não o documento.
  it("abertura sem fechamento não apaga o resto", () => {
    const r = preencherContrato(
      [p("ANTES"), v("inicio_cada_comprador"), p("DENTRO"), p("DEPOIS")],
      { compradores: [comprador("X")], gerais: {} },
    );
    expect(texto(r.nos)).toContain("ANTES");
    expect(texto(r.nos)).toContain("DEPOIS");
  });
});

describe("os blocos condicionais", () => {
  const comConjuge = [
    p(
      v("nome_cliente"),
      v("inicio_dados_conjuge"),
      ", casado com ",
      v("nome_conjuge"),
      v("fim_dados_conjuge"),
      ", compra.",
    ),
  ];

  it("imprime o cônjuge de quem tem", () => {
    const r = preencherContrato(comConjuge, {
      compradores: [
        comprador("THIAGO", {
          temConjuge: true,
          valores: { nome_cliente: "THIAGO", nome_conjuge: "MARIA" },
        }),
      ],
      gerais: {},
    });
    expect(texto(r.nos)).toBe("THIAGO, casado com MARIA, compra.");
  });

  it("e some inteiro para o solteiro — marcadores incluídos", () => {
    const r = preencherContrato(comConjuge, {
      compradores: [comprador("THIAGO", { valores: { nome_cliente: "THIAGO" } })],
      gerais: {},
    });
    expect(texto(r.nos)).toBe("THIAGO, compra.");
    expect(texto(r.nos)).not.toContain("inicio_dados_conjuge");
  });

  // ⚠️ O DEFEITO REAL DO VILLA PARIS: o bloco de pessoa jurídica saiu impresso num comprador pessoa
  // física, porque o motor do legado não respeitou o par.
  it("pessoa física não recebe o parágrafo de pessoa jurídica", () => {
    const minuta = [
      p(
        v("inicio_dados_cliente_pf"),
        "CPF ",
        v("cpf_cliente"),
        v("fim_dados_cliente_pf"),
        v("inicio_dados_cliente_pj"),
        "CNPJ ",
        v("cnpj_cliente"),
        v("fim_dados_cliente_pj"),
      ),
    ];
    const pf = preencherContrato(minuta, {
      compradores: [comprador("X", { valores: { cpf_cliente: "111" } })],
      gerais: {},
    });
    expect(texto(pf.nos)).toBe("CPF 111");
    expect(texto(pf.nos)).not.toContain("CNPJ");

    const pj = preencherContrato(minuta, {
      compradores: [
        comprador("X", { ehPessoaFisica: false, valores: { cnpj_cliente: "11.222/0001-33" } }),
      ],
      gerais: {},
    });
    expect(texto(pj.nos)).toBe("CNPJ 11.222/0001-33");
  });

  // ⚠️ CADA CÓPIA PERGUNTA AO SEU PRÓPRIO DADO. Se o par fosse resolvido antes do laço, o cônjuge do
  // primeiro comprador sairia repetido na qualificação de todos — o defeito do legado.
  it("o cônjuge é de cada comprador, não do primeiro", () => {
    const r = preencherContrato(
      [
        v("inicio_cada_comprador"),
        p(
          v("nome_cliente"),
          v("inicio_dados_conjuge"),
          " e ",
          v("nome_conjuge"),
          v("fim_dados_conjuge"),
          ";",
        ),
        v("fim_cada_comprador"),
      ],
      {
        compradores: [
          comprador("CASADO", {
            temConjuge: true,
            valores: { nome_cliente: "CASADO", nome_conjuge: "ESPOSA" },
          }),
          comprador("SOLTEIRO", { valores: { nome_cliente: "SOLTEIRO" } }),
        ],
        gerais: {},
      },
    );
    expect(texto(r.nos)).toBe("CASADO e ESPOSA; SOLTEIRO;");
  });

  it("os anexos ligam pela posição cadastrada", () => {
    const minuta = [
      p(v("inicio_tem_anexo_1"), "ANEXO I — ", v("anexo_1_nome"), v("fim_tem_anexo_1")),
      p(v("inicio_tem_anexo_2"), "ANEXO II — ", v("anexo_2_nome"), v("fim_tem_anexo_2")),
    ];
    const r = preencherContrato(minuta, {
      anexos: { 1: "Convenção de condomínio" },
      compradores: [comprador("X")],
      gerais: {},
    });
    expect(texto(r.nos)).toBe("ANEXO I — Convenção de condomínio");
  });

  // ⚠️ O QUE ESTE MOTOR NÃO CONHECE FICA LIGADO. Cláusula que some de contrato assinado é o pior
  // defeito possível: um par novo tem de sair impresso, para alguém perceber.
  it("par desconhecido não apaga a cláusula", () => {
    const r = preencherContrato(
      [p(v("inicio_condicao_que_nao_existe"), "TEXTO", v("fim_condicao_que_nao_existe"))],
      { compradores: [comprador("X")], gerais: {} },
    );
    expect(texto(r.nos)).toBe("TEXTO");
  });

  it("condição declarada como falsa remove o trecho", () => {
    const r = preencherContrato([p(v("inicio_tem_anuais"), "ANUAIS", v("fim_tem_anuais"))], {
      compradores: [comprador("X")],
      condicoes: { tem_anuais: false },
      gerais: {},
    });
    expect(texto(r.nos)).toBe("");
  });
});

describe("as minutas antigas, com sufixo", () => {
  it("o sufixo `_2` aponta para o segundo comprador", () => {
    const r = preencherContrato(
      [
        p(v("nome_cliente")),
        p(v("inicio_dados_cliente_2"), v("nome_cliente_2"), v("fim_dados_cliente_2")),
      ],
      {
        compradores: [
          comprador("PRIMEIRO", { valores: { nome_cliente: "PRIMEIRO" } }),
          comprador("SEGUNDO", { valores: { nome_cliente: "SEGUNDO" } }),
        ],
        gerais: {},
      },
    );
    expect(texto(r.nos)).toBe("PRIMEIRO SEGUNDO");
  });

  it("e some quando o segundo comprador não existe", () => {
    const r = preencherContrato(
      [
        p(v("nome_cliente")),
        p(v("inicio_dados_cliente_2"), v("nome_cliente_2"), v("fim_dados_cliente_2")),
      ],
      { compradores: [comprador("ÚNICO", { valores: { nome_cliente: "ÚNICO" } })], gerais: {} },
    );
    expect(texto(r.nos)).toBe("ÚNICO");
  });
});

describe("o documento continua válido", () => {
  it("não deixa o carimbo interno no resultado", () => {
    const r = preencherContrato(
      [v("inicio_cada_comprador"), p(v("nome_cliente")), v("fim_cada_comprador")],
      { compradores: [comprador("X")], gerais: {} },
    );
    expect(JSON.stringify(r.nos)).not.toContain("__comprador__");
  });

  it("serializa em HTML sem sobrar marcador nenhum", () => {
    const r = preencherContrato(
      [
        v("inicio_cada_comprador"),
        p(v("nome_cliente"), v("inicio_dados_conjuge"), " e ", v("nome_conjuge"), v("fim_dados_conjuge")),
        v("fim_cada_comprador"),
      ],
      { compradores: [comprador("SÓ", { valores: { nome_cliente: "SÓ" } })], gerais: {} },
    );
    const html = documentoParaHtml(r.nos);
    expect(html).not.toContain("inicio_");
    expect(html).not.toContain("fim_");
    expect(html).toContain("SÓ");
  });
});

describe("o laço dentro de um parágrafo", () => {
  // ⚠️ É ASSIM QUE A MINUTA REAL ESCREVE. Descoberto em 08/09/2026 gerando o primeiro contrato do
  // Veredas do Ouro: os marcadores estavam INLINE, os dois no mesmo <p> da qualificação. O motor só
  // sabia expandir parágrafos inteiros, não achou o par, e o `[fim_cada_comprador]` saiu IMPRESSO no
  // meio do contrato — com `vezesDoLaco` marcando zero.
  const minuta = [
    p("I. CONTRATANTE(S):"),
    p(
      v("inicio_cada_comprador"),
      v("nome_cliente"),
      ", inscrito no CPF sob o nº ",
      v("cpf_cliente"),
      ".",
      v("fim_cada_comprador"),
    ),
    p("II. CONTRATADO(S):"),
  ];

  it("repete a qualificação dentro do próprio parágrafo", () => {
    const r = preencherContrato(minuta, {
      compradores: [
        comprador("RAFAEL", { valores: { cpf_cliente: "137", nome_cliente: "RAFAEL" } }),
        comprador("MARIA", { valores: { cpf_cliente: "246", nome_cliente: "MARIA" } }),
      ],
      gerais: {},
    });
    expect(r.vezesDoLaco).toBe(2);
    expect(texto(r.nos)).toBe(
      "I. CONTRATANTE(S): RAFAEL, inscrito no CPF sob o nº 137. MARIA, inscrito no CPF sob o nº 246. II. CONTRATADO(S):",
    );
  });

  // ⚠️ O TEXTO ENTRE OS MARCADORES VIAJA JUNTO. A primeira versão filtrava os nós de texto para poder
  // recursar, e com isso apagava as vírgulas, os "e" e o "inscrito no CPF sob o nº" — tudo que não
  // fosse variável sumia da qualificação.
  it("não perde a pontuação nem as palavras entre as variáveis", () => {
    const r = preencherContrato(minuta, {
      compradores: [comprador("RAFAEL", { valores: { cpf_cliente: "137", nome_cliente: "RAFAEL" } })],
      gerais: {},
    });
    expect(texto(r.nos)).toContain("inscrito no CPF sob o nº");
  });

  it("o marcador de fim órfão não sai impresso", () => {
    const r = preencherContrato([p("texto ", v("fim_cada_comprador"), " mais texto")], {
      compradores: [comprador("X")],
      gerais: {},
    });
    expect(texto(r.nos)).not.toContain("fim_cada_comprador");
    expect(r.semValor).not.toContain("fim_cada_comprador");
  });

  it("o cônjuge dentro do laço inline é de cada comprador", () => {
    const r = preencherContrato(
      [
        p(
          v("inicio_cada_comprador"),
          v("nome_cliente"),
          v("inicio_dados_conjuge"),
          " casado com ",
          v("nome_conjuge"),
          v("fim_dados_conjuge"),
          "; ",
          v("fim_cada_comprador"),
        ),
      ],
      {
        compradores: [
          comprador("CASADO", {
            temConjuge: true,
            valores: { nome_cliente: "CASADO", nome_conjuge: "ESPOSA" },
          }),
          comprador("SOLTEIRO", { valores: { nome_cliente: "SOLTEIRO" } }),
        ],
        gerais: {},
      },
    );
    expect(texto(r.nos)).toBe("CASADO casado com ESPOSA; SOLTEIRO;");
  });
});

describe("o laço que ATRAVESSA parágrafos — o caso da minuta real", () => {
  // ⚠️ ESTE É O FORMATO DA MINUTA PUBLICADA DO VEREDAS DO OURO, medido em 08/09/2026:
  // `[inicio_cada_comprador]` está DENTRO do parágrafo 5, depois do título "I. CONTRATANTE(S):", e
  // `[fim_cada_comprador]` DENTRO do parágrafo 8 — com três parágrafos inteiros entre os dois.
  //
  // Não é nenhum dos dois casos fáceis: não envolve blocos inteiros e não cabe num parágrafo só.
  // Enquanto isto não existiu, `vezesDoLaco` saía ZERO na minuta de verdade — o par nunca era
  // achado, o marcador de fim ia impresso para o contrato e o SEGUNDO COMPRADOR SIMPLESMENTE NÃO
  // APARECIA. O contrato de um casal saía com uma pessoa só.
  const minuta = [
    p("I. CONTRATANTE(S):", v("inicio_cada_comprador"), v("nome_cliente"), ", CPF ", v("cpf_cliente")),
    p("Estado civil: ", v("estado_civil_cliente")),
    p(v("inicio_dados_conjuge"), "Casado com ", v("nome_conjuge"), v("fim_dados_conjuge")),
    p("Percentual: ", v("percentual_cliente"), v("fim_cada_comprador"), " II. CONTRATADO(S):"),
    p("Cláusula primeira."),
  ];

  const gente = (nome: string, casado: boolean): DadosDoComprador => ({
    ehPessoaFisica: true,
    temConjuge: casado,
    valores: {
      cpf_cliente: `CPF-${nome}`,
      estado_civil_cliente: casado ? "Casado" : "Solteiro",
      nome_cliente: nome,
      nome_conjuge: `ESPOSA-${nome}`,
      percentual_cliente: "50%",
    },
  });

  it("um comprador: o contrato sai inteiro, sem marcador", () => {
    const r = preencherContrato(minuta, { compradores: [gente("RAFAEL", true)], gerais: {} });
    expect(r.vezesDoLaco).toBe(1);
    const t = texto(r.nos);
    expect(t).toContain("RAFAEL");
    expect(t).toContain("ESPOSA-RAFAEL");
    expect(t).not.toMatch(/\[(inicio|fim)_/);
  });

  it("dois compradores: cada um com o seu, e o título NÃO se repete", () => {
    const r = preencherContrato(minuta, {
      compradores: [gente("RAFAEL", true), gente("MARIA", false)],
      gerais: {},
    });
    expect(r.vezesDoLaco).toBe(2);
    const t = texto(r.nos);
    expect(t).toContain("RAFAEL");
    expect(t).toContain("MARIA");
    // ⚠️ O QUE VEM ANTES DO MARCADOR FICA FORA DO LAÇO. "I. CONTRATANTE(S):" é título de seção: se
    // entrasse na repetição, o contrato de dois compradores teria duas seções I.
    expect((t.match(/I\. CONTRATANTE/g) ?? []).length).toBe(1);
    // E o que vem DEPOIS do fim também: "II. CONTRATADO(S):" abre a próxima seção.
    expect((t.match(/II\. CONTRATADO/g) ?? []).length).toBe(1);
  });

  it("o cônjuge é de cada um — o solteiro não herda a esposa do casado", () => {
    const r = preencherContrato(minuta, {
      compradores: [gente("RAFAEL", true), gente("MARIA", false), gente("JOAO", true)],
      gerais: {},
    });
    const t = texto(r.nos);
    expect(t).toContain("ESPOSA-RAFAEL");
    expect(t).toContain("ESPOSA-JOAO");
    expect(t).not.toContain("ESPOSA-MARIA");
    expect((t.match(/Casado com/g) ?? []).length).toBe(2);
  });

  it("cinco compradores: os cinco saem", () => {
    const nomes = ["A", "B", "C", "D", "E"];
    const r = preencherContrato(minuta, {
      compradores: nomes.map((n, i) => gente(n, i % 2 === 0)),
      gerais: {},
    });
    expect(r.vezesDoLaco).toBe(5);
    for (const n of nomes) expect(texto(r.nos), n).toContain(`CPF-${n}`);
  });

  it("par quebrado não engole o contrato nem imprime o marcador", () => {
    const r = preencherContrato(
      [p("ANTES", v("inicio_cada_comprador"), v("nome_cliente")), p("DEPOIS")],
      { compradores: [gente("X", false)], gerais: {} },
    );
    const t = texto(r.nos);
    expect(t).toContain("ANTES");
    expect(t).toContain("DEPOIS");
    expect(t).not.toMatch(/\[(inicio|fim)_/);
  });
});

// ── A ORAÇÃO DO REGIME DE BENS ───────────────────────────────────────────────
//
// Lucas, 08/09/2026, olhando o contrato do Rodrigo (solteiro) na prévia: *"regime do casamento não
// veio"* — e, no mesmo minuto, *"não é você preencher, é o sistema preencher"*. O cadastro estava
// CERTO: Rodrigo é solteiro e não tem regime de bens. O que estava errado era o papel, que dizia
// "Solteiro (a), casado sob o regime de [regime_casamento_cliente]".
describe("a oração do regime de bens", () => {
  // É a redação exata da minuta "Teste Minuta - Clicksing", do ZZ TESTE: a variável do estado civil,
  // o texto corrido ", casado sob o regime de " e a variável do regime — nenhum par condicional.
  const qualificacao = [
    p(
      v("nome_cliente"),
      ", ",
      v("nacionalidade_cliente"),
      ", ",
      v("estado_civil_cliente"),
      ", casado sob o regime de ",
      v("regime_casamento_cliente"),
      ", ",
      v("profissao_cliente"),
      ", portador do CPF ",
      v("cpf_cliente"),
    ),
  ];

  const pessoa = (nome: string, casado: boolean): DadosDoComprador => ({
    ehCasado: casado,
    ehPessoaFisica: true,
    temConjuge: casado,
    valores: {
      cpf_cliente: "111.222.333-44",
      estado_civil_cliente: casado ? "Casado (a)" : "Solteiro (a)",
      nacionalidade_cliente: "Brasileiro",
      nome_cliente: nome,
      profissao_cliente: "Corretor",
      ...(casado ? { regime_casamento_cliente: "Comunhão parcial de bens" } : {}),
    },
  });

  it("no solteiro, a oração inteira some — não sobra nem o colchete nem a frase", () => {
    const r = preencherContrato(qualificacao, {
      compradores: [pessoa("RODRIGO TAVARES LIMA", false)],
      gerais: {},
    });
    const t = texto(r.nos);

    expect(t).toBe(
      "RODRIGO TAVARES LIMA, Brasileiro, Solteiro (a), Corretor, portador do CPF 111.222.333-44",
    );
    expect(t).not.toContain("regime");
    expect(t).not.toContain("casado sob");
  });

  it("no casado, a oração fica inteira, com o regime escrito", () => {
    const r = preencherContrato(qualificacao, {
      compradores: [pessoa("HENRIQUE SALES DO VALE", true)],
      gerais: {},
    });

    expect(texto(r.nos)).toBe(
      "HENRIQUE SALES DO VALE, Brasileiro, Casado (a), casado sob o regime de Comunhão parcial de bens, Corretor, portador do CPF 111.222.333-44",
    );
  });

  // ⚠️ ESTA É A DIFERENÇA ENTRE "NÃO SE APLICA" E "FALTA NO CADASTRO". Sem estado civil na ficha o
  // resolvedor devolve `ehCasado` indefinido, e aí a cláusula tem de SAIR VISÍVEL: é o colchete no
  // papel que faz alguém completar o cadastro antes de o contrato ir a cartório.
  it("sem estado civil no cadastro, a oração fica — e o colchete aparece", () => {
    const r = preencherContrato(qualificacao, {
      compradores: [
        { ehPessoaFisica: true, temConjuge: false, valores: { nome_cliente: "SEM FICHA" } },
      ],
      gerais: {},
    });
    const t = texto(r.nos);

    expect(t).toContain("casado sob o regime de [regime_casamento_cliente]");
    expect(r.semValor).toContain("regime_casamento_cliente");
  });

  // ⚠️ O CORTE NÃO PODE COMER O VIZINHO. Quando o texto anterior não anuncia o regime, some só a
  // variável: apagar até a vírgula ali levaria embora a nacionalidade.
  it("quando o texto anterior não fala de regime, só a variável sai", () => {
    const r = preencherContrato(
      [p(v("nacionalidade_cliente"), ", natural de Belo Horizonte ", v("regime_casamento_cliente"))],
      {
        compradores: [
          {
            ehCasado: false,
            ehPessoaFisica: true,
            temConjuge: false,
            valores: { nacionalidade_cliente: "Brasileiro" },
          },
        ],
        gerais: {},
      },
    );

    expect(texto(r.nos)).toBe("Brasileiro, natural de Belo Horizonte");
  });

  // A forma CERTA de escrever isto numa minuta nova. Aqui o motor nem precisa do corte: o par
  // condicional já resolve, e é o que o agente da minuta passa a propor.
  it("com [inicio_dados_casado], o par condicional resolve sozinho", () => {
    const comPar = [
      p(
        v("estado_civil_cliente"),
        ", ",
        v("inicio_dados_casado"),
        "casado sob o regime de ",
        v("regime_casamento_cliente"),
        v("fim_dados_casado"),
        " e residente nesta capital",
      ),
    ];

    const solteiro = preencherContrato(comPar, {
      compradores: [pessoa("RODRIGO", false)],
      gerais: {},
    });
    expect(texto(solteiro.nos)).toBe("Solteiro (a), e residente nesta capital");

    const casado = preencherContrato(comPar, {
      compradores: [pessoa("HENRIQUE", true)],
      gerais: {},
    });
    expect(texto(casado.nos)).toBe(
      "Casado (a), casado sob o regime de Comunhão parcial de bens e residente nesta capital",
    );
  });

  // ⚠️ NO LAÇO, CADA COMPRADOR RESPONDE POR SI. Num casal em que só um é casado — dois irmãos
  // comprando juntos, por exemplo — o dono do nó é que decide, e não o primeiro da lista.
  it("dois compradores: a oração some no solteiro e fica no casado", () => {
    const r = preencherContrato(
      [
        p(v("inicio_cada_comprador"), v("nome_cliente"), ", ", v("estado_civil_cliente")),
        p(", casado sob o regime de ", v("regime_casamento_cliente"), v("fim_cada_comprador")),
      ],
      { compradores: [pessoa("CASADO", true), pessoa("SOLTEIRO", false)], gerais: {} },
    );
    const t = texto(r.nos);

    expect(t).toContain("CASADO, Casado (a) , casado sob o regime de Comunhão parcial de bens");
    expect(t).toContain("SOLTEIRO, Solteiro (a)");
    expect(t).not.toContain("SOLTEIRO, Solteiro (a) , casado");
  });
});

// ── A CARA DA VARIÁVEL E O VÃO DO BLOCO CORTADO ──────────────────────────────
//
// Dois defeitos que só apareceram quando o motor rodou sobre a minuta REAL do ZZ TESTE, em
// 08/09/2026, e que o contrato do Otávio (viúvo) e o do Rodrigo (solteiro) mostravam lado a lado.
describe("o valor herda a cara do chip", () => {
  // ⚠️ ESTA É A FORMA REAL DO NÓ NO BANCO. O `variavel` é void e inline: as marcas ficam no FILHO,
  // e o nó só tem type/nome/id/children. Medido: dos 102 nós da minuta, ZERO têm marca no nó e 48
  // têm no filho.
  const chip = (nome: string, marcas: Record<string, unknown> = {}): NoDoDocumento => ({
    children: [{ text: "", ...marcas }],
    nome,
    type: "variavel",
  });

  it("negrito e fonte do filho vão para o valor", () => {
    const html = documentoParaHtml(
      preencherContrato(
        [p("Eu, ", chip("nome_cliente", { bold: true, fontFamily: "Lucida Sans Unicode" }), ".")],
        { compradores: [comprador("THIAGO SOUZA")], gerais: {} },
      ).nos,
    );

    expect(html).toContain("THIAGO SOUZA");
    expect(html).toMatch(/<(strong|b)[^>]*>[^<]*THIAGO SOUZA/);
    expect(html).toContain("Lucida Sans Unicode");
  });

  // ⚠️ O NÓ VENCE O FILHO quando os dois trazem a marca — é a precedência declarada em `marcasDoNo`.
  it("marca no próprio nó continua vencendo a do filho", () => {
    const no = { ...chip("nome_cliente", { bold: true }), bold: false } as NoDoDocumento;
    const html = documentoParaHtml(
      preencherContrato([p(no)], { compradores: [comprador("THIAGO")], gerais: {} }).nos,
    );

    expect(html).toContain("THIAGO");
    expect(html).not.toMatch(/<(strong|b)>/);
  });

  // Sem marca em lugar nenhum, o valor sai limpo e herda o CSS do documento. Não inventa negrito.
  it("chip sem marca nenhuma sai sem marca nenhuma", () => {
    const html = documentoParaHtml(
      preencherContrato([p(chip("nome_cliente"))], {
        compradores: [comprador("THIAGO")],
        gerais: {},
      }).nos,
    );

    expect(html).toContain("THIAGO");
    expect(html).not.toMatch(/<(strong|b|em|i)>/);
  });
});

describe("o parágrafo que esvaziou no corte", () => {
  // ⚠️ ESTA É A FORMA REAL DO PARÁGRAFO DO CÔNJUGE na minuta do ZZ TESTE: os dois textos vazios
  // estão FORA do par, então sobrevivem ao corte e o parágrafo termina com dois filhos. A contagem
  // de filhos dizia "não está vazio", ele passava inteiro e saía como <p><br /></p> — uma linha em
  // branco no lugar exato da qualificação do cônjuge, no contrato de quem não tem cônjuge.
  const minuta = [
    p("Comprador: ", v("nome_cliente")),
    {
      children: [
        { text: "" },
        v("inicio_dados_conjuge"),
        { text: "E, na qualidade de cônjuge, " },
        v("nome_conjuge"),
        v("fim_dados_conjuge"),
        { text: "" },
      ],
      type: "p",
    } as NoDoDocumento,
    p("Cláusula primeira."),
  ];

  it("sem cônjuge, o parágrafo some inteiro — não vira linha em branco", () => {
    const r = preencherContrato(minuta, {
      compradores: [comprador("OTAVIO REZENDE CAMPOS", { temConjuge: false })],
      gerais: {},
    });

    expect(r.nos).toHaveLength(2);
    expect(documentoParaHtml(r.nos)).not.toContain("<br />");
    expect(texto(r.nos)).toBe("Comprador: OTAVIO REZENDE CAMPOS Cláusula primeira.");
  });

  it("com cônjuge, o parágrafo fica", () => {
    const r = preencherContrato(minuta, {
      compradores: [
        comprador("HENRIQUE", {
          temConjuge: true,
          valores: { nome_cliente: "HENRIQUE", nome_conjuge: "PATRÍCIA SALES DO VALE" },
        }),
      ],
      gerais: {},
    });

    expect(r.nos).toHaveLength(3);
    expect(texto(r.nos)).toContain("E, na qualidade de cônjuge, PATRÍCIA SALES DO VALE");
  });

  // ⚠️ A LINHA EM BRANCO DE DIAGRAMAÇÃO NÃO PODE SUMIR JUNTO. O jurídico a coloca de propósito
  // entre cláusulas, e o sinal que separa uma da outra é ter tido conteúdo ANTES do corte.
  it("linha em branco que já era vazia na minuta continua lá", () => {
    const r = preencherContrato(
      [p("Cláusula primeira."), p(""), p("Cláusula segunda.")],
      { compradores: [comprador("X")], gerais: {} },
    );

    expect(r.nos).toHaveLength(3);
  });
});
