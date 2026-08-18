import { describe, expect, it } from "vitest";

import type { LinhaAssinatura } from "@/lib/apolo/painel-assinatura";

import { montarQuadroDeAssinaturas, type ContratoVivo } from "./assinaturas";

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

  it("a lista de pendentes diz QUEM está na vez naquele contrato", () => {
    expect(quadro.pendentes).toHaveLength(1);
    expect(quadro.pendentes[0]).toMatchObject({ empreendimento: "VAL", unidade: "VALB0218" });
    expect(quadro.pendentes[0]!.naVez.sort()).toEqual(["Corretor C", "Imob B"]);
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
      { arId: 1, geradoEm: "2026-06-01T00:00:00.000Z" },
      { arId: 2, geradoEm: null },
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
    expect(quadro.pendentes).toHaveLength(0);
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
      [
        { arId: 1, geradoEm: null },
        { arId: 2, geradoEm: null },
      ],
      new Map([[10, 1]]),
    );

    expect(quadro.kpis.aguardandoEmissao).toBe(1);
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
      [{ arId: 1, geradoEm: null }],
      // O envio 10 (do ar 1) EXISTE e foi escolhido — só não tem linha de assinante.
      new Map([[10, 1]]),
      [{ emp: "VAL", enviadoEm: "2026-06-01", un: "VALB0218" }],
    );

    expect(quadro.kpis.aguardandoEmissao).toBe(0);
    expect(quadro.kpis.unidadesComEnvio).toBe(1);
    expect(quadro.kpis.unidadesTotalmenteAssinadas).toBe(0);
    // `naVez` vazio: a tela mostra "sem assinante registrado" no lugar dos nomes.
    expect(quadro.pendentes).toEqual([
      { empreendimento: "VAL", enviadoEm: "2026-06-01", naVez: [], unidade: "VALB0218" },
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
      [{ emp: "VAL", enviadoEm: "2026-07-01", un: "VALB0218" }],
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

describe("a lista de contratos pendentes", () => {
  it("vem do mais antigo para o mais novo: é onde o gargalo dói há mais tempo", () => {
    const linhas = [
      linha({ contrato: 10, envio: "2026-07-01", un: "VALB0218" }),
      linha({ contrato: 20, envio: "2026-05-01", un: "VALC0301", usuario: "Comprador B" }),
    ];
    const quadro = montarQuadroDeAssinaturas(
      linhas,
      [],
      new Map([
        [10, 1],
        [20, 2],
      ]),
    );

    expect(quadro.pendentes.map((pendente) => pendente.unidade)).toEqual([
      "VALC0301",
      "VALB0218",
    ]);
  });
});
