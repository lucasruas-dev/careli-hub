import { describe, expect, it } from "vitest";

import type { LinhaAssinatura } from "@/lib/apolo/painel-assinatura";

import {
  montarQuadroDeAssinaturas,
  type ContratoVivo,
  type FichaDoContratoVivo,
} from "./assinaturas";

// A RÉGUA REAL, medida no C2X em 18/08/2026 no VAL (Vista Alegre, o portal de teste): 39
// contratos vivos com envio válido, TODOS 100% assinados; 61 linhas de Comprador, 61 assinadas
// (100%); 0 aguardando emissão; tempo médio geração→última assinatura de 9,9 dias (n=13, só 13
// têm a geração no histórico); fila (`is_to_use_position_to_sign`) DESLIGADA no VAL — o único
// empreendimento que assina em fila de verdade é o Vale do Ouro.
//
// A regra de "assinado / vez / aguardando" NÃO é reimplementada aqui: `montarQuadroDeAssinaturas`
// importa `marcarSituacao` do painel interno, e estes testes provam que o quadro RESPEITA a fila
// (o caso Northon: contar toda pendência como "dele" cobrava a pessoa errada).

function linha(sobrescreve: Partial<LinhaAssinatura> = {}): LinhaAssinatura {
  return {
    assinadoEm: null,
    assinou: false,
    contrato: 10,
    degrau: 1,
    diasDesdeEnvio: 5,
    email: "",
    emp: "VAL",
    envio: "2026-06-01",
    lote: "L18",
    perfil: "Comprador",
    prazo: null,
    quadra: "B02",
    situacao: "aguardando",
    un: "VALB0218",
    usuario: "Fulano",
    valor: 89900,
    ...sobrescreve,
  };
}

/**
 * Um contrato vivo do escopo. Desde a fusão de 18/08/2026 ele carrega TUDO o que a visão Contratos
 * antiga mostrava (valor, imobiliária, geração, faturamento e o unitId do PDF), e é por ele que
 * esses dados chegam na linha da lista.
 */
function vivo(
  sobrescreve: Omit<Partial<ContratoVivo>, "ficha"> & { ficha?: Partial<FichaDoContratoVivo> } = {},
): ContratoVivo {
  const { ficha, ...resto } = sobrescreve;

  return {
    arId: 1,
    ficha: {
      comprador: "Fulano de Tal",
      empreendimento: "VAL",
      faturadoEm: null,
      imobiliaria: "Imobiliária X",
      temContrato: true,
      unidade: "VALB0218",
      unitId: 100,
      valorTabela: 89900,
      ...ficha,
    },
    geradoEm: null,
    ...resto,
  };
}

describe("o quadro por assinante respeita a ORDEM da fila (regra do painel interno, importada)", () => {
  // Um contrato com 4 degraus: 1 assinou; os DOIS do degrau 2 estão na vez (degrau dividido
  // assina em paralelo); o degrau 3 aguarda os anteriores.
  const linhas = [
    linha({ assinadoEm: "2026-06-03", assinou: true, degrau: 1, usuario: "Comprador A" }),
    linha({ degrau: 2, perfil: "Imobiliária", usuario: "Imob B" }),
    linha({ degrau: 2, perfil: "Corretor", usuario: "Corretor C" }),
    linha({ degrau: 3, perfil: "Incorporador", usuario: "Incorporador D" }),
  ];
  const quadro = montarQuadroDeAssinaturas(linhas, [], new Map([[10, 1]]));

  it("quem já assinou conta em 'assinou'", () => {
    const compradorA = quadro.assinantes.find((assinante) => assinante.nome === "Comprador A");
    expect(compradorA).toMatchObject({ aguardandoAnteriores: 0, assinou: 1, naVez: 0 });
  });

  it("⚠️ os dois do degrau da frente estão NA VEZ; o de trás aguarda (não é pendência dele)", () => {
    const imobB = quadro.assinantes.find((assinante) => assinante.nome === "Imob B");
    const corretorC = quadro.assinantes.find((assinante) => assinante.nome === "Corretor C");
    const incorporadorD = quadro.assinantes.find((assinante) => assinante.nome === "Incorporador D");

    expect(imobB).toMatchObject({ naVez: 1 });
    expect(corretorC).toMatchObject({ naVez: 1 });
    expect(incorporadorD).toMatchObject({ aguardandoAnteriores: 1, naVez: 0 });
  });

  it("quem tem contrato na vez vem primeiro no quadro: ele é o gargalo", () => {
    expect(quadro.assinantes[0]!.naVez).toBeGreaterThan(0);
  });

  it("a lista de unidades diz QUEM está na vez naquele contrato", () => {
    expect(quadro.unidades).toHaveLength(1);
    expect(quadro.unidades[0]).toMatchObject({
      assinadas: 1,
      concluida: false,
      empreendimento: "VAL",
      total: 4,
      unidade: "VALB0218",
    });
    expect(quadro.unidades[0]!.naVez.sort()).toEqual(["Corretor C", "Imob B"]);
  });

  it("⚠️ os PERFIS na vez são o recorte da pílula: é por eles que o dono filtra o que está parado", () => {
    expect(quadro.unidades[0]!.perfisNaVez).toEqual(["Corretor", "Imobiliária"]);
  });

  it("papel do assinante é o perfil traduzido", () => {
    const imobB = quadro.assinantes.find((assinante) => assinante.nome === "Imob B");
    expect(imobB?.papel).toBe("Imobiliária");
  });
});

describe("os KPIs", () => {
  it("⚠️ o cenário do VAL: tudo assinado dá 100% de compradores e zero pendente", () => {
    // Miniatura do VAL medido: contratos completos, compradores 100%, nada aguardando emissão.
    const linhas = [
      linha({ assinadoEm: "2026-06-05", assinou: true, contrato: 10, usuario: "Comprador A" }),
      linha({
        assinadoEm: "2026-06-11",
        assinou: true,
        contrato: 10,
        degrau: 2,
        perfil: "Incorporador",
        usuario: "Incorporador D",
      }),
      linha({
        assinadoEm: "2026-07-02",
        assinou: true,
        contrato: 20,
        un: "VALC0301",
        usuario: "Comprador B",
      }),
    ];
    const vivos: ContratoVivo[] = [
      vivo({ arId: 1, geradoEm: "2026-06-01T00:00:00.000Z" }),
      vivo({ arId: 2, ficha: { unidade: "VALC0301", unitId: 101 } }),
    ];
    const quadro = montarQuadroDeAssinaturas(
      linhas,
      vivos,
      new Map([
        [10, 1],
        [20, 2],
      ]),
    );

    expect(quadro.kpis.pctCompradoresAssinaram).toBe(100);
    expect(quadro.kpis.unidadesTotalmenteAssinadas).toBe(2);
    expect(quadro.kpis.unidadesComEnvio).toBe(2);
    expect(quadro.kpis.aguardandoEmissao).toBe(0);
    // Tempo médio = geração (01/06) até a ÚLTIMA assinatura do contrato (11/06) = 10 dias.
    // O contrato 20 fica FORA da média: sem geração no histórico (26 dos 39 do VAL são assim),
    // chutar a data mentiria o número.
    expect(quadro.kpis.tempoMedioDias).toBe(10);
    // Nada pendente: as duas unidades entram na lista, as duas concluídas.
    expect(quadro.unidades).toHaveLength(2);
    expect(quadro.unidades.every((unidade) => unidade.concluida)).toBe(true);
  });

  it("% de compradores conta LINHAS de comprador (cônjuge tem linha própria), e só elas", () => {
    const linhas = [
      linha({ assinadoEm: "2026-06-02", assinou: true, usuario: "Titular" }),
      linha({ usuario: "Cônjuge" }),
      // A imobiliária pendente não entra na conta dos compradores.
      linha({ degrau: 2, perfil: "Imobiliária", usuario: "Imob B" }),
    ];
    const quadro = montarQuadroDeAssinaturas(linhas, [], new Map([[10, 1]]));

    expect(quadro.kpis.pctCompradoresAssinaram).toBe(50);
  });

  it("sem comprador no escopo, o percentual é nulo, não 0 nem 100", () => {
    const quadro = montarQuadroDeAssinaturas(
      [linha({ perfil: "Imobiliária", usuario: "Imob B" })],
      [],
      new Map([[10, 1]]),
    );

    expect(quadro.kpis.pctCompradoresAssinaram).toBeNull();
  });

  it("contrato vivo SEM envio válido conta como aguardando emissão", () => {
    // O contrato 10 (ar 1) tem envio; o ar 2 é vivo e nunca saiu para a D4Sign.
    const quadro = montarQuadroDeAssinaturas(
      [linha({ assinadoEm: "2026-06-02", assinou: true })],
      [vivo({ arId: 1 }), vivo({ arId: 2, ficha: { unidade: "VALC0301", unitId: 101 } })],
      new Map([[10, 1]]),
    );

    expect(quadro.kpis.aguardandoEmissao).toBe(1);
  });

  it("⚠️ o contrato que ainda não saiu para assinar é LINHA da lista, não só um KPI (fusão 18/08)", () => {
    // A visão Contratos antiga mostrava esta venda com o chip "Aguardando emissão", com valor,
    // imobiliária e faturamento. Some-la num contador perderia tudo isso.
    const quadro = montarQuadroDeAssinaturas(
      [linha({ assinadoEm: "2026-06-02", assinou: true })],
      [
        vivo({ arId: 1 }),
        vivo({
          arId: 2,
          ficha: {
            faturadoEm: "2026-07-20",
            imobiliaria: "Imobiliária Y",
            temContrato: false,
            unidade: "VALC0301",
            unitId: 101,
            valorTabela: 123456,
          },
          geradoEm: "2026-07-01T12:00:00.000Z",
        }),
      ],
      new Map([[10, 1]]),
    );

    const semEnvio = quadro.unidades.find((unidade) => unidade.unidade === "VALC0301");

    expect(semEnvio).toMatchObject({
      // Sem envio não há esquema nem barrinha: a linha vive dos dados do contrato.
      enviadoEm: "",
      envioId: 0,
      esquema: [],
      grupos: [],
      situacao: "aguardando-emissao",
      total: 0,
    });
    expect(semEnvio?.contrato).toEqual({
      faturadoEm: "2026-07-20",
      geradoEm: "2026-07-01T12:00:00.000Z",
      imobiliaria: "Imobiliária Y",
      temContrato: false,
      unitId: 101,
      valorTabela: 123456,
    });
    // Ele NÃO conta como unidade com envio: esse KPI continua sendo o que saiu para a D4Sign.
    expect(quadro.kpis.unidadesComEnvio).toBe(1);
  });

  it("os dados do contrato descem na linha do envio, pelo ar_id (valor, imobiliária, PDF)", () => {
    const quadro = montarQuadroDeAssinaturas(
      [linha({ assinadoEm: "2026-06-02", assinou: true })],
      [vivo({ arId: 1, ficha: { faturadoEm: "2026-06-30", temContrato: true, unitId: 100 } })],
      new Map([[10, 1]]),
    );

    expect(quadro.unidades[0]).toMatchObject({ situacao: "assinado" });
    expect(quadro.unidades[0]!.contrato).toMatchObject({
      faturadoEm: "2026-06-30",
      imobiliaria: "Imobiliária X",
      temContrato: true,
      unitId: 100,
      valorTabela: 89900,
    });
  });

  it("⚠️ envio de proposta que não é mais a viva da unidade vem SEM dados de contrato", () => {
    // Distrato/revenda: o envio segue vivo no C2X, mas não há contrato vigente por trás dele —
    // então nada de valor, imobiliária ou botão de PDF apontando para o lugar errado.
    const quadro = montarQuadroDeAssinaturas(
      [linha()],
      [],
      new Map([[10, 1]]),
    );

    expect(quadro.unidades[0]!.contrato).toBeNull();
    expect(quadro.unidades[0]!.situacao).toBe("em-assinatura");
  });

  it("⚠️ unidade com um contrato assinado e outro pendente NÃO conta como 100% assinada", () => {
    const linhas = [
      linha({ assinadoEm: "2026-06-02", assinou: true, contrato: 10 }),
      // Mesma unidade, outro contrato (revenda), ainda pendente.
      linha({ contrato: 20, usuario: "Comprador Novo" }),
    ];
    const quadro = montarQuadroDeAssinaturas(
      linhas,
      [],
      new Map([
        [10, 1],
        [20, 2],
      ]),
    );

    expect(quadro.kpis.unidadesComEnvio).toBe(1);
    expect(quadro.kpis.unidadesTotalmenteAssinadas).toBe(0);
  });
});

describe("envio válido sem NENHUM assinante registrado (o furo do join interno)", () => {
  it("⚠️ entra como pendente 'sem assinante' e NÃO cai em aguardando emissão: a aba Contratos mostra o mesmo envio como Em assinatura", () => {
    const quadro = montarQuadroDeAssinaturas(
      [],
      [vivo({ arId: 1 })],
      // O envio 10 (do ar 1) EXISTE e foi escolhido — só não tem linha de assinante.
      new Map([[10, 1]]),
      [{ csId: 10, emp: "VAL", enviadoEm: "2026-06-01", un: "VALB0218" }],
    );

    expect(quadro.kpis.aguardandoEmissao).toBe(0);
    expect(quadro.kpis.unidadesComEnvio).toBe(1);
    expect(quadro.kpis.unidadesTotalmenteAssinadas).toBe(0);
    // Esquema e grupos vazios: a tela mostra "sem assinante registrado" no lugar das barrinhas.
    expect(quadro.unidades).toEqual([
      {
        assinadas: 0,
        comprador: null,
        concluida: false,
        contrato: {
          faturadoEm: null,
          geradoEm: null,
          imobiliaria: "Imobiliária X",
          temContrato: true,
          unitId: 100,
          valorTabela: 89900,
        },
        empreendimento: "VAL",
        enviadoEm: "2026-06-01",
        envioId: 10,
        esquema: [],
        grupos: [],
        naVez: [],
        perfisNaVez: [],
        // O envio saiu: é "em assinatura", não "aguardando emissão" (a régua da visão antiga).
        situacao: "em-assinatura",
        total: 0,
        unidade: "VALB0218",
      },
    ]);
  });

  it("um envio vazio na unidade segura o 100% dela, mesmo com outro contrato completo", () => {
    const quadro = montarQuadroDeAssinaturas(
      [linha({ assinadoEm: "2026-06-02", assinou: true, contrato: 10 })],
      [],
      new Map([
        [10, 1],
        [20, 2],
      ]),
      [{ csId: 20, emp: "VAL", enviadoEm: "2026-07-01", un: "VALB0218" }],
    );

    expect(quadro.kpis.unidadesComEnvio).toBe(1);
    expect(quadro.kpis.unidadesTotalmenteAssinadas).toBe(0);
  });
});

describe("unidades homônimas de empreendimentos diferentes (recorte 'todos')", () => {
  it("⚠️ não colidem nos KPIs de unidade: a chave é empreendimento + unidade", () => {
    // Dois loteamentos batizaram a unidade com o MESMO nome; uma está completa, a outra não.
    const linhas = [
      linha({ assinadoEm: "2026-06-02", assinou: true, contrato: 10, emp: "VAL", un: "B0218" }),
      linha({ contrato: 20, emp: "GDN", un: "B0218", usuario: "Comprador B" }),
    ];
    const quadro = montarQuadroDeAssinaturas(
      linhas,
      [],
      new Map([
        [10, 1],
        [20, 2],
      ]),
    );

    // Chaveado só pelo nome, seria 1 unidade com envio e 0 assinadas — a pendente do GDN
    // seguraria a homônima do VAL.
    expect(quadro.kpis.unidadesComEnvio).toBe(2);
    expect(quadro.kpis.unidadesTotalmenteAssinadas).toBe(1);
  });
});

describe("a ordem da lista analítica", () => {
  it("pendente antes de concluída, e a pendente mais antiga primeiro: é onde o gargalo dói há mais tempo", () => {
    const linhas = [
      linha({ contrato: 10, envio: "2026-07-01", un: "VALB0218" }),
      linha({ contrato: 20, envio: "2026-05-01", un: "VALC0301", usuario: "Comprador B" }),
      // Concluída, e a mais antiga de todas: ainda assim vai para o fim.
      linha({
        assinadoEm: "2026-04-10",
        assinou: true,
        contrato: 30,
        envio: "2026-04-01",
        un: "VALD0402",
        usuario: "Comprador C",
      }),
    ];
    const quadro = montarQuadroDeAssinaturas(
      linhas,
      [],
      new Map([
        [10, 1],
        [20, 2],
        [30, 3],
      ]),
    );

    expect(quadro.unidades.map((unidade) => unidade.unidade)).toEqual([
      "VALC0301",
      "VALB0218",
      "VALD0402",
    ]);
  });
});

// ── AS PEÇAS DO REDESENHO DE 18/08/2026 ─────────────────────────────────────
// A pergunta da tela virou POR UNIDADE (*"eu não sei o status de assinatura das unidades"*), com
// barrinha por grupo na linha e a tabela do esquema no popup. Os testes abaixo fixam o que a tela
// desenha: os grupos, as taxas por perfil, a fila por ordem e a régua de atraso do comprador.

describe("as barrinhas por GRUPO da unidade", () => {
  // Um contrato do Vale do Ouro em miniatura: comprador e cônjuge no degrau 1 (um assinou), a
  // imobiliária no 2 (a vez é dela) e o incorporador no 3 (ainda aguarda).
  const linhas = [
    linha({ assinadoEm: "2026-06-03", assinou: true, degrau: 1, usuario: "Titular" }),
    linha({ degrau: 1, usuario: "Cônjuge" }),
    linha({ degrau: 2, perfil: "Imobiliária", usuario: "Imob B" }),
    linha({ degrau: 3, perfil: "Incorporador", usuario: "Incorporador D" }),
  ];
  const quadro = montarQuadroDeAssinaturas(linhas, [], new Map([[10, 1]]));
  const unidade = quadro.unidades[0]!;

  it("um grupo por perfil PRESENTE no contrato, na ordem do fluxo", () => {
    expect(unidade.grupos.map((grupo) => grupo.perfil)).toEqual([
      "Comprador",
      "Imobiliária",
      "Incorporador",
    ]);
  });

  it("a fração de cada grupo é a daquele contrato ('1 de 2' no comprador)", () => {
    expect(unidade.grupos[0]).toEqual({
      assinadas: 1,
      naVez: true,
      perfil: "Comprador",
      total: 2,
    });
  });

  it("⚠️ só o grupo da VEZ fica marcado: quem aguarda os anteriores não é cobrado", () => {
    expect(unidade.grupos.map((grupo) => grupo.naVez)).toEqual([true, false, false]);
  });

  it("⚠️ a soma dos grupos FECHA com o total da linha: ninguém some da conta", () => {
    const soma = unidade.grupos.reduce((total, grupo) => total + grupo.total, 0);
    const assinadas = unidade.grupos.reduce((total, grupo) => total + grupo.assinadas, 0);

    expect(soma).toBe(unidade.total);
    expect(assinadas).toBe(unidade.assinadas);
  });

  it("o comprador da linha sai das próprias assinaturas, sem consulta nova", () => {
    expect(unidade.comprador).toBe("Titular, Cônjuge");
  });

  it("o esquema do popup vem na ordem do fluxo, com a data de quem assinou", () => {
    expect(unidade.esquema.map((item) => [item.nome, item.situacao, item.assinadoEm])).toEqual([
      ["Titular", "assinado", "2026-06-03"],
      ["Cônjuge", "vez", null],
      ["Imob B", "aguardando", null],
      ["Incorporador D", "aguardando", null],
    ]);
  });
});

describe("as taxas por perfil (os cards de gargalo)", () => {
  const linhas = [
    linha({ assinadoEm: "2026-06-03", assinou: true, usuario: "Titular" }),
    linha({ assinadoEm: "2026-06-03", assinou: true, contrato: 20, usuario: "Comprador B" }),
    linha({ degrau: 2, perfil: "Backoffice", usuario: "Careli 1" }),
    linha({ contrato: 20, degrau: 2, perfil: "Backoffice", usuario: "Careli 1" }),
    linha({
      assinadoEm: "2026-06-04",
      assinou: true,
      degrau: 3,
      perfil: "Imobiliária",
      usuario: "Imob B",
    }),
  ];
  const quadro = montarQuadroDeAssinaturas(
    linhas,
    [],
    new Map([
      [10, 1],
      [20, 2],
    ]),
  );

  it("⚠️ o PIOR vem primeiro: a faixa existe para dizer em qual elo emperra", () => {
    expect(quadro.taxas.map((taxa) => taxa.perfil)).toEqual([
      "Backoffice",
      "Comprador",
      "Imobiliária",
    ]);
  });

  it("a taxa é assinadas sobre esperadas daquele perfil no recorte inteiro", () => {
    expect(quadro.taxas[0]).toEqual({ assinadas: 0, esperadas: 2, perfil: "Backoffice" });
    expect(quadro.taxas[1]).toEqual({ assinadas: 2, esperadas: 2, perfil: "Comprador" });
  });

  it("⚠️ os rótulos são os de `perfilDeTela`, sem grupo inventado por cima", () => {
    // Backoffice é o e-mail @careli.adm.br do painel interno, não um rótulo novo desta tela.
    expect(quadro.taxas.map((taxa) => taxa.perfil)).not.toContain("Careli");
  });
});

describe("a fila por ordem de assinatura", () => {
  it("⚠️ recorte SEM ordem (todo mundo no degrau 0) não desenha fila nenhuma", () => {
    // Metade dos empreendimentos assina com `after_position` = 0 para todos (medido no C2X em
    // 18/08/2026: VAL, LBF e LBP). "Degrau 0: 3 de 3" seria uma seção repetindo o KPI geral.
    const quadro = montarQuadroDeAssinaturas(
      [
        linha({ degrau: 0, usuario: "Titular" }),
        linha({ degrau: 0, perfil: "Imobiliária", usuario: "Imob B" }),
      ],
      [],
      new Map([[10, 1]]),
    );

    expect(quadro.fila).toEqual([]);
  });

  it("com ordem de verdade, cada degrau traz a fração e OS PERFIS que assinam nele", () => {
    const quadro = montarQuadroDeAssinaturas(
      [
        linha({ assinadoEm: "2026-06-02", assinou: true, degrau: 1, usuario: "Titular" }),
        linha({ degrau: 2, perfil: "Imobiliária", usuario: "Imob B" }),
        linha({ degrau: 2, perfil: "Coordenadora de venda", usuario: "Coord C" }),
      ],
      [],
      new Map([[10, 1]]),
    );

    // O rótulo do degrau é DERIVADO: a tabela de nomes fixos do painel interno descreve o Vale do
    // Ouro e mentiria aqui (no LBR o degrau 3 é da Imobiliária, não das testemunhas).
    expect(quadro.fila).toEqual([
      { assinadas: 1, degrau: 1, perfis: ["Comprador"], total: 1 },
      { assinadas: 0, degrau: 2, perfis: ["Coordenadora de venda", "Imobiliária"], total: 2 },
    ]);
  });
});

describe("os KPIs de prazo do comprador (régua de 7 dias, importada do painel)", () => {
  it("⚠️ comprador pendente há mais de 7 dias conta como atraso; dentro do prazo, não", () => {
    const quadro = montarQuadroDeAssinaturas(
      [
        linha({ contrato: 10, diasDesdeEnvio: 12, usuario: "Atrasado" }),
        linha({ contrato: 20, diasDesdeEnvio: 3, un: "VALC0301", usuario: "No prazo" }),
        // Imobiliária parada há 30 dias NÃO entra: o prazo de 7 dias é só do comprador.
        linha({ contrato: 30, diasDesdeEnvio: 30, perfil: "Imobiliária", un: "VALD0402", usuario: "Imob B" }),
      ],
      [],
      new Map([
        [10, 1],
        [20, 2],
        [30, 3],
      ]),
    );

    expect(quadro.kpis.compradorEmAtraso).toBe(1);
  });

  it("dias até assinar é a média do envio até a assinatura do comprador", () => {
    const quadro = montarQuadroDeAssinaturas(
      [
        // 01/06 → 05/06 = 4 dias; 01/06 → 07/06 = 6 dias. Média 5.
        linha({ assinadoEm: "2026-06-05", assinou: true, contrato: 10 }),
        linha({ assinadoEm: "2026-06-07", assinou: true, contrato: 20, un: "VALC0301" }),
      ],
      [],
      new Map([
        [10, 1],
        [20, 2],
      ]),
    );

    expect(quadro.kpis.diasAteAssinar).toBe(5);
  });

  it("⚠️ dias desde o envio é UM valor por contrato, não por linha", () => {
    // Um contrato de 3 assinantes com 10 dias e outro de 1 com 2 dias: média 6, não 8.
    const quadro = montarQuadroDeAssinaturas(
      [
        linha({ contrato: 10, diasDesdeEnvio: 10, usuario: "A" }),
        linha({ contrato: 10, degrau: 2, diasDesdeEnvio: 10, perfil: "Imobiliária", usuario: "B" }),
        linha({ contrato: 10, degrau: 3, diasDesdeEnvio: 10, perfil: "Backoffice", usuario: "C" }),
        linha({ contrato: 20, diasDesdeEnvio: 2, un: "VALC0301", usuario: "D" }),
      ],
      [],
      new Map([
        [10, 1],
        [20, 2],
      ]),
    );

    expect(quadro.kpis.diasDesdeEnvio).toBe(6);
  });

  it("as unidades do comprador batem com o painel: assinada de um lado, pendente do outro", () => {
    const quadro = montarQuadroDeAssinaturas(
      [
        linha({ assinadoEm: "2026-06-02", assinou: true, contrato: 10 }),
        linha({ contrato: 20, un: "VALC0301", usuario: "Comprador B" }),
        // Contrato sem NENHUM comprador não entra em nenhum dos dois lados.
        linha({ contrato: 30, perfil: "Imobiliária", un: "VALD0402", usuario: "Imob B" }),
      ],
      [],
      new Map([
        [10, 1],
        [20, 2],
        [30, 3],
      ]),
    );

    expect(quadro.kpis.compradorOk).toBe(1);
    expect(quadro.kpis.compradorPendente).toBe(1);
  });
});
