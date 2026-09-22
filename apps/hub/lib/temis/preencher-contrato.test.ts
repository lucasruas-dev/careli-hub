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

// ── O RG QUE NÃO É EXIGIDO ───────────────────────────────────────────────────
//
// Lucas, 18/09/2026: *"rg não precisa"*. Até aqui o RG ausente virava `[rg_cliente]` no papel, entrava
// em `semValor` e a geração do contrato era RECUSADA por `podeGerarContrato`. A redação é a medida nas
// duas minutas publicadas que usam a variável (VDO 19 e RVP 38).
describe("a oração do RG", () => {
  const qualificacao = [
    p(
      v("nome_cliente"),
      ", ",
      v("profissao_cliente"),
      ", portador da cédula de identidade nº ",
      v("rg_cliente"),
      " e inscrito no CPF sob o nº ",
      v("cpf_cliente"),
      ", residente",
    ),
  ];

  const pessoa = (nome: string, rg?: string): DadosDoComprador => ({
    ehPessoaFisica: true,
    temConjuge: false,
    valores: {
      cpf_cliente: "111.222.333-44",
      nome_cliente: nome,
      profissao_cliente: "Corretor",
      ...(rg ? { rg_cliente: rg } : {}),
    },
  });

  it("sem RG, a oração inteira sai — e o contrato não fica preso por ela", () => {
    const r = preencherContrato(qualificacao, { compradores: [pessoa("SEM RG")], gerais: {} });

    expect(texto(r.nos)).toBe(
      "SEM RG, Corretor, inscrito no CPF sob o nº 111.222.333-44, residente",
    );
    expect(r.semValor).not.toContain("rg_cliente");
  });

  it("com RG, nada muda: ele continua impresso", () => {
    const r = preencherContrato(qualificacao, {
      compradores: [pessoa("COM RG", "MG-12.345.678 SSP/MG")],
      gerais: {},
    });

    expect(texto(r.nos)).toBe(
      "COM RG, Corretor, portador da cédula de identidade nº MG-12.345.678 SSP/MG e inscrito no CPF sob o nº 111.222.333-44, residente",
    );
  });

  // ⚠️ SEM O ANÚNCIO, O MOTOR NÃO CORTA: a redação é outra, e cortar comeria texto que ele não sabe
  // ler. Fica o colchete, e a prévia avisa — como qualquer variável sem valor.
  it("quando o texto anterior não anuncia o RG, fica o colchete", () => {
    const r = preencherContrato([p(v("nome_cliente"), ", documento ", v("rg_cliente"))], {
      compradores: [pessoa("OUTRA REDACAO")],
      gerais: {},
    });

    expect(texto(r.nos)).toBe("OUTRA REDACAO, documento [rg_cliente]");
    expect(r.semValor).toContain("rg_cliente");
  });

  it("no laço, cada comprador responde pelo seu RG", () => {
    const r = preencherContrato(
      [
        p(
          v("inicio_cada_comprador"),
          v("nome_cliente"),
          ", portador da cédula de identidade nº ",
          v("rg_cliente"),
          " e inscrito no CPF sob o nº ",
          v("cpf_cliente"),
          "; ",
          v("fim_cada_comprador"),
        ),
      ],
      { compradores: [pessoa("PRIMEIRO", "MG-1"), pessoa("SEGUNDO")], gerais: {} },
    );
    const t = texto(r.nos);

    expect(t).toContain("PRIMEIRO, portador da cédula de identidade nº MG-1 e inscrito no CPF");
    expect(t).toContain("SEGUNDO, inscrito no CPF sob o nº 111.222.333-44");
    expect(r.semValor).toEqual([]);
  });
});

// ── O BLOCO CONDICIONAL QUE ATRAVESSA PARÁGRAFOS ─────────────────────────────
//
// Lucas (20/09/2026), com o contrato do Vale do Ouro na mão: *"Está trazendo o conjuge sem ter
// conjuge"*. Na minuta publicada do VOL as seis ocorrências do cônjuge estão certas, cada uma
// entre `[inicio_dados_conjuge]` e `[fim_dados_conjuge]` — medido no banco em 20/09/2026. O que
// falhava era o motor: os pares só eram aplicados DENTRO de um parágrafo, e na área das
// assinaturas o bloco abrange parágrafos inteiros (o marcador é um parágrafo só).
describe("bloco condicional entre parágrafos", () => {
  const assinaturas = () => [
    p("(Assinado eletronicamente)"),
    p(v("nome_cliente")),
    p("COMPROMISSÁRIO(A) COMPRADOR(A)"),
    p(v("inicio_dados_conjuge")),
    p("(Assinado eletronicamente)"),
    p(v("nome_conjuge")),
    p("CÔNJUGE"),
    p(v("fim_dados_conjuge")),
    p("Testemunhas:"),
  ];

  it("⚠️ sem cônjuge, o bloco inteiro some — e não sobra `[nome_conjuge]` no papel", () => {
    const r = preencherContrato(assinaturas(), {
      compradores: [comprador("VITORIA SILVA ARAUJO")],
      gerais: {},
    });

    expect(texto(r.nos)).toBe(
      "(Assinado eletronicamente) VITORIA SILVA ARAUJO COMPROMISSÁRIO(A) COMPRADOR(A) Testemunhas:",
    );
    // E não trava a geração: o que sumiu não pode ser cobrado como variável sem valor.
    expect(r.semValor).not.toContain("nome_conjuge");
  });

  it("com cônjuge, o bloco fica, com o nome no lugar", () => {
    const r = preencherContrato(assinaturas(), {
      compradores: [
        comprador("VITORIA SILVA ARAUJO", {
          temConjuge: true,
          valores: { nome_cliente: "VITORIA SILVA ARAUJO", nome_conjuge: "JOAO ARAUJO" },
        }),
      ],
      gerais: {},
    });

    expect(texto(r.nos)).toBe(
      "(Assinado eletronicamente) VITORIA SILVA ARAUJO COMPROMISSÁRIO(A) COMPRADOR(A) " +
        "(Assinado eletronicamente) JOAO ARAUJO CÔNJUGE Testemunhas:",
    );
  });

  // O laço já é expandido antes dos pares: cada cópia pergunta pelo SEU comprador.
  it("dois compradores, só um casado: o bloco sai uma vez", () => {
    const r = preencherContrato(
      [
        p(v("inicio_cada_comprador")),
        p(v("nome_cliente")),
        p(v("inicio_dados_conjuge")),
        p(v("nome_conjuge")),
        p(v("fim_dados_conjuge")),
        p(v("fim_cada_comprador")),
      ],
      {
        compradores: [
          comprador("SOLTEIRO", { valores: { nome_cliente: "SOLTEIRO" } }),
          comprador("CASADO", {
            temConjuge: true,
            valores: { nome_cliente: "CASADO", nome_conjuge: "ESPOSA" },
          }),
        ],
        gerais: {},
      },
    );

    expect(texto(r.nos)).toBe("SOLTEIRO CASADO ESPOSA");
    expect(r.semValor).not.toContain("nome_conjuge");
  });

  // Par quebrado (abre e não fecha) não pode engolir o resto do contrato: é a mesma rede do laço.
  it("abertura sem fechamento não engole o contrato", () => {
    const r = preencherContrato(
      [p("Antes"), p(v("inicio_dados_conjuge")), p("Depois")],
      { compradores: [comprador("X")], gerais: {} },
    );
    expect(texto(r.nos)).toBe("Antes Depois");
  });
});

// ── OS GERADOS: o que não é texto ────────────────────────────────────────────
//
// `[tabela_geral_pagamentos]` não vira palavra: vira QUADRO. O motor troca o parágrafo inteiro
// pelos nós que o gerador entregou (ver lib/temis/tabela-de-pagamentos.ts).
describe("variáveis geradas (tabelas)", () => {
  const quadro: NoDoDocumento = {
    children: [{ children: [{ children: [{ text: "Mensais" }], type: "td" }], type: "tr" }],
    type: "table",
  };

  it("o parágrafo da variável vira o quadro", () => {
    const r = preencherContrato(
      [p("O preço será pago conforme o quadro:"), p(v("tabela_geral_pagamentos")), p("Segue.")],
      { compradores: [comprador("X")], gerados: { tabela_geral_pagamentos: [quadro] }, gerais: {} },
    );

    expect(texto(r.nos)).toBe("O preço será pago conforme o quadro: Mensais Segue.");
    expect(r.semValor).not.toContain("tabela_geral_pagamentos");
    expect(r.nos.some((no) => no.type === "table")).toBe(true);
  });

  // ⚠️ SEM CRONOGRAMA O QUADRO NÃO EXISTE, e a variável tem de continuar cobrando: é a regra do
  // topo deste arquivo. Some quem escolheu sumir, e o quadro não escolheu.
  it("sem gerado, a variável continua aparecendo e trava a geração", () => {
    const r = preencherContrato([p(v("tabela_geral_pagamentos"))], {
      compradores: [comprador("X")],
      gerais: {},
    });

    expect(texto(r.nos)).toBe("[tabela_geral_pagamentos]");
    expect(r.semValor).toContain("tabela_geral_pagamentos");
  });

  // ⚠️ DENTRO DE CÉLULA É O CAMINHO REAL, E O ÚNICO QUE NÃO ESTAVA MEDIDO. Nas DUAS minutas
  // publicadas que usam a variável (VOL v6 e RVP v2, conferidas em produção em 20/09/2026) ela mora
  // em `table > tr > td > p`, no Quadro-Resumo — nunca num parágrafo solto. Até esta data quem
  // atendia o caso era `dentroDoFilho`, que devolvia os FILHOS do nó gerado no lugar do nó: as
  // `<tr>` do quadro saíam soltas dentro do `<p>`, sem o `<table>` em volta. Exatamente o HTML
  // inválido que a nota desta seção diz estar evitando — e o navegador expulsa a `<tr>` do
  // parágrafo ao imprimir.
  it("dentro de uma célula de tabela, o quadro continua sendo uma TABELA", () => {
    const r = preencherContrato(
      [
        {
          children: [{ children: [{ children: [p(v("tabela_geral_pagamentos"))], type: "td" }], type: "tr" }],
          type: "table",
        } as NoDoDocumento,
      ],
      { compradores: [comprador("X")], gerados: { tabela_geral_pagamentos: [quadro] }, gerais: {} },
    );

    const celula = (r.nos[0]?.children?.[0] as NoDoDocumento | undefined)?.children?.[0] as
      | NoDoDocumento
      | undefined;
    const tabelas = (celula?.children ?? []).filter((f) => (f as NoDoDocumento).type === "table");
    expect(tabelas).toHaveLength(1);
    expect(texto(r.nos)).toContain("Mensais");
  });

  // ⚠️ E A CÉLULA REAL TEM A CLÁUSULA INTEIRA DENTRO, não um parágrafo só. Lida em produção em
  // 20/09/2026, a `<td>` do Quadro-Resumo das duas minutas guarda os parágrafos da cláusula VI em
  // sequência, e o da variável é um deles: `{ text: "" }`, a variável, `{ text: "" }`. O quadro tem
  // de entrar NA POSIÇÃO daquele parágrafo — se ele fosse parar no fim da célula, a tabela sairia
  // depois do 6.2, fora da cláusula que a anuncia.
  it("na célula da cláusula VI, o quadro entra no lugar do parágrafo da variável", () => {
    const celula: NoDoDocumento = {
      children: [
        p("VI - PREÇO, FORMA DE PAGAMENTO E PARCELAMENTO DO PREÇO"),
        p("6.1. PREÇO DO LOTE: R$ 100.000,00"),
        { children: [{ text: "" }, v("tabela_geral_pagamentos"), { text: "" }], type: "p" },
        p("6.2. O pagamento obedecerá ao quadro acima."),
      ],
      type: "td",
    };

    const r = preencherContrato(
      [{ children: [{ children: [celula], type: "tr" }], type: "table" } as NoDoDocumento],
      { compradores: [comprador("X")], gerados: { tabela_geral_pagamentos: [quadro] }, gerais: {} },
    );

    const td = (r.nos[0]?.children?.[0] as NoDoDocumento | undefined)?.children?.[0] as
      | NoDoDocumento
      | undefined;
    expect((td?.children ?? []).map((f) => (f as NoDoDocumento).type)).toEqual([
      "p",
      "p",
      "table",
      "p",
    ]);
    // A `<tr>` não pode acabar dentro do `<p>`: era o que o `map` de `dentroDoFilho` produzia.
    const html = documentoParaHtml(r.nos);
    expect(html).not.toMatch(/<p[^>]*>\s*<tr/);
    expect(html).toContain("<table");
    expect(texto(r.nos)).toContain("Mensais");
    expect(r.semValor).not.toContain("tabela_geral_pagamentos");
  });

  // O quadro no meio de uma frase seria HTML inválido (tabela dentro de parágrafo): o texto ao
  // redor fica, e o quadro entra depois dele.
  it("com texto ao redor, o texto fica e o quadro entra em seguida", () => {
    const r = preencherContrato([p("Quadro: ", v("tabela_geral_pagamentos"), " (parte integrante)")], {
      compradores: [comprador("X")],
      gerados: { tabela_geral_pagamentos: [quadro] },
      gerais: {},
    });

    expect(texto(r.nos)).toBe("Quadro: (parte integrante) Mensais");
  });
});

// ── O QUADRO DENTRO DO QUADRO-RESUMO ─────────────────────────────────────────
//
// ⚠️ NA MINUTA REAL A VARIÁVEL NÃO ESTÁ NA FOLHA: ESTÁ DENTRO DE UMA CÉLULA. Medido em 20/09/2026 na
// VOL-MINUTA-COMPRA-VENDA-NORMAL v6, o Quadro-Resumo inteiro é uma tabela de uma coluna, e o item VI
// é uma célula dela: `table > tr > td > p > [tabela_geral_pagamentos]`.
//
// Lucas, vendo o contrato gerado: *"a tabela está desconfigurando o resto do contrato"*. O quadro
// saía como `<p>` com `<tr>` dentro — linhas de tabela penduradas num parágrafo, dentro da célula do
// Quadro-Resumo. O navegador reaproveita essas linhas na tabela de fora, a grade do Quadro-Resumo
// ganha sete colunas que não são dela e todas as outras seções encolhem.
describe("o quadro dentro de uma célula (o Quadro-Resumo da minuta real)", () => {
  const quadro: NoDoDocumento = {
    children: [{ children: [{ children: [{ text: "Mensais" }], type: "td" }], type: "tr" }],
    type: "table",
  };

  const dentroDaCelula: NoDoDocumento = {
    children: [
      {
        children: [
          {
            children: [p("6.2. PREÇO TOTAL DA AQUISIÇÃO"), p(v("tabela_geral_pagamentos"))],
            type: "td",
          },
        ],
        type: "tr",
      },
    ],
    type: "table",
  };

  it("⚠️ o quadro entra como TABELA irmã na célula, e não como linha solta num parágrafo", () => {
    const r = preencherContrato([dentroDaCelula], {
      compradores: [comprador("X")],
      gerados: { tabela_geral_pagamentos: [quadro] },
      gerais: {},
    });
    const html = documentoParaHtml(r.nos);

    // Nenhum `<tr>` pendurado em parágrafo: é isso que desmonta a grade do Quadro-Resumo.
    expect(html).not.toContain("<p><tr>");
    expect(/<p[^>]*><tr>/.test(html)).toBe(false);
    // O quadro é uma tabela de verdade, dentro da célula, depois do texto da cláusula.
    expect(html).toContain("</p><table");
    expect(texto(r.nos)).toContain("6.2. PREÇO TOTAL DA AQUISIÇÃO");
    expect(texto(r.nos)).toContain("Mensais");
  });
});

// ── O PAR CONDICIONAL DENTRO DA CÉLULA ───────────────────────────────────────
//
// ⚠️ NA MINUTA REAL, DOIS DOS SEIS PARES DO CÔNJUGE ESTÃO DENTRO DA TABELA DO QUADRO-RESUMO. Medido
// em 20/09/2026 no jsonb da VOL-MINUTA-COMPRA-VENDA-NORMAL v6: o nó de topo nº 3 é uma tabela de
// 44 KB e carrega 2 pares `[inicio_dados_conjuge]…[fim_dados_conjuge]`; os outros 4 estão soltos no
// documento. `paresEntreBlocos` percorria só a lista que recebia, então os pares de dentro da célula
// nunca eram resolvidos — e o contrato de uma compradora SOLTEIRA saía com `[nome_conjuge]` e a
// palavra CÔNJUGE impressos na caixa de CIÊNCIA PRÉVIA. Lucas, com o print do contrato gerado:
// *"ainda está aparecendo o nome do conjuge mesmo a pessoa sendo solteira"*.
describe("o par que atravessa parágrafos DENTRO de uma célula", () => {
  const celulaComAssinatura = (): NoDoDocumento => ({
    children: [
      {
        children: [
          {
            children: [
              p("(Assinado eletronicamente)", v("inicio_dados_conjuge")),
              p(v("nome_conjuge")),
              p("CÔNJUGE", v("fim_dados_conjuge")),
            ],
            type: "td",
          },
        ],
        type: "tr",
      },
    ],
    type: "table",
  });

  it("⚠️ comprador SOLTEIRO: o bloco do cônjuge some de dentro da célula", () => {
    const r = preencherContrato([celulaComAssinatura()], {
      compradores: [comprador("VITORIA SILVA ARAUJO")],
      gerais: {},
    });

    // ⚠️ O RÓTULO DA ASSINATURA SOME JUNTO. Nívea, 21/09/2026: *"ainda está saindo a parte do
    // Assinado eletronicamente do conjuge"*. Ele vem ANTES do marcador na minuta, então a regra do
    // "o que está fora fica" o preservava — anunciando a assinatura de quem não existe.
    expect(texto(r.nos)).toBe("");
    expect(texto(r.nos)).not.toContain("CÔNJUGE");
    expect(texto(r.nos)).not.toContain("Assinado");
    expect(r.semValor).not.toContain("nome_conjuge");
  });

  it("comprador CASADO: o bloco do cônjuge fica, na célula onde estava", () => {
    const r = preencherContrato([celulaComAssinatura()], {
      compradores: [
        comprador("VITORIA SILVA ARAUJO", {
          temConjuge: true,
          valores: { nome_cliente: "VITORIA SILVA ARAUJO", nome_conjuge: "JOÃO DA SILVA" },
        }),
      ],
      gerais: {},
    });

    expect(texto(r.nos)).toContain("JOÃO DA SILVA");
    expect(texto(r.nos)).toContain("CÔNJUGE");
    // E continua DENTRO da tabela: o bloco não pode vazar para fora do Quadro-Resumo.
    expect(r.nos.length).toBe(1);
    expect(r.nos[0]?.type).toBe("table");
  });
});

// ── O LAÇO DENTRO DA CÉLULA ──────────────────────────────────────────────────
//
// ⚠️ OS DOIS LAÇOS DE COMPRADOR DA MINUTA REAL TAMBÉM ESTÃO DENTRO DA TABELA. Medido em 20/09/2026
// no jsonb da VOL v6: o nó nº 3 (a tabela do Quadro-Resumo) carrega 2 pares
// `[inicio_cada_comprador]…[fim_cada_comprador]`, e cada um começa num parágrafo e termina em outro,
// dentro da MESMA célula. A descida de `expandirLaco` ia de um filho por vez, então nunca via o
// fechamento no parágrafo vizinho: o par era tratado como quebrado, o laço não rodava e o
// Quadro-Resumo de uma venda com DOIS compradores saía com um comprador só.
describe("o laço que atravessa parágrafos DENTRO de uma célula", () => {
  const celulaComLaco = (): NoDoDocumento => ({
    children: [
      {
        children: [
          {
            children: [
              p(v("inicio_cada_comprador"), v("nome_cliente")),
              p("COMPROMISSÁRIO(A) COMPRADOR(A)", v("fim_cada_comprador")),
            ],
            type: "td",
          },
        ],
        type: "tr",
      },
    ],
    type: "table",
  });

  it("⚠️ dois compradores: os dois aparecem dentro da célula", () => {
    const r = preencherContrato([celulaComLaco()], {
      compradores: [comprador("VITORIA SILVA ARAUJO"), comprador("JOÃO DA SILVA")],
      gerais: {},
    });

    expect(r.vezesDoLaco).toBe(2);
    expect(texto(r.nos)).toContain("VITORIA SILVA ARAUJO");
    expect(texto(r.nos)).toContain("JOÃO DA SILVA");
    // E nenhum marcador sobra impresso no papel.
    expect(texto(r.nos)).not.toContain("cada_comprador");
    expect(r.semValor).not.toContain("fim_cada_comprador");
  });
});

// ── ONDE A DESCIDA NÃO PODE ENTRAR ───────────────────────────────────────────
//
// ⚠️ DESCER DEMAIS ESTRAGA TANTO QUANTO NÃO DESCER. Estes dois casos não existem na minuta do Vale
// do Ouro de hoje, e é justamente por isso que estão travados aqui: são as formas que a primeira
// versão da descida produzia — `<table>` pendurada num parágrafo e quadro solto ao lado da célula —
// e que o navegador desmonta na hora de imprimir.
describe("a descida dos gerados respeita a moldura do documento", () => {
  const quadro: NoDoDocumento = {
    children: [{ children: [{ children: [{ text: "Mensais" }], type: "td" }], type: "tr" }],
    type: "table",
  };

  it("⚠️ variável filha DIRETA da célula: o quadro entra DENTRO dela, não ao lado", () => {
    const celula: NoDoDocumento = {
      children: [
        { children: [{ children: [v("tabela_geral_pagamentos")], type: "td" }], type: "tr" },
      ],
      type: "table",
    };

    const r = preencherContrato([celula], {
      compradores: [comprador("X")],
      gerados: { tabela_geral_pagamentos: [quadro] },
      gerais: {},
    });
    const html = documentoParaHtml(r.nos);

    // Tabela irmã do `<td>` dentro do `<tr>` é HTML inválido: o navegador a joga para fora do
    // quadro inteiro.
    expect(/<\/td><table/.test(html)).toBe(false);
    expect(/<td[^>]*><table/.test(html)).toBe(true);
    expect(texto(r.nos)).toContain("Mensais");
  });

  it("⚠️ variável dentro de um nó de LINHA (link): a descida não entra, e a variável cobra", () => {
    const comLink: NoDoDocumento = {
      children: [{ children: [v("tabela_geral_pagamentos")], type: "a", url: "https://x" }],
      type: "p",
    };

    const r = preencherContrato([comLink], {
      compradores: [comprador("X")],
      gerados: { tabela_geral_pagamentos: [quadro] },
      gerais: {},
    });
    const html = documentoParaHtml(r.nos);

    // `<table>` dentro de `<p>` racha a cláusula em duas na hora de imprimir.
    expect(/<p[^>]*><table/.test(html)).toBe(false);
    expect(texto(r.nos)).toContain("[tabela_geral_pagamentos]");
    expect(r.semValor).toContain("tabela_geral_pagamentos");
  });
});

// ⚠️ CÉLULA QUE ESVAZIOU NÃO PODE SUMIR. Quando o bloco condicional que ocupava a célula inteira é
// desligado (a compradora é solteira), o `<td>` fica sem conteúdo — e apagá-lo tira uma coluna
// daquela linha, desmontando a grade do Quadro-Resumo. Na folha, apagar um parágrafo vazio é
// inofensivo; dentro de uma tabela, não é a mesma coisa.
describe("a poda de vazios não desmonta a grade", () => {
  it("célula que ficou sem conteúdo continua existindo, vazia", () => {
    const linha: NoDoDocumento = {
      children: [
        {
          children: [
            { children: [p("COMPRADOR")], type: "td" },
            { children: [p(v("inicio_dados_conjuge"), v("nome_conjuge"), v("fim_dados_conjuge"))], type: "td" },
          ],
          type: "tr",
        },
      ],
      type: "table",
    };

    const r = preencherContrato([linha], { compradores: [comprador("X")], gerais: {} });
    const html = documentoParaHtml(r.nos);

    expect(texto(r.nos)).not.toContain("nome_conjuge");
    // As duas células continuam lá: a linha não pode encolher.
    expect((html.match(/<td/g) ?? []).length).toBe(2);
  });
});

// ── OS MARCADORES DE MONTAGEM ───────────────────────────────────────────────
//
// `[capa_contrato]`, `[anexos_do_contrato]` e `[anexo_N]` não são variáveis de TEXTO: eles dizem
// ONDE um arquivo entra, e quem põe o arquivo é `montar-pdf-do-contrato.ts`.
//
// ⚠️ ATÉ 21/09/2026 OS TRÊS CAÍAM EM `semValor` E DERRUBAVAM A GERAÇÃO COM 409. E dois deles
// (`capa_contrato` e `anexos_do_contrato`) estão na paleta do editor desde 07/09/2026: um clique
// publicava uma minuta que recusava TODO contrato daquele empreendimento, e a frase do erro
// mandava preencher um cadastro que não tinha o campo.

describe("os marcadores de montagem", () => {
  it("a capa e o curinga saem do texto e NÃO entram em semValor", () => {
    const r = preencherContrato([p(v("capa_contrato"), "TEXTO", v("anexos_do_contrato"))], {
      compradores: [comprador("X")],
      gerais: {},
    });
    expect(texto(r.nos)).toBe("TEXTO");
    expect(r.semValor).toHaveLength(0);
    expect(r.marcadores).toEqual(["anexos_do_contrato", "capa_contrato"]);
  });

  it("[anexo_2] no meio da cláusula fica registrado, e o texto ao redor continua inteiro", () => {
    const r = preencherContrato([p("antes ", v("anexo_2"), " depois")], {
      anexos: { 2: "Memorial descritivo" },
      compradores: [comprador("X")],
      gerais: {},
    });
    expect(texto(r.nos)).toBe("antes depois");
    expect(r.semValor).toHaveLength(0);
    expect(r.marcadores).toEqual(["anexo_2"]);
  });

  it("[anexo_2_nome] continua sendo TEXTO, e não vira marcador", () => {
    const r = preencherContrato([p(v("anexo_2_nome"))], {
      anexos: { 2: "Memorial descritivo" },
      compradores: [comprador("X")],
      gerais: {},
    });
    expect(texto(r.nos)).toBe("Memorial descritivo");
    expect(r.marcadores).toHaveLength(0);
  });

  it("erro de digitação parecido com anexo CONTINUA saltando aos olhos", () => {
    // ⚠️ A FAMÍLIA É FECHADA DE PROPÓSITO. Reconhecer qualquer coisa que comece com "anexo" faria
    // `[anexo_da_planta]` sumir do contrato calado, que é o oposto da decisão deste motor.
    const r = preencherContrato([p(v("anexo_da_planta"), " ", v("anexo_0"))], {
      compradores: [comprador("X")],
      gerais: {},
    });
    expect(texto(r.nos)).toBe("[anexo_da_planta] [anexo_0]");
    expect(r.semValor).toEqual(["anexo_0", "anexo_da_planta"]);
  });
});

// ── O RÓTULO DE ASSINATURA QUE FICAVA ÓRFÃO ──────────────────────────────────
//
// Nívea, 21/09/2026, lendo o contrato de uma compradora solteira: *"ainda está saindo a parte do
// Assinado eletronicamente do conjuge. Saiu a parte do conjuge."* Na minuta do Vale do Ouro o fecho
// é `<p>(Assinado eletronicamente)[inicio_dados_conjuge]</p>`: o rótulo está FORA do marcador, e a
// regra geral — o que está fora do bloco é texto do contrato — o preservava.
// ⚠️ A FOLHA EM BRANCO NO FIM DO CONTRATO. Medido no PDF do Vale do Ouro em 22/09/2026: 33
// páginas, e a última com stream vazio. A minuta termina com uma quebra de página seguida do bloco
// do anexo; sem anexo cadastrado o bloco cai e a quebra fica.
describe("a quebra de página que ficou sem nada depois", () => {
  const quebra = (): NoDoDocumento => ({ children: [{ text: "" }], type: "quebra_pagina" });

  it("⚠️ bloco que cai no fim leva a quebra de página junto", () => {
    const r = preencherContrato(
      [
        p("CLÁUSULA FINAL"),
        quebra(),
        p(v("inicio_tem_anexo_1"), v("anexo_1_nome"), v("fim_tem_anexo_1")),
      ],
      { compradores: [comprador("VITORIA")], gerais: {} },
    );

    expect(r.nos.map((n) => n.type)).toEqual(["p"]);
  });

  it("duas quebras coladas viram uma: o que morava entre elas caiu", () => {
    const r = preencherContrato(
      [
        p("ANTES"),
        quebra(),
        p(v("inicio_tem_anexo_1"), v("anexo_1_nome"), v("fim_tem_anexo_1")),
        quebra(),
        p("DEPOIS"),
      ],
      { compradores: [comprador("VITORIA")], gerais: {} },
    );

    expect(r.nos.map((n) => n.type)).toEqual(["p", "quebra_pagina", "p"]);
  });

  it("a quebra que separa conteúdo NÃO se toca: ela é diagramação", () => {
    const r = preencherContrato([p("PRIMEIRA"), quebra(), p("SEGUNDA")], {
      compradores: [comprador("VITORIA")],
      gerais: {},
    });

    expect(r.nos.map((n) => n.type)).toEqual(["p", "quebra_pagina", "p"]);
  });
});

describe("o rótulo de assinatura de quem não assina", () => {
  // ⚠️ O CASO DA MINUTA REAL DO VOL, e o que faltava: o par INTEIRO cabe num parágrafo só. Medido em
  // 22/09/2026 na VOL-MINUTA-COMPRA-VENDA-NORMAL v7 (parágrafos 115, 260 e 277, idênticos):
  //
  //     (Assinado eletronicamente)[inicio_dados_conjuge][nome_conjuge] CONJUGE[fim_dados_conjuge][fim_cada_comprador]
  //
  // A trava do rótulo só existia no caminho que ATRAVESSA parágrafos, então este corte passava por
  // outra função e o rótulo ficava na página. Nívea, 22/09/2026, com o print: *"Continua saindo o
  // (Assinado eletronicamente) depois do comprador. Está iniciando o conjuge"*.
  it("⚠️ solteiro: o par no MESMO parágrafo também leva o rótulo embora", () => {
    const r = preencherContrato(
      [
        p(
          "(Assinado eletronicamente) ",
          v("inicio_cada_comprador"),
          v("nome_cliente"),
          " COMPROMISSÁRIO(A) COMPRADOR(A)",
        ),
        p(
          "(Assinado eletronicamente)",
          v("inicio_dados_conjuge"),
          v("nome_conjuge"),
          " CONJUGE",
          v("fim_dados_conjuge"),
          v("fim_cada_comprador"),
        ),
        p("Testemunhas:"),
      ],
      { compradores: [comprador("VITORIA SILVA ARAUJO")], gerais: {} },
    );

    // O rótulo do COMPRADOR fica: ele assina. O do cônjuge some com o bloco.
    expect(texto(r.nos)).toBe(
      "(Assinado eletronicamente) VITORIA SILVA ARAUJO COMPROMISSÁRIO(A) COMPRADOR(A) Testemunhas:",
    );
    expect(texto(r.nos)).not.toContain("CONJUGE");
  });

  it("casado: no mesmo parágrafo, o rótulo e o cônjuge ficam", () => {
    const r = preencherContrato(
      [
        p(
          "(Assinado eletronicamente)",
          v("inicio_dados_conjuge"),
          v("nome_conjuge"),
          " CONJUGE",
          v("fim_dados_conjuge"),
        ),
      ],
      {
        compradores: [
          comprador("VITORIA", {
            temConjuge: true,
            valores: { nome_cliente: "VITORIA", nome_conjuge: "JOÃO DA SILVA" },
          }),
        ],
        gerais: {},
      },
    );

    // Sem espaço entre o rótulo e o nome porque a minuta real não tem: o marcador encosta no texto.
    expect(texto(r.nos)).toBe("(Assinado eletronicamente)JOÃO DA SILVA CONJUGE");
  });

  // ⚠️ A REGRA NÃO PODE ALARGAR: texto que NÃO é só o rótulo fica onde está, mesmo colado ao bloco
  // que caiu. Apagar aqui seria comer cláusula do contrato.
  it("texto comum antes do bloco que cai NÃO é apagado", () => {
    const r = preencherContrato(
      [p("O comprador declara que ", v("inicio_dados_conjuge"), "tem cônjuge", v("fim_dados_conjuge"))],
      { compradores: [comprador("VITORIA")], gerais: {} },
    );

    expect(texto(r.nos)).toBe("O comprador declara que");
  });

  it("⚠️ solteiro: some o bloco do cônjuge E o '(Assinado eletronicamente)' dele", () => {
    const r = preencherContrato(
      [
        p("COMPROMISSÁRIO(A) COMPRADOR(A)"),
        p("(Assinado eletronicamente)", v("inicio_dados_conjuge")),
        p(v("nome_conjuge")),
        p("CÔNJUGE", v("fim_dados_conjuge")),
      ],
      { compradores: [comprador("VITORIA")], gerais: {} },
    );

    expect(texto(r.nos)).toBe("COMPROMISSÁRIO(A) COMPRADOR(A)");
  });

  it("casado: o rótulo e o cônjuge ficam", () => {
    const r = preencherContrato(
      [
        p("(Assinado eletronicamente)", v("inicio_dados_conjuge")),
        p(v("nome_conjuge")),
        p("CÔNJUGE", v("fim_dados_conjuge")),
      ],
      {
        compradores: [
          comprador("VITORIA", {
            temConjuge: true,
            valores: { nome_cliente: "VITORIA", nome_conjuge: "JOÃO" },
          }),
        ],
        gerais: {},
      },
    );

    expect(texto(r.nos)).toBe("(Assinado eletronicamente) JOÃO CÔNJUGE");
  });

  // ⚠️ A REGRA NÃO PODE COMER A ASSINATURA DE QUEM ASSINA. No mesmo fecho, o rótulo do COMPRADOR
  // vem antes do laço e do `[inicio_dados_cliente_pf]`, com o nome logo em seguida no mesmo
  // parágrafo — ali o pedaço tem variável e nunca é tratado como rótulo solto.
  it("texto com variável junto não é rótulo solto", () => {
    const r = preencherContrato(
      [
        p("(Assinado eletronicamente) ", v("nome_cliente"), v("inicio_dados_conjuge")),
        p("CÔNJUGE", v("fim_dados_conjuge")),
      ],
      { compradores: [comprador("VITORIA SILVA")], gerais: {} },
    );

    expect(texto(r.nos)).toContain("(Assinado eletronicamente)");
    expect(texto(r.nos)).toContain("VITORIA SILVA");
    expect(texto(r.nos)).not.toContain("CÔNJUGE");
  });
});

describe("a unidade de área não sai duas vezes", () => {
  // O caso real: VOL Q11 L07, 22/09/2026. A minuta escrevia "[area_lote] m²" e `area_lote` já vem
  // com o "m²", então o papel saiu com "área de 365,09 m² m²".
  it("apara o m² que a minuta repete depois da variável", () => {
    const r = preencherContrato([p("com área de ", v("area_lote"), " m² (trezentos).")], {
      compradores: [],
      gerais: { area_lote: "365,09 m²" },
    });
    expect(texto(r.nos)).toBe("com área de 365,09 m² (trezentos).");
  });

  it("apara o 'metros quadrados' repetido depois do extenso", () => {
    const r = preencherContrato([p("(", v("area_lote_extenso"), " metros quadrados)")], {
      compradores: [],
      gerais: {
        area_lote_extenso: "trezentos e sessenta e cinco metros quadrados e nove decímetros quadrados",
      },
    });
    expect(texto(r.nos)).toBe(
      "(trezentos e sessenta e cinco metros quadrados e nove decímetros quadrados)",
    );
  });

  it("não mexe quando a minuta NÃO repete", () => {
    const r = preencherContrato([p("com área de ", v("area_lote"), ", integrante do bairro.")], {
      compradores: [],
      gerais: { area_lote: "365,09 m²" },
    });
    expect(texto(r.nos)).toBe("com área de 365,09 m², integrante do bairro.");
  });

  it("não come o m² que vem depois de uma variável que NÃO é de área", () => {
    const r = preencherContrato([p("R$ ", v("preco_do_metro"), " m² de terreno.")], {
      compradores: [],
      gerais: { preco_do_metro: "366,00" },
    });
    expect(texto(r.nos)).toBe("R$ 366,00 m² de terreno.");
  });
});
