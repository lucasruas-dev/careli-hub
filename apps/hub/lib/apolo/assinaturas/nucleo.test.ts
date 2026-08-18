import { describe, expect, it } from "vitest";

import {
  CODES_PADRAO_DO_PAINEL,
  emailsPorNome,
  enriquecerAssinantes,
  enriquecerUnidades,
  montarQuadroDeAssinaturas,
  resolverCodes,
  type ContratoVivo,
  type EmpreendimentoDoFiltro,
  type FichaDoContratoVivo,
  type LinhaAssinatura,
} from "./nucleo";

// O que estes testes protegem é a BORDA INTERNA da tela Contratos do Apolo. O núcleo (fila,
// perfil, prazo, taxas, dados do contrato na linha) já tem os testes do portal e do painel; aqui
// ficam as peças que só a versão interna tem — o e-mail que atravessa, o documento do PDF e a
// validação do empreendimento pedido pela tela.

function linha(
  parcial: Partial<LinhaAssinatura> & { contrato: number; degrau: number },
): LinhaAssinatura {
  return {
    assinadoEm: null,
    assinou: false,
    diasDesdeEnvio: 10,
    email: "assinante@exemplo.com",
    emp: "VOC",
    envio: "2026-08-01",
    lote: "1",
    perfil: "Backoffice",
    prazo: null,
    quadra: "A",
    situacao: "aguardando",
    un: "VOCA1",
    usuario: "Fulano",
    valor: 100,
    ...parcial,
  };
}

/** Um contrato vivo COM ficha: é como a borda interna chama o núcleo (a tela mostra os dados). */
function vivo(
  parcial: Partial<FichaDoContratoVivo> & { arId: number; geradoEm?: null | string },
): ContratoVivo {
  const { arId, geradoEm = "2026-07-25T12:00:00.000Z", ...ficha } = parcial;

  return {
    arId,
    ficha: {
      comprador: "Comprador",
      empreendimento: "VOC",
      faturadoEm: null,
      imobiliaria: "Imob Teste",
      temContrato: false,
      unidade: "VOCA1",
      unitId: 4242,
      valorTabela: 250_000,
      ...ficha,
    },
    geradoEm,
  };
}

const EMPREENDIMENTOS: EmpreendimentoDoFiltro[] = [
  { code: "VLO", contratos: 15, nome: "VALE DO OURO" },
  { code: "VOC", contratos: 93, nome: "VALE DO OURO" },
  { code: "VOL", contratos: 93, nome: "VALE DO OURO" },
  { code: "VOR", contratos: 2, nome: "VALE DO OURO" },
  { code: "VAL", contratos: 39, nome: "VISTA ALEGRE" },
];

describe("resolverCodes", () => {
  it("sem pedido, cai no recorte padrão — o mesmo Vale do Ouro que a tela mostra hoje", () => {
    expect(resolverCodes([], EMPREENDIMENTOS)).toEqual([...CODES_PADRAO_DO_PAINEL].sort());
  });

  it("aceita o que existe e IGNORA o que não existe (allowlist, não filtro cru)", () => {
    expect(resolverCodes(["val", " VOC ", "XXX"], EMPREENDIMENTOS)).toEqual(["VAL", "VOC"]);
    // Só lixo: volta o padrão em vez de consultar um código inventado.
    expect(resolverCodes(["'; drop table --"], EMPREENDIMENTOS)).toEqual(["VOC", "VOL"]);
  });

  it("'*' abre o recorte inteiro", () => {
    expect(resolverCodes(["*"], EMPREENDIMENTOS)).toEqual(["VAL", "VLO", "VOC", "VOL", "VOR"]);
  });

  it("os QUATRO Vale do Ouro continuam quatro: o recorte é por código, nunca por nome", () => {
    // A armadilha: VLO (espelho histórico), VOL (Lino), VOC (Cecílio) e VOR (novo) têm o MESMO
    // nome no C2X. Pedir um não pode arrastar os outros três.
    expect(resolverCodes(["VOR"], EMPREENDIMENTOS)).toEqual(["VOR"]);
    expect(
      new Set(EMPREENDIMENTOS.filter((item) => item.nome === "VALE DO OURO").map((i) => i.code)).size,
    ).toBe(4);
  });

  it("banco sem o padrão devolve o que existe, em vez de consultar código ausente", () => {
    expect(resolverCodes([], [{ code: "VAL", contratos: 39, nome: "VISTA ALEGRE" }])).toEqual([
      "VAL",
    ]);
    expect(resolverCodes([], [])).toEqual([]);
  });
});

describe("e-mail do assinante (só na versão interna)", () => {
  it("junta os e-mails por nome sem fundir homônimos num só", () => {
    const mapa = emailsPorNome([
      linha({ contrato: 1, degrau: 1, email: "a@careli.adm.br", usuario: "Ana" }),
      linha({ contrato: 2, degrau: 1, email: "a@careli.adm.br", usuario: "Ana" }),
      linha({ contrato: 3, degrau: 1, email: "outra.ana@x.com", usuario: "Ana" }),
      linha({ contrato: 4, degrau: 1, email: "", usuario: "Sem email" }),
    ]);

    expect(mapa.get("Ana")).toEqual(["a@careli.adm.br", "outra.ana@x.com"]);
    expect(mapa.has("Sem email")).toBe(false);
  });

  it("o quadro por assinante ganha o e-mail e avisa quando o nome tem mais de um", () => {
    const quadro = enriquecerAssinantes(
      [
        { aguardandoAnteriores: 0, assinou: 2, naVez: 1, nome: "Ana", papel: "Backoffice" },
        { aguardandoAnteriores: 3, assinou: 0, naVez: 0, nome: "Bruno", papel: "Incorporador" },
      ],
      new Map([["Ana", ["a@careli.adm.br", "outra@x.com"]]]),
    );

    expect(quadro[0]).toMatchObject({ email: "a@careli.adm.br", emailsExtras: 1 });
    expect(quadro[1]).toMatchObject({ email: null, emailsExtras: 0 });
  });
});

describe("enriquecerUnidades", () => {
  const linhas = [
    linha({
      assinou: true,
      contrato: 900,
      degrau: 1,
      email: "cliente@x.com",
      perfil: "Comprador",
      usuario: "Cliente",
    }),
    linha({ contrato: 900, degrau: 2, email: "socio@inc.com", usuario: "Socio" }),
  ];
  const quadro = montarQuadroDeAssinaturas(
    linhas,
    [vivo({ arId: 77, temContrato: true })],
    new Map([[900, 77]]),
  );
  const contratos = enriquecerUnidades({
    linhas,
    unidades: quadro.unidades,
    uuidPorEnvio: new Map([[900, "uuid-do-d4sign"]]),
  });

  it("o documento do PDF vem do ENVIO escolhido", () => {
    expect(contratos[0]?.documentoId).toBe("uuid-do-d4sign");
  });

  it("cada linha do esquema recebe o e-mail daquele envio", () => {
    const porNome = new Map(contratos[0]?.esquema.map((item) => [item.nome, item.email]));

    expect(porNome.get("Cliente")).toBe("cliente@x.com");
    expect(porNome.get("Socio")).toBe("socio@inc.com");
  });

  it("os dados do contrato continuam vindo do núcleo, não recalculados aqui", () => {
    // A garantia de que a tela interna e o portal contam a MESMA história do mesmo contrato.
    expect(contratos[0]?.contrato).toMatchObject({
      imobiliaria: "Imob Teste",
      unitId: 4242,
      valorTabela: 250_000,
    });
  });

  it("envio sem uuid não vira botão de PDF", () => {
    const semDocumento = enriquecerUnidades({
      linhas,
      unidades: quadro.unidades,
      uuidPorEnvio: new Map(),
    });

    expect(semDocumento[0]?.documentoId).toBeNull();
  });
});

describe("a lista da tela Contratos tem as TRÊS situações", () => {
  // A fusão das duas abas não pode perder o contrato que ainda não saiu para assinar: era o chip
  // "Aguardando emissão" da aba Contratos, e sem ele some da tela justamente o contrato que
  // alguém precisa emitir.
  const linhas = [linha({ contrato: 900, degrau: 1 })];
  const quadro = montarQuadroDeAssinaturas(
    linhas,
    [
      vivo({ arId: 77, temContrato: true }),
      vivo({ arId: 78, unidade: "VOCA2", unitId: 4243 }),
    ],
    new Map([[900, 77]]),
  );
  const contratos = enriquecerUnidades({
    linhas,
    unidades: quadro.unidades,
    uuidPorEnvio: new Map([[900, "uuid"]]),
  });

  it("o contrato gerado e ainda não enviado entra como linha, com os dados dele", () => {
    const semEnvio = contratos.find((item) => item.situacao === "aguardando-emissao");

    expect(semEnvio).toBeDefined();
    expect(semEnvio?.unidade).toBe("VOCA2");
    expect(semEnvio?.contrato?.valorTabela).toBe(250_000);
    // Sem envio não há esquema, nem barrinha, nem PDF.
    expect(semEnvio?.esquema).toEqual([]);
    expect(semEnvio?.documentoId).toBeNull();
  });

  it("e o indicador 'aguardando emissão' conta a mesma coisa que a lista mostra", () => {
    expect(contratos.filter((item) => item.situacao === "aguardando-emissao")).toHaveLength(
      quadro.kpis.aguardandoEmissao,
    );
  });
});
