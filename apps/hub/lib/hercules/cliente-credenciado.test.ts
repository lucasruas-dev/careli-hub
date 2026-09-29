import { describe, expect, it } from "vitest";

import { hashIdentifier } from "@/lib/apolo/server";

import {
  credenciadoParaVender,
  decidirPelasLinhas,
  FalhaAoLerCredenciamento,
} from "./cliente-credenciado";
import type { CompraAtiva } from "./compra-ativa";

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
  origem?: null | string;
};

type Consulta ={ filtros: Array<{ coluna: string; valores: unknown[] }>; tabela: string };

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
//
// (26/09/2026) A porta da carteira lê mais duas tabelas: `hercules_propostas` (com a unidade
// embutida, filtrada por `unidade.enterprise_id`, e `is("cancelada_em", null)`) e
// `apolo_source_links`. O filtro com ponto percorre o objeto embutido, do mesmo jeito estrito: é o
// que faz o contrato de OUTRO empreendimento voltar vazio quando a consulta filtra certo.
function clienteFake(cfg: {
  contratos?: Array<Record<string, unknown>>;
  entidades?: EntidadeFake[];
  erroEm?: string;
  esteira?: LinhaEsteiraFake[];
  fontes?: Array<Record<string, unknown>>;
  identificadores?: IdentificadorFake[];
}) {
  const consultas: Consulta[] = [];

  const client = {
    from(tabela: string) {
      const filtros: Array<{ coluna: string; valores: unknown[] }> = [];
      consultas.push({ filtros, tabela });

      const valorDe = (linha: Record<string, unknown>, coluna: string): unknown =>
        coluna.split(".").reduce<unknown>(
          (atual, parte) =>
            atual && typeof atual === "object" ? (atual as Record<string, unknown>)[parte] : undefined,
          linha,
        );

      const combina = (linha: Record<string, unknown>) =>
        filtros.every((f) => f.valores.includes(valorDe(linha, f.coluna)));

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
        if (tabela === "hercules_propostas") {
          return { data: filtrar(cfg.contratos ?? []), error: null };
        }
        if (tabela === "apolo_source_links") {
          return { data: filtrar(cfg.fontes ?? []), error: null };
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
        is: (coluna: string, valor: unknown) => {
          filtros.push({ coluna, valores: [valor] });
          return builder;
        },
        order: () => builder,
        range: () => builder,
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

// ── O COMPRADOR DA CARTEIRA (26/09/2026) ─────────────────────────────────────
//
// Lucas: *"tem um cliente que é comprador, mas não está dando para ele comprar mais uma unidade
// [...] temos que aproveitar esses cadastros de comprador"*. Decisões: "Só no mesmo" empreendimento
// (a família pai/filhos), "Passa mesmo em atraso", "Nasce a CAD credenciada" (na gravação, não
// aqui). O caso real: comprador antigo do Veredas do Ouro (19), sem CAD, reservou outra unidade do
// mesmo Veredas, e a tela disse "Este cliente não tem CAD neste empreendimento".

const VEREDAS = "19";
const USUARIO_DO_C2X = "7001";

function contrato(parcial: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    cancelada_em: null,
    cancelamento_pedido_em: null,
    cliente_c2x_id: USUARIO_DO_C2X,
    cliente_documento: CPF,
    cliente_entity_id: null,
    cliente_nome: "MARIA DA SILVA",
    codigo: "000728",
    compradores: [
      { c2x_user_id: USUARIO_DO_C2X, documento: CPF, nome: "MARIA DA SILVA", percentual: 100, titular: true },
    ],
    etapa: "faturado",
    etapa_desde: "2024-03-10T12:00:00.000Z",
    id: "prop-antiga",
    unidade: { codigo: "VDO0728", enterprise_id: VEREDAS, id: "uni-728" },
    workspace_id: "careli",
    ...parcial,
  };
}

/** A ligação do usuário do C2X com a entidade sincronizada, como o sync grava. */
function fonte(entityId: string, usuario = USUARIO_DO_C2X): Record<string, unknown> {
  return { entity_id: entityId, source_id: usuario, source_system: "c2x", source_table: "users" };
}

describe("credenciadoParaVender: o comprador da carteira", () => {
  it("⚠️ sem CAD e com contrato ativo NO MESMO empreendimento, passa como comprador da carteira", async () => {
    const { client } = clienteFake({
      contratos: [contrato()],
      fontes: [fonte(ENTIDADE)],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.origem).toBe("comprador_da_carteira");
    // Sem etapa: ainda não há CAD. Ela nasce na GRAVAÇÃO da proposta, e é a `compra` que manda.
    expect(resposta.etapa).toBeNull();
    expect(resposta.motivo).toBeNull();
    // ⚠️ Sem `desde`: não há CAD para datar, e a data do contrato antigo fica dentro da compra (o GET
    // a mandaria ao portal que não é a Careli).
    expect(resposta.desde).toBeNull();
    expect(resposta.entityId).toBe(ENTIDADE);
    expect(resposta.compra).toMatchObject({
      codigo: "000728",
      desde: "2024-03-10T12:00:00.000Z",
      enterpriseIdDaUnidade: VEREDAS,
      entityIdDoContrato: ENTIDADE,
      papel: "titular",
      propostaId: "prop-antiga",
      unidade: "VDO0728",
    });
  });

  it("⚠️ contrato em OUTRO empreendimento não conta: para lá, abre CAD como hoje", async () => {
    const { client } = clienteFake({
      contratos: [contrato({ unidade: { codigo: "VLO0101", enterprise_id: "35", id: "uni-vlo" } })],
      fontes: [fonte(ENTIDADE)],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.origem).toBeNull();
    expect(resposta.compra).toBeNull();
    expect(resposta.motivo).toBe("Este cliente não tem CAD neste empreendimento.");
  });

  it("contrato numa divisão da MESMA família conta (o escopo é o mesmo da CAD, já expandido)", async () => {
    const { client } = clienteFake({
      contratos: [contrato({ unidade: { codigo: "VOC0101", enterprise_id: "37", id: "uni-voc" } })],
      fontes: [fonte(ENTIDADE)],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: ["35", "36", "37", "41"],
    });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.compra?.enterpriseIdDaUnidade).toBe("37");
  });

  it("⚠️ distrato, cancelado, assinatura e contrato NÃO são contrato ativo", async () => {
    for (const etapa of ["distrato", "cancelado", "assinatura", "contrato", "proposta", "reservado"]) {
      const { client } = clienteFake({
        contratos: [contrato({ etapa })],
        fontes: [fonte(ENTIDADE)],
        identificadores: [vindaDoC2x(ENTIDADE)],
      });
      const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });
      expect(resposta.credenciado, etapa).toBe(false);
    }
  });

  it("faturado com cancelamento registrado também não conta", async () => {
    const { client } = clienteFake({
      contratos: [contrato({ cancelada_em: "2026-09-01T12:00:00.000Z" })],
      fontes: [fonte(ENTIDADE)],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(false);
  });

  it("⚠️ faturado com PEDIDO de distrato em curso não conta, e a leitura já o filtra no banco", async () => {
    // Pelo fluxo do cancelamento, a etapa fica 'faturado' até a Têmis concluir; o pedido é só a marca.
    const { client, consultas } = clienteFake({
      contratos: [contrato({ cancelamento_pedido_em: "2026-09-20T12:00:00.000Z" })],
      fontes: [fonte(ENTIDADE)],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.motivo).toBe("Este cliente não tem CAD neste empreendimento.");
    const leitura = consultas.find((c) => c.tabela === "hercules_propostas");
    expect(leitura?.filtros).toContainEqual({ coluna: "cancelamento_pedido_em", valores: [null] });
  });

  it("o CPF do contrato só com dígitos casa com o CPF formatado da reserva", async () => {
    const { client } = clienteFake({
      contratos: [contrato({ cliente_documento: "52998224725" })],
      fontes: [fonte(ENTIDADE)],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(true);
  });

  it("⚠️ CAD em REVISÃO no escopo continua barrando, mesmo com contrato ativo", async () => {
    // A carteira não é uma linha de CAD: é a prova que substitui a CAD quando ela NÃO existe.
    // Revisão é crédito reprovado, e esse só a coordenação destrava, pelo override.
    const { client } = clienteFake({
      contratos: [contrato()],
      esteira: [cad({ enterprise_id: VEREDAS, etapa: "revisao" })],
      fontes: [fonte(ENTIDADE)],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.etapa).toBe("revisao");
    expect(resposta.origem).toBe("cad");
    expect(resposta.compra).toBeNull();
  });

  it("⚠️ CAD INDEFERIDA noutra entidade do mesmo CPF também barra: a decisão é da pessoa", async () => {
    const { client } = clienteFake({
      contratos: [contrato()],
      entidades: [nascidaNoApolo("ent-do-apolo")],
      esteira: [cad({ enterprise_id: VEREDAS, entity_id: "ent-do-apolo", etapa: "indeferido" })],
      fontes: [fonte(ENTIDADE)],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.etapa).toBe("indeferido");
  });

  it("CAD credenciada vence e diz 'cad'; o caminho comum não lê contrato nenhum", async () => {
    const { client, consultas } = clienteFake({
      contratos: [contrato()],
      esteira: [cad({ enterprise_id: VEREDAS })],
      fontes: [fonte(ENTIDADE)],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.origem).toBe("cad");
    expect(resposta.compra).toBeNull();
    expect(consultas.some((c) => c.tabela === "hercules_propostas")).toBe(false);
  });

  it("a CAD que já NASCEU da carteira diz 'comprador_da_carteira', sem pedir outra", async () => {
    const { client } = clienteFake({
      esteira: [cad({ enterprise_id: VEREDAS, origem: "comprador_da_carteira" })],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.origem).toBe("comprador_da_carteira");
    // `compra` nula: a CAD existe, e a gravação da proposta não escreve outra.
    expect(resposta.compra).toBeNull();
  });

  it("⚠️ o CO-COMPRADOR conta, na entidade ligada ao usuário dele no C2X", async () => {
    const { client } = clienteFake({
      contratos: [
        contrato({
          cliente_c2x_id: "8001",
          cliente_documento: "111.444.777-35",
          compradores: [
            { c2x_user_id: "8001", documento: "111.444.777-35", nome: "OUTRA PESSOA", percentual: 50, titular: true },
            { c2x_user_id: USUARIO_DO_C2X, documento: "52998224725", nome: "MARIA DA SILVA", percentual: 50, titular: false },
          ],
        }),
      ],
      fontes: [fonte(ENTIDADE)],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.compra?.papel).toBe("co");
    expect(resposta.entityId).toBe(ENTIDADE);
  });

  it("⚠️ a entidade é a DO CONTRATO (sincronizada do C2X), e não a nascida no Apolo", async () => {
    // 74 CPFs de titular têm também uma entidade nascida no Apolo. A CAD nela acenderia "nunca
    // enviado" no Board e poria a pessoa no lote de envio ao C2X. 'ent-aaa' vem primeiro na ordem.
    const { client } = clienteFake({
      contratos: [contrato()],
      entidades: [nascidaNoApolo("ent-aaa-do-apolo")],
      fontes: [fonte("ent-zzz-do-c2x")],
      identificadores: [vindaDoC2x("ent-zzz-do-c2x")],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.entityId).toBe("ent-zzz-do-c2x");
    expect(resposta.compra?.entityIdDoContrato).toBe("ent-zzz-do-c2x");
  });

  it("⚠️ falha ao ler os contratos é FalhaAoLerCredenciamento (503), nunca 'não credenciado'", async () => {
    const { client } = clienteFake({
      erroEm: "hercules_propostas",
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    await expect(
      credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] }),
    ).rejects.toBeInstanceOf(FalhaAoLerCredenciamento);
  });

  it("falha ao achar a entidade do contrato também é 503", async () => {
    const { client } = clienteFake({
      contratos: [contrato()],
      erroEm: "apolo_source_links",
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    await expect(
      credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] }),
    ).rejects.toBeInstanceOf(FalhaAoLerCredenciamento);
  });

  it("sem entidade nenhuma no Apolo, a resposta continua a de hoje, mesmo com contrato", async () => {
    const { client } = clienteFake({ contratos: [contrato()] });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.motivo).toBe(
      "Este CPF não tem cadastro no Apolo. Abra a CAD antes de gerar a proposta.",
    );
  });

  it("compradorDaCarteira: false desliga a porta (só a CAD vale)", async () => {
    const { client, consultas } = clienteFake({
      contratos: [contrato()],
      fontes: [fonte(ENTIDADE)],
      identificadores: [vindaDoC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(client, {
      compradorDaCarteira: false,
      documento: CPF,
      enterpriseIds: [VEREDAS],
    });

    expect(resposta.credenciado).toBe(false);
    expect(consultas.some((c) => c.tabela === "hercules_propostas")).toBe(false);
  });
});

describe("decidirPelasLinhas com a compra (a régua que a busca de proponentes usa)", () => {
  const COMPRA: CompraAtiva = {
    c2xUserId: "7001",
    codigo: "000728",
    desde: "2024-03-10T12:00:00.000Z",
    enterpriseIdDaUnidade: VEREDAS,
    entityIdApontada: null,
    entityIdDoContrato: "ent-do-contrato",
    papel: "co",
    propostaId: "prop-antiga",
    unidade: "VDO0728",
  };

  it("sem CAD, a compra libera o co-proponente, com a entidade do contrato", () => {
    const decisao = decidirPelasLinhas([], ["ent-x"], { compra: COMPRA });
    expect(decisao.credenciado).toBe(true);
    expect(decisao.origem).toBe("comprador_da_carteira");
    expect(decisao.entityId).toBe("ent-do-contrato");
    expect(decisao.desde).toBeNull();
    expect(decisao.compra?.desde).toBe(COMPRA.desde);
  });

  it("com CAD no escopo, a CAD decide e a compra é ignorada", () => {
    const decisao = decidirPelasLinhas(
      [{ ...cad({ enterprise_id: VEREDAS, etapa: "credito" }), chegou_em: null }],
      [ENTIDADE],
      { compra: COMPRA },
    );
    expect(decisao.credenciado).toBe(false);
    expect(decisao.etapa).toBe("credito");
    expect(decisao.compra).toBeNull();
  });

  it("sem compra e sem CAD, a frase de sempre", () => {
    const decisao = decidirPelasLinhas([], ["ent-x"]);
    expect(decisao.credenciado).toBe(false);
    expect(decisao.origem).toBeNull();
    expect(decisao.motivo).toBe("Este cliente não tem CAD neste empreendimento.");
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

// ── O COMPRADOR DA CARTEIRA COM CNPJ (26/09/2026, junção com a v1.384.0) ─────────────────
//
// A v1.384.0 abriu a régua do titular para CNPJ; a porta da carteira segue a MESMA peça
// (`tipoDePessoa`/`namespaceDoHash`), em vez de guardar uma segunda régua só de CPF.
//
// MEDIDO em 26/09/2026 (produção, só SELECT): 68 faturados ativos de CNPJ (40 CNPJs), todos
// titulares. 63 têm a entidade SEM o CNPJ (o sync do C2X não gravou o documento da empresa) e param
// em "Este CNPJ não tem cadastro no Apolo" com ou sem a porta; os outros 4 CNPJs já têm CAD
// credenciada no 35. Zero empresas passam a entrar hoje: os testes abaixo cobram a régua, e o
// primeiro deles é o caso que ainda não existe no banco.
describe("credenciadoParaVender: o comprador da carteira com CNPJ", () => {
  const CNPJ = "12.345.678/0001-95";
  const CNPJ_DIGITOS = "12345678000195";
  const HASH_DO_CNPJ = hashIdentifier("cnpj", CNPJ_DIGITOS);
  const EMPRESA = "ent-empresa";
  const USUARIO_DA_EMPRESA = "9001";

  function contratoDaEmpresa(parcial: Record<string, unknown> = {}): Record<string, unknown> {
    return contrato({
      cliente_c2x_id: USUARIO_DA_EMPRESA,
      cliente_documento: CNPJ,
      cliente_nome: "ACME LOTEAMENTOS LTDA",
      compradores: [
        { c2x_user_id: USUARIO_DA_EMPRESA, documento: CNPJ, nome: "ACME LOTEAMENTOS LTDA", percentual: 100, titular: true },
      ],
      id: "prop-da-empresa",
      ...parcial,
    });
  }

  it("⚠️ a empresa sem CAD e com contrato ativo no mesmo empreendimento passa, pelo hash do namespace CNPJ", async () => {
    const { client, consultas } = clienteFake({
      contratos: [contratoDaEmpresa()],
      fontes: [fonte(EMPRESA, USUARIO_DA_EMPRESA)],
      identificadores: [{ entity_id: EMPRESA, value_hash: HASH_DO_CNPJ }],
    });

    const resposta = await credenciadoParaVender(client, { documento: CNPJ, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(true);
    expect(resposta.origem).toBe("comprador_da_carteira");
    expect(resposta.entityId).toBe(EMPRESA);
    expect(resposta.compra).toMatchObject({
      entityIdDoContrato: EMPRESA,
      papel: "titular",
      propostaId: "prop-da-empresa",
    });
    const busca = consultas.find((c) => c.tabela === "apolo_entity_identifiers");
    expect(busca?.filtros.find((f) => f.coluna === "value_hash")?.valores[0]).toBe(HASH_DO_CNPJ);
  });

  it("⚠️ o caso MEDIDO: entidade da empresa sem o CNPJ para em 'sem cadastro', e nem lê contrato", async () => {
    // 63 dos 68 faturados de CNPJ em produção: a entidade existe (ligada ao usuário do C2X), mas
    // não carrega o documento. A porta da carteira não muda nada para eles.
    const { client, consultas } = clienteFake({
      contratos: [contratoDaEmpresa()],
      fontes: [fonte(EMPRESA, USUARIO_DA_EMPRESA)],
    });

    const resposta = await credenciadoParaVender(client, { documento: CNPJ, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.motivo).toBe(
      "Este CNPJ não tem cadastro no Apolo. Abra a CAD antes de gerar a proposta.",
    );
    expect(consultas.some((c) => c.tabela === "hercules_propostas")).toBe(false);
  });

  it("⚠️ CAD da empresa em REVISÃO continua barrando, mesmo com contrato ativo", async () => {
    const { client } = clienteFake({
      contratos: [contratoDaEmpresa()],
      esteira: [cad({ enterprise_id: VEREDAS, entity_id: EMPRESA, etapa: "revisao" })],
      fontes: [fonte(EMPRESA, USUARIO_DA_EMPRESA)],
      identificadores: [{ entity_id: EMPRESA, value_hash: HASH_DO_CNPJ }],
    });

    const resposta = await credenciadoParaVender(client, { documento: CNPJ, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.etapa).toBe("revisao");
    expect(resposta.compra).toBeNull();
  });

  it("⚠️ a FILIAL não herda o contrato da matriz: o CNPJ casa inteiro, nunca pela raiz", async () => {
    const FILIAL = "12.345.678/0002-76";
    const { client } = clienteFake({
      contratos: [contratoDaEmpresa()],
      fontes: [fonte(EMPRESA, USUARIO_DA_EMPRESA)],
      identificadores: [{ entity_id: EMPRESA, value_hash: hashIdentifier("cnpj", "12345678000276") }],
    });

    const resposta = await credenciadoParaVender(client, { documento: FILIAL, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.motivo).toBe("Este cliente não tem CAD neste empreendimento.");
  });

  it("⚠️ o CPF do sócio NÃO herda o contrato da empresa: quem comprou foi o CNPJ", async () => {
    const { client } = clienteFake({
      contratos: [contratoDaEmpresa()],
      fontes: [fonte(EMPRESA, USUARIO_DA_EMPRESA)],
      identificadores: [vindaDoC2x(ENTIDADE), { entity_id: EMPRESA, value_hash: HASH_DO_CNPJ }],
    });

    const resposta = await credenciadoParaVender(client, { documento: CPF, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(false);
    expect(resposta.compra).toBeNull();
  });

  it("⚠️ 'assinatura' também não conta para a empresa (Lucas: em assinatura não entra)", async () => {
    const { client } = clienteFake({
      contratos: [contratoDaEmpresa({ etapa: "assinatura" })],
      fontes: [fonte(EMPRESA, USUARIO_DA_EMPRESA)],
      identificadores: [{ entity_id: EMPRESA, value_hash: HASH_DO_CNPJ }],
    });

    const resposta = await credenciadoParaVender(client, { documento: CNPJ, enterpriseIds: [VEREDAS] });

    expect(resposta.credenciado).toBe(false);
  });
});
