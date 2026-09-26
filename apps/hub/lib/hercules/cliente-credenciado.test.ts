import { describe, expect, it } from "vitest";

import { hashIdentifier } from "@/lib/apolo/server";

import { credenciadoParaVender, FalhaAoLerCredenciamento } from "./cliente-credenciado";

// A CAD CREDENCIADA É A PORTA DA PROPOSTA (Lucas, 04/09/2026). Errar para o lado frouxo deixa
// nascer proposta de quem não passou pelo crédito; errar para o lado apertado recusa um cliente
// credenciado na frente do corretor, que não tem como discutir com a tela.
//
// Os testes daqui cobram as quatro maneiras de errar para o lado apertado que já custaram caro em
// outros pontos do repo — a CAD gravada no grupo, o CPF com mais de uma entidade, a CAD de outro
// empreendimento e o erro de leitura virando "não" — e não o caminho feliz sozinho. E cobram
// também o único jeito de errar para o lado FROUXO: uma etapa velha vencendo a decisão de ontem
// dentro da mesma CAD.

type EntidadeFake = { document_hash: null | string; id: string };

type IdentificadorFake = { entity_id: string; value_hash: string };

type LinhaEsteiraFake = {
  atualizado_em: null | string;
  created_at: null | string;
  enterprise_id: null | string;
  entity_id: string;
  etapa: null | string;
};

type Consulta = { filtros: Array<{ coluna: string; valores: unknown[] }>; tabela: string };

// Client falso no mesmo espírito do de `lib/apolo/cad-por-empreendimento.test.ts`: o builder do
// supabase-js é encadeável e "thenable", então todo filtro devolve o mesmo objeto e o `await`
// resolve sem precisar de `.maybeSingle()`.
//
// ⚠️ TODA TABELA RESPEITA OS FILTROS de verdade, e isso é o ponto: um fixture que ignorasse os
// filtros passaria com a função quebrada. Vale para o escopo da esteira ("CAD de outro
// empreendimento não vale", que precisa de zero linha quando a consulta filtra errado) e vale para
// as DUAS fontes de entidade: `apolo_entities` casa por `document_hash` e
// `apolo_entity_identifiers` por `value_hash`, então uma consulta feita na coluna errada — ou com
// o hash de outro documento — volta vazia em vez de devolver a fixture inteira.
//
// O casamento é estrito de propósito: coluna que a linha não tem nunca casa. É o que faz o teste
// notar quando a função procura onde não deve.
function clienteFake(cfg: {
  entidades?: EntidadeFake[];
  erroEm?: string;
  esteira?: LinhaEsteiraFake[];
  identificadores?: IdentificadorFake[];
}) {
  const consultas: Consulta[] = [];

  const client = {
    from(tabela: string) {
      const filtros: Array<{ coluna: string; valores: unknown[] }> = [];
      consultas.push({ filtros, tabela });

      const combina = (linha: Record<string, unknown>) =>
        filtros.every((f) => f.valores.includes(linha[f.coluna]));

      const filtrar = (linhas: object[]) =>
        linhas.filter((linha) => combina(linha as Record<string, unknown>));

      const resultado = () => {
        if (cfg.erroEm === tabela) return { data: null, error: { message: "conexão caiu" } };
        if (tabela === "apolo_entities") {
          return { data: filtrar(cfg.entidades ?? []), error: null };
        }
        if (tabela === "apolo_entity_identifiers") {
          return { data: filtrar(cfg.identificadores ?? []), error: null };
        }
        if (tabela === "apolo_esteira") {
          return { data: filtrar(cfg.esteira ?? []), error: null };
        }
        return { data: [], error: null };
      };

      const builder: Record<string, unknown> = {
        eq: (coluna: string, valor: unknown) => {
          filtros.push({ coluna, valores: [valor] });
          return builder;
        },
        in: (coluna: string, valores: unknown[]) => {
          filtros.push({ coluna, valores });
          return builder;
        },
        select: () => builder,
        then: (resolver: (valor: unknown) => unknown) => Promise.resolve(resolver(resultado())),
      };

      return builder;
    },
  };

  return { client: client as never, consultas };
}

const CPF = "529.982.247-25";
const ENTIDADE = "ent-maria";
// 35 = master do Vale do Ouro, onde estão as 637 CADs de produção.
const VALE_DO_OURO = "35";

// O mesmo hash que a função monta: o tipo do documento já está dentro dele, e é por ele que as
// duas fontes casam.
const HASH_DO_CPF = hashIdentifier("cpf", "52998224725");

/** Entidade que NASCEU no Apolo (o portal): o CPF mora em `apolo_entities.document_hash`. */
function nascidaNoApolo(id: string): EntidadeFake {
  return { document_hash: HASH_DO_CPF, id };
}

/**
 * Entidade que veio do sync do C2X: `document_hash` fica `null` de propósito e o CPF mora em
 * `apolo_entity_identifiers.value_hash`. É a origem da quase totalidade da base.
 */
function vindaDoC2x(entityId: string): IdentificadorFake {
  return { entity_id: entityId, value_hash: HASH_DO_CPF };
}

function cad(parcial: Partial<LinhaEsteiraFake> = {}): LinhaEsteiraFake {
  return {
    atualizado_em: "2026-09-02T12:00:00.000Z",
    created_at: "2026-08-01T12:00:00.000Z",
    enterprise_id: VALE_DO_OURO,
    entity_id: ENTIDADE,
    etapa: "credenciado",
    ...parcial,
  };
}

describe("credenciadoParaVender", () => {
  it("libera quando a CAD do CPF está credenciada NESTE empreendimento", async () => {
    const { client } = clienteFake({
      esteira: [cad()],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.entityId).toBe(ENTIDADE);
    expect(resposta.etapa).toBe("credenciado");
    expect(resposta.desde).toBe("2026-09-02T12:00:00.000Z");
    // Credenciado não tem o que explicar: motivo preenchido aqui viraria alerta na tela.
    expect(resposta.motivo).toBeNull();
  });

  it("recusando, diz EM QUE ETAPA está e desde quando — 'não credenciado' sozinho é um muro", async () => {
    const { client } = clienteFake({
      esteira: [cad({ etapa: "credito" })],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.etapa).toBe("credito");
    expect(resposta.desde).toBe("2026-09-02T12:00:00.000Z");
    expect(resposta.motivo).toBe("A CAD deste cliente está em análise de crédito desde 02/09/2026.");
  });

  it("CAD credenciada em OUTRO empreendimento não vale para este", async () => {
    // A pessoa comprou no Vale do Ouro e está credenciada lá. A proposta é do Garden (39).
    const { client } = clienteFake({
      esteira: [cad({ enterprise_id: VALE_DO_OURO })],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: ["39"] });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.etapa).toBeNull();
    expect(resposta.motivo).toBe("Este cliente não tem CAD neste empreendimento.");
  });

  it("CPF sem nenhuma entidade no Apolo manda ABRIR a CAD, e não fala em etapa", async () => {
    const { client } = clienteFake({});

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.entityId).toBeNull();
    expect(resposta.etapa).toBeNull();
    expect(resposta.motivo).toBe(
      "Este CPF não tem cadastro no Apolo. Abra a CAD antes de gerar a proposta.",
    );
  });

  it("CAD gravada como 'group:Nome' conta quando o grupo está no escopo", async () => {
    // Há linha assim na base: `apolo_esteira.enterprise_id` guarda a divisão ("35") E o grupo do
    // catálogo ("group:Vale do Ouro"). É a rota que expande o escopo, com `comIdsDoGrupo`.
    const { client } = clienteFake({
      esteira: [cad({ enterprise_id: "group:Vale do Ouro" })],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO, "group:Vale do Ouro"],
    });

    expect(resposta.credenciado).toBe(true);
  });

  it("sem o grupo no escopo, a MESMA CAD do grupo some — é por isso que o chamador expande antes", async () => {
    const { client } = clienteFake({
      esteira: [cad({ enterprise_id: "group:Vale do Ouro" })],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(false);
  });

  it("com duas entidades para o mesmo CPF, basta UMA delas estar credenciada", async () => {
    // São 619 documentos duplicados no Apolo: uma entidade veio do sync do C2X, outra nasceu numa
    // importação. Olhar só a primeira recusa a proposta de quem está credenciado.
    const DO_C2X = "ent-do-c2x";
    const { client } = clienteFake({
      // `document_hash` só é preenchido para quem nasce no Apolo; o sync do C2X grava o CPF em
      // `apolo_entity_identifiers`. As duas fontes precisam ser consultadas.
      entidades: [nascidaNoApolo(ENTIDADE)],
      esteira: [
        cad({ atualizado_em: "2026-09-03T12:00:00.000Z", etapa: "correcao" }),
        cad({ entity_id: DO_C2X, etapa: "credenciado" }),
      ],
      identificadores: [vindaDoC2x(DO_C2X)],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.entityId).toBe(DO_C2X);
  });

  it("INDEFERIDO de setembro vence CREDENCIADO de junho na MESMA entidade", async () => {
    // O único jeito de esta função errar para o lado FROUXO. Procurar "alguma linha credenciada"
    // antes de reduzir cada entidade à sua linha mais recente acha a de junho e deixa a proposta
    // nascer para um cliente reprovado no crédito.
    const { client } = clienteFake({
      esteira: [
        cad({ atualizado_em: "2026-06-10T12:00:00.000Z", etapa: "credenciado" }),
        cad({ atualizado_em: "2026-09-03T12:00:00.000Z", etapa: "indeferido" }),
      ],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.etapa).toBe("indeferido");
    expect(resposta.motivo).toBe(
      "A CAD deste cliente está com o cadastro indeferido desde 03/09/2026.",
    );
  });

  it("⚠️ a CAD nova de um IRMAO da familia nao derruba a credenciada do PAI", async () => {
    // O escopo que chega aqui vem EXPANDIDO pela familia (familiaDoEmpreendimento devolve VLO 35 +
    // VOL 36 + VOC 37), e uma CAD e a ficha de uma pessoa num EMPREENDIMENTO. Agrupar so por
    // entidade fazia a CAD recem-aberta no irmao apagar a credenciada do pai e recusar um cliente
    // que esta credenciado — o erro caro, porque o corretor ouve "nao credenciado" sobre alguem que
    // passou. E o unico estado que o banco produz de verdade: o upsert da esteira tem onConflict
    // (entity_id, enterprise_id), entao duas linhas da MESMA entidade so convivem em
    // empreendimentos diferentes.
    const { client } = clienteFake({
      esteira: [
        cad({ atualizado_em: "2026-06-10T12:00:00.000Z", enterprise_id: "35", etapa: "credenciado" }),
        cad({ atualizado_em: "2026-09-03T12:00:00.000Z", enterprise_id: "37", etapa: "correcao" }),
      ],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: ["35", "36", "37"],
    });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.etapa).toBe("credenciado");
  });

  it("o indeferido recente de UMA entidade não derruba a credenciada antiga da OUTRA", async () => {
    // A outra metade da mesma régua: a recência manda DENTRO da entidade, nunca entre entidades —
    // senão as 619 duplicatas de CPF voltariam a recusar quem está credenciado.
    const DO_C2X = "ent-do-c2x";
    const { client } = clienteFake({
      entidades: [nascidaNoApolo(ENTIDADE)],
      esteira: [
        cad({ atualizado_em: "2026-09-03T12:00:00.000Z", etapa: "indeferido" }),
        cad({
          atualizado_em: "2026-06-10T12:00:00.000Z",
          entity_id: DO_C2X,
          etapa: "credenciado",
        }),
      ],
      identificadores: [vindaDoC2x(DO_C2X)],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.entityId).toBe(DO_C2X);
  });

  it("entidade que existe SÓ em apolo_entities.document_hash conta — é por onde nasce a CAD do portal", async () => {
    // Sem este teste, apagar a consulta a `apolo_entities` da função deixa a suíte verde: todos os
    // outros casos têm identificador. Quem nasce no Apolo (as CADs novas do portal) não tem.
    const { client } = clienteFake({
      entidades: [nascidaNoApolo(ENTIDADE)],
      esteira: [cad()],
      identificadores: [],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.entityId).toBe(ENTIDADE);
  });

  it("entidade com o hash de OUTRO documento não entra — a busca é pelo CPF, não pela tabela", async () => {
    const { client } = clienteFake({
      entidades: [{ document_hash: hashIdentifier("cpf", "11144477735"), id: "ent-de-outro" }],
      esteira: [cad({ entity_id: "ent-de-outro" })],
      identificadores: [],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.motivo).toBe(
      "Este CPF não tem cadastro no Apolo. Abra a CAD antes de gerar a proposta.",
    );
  });

  it("sem CAD no escopo, o entityId é o mesmo nas duas ordens de chegada das fontes", async () => {
    // As duas consultas de `entidadesDoDocumento` voltam do PostgREST sem `order`. Se o primeiro
    // id fosse o primeiro que chegou, o mesmo clique devolveria ora a ficha-fantasma, ora a real.
    const PRIMEIRO = "ent-aaa";
    const SEGUNDO = "ent-zzz";

    const responder = async (entidade: string, identificador: string) => {
      const { client } = clienteFake({
        entidades: [nascidaNoApolo(entidade)],
        identificadores: [vindaDoC2x(identificador)],
      });

      return credenciadoParaVender(client, { documento: CPF, enterpriseIds: ["39"] });
    };

    const doApoloPrimeiro = await responder(PRIMEIRO, SEGUNDO);
    const doC2xPrimeiro = await responder(SEGUNDO, PRIMEIRO);

    expect(doApoloPrimeiro.entityId).toBe(PRIMEIRO);
    expect(doC2xPrimeiro.entityId).toBe(PRIMEIRO);
    expect(doApoloPrimeiro.motivo).toBe("Este cliente não tem CAD neste empreendimento.");
  });

  it("erro de leitura da esteira ESTOURA, em vez de virar 'cliente não credenciado'", async () => {
    const { client } = clienteFake({
      erroEm: "apolo_esteira",
      esteira: [cad()],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    await expect(
      credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VALE_DO_OURO] }),
    ).rejects.toBeInstanceOf(FalhaAoLerCredenciamento);
  });

  it("erro ao procurar a entidade também ESTOURA — a rota responde 503, não recusa o cliente", async () => {
    const { client } = clienteFake({ erroEm: "apolo_entity_identifiers" });

    await expect(
      credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VALE_DO_OURO] }),
    ).rejects.toBeInstanceOf(FalhaAoLerCredenciamento);
  });

  it("escopo de empreendimento vazio é ERRO do chamador, e não uma recusa do cliente", async () => {
    const { client } = clienteFake({
      esteira: [cad()],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    await expect(
      credenciadoParaVender(client, { documento: CPF, enterpriseIds: ["", "  "] }),
    ).rejects.toBeInstanceOf(FalhaAoLerCredenciamento);
  });

  it("CPF com máscara e CPF só de dígitos procuram exatamente o MESMO hash", async () => {
    const hashDe = async (documento: string) => {
      const { client, consultas } = clienteFake({});
      await credenciadoParaVender(client, { documento, enterpriseIds: [VALE_DO_OURO] });
      const busca = consultas.find((c) => c.tabela === "apolo_entity_identifiers");
      return busca?.filtros.find((f) => f.coluna === "value_hash")?.valores[0];
    };

    const comMascara = await hashDe(CPF);
    expect(comMascara).toBeTypeOf("string");
    expect(await hashDe("52998224725")).toBe(comMascara);
  });

  it("CPF incompleto nem chega a consultar o banco", async () => {
    const { client, consultas } = clienteFake({});

    const resposta = await credenciadoParaVender(client, {
      documento: "529.982",
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.motivo).toBe(
      "Informe o CPF ou o CNPJ do titular para conferir o credenciamento.",
    );
    expect(consultas).toHaveLength(0);
  });
});

// ── A CAD DE PESSOA JURÍDICA ───────────────────────────────────────────────────
//
// Lucas (26/09/2026): *"temos que habilitar pessoa fisica e pessoa juridica, hoje só atende pessoa
// fisica"*.
//
// MEDIDO em 26/09/2026 (produção, só SELECT): existem 11 CADs de entidade pj na esteira (9 na etapa
// credenciado, 1 em revisão, 1 em validação), e as 11 têm identificador cnpj cujo value_hash é
// igual ao document_hash da entidade em 11 de 11 casos — e ZERO delas casa com um hash de namespace
// cpf. O caminho da empresa EXISTE no dado; era o código que não enxergava.
describe("credenciadoParaVender com CNPJ", () => {
  const CNPJ = "12.345.678/0001-95";
  const HASH_DO_CNPJ = hashIdentifier("cnpj", "12345678000195");
  const EMPRESA = "ent-acme";

  it("⚠️ procura pelo hash do namespace CNPJ, e libera a empresa credenciada", async () => {
    const { client, consultas } = clienteFake({
      esteira: [cad({ entity_id: EMPRESA })],
      identificadores: [{ entity_id: EMPRESA, value_hash: HASH_DO_CNPJ }],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CNPJ,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.entityId).toBe(EMPRESA);

    // hashIdentifier concatena "apolo-identifier:TIPO:valor": hasheado como "cpf", um CNPJ nunca
    // casaria com a CAD da empresa, e a recusa sairia sem erro nenhum no log.
    const busca = consultas.find((c) => c.tabela === "apolo_entity_identifiers");
    expect(busca?.filtros.find((f) => f.coluna === "value_hash")?.valores[0]).toBe(HASH_DO_CNPJ);
  });

  it("⚠️ sem cadastro, a frase diz CNPJ e não CPF", async () => {
    const { client } = clienteFake({});

    const resposta = await credenciadoParaVender(client, {
      documento: CNPJ,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.motivo).toContain("CNPJ");
    expect(resposta.motivo).not.toContain("CPF");
  });

  it("documento que não tem 11 nem 14 dígitos nem chega a consultar o banco", async () => {
    // ⚠️ TREZE DÍGITOS, E NÃO DOZE MASCARADOS. "12.345.678/000" tem ONZE dígitos depois do
    // `soDigitos`, e onze dígitos SÃO suficientes para procurar (o portão não cobra DV, ver o
    // describe abaixo): usar aquela string aqui afirmaria o contrário do que a função faz.
    const { client, consultas } = clienteFake({});
    const resposta = await credenciadoParaVender(client, {
      documento: "12.345.678/0001",
      enterpriseIds: [VALE_DO_OURO],
    });
    expect(resposta.credenciado).toBe(false);
    expect(resposta.motivo).toBe(
      "Informe o CPF ou o CNPJ do titular para conferir o credenciamento.",
    );
    expect(consultas).toHaveLength(0);
  });
});

// ── O PORTÃO NÃO COBRA DÍGITO VERIFICADOR ──────────────────────────────────────
//
// ⚠️ ESTA É A DECISÃO DE 04/09/2026, E ELA VOLTOU (26/09/2026). A primeira versão do lote de PJ
// trocou o portão de tamanho por `documentoDeCompradorValido`, que exige DV: isso APERTA um portão
// que decide se a proposta pode nascer, e nada disso era necessário para habilitar CNPJ. A pergunta
// deste portão é "tenho documento suficiente para procurar?" — a mesma, e pelo mesmo motivo, que a
// busca de proponentes faz em `app/api/incorporador/venda/proponentes/route.ts`: a base tem
// documento torto vindo da carga do C2X, e existe porta de reserva que não valida DV nenhum
// (`lib/prometeu/reservas-evento.ts`, o tótem do salão).
//
// O DV continua onde ele é porta de ENTRADA: `conferirReserva` e `conferirProposta`.
describe("credenciadoParaVender e o dígito verificador", () => {
  // Onze dígitos, DV que NÃO fecha. É o mesmo formato que `proponentes/route.test.ts` usa como
  // documento torto da carga do C2X.
  const CPF_TORTO = "333.333.333-33";
  const HASH_DO_TORTO = hashIdentifier("cpf", "33333333333");
  const TORTA = "ent-torta";

  it("⚠️ CPF de 11 dígitos com DV errado PROCURA no banco, e a CAD credenciada libera", async () => {
    // Antes de 26/09/2026 o portão era `digitos.length !== 11` e deixava passar: a entidade era
    // achada pelo hash (a mesma digitação torta está no Apolo, porque veio da mesma carga) e o
    // botão Gerar proposta acendia. Exigir DV aqui prende o lote numa reserva que não vira
    // proposta, com uma frase que manda informar o documento que já está preenchido na tela.
    const { client, consultas } = clienteFake({
      esteira: [cad({ entity_id: TORTA })],
      identificadores: [{ entity_id: TORTA, value_hash: HASH_DO_TORTO }],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF_TORTO,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(consultas.length).toBeGreaterThan(0);
    expect(resposta.credenciado).toBe(true);
    expect(resposta.entityId).toBe(TORTA);
  });

  it("⚠️ CNPJ de 14 dígitos com DV errado também procura, no namespace CNPJ", async () => {
    const CNPJ_TORTO = "12.345.678/0001-00";
    const HASH = hashIdentifier("cnpj", "12345678000100");
    const { client, consultas } = clienteFake({
      esteira: [cad({ entity_id: "ent-torta-pj" })],
      identificadores: [{ entity_id: "ent-torta-pj", value_hash: HASH }],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CNPJ_TORTO,
      enterpriseIds: [VALE_DO_OURO],
    });

    expect(resposta.credenciado).toBe(true);
    const busca = consultas.find((c) => c.tabela === "apolo_entity_identifiers");
    expect(busca?.filtros.find((f) => f.coluna === "value_hash")?.valores[0]).toBe(HASH);
  });
});
