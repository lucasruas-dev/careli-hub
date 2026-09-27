import { describe, expect, it } from "vitest";

import { ETAPAS_ESTEIRA } from "@/lib/apolo/esteira";
import { hashIdentifier } from "@/lib/apolo/server";

import {
  credenciadoParaVender,
  FalhaAoLerCredenciamento,
  LIBERA_COM_CAD_EM_ANDAMENTO,
} from "./cliente-credenciado";

// UMA RÉGUA COM DOIS MODOS: A CAD EM ANDAMENTO LIBERA A PROPOSTA DO COORDENADOR.
//
// Lucas (26/09/2026): *"pode deixar os coordenadores emitirem proposta sem a cad esta credenciada.
// ela pode estar em validacao ou em qualquer outro estagio"*. E, olhando o print do MATEUS COTTA
// SACCHETTO (lote EIRETAMA-14 da Aldeia das Cachoeiras das Pedras, empreendimento 42, CAD em
// `validacao`): *"essa devia passar"*.
//
// ⚠️ MEDIDO EM PRODUÇÃO (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026):
//   select etapa, count(*) from apolo_esteira group by 1 order by 2 desc;
//     → credenciado 662 · revisao 172 · correcao 6 · validacao 2
//   Ou seja: ZERO CADs em `indeferido`, `credito` ou `prevenda` hoje. A recusa que este lote mantém
//   (`indeferido`) não trava ninguém agora — ela existe para o dia em que a coordenação reprovar.
//   select etapa, enterprise_id, atualizado_em, entity_id from apolo_esteira
//     where etapa = 'validacao' order by atualizado_em desc;
//     → enterprise_id 42, atualizado_em 2026-09-26 17:11:31+00 (a CAD do Mateus) e uma no 20.
//
// ⚠️ AS DUAS DECISÕES DO LUCAS DO MESMO DIA, e é por elas que a régua tem DOIS MODOS e não virou uma
// régua frouxa só:
//   1. `indeferido` CONTINUA BARRANDO, mesmo para o coordenador. É uma decisão já tomada de reprovar
//      o cliente, e gerar proposta em cima dela é vender para quem a coordenação recusou.
//   2. SÓ O PORTAL COMERCIAL DA CARELI. O portal do Cecílio (`cecilio-rocha`), que também opera a
//      própria venda, continua precisando da CAD credenciada.
//
// ⚠️ E `credenciado` NÃO MENTE. Ele continua significando a verdade sobre a CAD; quem decide a porta
// é `podeGerarProposta`. Uma CAD em validação que voltasse `credenciado: true` faria o selo da
// ModalDeProposta escrever "CAD credenciada neste empreendimento" em cima de uma CAD que não está —
// a tela passaria a mentir para o coordenador em vez de avisá-lo.

type LinhaEsteiraFake = {
  atualizado_em: null | string;
  created_at: null | string;
  enterprise_id: null | string;
  entity_id: string;
  etapa: null | string;
};

/**
 * Client falso no mesmo espírito do de `cliente-credenciado.test.ts`: o builder do supabase-js é
 * encadeável e "thenable", e TODO filtro é respeitado de verdade — um fixture que ignorasse os
 * filtros passaria com a função quebrada (o escopo do empreendimento é justamente o que faz "sem CAD
 * neste empreendimento" continuar barrando).
 */
function clienteFake(cfg: {
  erroEm?: string;
  esteira?: LinhaEsteiraFake[];
  identificadores?: Array<{ entity_id: string; value_hash: string }>;
}) {
  const client = {
    from(tabela: string) {
      const filtros: Array<{ coluna: string; valores: unknown[] }> = [];

      const combina = (linha: Record<string, unknown>) =>
        filtros.every((f) => f.coluna in linha && f.valores.includes(linha[f.coluna]));

      const responder = () => {
        if (cfg.erroEm === tabela) {
          return { data: null, error: { message: "timeout" } };
        }
        if (tabela === "apolo_entities") return { data: [], error: null };
        if (tabela === "apolo_entity_identifiers") {
          return { data: (cfg.identificadores ?? []).filter(combina), error: null };
        }
        if (tabela === "apolo_esteira") {
          return { data: (cfg.esteira ?? []).filter(combina), error: null };
        }
        return { data: [], error: null };
      };

      const alvo: Record<string, unknown> = {
        then: (aceitar: (r: unknown) => unknown, recusar?: (e: unknown) => unknown) =>
          Promise.resolve(responder()).then(aceitar, recusar),
      };
      // ⚠️ `is`, `order` e `range` EXISTEM PORQUE A PORTA DA CARTEIRA É LIDA quando não há CAD no
      // escopo (junção de 26/09/2026, v1.385.0): `lerContratosAtivos` pagina com
      // `.is(...).order(...).range(...)`. Sem eles o fake estourava e a resposta virava
      // `FalhaAoLerCredenciamento` — um 503 onde o teste queria ler "sem CAD neste empreendimento".
      for (const metodo of ["eq", "in", "is"]) {
        alvo[metodo] = (coluna: string, valores: unknown) => {
          filtros.push({
            coluna,
            valores: Array.isArray(valores) ? valores : [valores],
          });
          return alvo;
        };
      }
      alvo.order = () => alvo;
      alvo.range = () => alvo;
      alvo.select = () => alvo;
      return alvo;
    },
  } as never;

  return client;
}

const CPF = "529.982.247-25";
const ENTIDADE = "ent-mateus";
const ALDEIA = "42";

/**
 * O `value_hash` que o sync do C2X grava — a única fonte que enxerga esta pessoa.
 *
 * O hash sai do `hashIdentifier` DE VERDADE, o mesmo que a lib chama: um hash inventado à mão no
 * fixture nunca casaria, e o teste passaria a provar só a si mesmo.
 */
const doC2x = (entity_id: string) => ({
  entity_id,
  value_hash: hashIdentifier("cpf", "52998224725"),
});

function cad(parcial: Partial<LinhaEsteiraFake> = {}): LinhaEsteiraFake {
  return {
    atualizado_em: "2026-09-26T17:11:31.401Z",
    created_at: "2026-09-20T12:00:00.000Z",
    enterprise_id: ALDEIA,
    entity_id: ENTIDADE,
    etapa: "validacao",
    ...parcial,
  };
}

/** O modo do coordenador: o portal comercial da Careli. */
const COORDENADOR = { cadEmAndamentoLibera: true };

/** O modo de sempre: o Cecílio, e a busca de proponentes. */
const EXIGE_CREDENCIADA = { cadEmAndamentoLibera: false };

describe("a CAD em andamento e o coordenador", () => {
  it("CAD em validação: o coordenador GERA, e o selo continua dizendo que ela não está credenciada", async () => {
    const client = clienteFake({ esteira: [cad()], identificadores: [doC2x(ENTIDADE)] });

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA] },
      COORDENADOR,
    );

    // A porta abre...
    expect(resposta.podeGerarProposta).toBe(true);
    // ...e a verdade sobre a CAD não muda de lado. É o que impede o selo de escrever "CAD
    // credenciada neste empreendimento" em cima de uma CAD em validação.
    expect(resposta.credenciado).toBe(false);
    expect(resposta.etapa).toBe("validacao");
    expect(resposta.motivo).toBe(
      "A CAD deste cliente está em validação de cadastro desde 26/09/2026.",
    );
  });

  it("a MESMA CAD em validação NÃO gera no modo de sempre — é o portal do Cecílio", async () => {
    const client = clienteFake({ esteira: [cad()], identificadores: [doC2x(ENTIDADE)] });

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA] },
      EXIGE_CREDENCIADA,
    );

    expect(resposta.podeGerarProposta).toBe(false);
    expect(resposta.credenciado).toBe(false);
    expect(resposta.etapa).toBe("validacao");
  });

  it("sem modo nenhum, a régua é a de sempre — o default não pode afrouxar quem não pediu", async () => {
    // `decidirPelasLinhas` é chamada sem modo pela busca de proponentes
    // (app/api/incorporador/venda/proponentes/route.ts:186). O default tem de ser o apertado.
    const client = clienteFake({ esteira: [cad()], identificadores: [doC2x(ENTIDADE)] });

    const resposta = await credenciadoParaVender(client, {
      documento: CPF,
      enterpriseIds: [ALDEIA],
    });

    expect(resposta.podeGerarProposta).toBe(false);
  });

  it.each(["revisao", "correcao", "credito", "prevenda"])(
    "CAD em %s também libera o coordenador — 'em qualquer outro estagio'",
    async (etapa) => {
      const client = clienteFake({
        esteira: [cad({ etapa })],
        identificadores: [doC2x(ENTIDADE)],
      });

      const resposta = await credenciadoParaVender(
        client,
        { documento: CPF, enterpriseIds: [ALDEIA] },
        COORDENADOR,
      );

      expect(resposta.podeGerarProposta).toBe(true);
      expect(resposta.credenciado).toBe(false);
      expect(resposta.etapa).toBe(etapa);
    },
  );

  it("CAD INDEFERIDA não gera nem para o coordenador — é uma decisão de reprovar já tomada", async () => {
    const client = clienteFake({
      esteira: [cad({ etapa: "indeferido" })],
      identificadores: [doC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA] },
      COORDENADOR,
    );

    expect(resposta.podeGerarProposta).toBe(false);
    expect(resposta.credenciado).toBe(false);
    expect(resposta.motivo).toBe(
      "A CAD deste cliente está com o cadastro indeferido desde 26/09/2026.",
    );
  });

  it("INDEFERIDO de hoje vence CREDENCIADO de ontem na MESMA CAD, e o modo novo não muda isso", async () => {
    // ⚠️ COM A REGRA NOVA `maisRecentePorCad` FICA MAIS IMPORTANTE, NÃO MENOS: é o que faz o
    // indeferido de hoje vencer o credenciado de ontem. Se o filtro por etapa voltasse a vir antes
    // do corte por CAD, a linha antiga sobreviveria e a proposta nasceria para quem foi reprovado.
    const client = clienteFake({
      esteira: [
        cad({ atualizado_em: "2026-09-25T12:00:00.000Z", etapa: "credenciado" }),
        cad({ atualizado_em: "2026-09-26T17:11:31.401Z", etapa: "indeferido" }),
      ],
      identificadores: [doC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA] },
      COORDENADOR,
    );

    expect(resposta.podeGerarProposta).toBe(false);
    expect(resposta.credenciado).toBe(false);
    expect(resposta.etapa).toBe("indeferido");
  });

  // ⚠️ O INDEFERIDO TEM DE SER PROCURADO NO ESCOPO INTEIRO, E NÃO NA LINHA MAIS NOVA. Até
  // 26/09/2026 `decidirPelasLinhas` escolhia UMA linha (`maisRecente(decisivas)`,
  // lib/hercules/cliente-credenciado.ts:361) e perguntava a porta só sobre a etapa DELA
  // (:393). No modo apertado isso era inofensivo — só `credenciado` abria a porta, e um
  // indeferido nunca "perdia" para nada que não fosse uma aprovação. Com 6 das 7 etapas
  // liberando o coordenador, uma segunda CAD do mesmo CPF em etapa em andamento e com
  // `atualizado_em` mais novo passava por cima da recusa.
  //
  // MEDIDO ANTES DA CORREÇÃO (`npx tsx` chamando `decidirPelasLinhas` de verdade, modo
  // `{cadEmAndamentoLibera: true}`, 26/09/2026): indeferido no 42 em 20/09 + revisao no 43 em
  // 26/09 devolvia `{"podeGerarProposta":true,"etapa":"revisao"}`, e entidade A indeferida no 42
  // em 20/09 + entidade B em validacao no 42 em 26/09 devolvia
  // `{"podeGerarProposta":true,"etapa":"validacao"}`. Nos dois a tela escrevia "CAD em andamento"
  // sobre um cliente REPROVADO, e o indeferimento não aparecia em lugar nenhum.
  //
  // ⚠️ MEDIDO POR MIM EM PRODUÇÃO (`bxgukywoxgivlrhjkwjx`, só SELECT, 26/09/2026 18h):
  //   select etapa, count(*) from apolo_esteira group by 1;
  //     → credenciado 662 · revisao 173 · correcao 6 · validacao 1 · ZERO `indeferido`
  //   select count(*) from (select value_hash from apolo_entity_identifiers
  //     group by 1 having count(distinct entity_id) > 1) d;                            → 806
  //   select count(*) from (select i.value_hash from apolo_esteira e
  //     join apolo_entity_identifiers i on i.entity_id = e.entity_id
  //     group by 1 having count(distinct e.etapa) > 1) x;                              → 16
  //   select count(*) from (select entity_id from apolo_esteira
  //     group by 1 having count(distinct enterprise_id) > 1) y;                        → 7
  // Não houve vítima (zero `indeferido`), mas a FORMA já está no dado: 16 documentos com CADs em
  // etapas DIFERENTES, 7 entidades com CAD em mais de um empreendimento, e 806 `value_hash` com mais
  // de uma entidade.
  it("INDEFERIDO num IRMÃO da família barra, mesmo com etapa mais nova no alvo", async () => {
    const client = clienteFake({
      esteira: [
        cad({ atualizado_em: "2026-09-20T12:00:00.000Z", etapa: "indeferido" }),
        cad({
          atualizado_em: "2026-09-26T17:11:31.401Z",
          enterprise_id: "43",
          etapa: "revisao",
        }),
      ],
      identificadores: [doC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA, "43"] },
      COORDENADOR,
    );

    expect(resposta.podeGerarProposta).toBe(false);
    expect(resposta.credenciado).toBe(false);
    // ⚠️ E A TELA LÊ A RECUSA, não a etapa mais nova. É o coordenador ficar sabendo que existe um
    // indeferimento, em vez de ler "em revisão" sobre alguém reprovado.
    expect(resposta.etapa).toBe("indeferido");
    expect(resposta.motivo).toBe(
      "A CAD deste cliente está com o cadastro indeferido desde 20/09/2026.",
    );
  });

  it("INDEFERIDO numa ENTIDADE DUPLICADA do mesmo CPF, no MESMO empreendimento, barra", async () => {
    // São 806 `value_hash` com mais de uma entidade (medido acima): uma veio do sync do C2X
    // e outra nasceu numa importação. Abrir CAD nova é trivial; indeferir exige motivo escrito e é
    // etapa FINAL (`ETAPAS_FINAIS` em lib/apolo/incorporador/resumo-do-produto.ts).
    const client = clienteFake({
      esteira: [
        cad({ atualizado_em: "2026-09-20T12:00:00.000Z", entity_id: "ent-a", etapa: "indeferido" }),
        cad({ atualizado_em: "2026-09-26T17:11:31.401Z", entity_id: "ent-b", etapa: "validacao" }),
      ],
      identificadores: [doC2x("ent-a"), doC2x("ent-b")],
    });

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA] },
      COORDENADOR,
    );

    expect(resposta.podeGerarProposta).toBe(false);
    expect(resposta.etapa).toBe("indeferido");
    expect(resposta.entityId).toBe("ent-a");
  });

  it("INDEFERIDO gravado no GRUPO do catálogo barra a divisão, e vice-versa", async () => {
    // `apolo_esteira.enterprise_id` guarda a divisão do C2X ("42") E o grupo do catálogo
    // ("group:ACP"), com linha viva nas duas formas — e `escopoDoTitular` traz as duas juntas.
    const client = clienteFake({
      esteira: [
        cad({
          atualizado_em: "2026-09-20T12:00:00.000Z",
          enterprise_id: "group:ACP",
          etapa: "indeferido",
        }),
        cad({ atualizado_em: "2026-09-26T17:11:31.401Z", etapa: "validacao" }),
      ],
      identificadores: [doC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA, "group:ACP"] },
      COORDENADOR,
    );

    expect(resposta.podeGerarProposta).toBe(false);
    expect(resposta.etapa).toBe("indeferido");
  });

  it("uma CAD CREDENCIADA em outra entidade continua vencendo o indeferido — nada foi apertado", async () => {
    // ⚠️ A VARREDURA DA RECUSA ENTRA DEPOIS DO RAMO DO `credenciado`, DE PROPÓSITO. "Entre CADs
    // diferentes, qualquer uma serve" é a regra escrita em `maisRecentePorCad` desde antes deste
    // lote, e apertá-la aqui faria a função recusar quem hoje passa — o erro caro é o corretor
    // ouvir "não credenciado" sobre alguém que está.
    const client = clienteFake({
      esteira: [
        cad({ atualizado_em: "2026-09-20T12:00:00.000Z", entity_id: "ent-a", etapa: "indeferido" }),
        cad({
          atualizado_em: "2026-09-26T17:11:31.401Z",
          entity_id: "ent-b",
          etapa: "credenciado",
        }),
      ],
      identificadores: [doC2x("ent-a"), doC2x("ent-b")],
    });

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA] },
      COORDENADOR,
    );

    expect(resposta.credenciado).toBe(true);
    expect(resposta.podeGerarProposta).toBe(true);
  });

  it("no modo APERTADO a varredura não muda nada — a frase continua sendo a da etapa mais nova", async () => {
    // O default apertado não foi tocado: sem `credenciado` a porta já era `false` de qualquer jeito,
    // e mudar a FRASE do Cecílio e da busca de proponentes seria mexer em quem não pediu.
    const client = clienteFake({
      esteira: [
        cad({ atualizado_em: "2026-09-20T12:00:00.000Z", etapa: "indeferido" }),
        cad({
          atualizado_em: "2026-09-26T17:11:31.401Z",
          enterprise_id: "43",
          etapa: "revisao",
        }),
      ],
      identificadores: [doC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA, "43"] },
      EXIGE_CREDENCIADA,
    );

    expect(resposta.podeGerarProposta).toBe(false);
    expect(resposta.etapa).toBe("revisao");
  });

  it("CAD credenciada gera nos DOIS modos, e é o único caso em que os dois campos são true", async () => {
    for (const modo of [COORDENADOR, EXIGE_CREDENCIADA]) {
      const client = clienteFake({
        esteira: [cad({ etapa: "credenciado" })],
        identificadores: [doC2x(ENTIDADE)],
      });

      const resposta = await credenciadoParaVender(
        client,
        { documento: CPF, enterpriseIds: [ALDEIA] },
        modo,
      );

      expect(resposta.credenciado).toBe(true);
      expect(resposta.podeGerarProposta).toBe(true);
      expect(resposta.motivo).toBeNull();
    }
  });

  it("SEM CAD no escopo continua barrado para o coordenador — não é etapa, é falta de entidade", async () => {
    // A CAD existe, mas no Vale do Ouro. A proposta é da Aldeia (42).
    const client = clienteFake({
      esteira: [cad({ enterprise_id: "35" })],
      identificadores: [doC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA] },
      COORDENADOR,
    );

    expect(resposta.podeGerarProposta).toBe(false);
    expect(resposta.etapa).toBeNull();
    expect(resposta.motivo).toBe("Este cliente não tem CAD neste empreendimento.");
  });

  it("CPF sem nenhuma entidade no Apolo continua barrado para o coordenador", async () => {
    const client = clienteFake({});

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA] },
      COORDENADOR,
    );

    expect(resposta.podeGerarProposta).toBe(false);
    expect(resposta.motivo).toBe(
      "Este CPF não tem cadastro no Apolo. Abra a CAD antes de gerar a proposta.",
    );
  });

  it("documento insuficiente continua barrado para o coordenador", async () => {
    const client = clienteFake({ esteira: [cad()], identificadores: [doC2x(ENTIDADE)] });

    const resposta = await credenciadoParaVender(
      client,
      { documento: "123", enterpriseIds: [ALDEIA] },
      COORDENADOR,
    );

    expect(resposta.podeGerarProposta).toBe(false);
    expect(resposta.motivo).toBe(
      "Informe o CPF ou o CNPJ do titular para conferir o credenciamento.",
    );
  });

  it("etapa fora do vocabulário não libera nem o coordenador — só o que a régua conhece passa", async () => {
    // A coluna é `text` sem CHECK (migration 0057). Uma etapa gravada à mão não pode virar porta
    // aberta só por não estar na lista de recusa.
    const client = clienteFake({
      esteira: [cad({ etapa: "aguardando o jurídico" })],
      identificadores: [doC2x(ENTIDADE)],
    });

    const resposta = await credenciadoParaVender(
      client,
      { documento: CPF, enterpriseIds: [ALDEIA] },
      COORDENADOR,
    );

    expect(resposta.podeGerarProposta).toBe(false);
  });

  it("erro de leitura da esteira continua virando FALHA, nunca liberação nem recusa", async () => {
    const client = clienteFake({
      erroEm: "apolo_esteira",
      esteira: [cad()],
      identificadores: [doC2x(ENTIDADE)],
    });

    await expect(
      credenciadoParaVender(client, { documento: CPF, enterpriseIds: [ALDEIA] }, COORDENADOR),
    ).rejects.toBeInstanceOf(FalhaAoLerCredenciamento);
  });

  it("erro de leitura das entidades também, e o escopo vazio também", async () => {
    await expect(
      credenciadoParaVender(
        clienteFake({ erroEm: "apolo_entity_identifiers" }),
        { documento: CPF, enterpriseIds: [ALDEIA] },
        COORDENADOR,
      ),
    ).rejects.toBeInstanceOf(FalhaAoLerCredenciamento);

    await expect(
      credenciadoParaVender(
        clienteFake({}),
        { documento: CPF, enterpriseIds: ["", "  "] },
        COORDENADOR,
      ),
    ).rejects.toBeInstanceOf(FalhaAoLerCredenciamento);
  });

  it("TODA etapa do vocabulário tem decisão escrita — etapa nova não nasce liberada por descuido", () => {
    // ⚠️ A VARREDURA É O QUE IMPEDE O AFROUXAMENTO CALADO. `ETAPAS_ESTEIRA` (lib/apolo/esteira.ts:19)
    // é o vocabulário; o dia em que alguém acrescentar uma etapa, ela precisa de uma decisão
    // explícita aqui, e não do lado que a régua chutar.
    for (const etapa of ETAPAS_ESTEIRA) {
      expect(Object.hasOwn(LIBERA_COM_CAD_EM_ANDAMENTO, etapa)).toBe(true);
    }
    expect(Object.keys(LIBERA_COM_CAD_EM_ANDAMENTO).sort()).toEqual([...ETAPAS_ESTEIRA].sort());
    // E as duas que NÃO são "em andamento": a que já libera sozinha e a que é recusa.
    expect(LIBERA_COM_CAD_EM_ANDAMENTO.indeferido).toBe(false);
    expect(LIBERA_COM_CAD_EM_ANDAMENTO.credenciado).toBe(true);
  });
});
