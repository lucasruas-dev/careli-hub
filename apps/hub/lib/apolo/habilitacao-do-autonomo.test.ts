import { describe, expect, it, vi } from "vitest";

// A HABILITAÇÃO DO CORRETOR AUTÔNOMO — empreendimento a empreendimento, igual à imobiliária.
//
// Lucas (27/09/2026), perguntado se o autônomo vende em tudo ou só onde a coordenação liberar:
// *"Sim, empreendimento a empreendimento"*. E a regra que manda em tudo isto, do mesmo dia:
// *"NAO QUERO TER A INFORMACAO QUE PODE TER PESSOA FISICA COMO IMOBILIARIA, isso sera bem restrito"*.
//
// O que está travado aqui:
//   • o vínculo de CAD de um cliente NÃO habilita ninguém. É o achado que decide o desenho:
//     medido em produção em 28/09/2026 (bxgukywoxgivlrhjkwjx), JÁ EXISTEM 170 vínculos
//     `relationship_type = 'empreendimento'` em entidade `pf`, 169 deles `source = 'publico-cad'`
//     e todos em ficha com papel `prospect` (24 também com papel `corretor`). Ler o vínculo cru
//     daria habilitação a todo cliente que já mandou CAD;
//   • quem não tem `broker_code` NÃO é autônomo da casa. São os 131 corretores que o sync do C2X
//     trouxe sem código, e sobre eles o Lucas já decidiu: *"são resíduo do c2x, pode ignorar"*
//     (cabeçalho da migration 0193);
//   • pessoa física NUNCA entra como imobiliária: a lista de autônomos recusa quem tem o papel
//     `imobiliaria`, e o seletor de imobiliária do wizard continua saindo de
//     `apolo_entity_profiles.profile = 'imobiliaria'` (lib/apolo/server.ts:490), onde há ZERO
//     entidade `pf` contra 483 `pj` (medido em 28/09/2026);
//   • falha de leitura RECUSA. Habilitação é autorização: um blip de rede não pode liberar venda.

import {
  conferirHabilitacaoDoAutonomo,
  FONTE_DA_HABILITACAO_DO_AUTONOMO,
  idsHabilitadosDoAutonomo,
  listarCorretoresAutonomos,
  MENSAGEM_AUTONOMO_SEM_HABILITACAO,
  MENSAGEM_FALHA_AO_LER_HABILITACAO,
  MENSAGEM_NAO_E_AUTONOMO,
} from "./habilitacao-do-autonomo";

const AUTONOMO = "aaaaaaaa-1111-4111-8111-111111111111";
const RESIDUO_DO_C2X = "bbbbbbbb-2222-4222-8222-222222222222";
const CLIENTE = "cccccccc-3333-4333-8333-333333333333";
const IMOBILIARIA = "dddddddd-4444-4444-8444-444444444444";
const OPERADOR = "766e2df4-c404-472e-9c33-bd65cbf150d8";

type Linha = Record<string, unknown>;

// Um banco de mentira que filtra de verdade (eq, in, not, range) e sabe devolver erro por tabela.
function bancoFalso(tabelas: Record<string, Linha[]>, erros: Record<string, string> = {}) {
  const from = (tabela: string) => {
    let linhas = [...(tabelas[tabela] ?? [])];
    const erro = erros[tabela] ? { message: erros[tabela] } : null;
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (coluna: string, valor: unknown) => {
      linhas = linhas.filter((linha) => String(linha[coluna] ?? null) === String(valor));
      return q;
    };
    q.in = (coluna: string, valores: unknown[]) => {
      linhas = linhas.filter((linha) => valores.map(String).includes(String(linha[coluna] ?? null)));
      return q;
    };
    q.not = (coluna: string, _op: string, _valor: unknown) => {
      linhas = linhas.filter((linha) => linha[coluna] !== null && linha[coluna] !== undefined);
      return q;
    };
    for (const metodo of ["limit", "order", "range"]) q[metodo] = () => q;
    q.maybeSingle = async () => ({ data: erro ? null : (linhas[0] ?? null), error: erro });
    q.then = (resolver: (r: unknown) => unknown) =>
      Promise.resolve({ data: erro ? null : linhas, error: erro }).then(resolver);
    return q;
  };
  return { from } as never;
}

const entidade = (id: string, nome: string, extra: Linha = {}): Linha => ({
  broker_code: null,
  display_name: nome,
  entity_kind: "pf",
  id,
  legal_name: null,
  ...extra,
});

const papel = (entityId: string, profile: string, status = "active"): Linha => ({
  entity_id: entityId,
  profile,
  status,
});

// O vínculo de HABILITAÇÃO do autônomo: a porta dele grava uma fonte própria, e é ela que separa
// a autorização do vínculo de CAD de um cliente.
const habilitacao = (entityId: string, enterpriseId: string): Linha => ({
  created_at: "2026-09-28T12:00:00+00:00",
  entity_id: entityId,
  id: `rel-${entityId}-${enterpriseId}`,
  label: "Vale do Ouro",
  metadata: {
    createdBy: OPERADOR,
    enterpriseId,
    kind: "trabalho",
    role: "empreendimento",
    source: FONTE_DA_HABILITACAO_DO_AUTONOMO,
  },
  relationship_type: "empreendimento",
  status: "verified",
});

// O vínculo que o formulário PÚBLICO de CAD grava na ficha do CLIENTE. 169 assim em produção.
const vinculoDeCad = (entityId: string, enterpriseId: string): Linha => ({
  created_at: "2026-09-01T12:00:00+00:00",
  entity_id: entityId,
  id: `cad-${entityId}-${enterpriseId}`,
  label: "Vale do Ouro",
  metadata: { enterpriseId, kind: "trabalho", role: "empreendimento", source: "publico-cad" },
  relationship_type: "empreendimento",
  status: "verified",
});

function base(extra: Partial<Record<string, Linha[]>> = {}) {
  return bancoFalso({
    apolo_entities: [
      entidade(AUTONOMO, "JOAO AUTONOMO", { broker_code: "CA-0001" }),
      entidade(RESIDUO_DO_C2X, "CORRETOR VELHO DO C2X"),
      entidade(CLIENTE, "MARIA CLIENTE"),
      entidade(IMOBILIARIA, "RR SOLUCOES LTDA", { entity_kind: "pj", legal_name: "RR SOLUCOES LTDA" }),
    ],
    apolo_entity_profiles: [
      papel(AUTONOMO, "corretor"),
      papel(RESIDUO_DO_C2X, "corretor"),
      papel(CLIENTE, "prospect"),
      papel(IMOBILIARIA, "imobiliaria"),
    ],
    apolo_relationships: [
      habilitacao(AUTONOMO, "37"),
      vinculoDeCad(CLIENTE, "37"),
      // O caso medido dos 24: a MESMA pessoa é corretor e tem CAD própria como cliente.
      vinculoDeCad(RESIDUO_DO_C2X, "37"),
    ],
    ...extra,
  });
}

// A identidade: nesta suíte o cadastro do Panteon não é lido (o expansor tem teste próprio em
// lib/apolo/habilitacao-pelo-cadastro.test.ts).
const semExpansao = (id: string) => [id];

describe("conferirHabilitacaoDoAutonomo", () => {
  it("o autônomo habilitado no 37 passa, e volta com o código e o nome resolvidos no servidor", async () => {
    const r = await conferirHabilitacaoDoAutonomo(base(), {
      enterpriseId: "37",
      entityId: AUTONOMO,
      expandir: semExpansao,
    });
    expect(r).toEqual({
      autonomo: { codigo: "CA-0001", entityId: AUTONOMO, nome: "JOAO AUTONOMO" },
      ok: true,
    });
  });

  it("⚠️ o autônomo NÃO habilitado no 39 é recusado, com a frase do operador", async () => {
    const r = await conferirHabilitacaoDoAutonomo(base(), {
      enterpriseId: "39",
      entityId: AUTONOMO,
      expandir: semExpansao,
    });
    expect(r).toEqual({
      mensagem: MENSAGEM_AUTONOMO_SEM_HABILITACAO,
      motivo: "nao-habilitado",
      ok: false,
    });
  });

  it("⚠️ o vínculo de CAD de um CLIENTE não habilita ninguém (169 assim em produção)", async () => {
    const r = await conferirHabilitacaoDoAutonomo(base(), {
      enterpriseId: "37",
      entityId: CLIENTE,
      expandir: semExpansao,
    });
    // Recusado ANTES da habilitação: ele não tem código, então não é autônomo da casa.
    expect(r).toMatchObject({ motivo: "nao-e-autonomo", ok: false });
  });

  it("⚠️ o corretor sem broker_code (resíduo do C2X) não é autônomo, mesmo com vínculo no 37", async () => {
    const r = await conferirHabilitacaoDoAutonomo(base(), {
      enterpriseId: "37",
      entityId: RESIDUO_DO_C2X,
      expandir: semExpansao,
    });
    expect(r).toEqual({ mensagem: MENSAGEM_NAO_E_AUTONOMO, motivo: "nao-e-autonomo", ok: false });
  });

  it("⚠️ pessoa jurídica com papel imobiliária nunca passa por autônomo, nem com código", async () => {
    const banco = bancoFalso({
      apolo_entities: [
        entidade(IMOBILIARIA, "RR SOLUCOES LTDA", { broker_code: "CA-0009", entity_kind: "pj" }),
      ],
      apolo_entity_profiles: [papel(IMOBILIARIA, "imobiliaria")],
      apolo_relationships: [habilitacao(IMOBILIARIA, "37")],
    });
    const r = await conferirHabilitacaoDoAutonomo(banco, {
      enterpriseId: "37",
      entityId: IMOBILIARIA,
      expandir: semExpansao,
    });
    expect(r).toMatchObject({ motivo: "nao-e-autonomo", ok: false });
  });

  it("⚠️ falha ao ler a habilitação RECUSA (fail-closed), e não libera a venda", async () => {
    const banco = bancoFalso(
      {
        apolo_entities: [entidade(AUTONOMO, "JOAO AUTONOMO", { broker_code: "CA-0001" })],
        apolo_entity_profiles: [papel(AUTONOMO, "corretor")],
        apolo_relationships: [habilitacao(AUTONOMO, "37")],
      },
      { apolo_relationships: "connection reset" },
    );
    const r = await conferirHabilitacaoDoAutonomo(banco, {
      enterpriseId: "37",
      entityId: AUTONOMO,
      expandir: semExpansao,
    });
    expect(r).toEqual({
      mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO,
      motivo: "falha",
      ok: false,
    });
  });

  it("vínculo arquivado não habilita (arquivar é como o time tira a habilitação)", async () => {
    const banco = bancoFalso({
      apolo_entities: [entidade(AUTONOMO, "JOAO AUTONOMO", { broker_code: "CA-0001" })],
      apolo_entity_profiles: [papel(AUTONOMO, "corretor")],
      apolo_relationships: [{ ...habilitacao(AUTONOMO, "37"), status: "archived" }],
    });
    const r = await conferirHabilitacaoDoAutonomo(banco, {
      enterpriseId: "37",
      entityId: AUTONOMO,
      expandir: semExpansao,
    });
    expect(r).toMatchObject({ motivo: "nao-habilitado", ok: false });
  });

  it("habilitar o PAI cobre a divisão: habilitado no 35, a CAD no 37 passa", async () => {
    const banco = bancoFalso({
      apolo_entities: [entidade(AUTONOMO, "JOAO AUTONOMO", { broker_code: "CA-0001" })],
      apolo_entity_profiles: [papel(AUTONOMO, "corretor")],
      apolo_relationships: [habilitacao(AUTONOMO, "35")],
    });
    // O expansor real (lib/apolo/habilitacao-pelo-cadastro.ts) traduz o pai 35 nas divisões.
    const r = await conferirHabilitacaoDoAutonomo(banco, {
      enterpriseId: "37",
      entityId: AUTONOMO,
      expandir: (id) => (id === "35" ? ["36", "37", "41"] : [id]),
    });
    expect(r).toMatchObject({ ok: true });
  });
});

describe("idsHabilitadosDoAutonomo", () => {
  it("devolve só os ids da habilitação, sem os vínculos de CAD", async () => {
    const banco = bancoFalso({
      apolo_entities: [entidade(AUTONOMO, "JOAO AUTONOMO", { broker_code: "CA-0001" })],
      apolo_entity_profiles: [papel(AUTONOMO, "corretor")],
      apolo_relationships: [
        habilitacao(AUTONOMO, "37"),
        habilitacao(AUTONOMO, "39"),
        vinculoDeCad(AUTONOMO, "43"),
      ],
    });
    const r = await idsHabilitadosDoAutonomo(banco, AUTONOMO);
    expect(r).toEqual({ ids: ["37", "39"], ok: true });
  });
});

describe("listarCorretoresAutonomos", () => {
  it("⚠️ só quem tem código, papel corretor ativo e é pessoa física", async () => {
    const lista = await listarCorretoresAutonomos(base());
    expect(lista).toEqual([{ codigo: "CA-0001", entityId: AUTONOMO, nome: "JOAO AUTONOMO" }]);
  });

  it("⚠️ NUNCA quem tem o papel imobiliária (a regra do Lucas de 27/09/2026)", async () => {
    const banco = bancoFalso({
      apolo_entities: [
        entidade(AUTONOMO, "JOAO AUTONOMO", { broker_code: "CA-0001" }),
        entidade(IMOBILIARIA, "RR SOLUCOES LTDA", { broker_code: "CA-0002", entity_kind: "pj" }),
      ],
      apolo_entity_profiles: [
        papel(AUTONOMO, "corretor"),
        papel(IMOBILIARIA, "corretor"),
        papel(IMOBILIARIA, "imobiliaria"),
      ],
      apolo_relationships: [],
    });
    const lista = await listarCorretoresAutonomos(banco);
    expect(lista.map((a) => a.entityId)).toEqual([AUTONOMO]);
  });

  it("papel corretor em revisão fica fora (habilitação é para quem a casa já validou)", async () => {
    const banco = bancoFalso({
      apolo_entities: [entidade(AUTONOMO, "JOAO AUTONOMO", { broker_code: "CA-0001" })],
      apolo_entity_profiles: [papel(AUTONOMO, "corretor", "review")],
      apolo_relationships: [],
    });
    expect(await listarCorretoresAutonomos(banco)).toEqual([]);
  });

  it("falha de leitura devolve lista vazia e registra, nunca uma lista pela metade", async () => {
    const aviso = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const banco = bancoFalso(
      { apolo_entities: [], apolo_entity_profiles: [], apolo_relationships: [] },
      { apolo_entity_profiles: "timeout" },
    );
    expect(await listarCorretoresAutonomos(banco)).toEqual([]);
    expect(aviso).toHaveBeenCalled();
    aviso.mockRestore();
  });
});

// ─── A CERCA DA FONTE: AUTORIZAÇÃO NÃO SE ESCREVE POR EXCLUSÃO (revisão de 28/09/2026) ───────────
//
// A primeira versão de `idsHabilitadosDoAutonomo` descartava o que `origemDoVinculo` classifica como
// `cad` e ACEITAVA TODO O RESTO. `origemDoVinculo` só devolve `cad` para `source = 'publico-cad'` e
// `origem = 'mover-cad'` (lib/apolo/habilitada-sem-fila.ts:88): qualquer outra coisa virava habilitação.
//
// ⚠️ O FURO ESTAVA NO AR, E EM PRODUÇÃO. `/api/apolo/relationships/create` (route.ts:114-126) grava o
// vínculo `empreendimento` `verified` com `source: "apolo"` + `createdBy`, sem olhar papel nem
// `entity_kind`, e por ali `habilitacaoPeloVinculo` devolve `nao-e-habilitacao` (exige papel
// `imobiliaria` ativo): o modal de relacionamento da ficha habilitava o autônomo EM SILÊNCIO, sem
// auditoria `corretor_autonomo_habilitado` e sem aviso ao coordenador. É o silêncio que o Lucas proibiu
// em 24/09/2026 ("3 - Isso ae"). Medido em produção (bxgukywoxgivlrhjkwjx, 28/09/2026):
// `select e.entity_kind, r.metadata->>'source', r.status, count(*) from apolo_relationships r join
// apolo_entities e on e.id = r.entity_id where r.relationship_type = 'empreendimento' and
// e.entity_kind = 'pf' group by 1,2,3;` → publico-cad/verified 168, publico-cad/archived 1 e
// apolo/verified 1. JÁ EXISTE uma linha `pf` que a leitura antiga aceitaria como habilitação.

/** O vínculo que o MODAL DE RELACIONAMENTO da ficha grava: `source: "apolo"` com autor. */
const vinculoDoModalDaFicha = (entityId: string, enterpriseId: string): Linha => ({
  created_at: "2026-09-28T09:00:00+00:00",
  entity_id: entityId,
  id: `modal-${entityId}-${enterpriseId}`,
  label: "Vale do Ouro",
  metadata: {
    createdBy: OPERADOR,
    enterpriseId,
    kind: "trabalho",
    role: "empreendimento",
    source: "apolo",
  },
  relationship_type: "empreendimento",
  status: "verified",
});

describe("a cerca da fonte: só a porta do autônomo habilita", () => {
  function comVinculo(...vinculos: Linha[]) {
    return bancoFalso({
      apolo_entities: [entidade(AUTONOMO, "JOAO AUTONOMO", { broker_code: "CA-0001" })],
      apolo_entity_profiles: [papel(AUTONOMO, "corretor")],
      apolo_relationships: vinculos,
    });
  }

  it("⚠️ o vínculo do MODAL DA FICHA (source apolo, com autor) NÃO habilita: seria autorização em silêncio", async () => {
    expect(await idsHabilitadosDoAutonomo(comVinculo(vinculoDoModalDaFicha(AUTONOMO, "35")), AUTONOMO)).toEqual({
      ids: [],
      ok: true,
    });
    const r = await conferirHabilitacaoDoAutonomo(comVinculo(vinculoDoModalDaFicha(AUTONOMO, "35")), {
      enterpriseId: "35",
      entityId: AUTONOMO,
      expandir: semExpansao,
    });
    expect(r).toEqual({
      mensagem: MENSAGEM_AUTONOMO_SEM_HABILITACAO,
      motivo: "nao-habilitado",
      ok: false,
    });
  });

  it("⚠️ nem o vínculo do Board (apolo-credenciamento), nem o da página pública, nem um sem fonte", async () => {
    const outras = ["apolo-credenciamento", "publico-imobiliaria", "setup-script", ""];
    for (const fonte of outras) {
      const vinculo = {
        ...habilitacao(AUTONOMO, "35"),
        metadata: { ...(habilitacao(AUTONOMO, "35").metadata as Linha), source: fonte },
      };
      expect(await idsHabilitadosDoAutonomo(comVinculo(vinculo), AUTONOMO)).toEqual({
        ids: [],
        ok: true,
      });
    }
  });

  it("a fonte da porta nova continua habilitando, e o vínculo de CAD continua fora", async () => {
    const r = await idsHabilitadosDoAutonomo(
      comVinculo(habilitacao(AUTONOMO, "35"), vinculoDeCad(AUTONOMO, "43")),
      AUTONOMO,
    );
    expect(r).toEqual({ ids: ["35"], ok: true });
  });
});
