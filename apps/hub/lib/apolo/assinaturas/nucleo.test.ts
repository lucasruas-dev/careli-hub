import { describe, expect, it } from "vitest";

import {
  emailsPorNome,
  enriquecerAssinantes,
  enriquecerUnidades,
  IDS_PADRAO_DO_PAINEL,
  idsDoRecorte,
  montarQuadroDeAssinaturas,
  resolverCodes,
  SQL_LINHAS_POR_ID,
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

// Os ids são os do C2X em 25/09/2026 (lib/apolo/c2x-pelo-id.fixture.ts).
const EMPREENDIMENTOS: EmpreendimentoDoFiltro[] = [
  { code: "VLO", contratos: 15, id: 35, nome: "VALE DO OURO" },
  { code: "VOC", contratos: 93, id: 37, nome: "VALE DO OURO" },
  { code: "VOL", contratos: 93, id: 36, nome: "VALE DO OURO" },
  { code: "VOR", contratos: 2, id: 41, nome: "VALE DO OURO" },
  { code: "VAL", contratos: 39, id: 29, nome: "VISTA ALEGRE" },
];

/** A mesma lista depois de um renome no C2X: o 37 deixou de ser VOC. O id não muda. */
const RENOMEADO: EmpreendimentoDoFiltro[] = EMPREENDIMENTOS.map((item) =>
  item.id === 37 ? { ...item, code: "VCX" } : item,
);

describe("resolverCodes", () => {
  it("sem pedido, cai no recorte padrão — o mesmo Vale do Ouro que a tela mostra hoje", () => {
    // Era `["VOC", "VOL"]` escrito no código; o padrão pelo id dá a mesma coisa hoje.
    expect(resolverCodes([], EMPREENDIMENTOS)).toEqual(["VOC", "VOL"]);
    expect([...IDS_PADRAO_DO_PAINEL].sort((a, b) => a - b)).toEqual([36, 37]);
  });

  it("o padrão sobrevive a um renome no C2X: é pelo id, e a sigla sai a de hoje", () => {
    // Pela sigla fixa, o padrão viraria só ["VOL"] e a carteira do VOC sumiria da tela aberta.
    expect(resolverCodes([], RENOMEADO)).toEqual(["VCX", "VOL"]);
    // O VOR (41) continua fora do padrão, como sempre esteve.
    expect(resolverCodes([], RENOMEADO)).not.toContain("VOR");
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
    expect(resolverCodes([], [{ code: "VAL", contratos: 39, id: 29, nome: "VISTA ALEGRE" }])).toEqual([
      "VAL",
    ]);
    expect(resolverCodes([], [])).toEqual([]);
  });
});

describe("idsDoRecorte: a sigla da tela vira o id do C2X pela MESMA lista (PAN-124)", () => {
  it("traduz cada sigla pelo id da linha dela, sem repetição e em ordem crescente", () => {
    expect(idsDoRecorte(["VOL", "VOC"], EMPREENDIMENTOS)).toEqual([36, 37]);
    expect(idsDoRecorte(resolverCodes([], EMPREENDIMENTOS), EMPREENDIMENTOS)).toEqual([36, 37]);
    expect(idsDoRecorte([" voc ", "VOC"], EMPREENDIMENTOS)).toEqual([37]);
  });

  it("'*' consulta todos os ids da lista, e só eles", () => {
    expect(idsDoRecorte(resolverCodes(["*"], EMPREENDIMENTOS), EMPREENDIMENTOS)).toEqual([
      29, 35, 36, 37, 41,
    ]);
  });

  it("sigla que a lista não tem não vira id (e o painel não vai ao C2X com `in ()`)", () => {
    expect(idsDoRecorte(["XXX"], EMPREENDIMENTOS)).toEqual([]);
    expect(idsDoRecorte([], EMPREENDIMENTOS)).toEqual([]);
  });

  it("renome no C2X não muda o recorte: o mesmo id, seja qual for a sigla de hoje", () => {
    expect(idsDoRecorte(["VCX"], RENOMEADO)).toEqual(idsDoRecorte(["VOC"], EMPREENDIMENTOS));
    expect(idsDoRecorte(resolverCodes([], RENOMEADO), RENOMEADO)).toEqual([36, 37]);
  });

  it("id inválido na lista (zero, id do Panteon) não vai ao C2X", () => {
    expect(
      idsDoRecorte(
        ["AAA", "BBB"],
        [
          { code: "AAA", contratos: 1, id: 0, nome: "A" },
          { code: "BBB", contratos: 1, id: 100_001, nome: "B" },
        ],
      ),
    ).toEqual([]);
  });
});

describe("SQL_LINHAS_POR_ID: a consulta das linhas filtra pelo id, nunca pela sigla", () => {
  const sql = SQL_LINHAS_POR_ID("?, ?");

  it("o WHERE é `e.id in (...)`, e não há `e.code in` em lugar nenhum", () => {
    expect(sql).toContain("where e.id in (?, ?)");
    expect(sql).not.toMatch(/e\.code\s+in\s*\(/i);
  });

  it("o resto não muda: a sigla continua sendo o rótulo `emp` e a ordem continua pela sigla", () => {
    expect(sql).toContain("e.code as emp");
    expect(sql).toMatch(/order by e\.code, u\.block, u\.lot/);
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
