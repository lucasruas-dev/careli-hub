// O SELETOR E O PORTÃO DA RESERVA DO CORRETOR AUTÔNOMO — a frase certa, e a falha contada.
//
// Lucas (28/09/2026): *"pode fazer, exige um dos dois"*. A lista (`quemPodeVender`) e o portão do POST
// (`podemVender`) usam a MESMA consulta, de propósito. Este arquivo cobre os dois jeitos de essa peça
// mentir para o coordenador.
//
// ⚠️ 1. A FRASE DA RECUSA ERA A DA CAD, NUM PORTÃO DE RESERVA (revisão de 28/09/2026).
// `MENSAGEM_AUTONOMO_SEM_HABILITACAO` diz *"a CAD do cliente dele não pode ser aberta aqui"* e voltava
// como motivo do 403 da reserva: quem está RESERVANDO um lote lia uma frase sobre abrir CAD, que é outra
// tela e outro momento do processo. É o mesmo defeito que `RESERVA_SEM_QUEM_VENDE` foi criada para
// consertar duas linhas antes, com a justificativa escrita lá: *"quem lesse isso numa venda de corretor
// autônomo iria pedir credenciamento de imobiliária, que é o caminho errado e demora dias"*.
//
// ⚠️ 2. FALHA DE LEITURA VIRAVA "NÃO ESTÁ HABILITADO", E NO GET VIRAVA SILÊNCIO. A consulta devolvia `[]`
// no erro, e `[]` no portão é recusa e na lista é "ninguém habilitado". Três linhas acima, no MESMO
// arquivo, o ramo da imobiliária faz o oposto e devolve/lança o erro de verdade. Instabilidade de dez
// segundos no Supabase fazia o coordenador pedir à coordenação uma habilitação que já existe, e são dias
// de espera para uma reserva que sairia no minuto seguinte com um F5.
//
// ⚠️ MEDIDO em produção (bxgukywoxgivlrhjkwjx, 28/09/2026, só SELECT): `select count(*) from
// apolo_entities where broker_code is not null` → 0, e vínculos com
// `metadata->>'source' = 'apolo-corretor-autonomo'` → 0. Não há autônomo em produção hoje: a PRIMEIRA vez
// que isso acontecer vai parecer defeito da fatia 1, e não instabilidade.

import { describe, expect, it, vi } from "vitest";

import {
  FONTE_DA_HABILITACAO_DO_AUTONOMO,
  MENSAGEM_AUTONOMO_NAO_VENDE_AQUI,
  MENSAGEM_AUTONOMO_SEM_HABILITACAO,
  MENSAGEM_FALHA_AO_LER_HABILITACAO,
} from "@/lib/apolo/habilitacao-do-autonomo";

import { podemVender, quemPodeVender } from "./quem-pode-vender";

const AUTONOMO = "aaaaaaaa-1111-4111-8111-111111111111";
const IMOBILIARIA = "dddddddd-4444-4444-8444-444444444444";

type Linha = Record<string, unknown>;
type Consulta = { filtros: Record<string, unknown>; tabela: string };

/**
 * O banco falso, com falha SELETIVA por consulta.
 *
 * ⚠️ A FALHA TEM DE SER DE UM LADO SÓ. As imobiliárias e os autônomos saem da MESMA tabela
 * (`apolo_relationships`): o que os separa é o filtro `metadata->>source`, que só a consulta do autônomo
 * manda. Sem poder derrubar uma e não a outra, o teste não distinguiria as duas doutrinas.
 */
function bancoDaCasa(tabelas: Record<string, Linha[]>, falhar?: (c: Consulta) => boolean) {
  const from = (tabela: string) => {
    let linhas = [...(tabelas[tabela] ?? [])];
    const consulta: Consulta = { filtros: {}, tabela };
    const q: Record<string, unknown> = {};
    for (const metodo of ["limit", "order", "range", "returns", "select"]) q[metodo] = () => q;
    q.eq = (coluna: string, valor: unknown) => {
      consulta.filtros[coluna] = valor;
      const jsonb = /^([a-z_]+)->>([a-zA-Z_]+)$/.exec(coluna);
      linhas = linhas.filter((linha) => {
        const bruto = jsonb
          ? (linha[jsonb[1] as string] as null | Record<string, unknown>)?.[jsonb[2] as string]
          : linha[coluna];
        return String(bruto ?? null) === String(valor);
      });
      return q;
    };
    q.in = (coluna: string, valores: unknown[]) => {
      linhas = linhas.filter((linha) => valores.map(String).includes(String(linha[coluna] ?? null)));
      return q;
    };
    q.not = (coluna: string) => {
      linhas = linhas.filter((linha) => linha[coluna] !== null && linha[coluna] !== undefined);
      return q;
    };
    q.maybeSingle = async () => ({ data: linhas[0] ?? null, error: null });
    q.then = (resolver: (r: unknown) => unknown) =>
      Promise.resolve(
        falhar?.(consulta)
          ? { data: null, error: { message: "timeout" } }
          : { data: linhas, error: null },
      ).then(resolver);
    return q;
  };
  return { from } as never;
}

/** Só a consulta do AUTÔNOMO manda `metadata->>source`; a da imobiliária, não. */
const soADoAutonomo = (c: Consulta) =>
  c.tabela === "apolo_relationships" && "metadata->>source" in c.filtros;

function base(falhar?: (c: Consulta) => boolean) {
  return bancoDaCasa(
    {
      apolo_contacts: [],
      apolo_entities: [
        {
          broker_code: "CA-0001",
          display_name: "JOAO AUTONOMO",
          document_masked: "529.982.247-25",
          entity_kind: "pf",
          id: AUTONOMO,
          legal_name: null,
        },
        {
          broker_code: null,
          display_name: "RR SOLUCOES LTDA",
          document_masked: "60.054.065/0001-41",
          entity_kind: "pj",
          id: IMOBILIARIA,
          legal_name: "RR SOLUCOES LTDA",
        },
      ],
      apolo_entity_profiles: [
        { entity_id: AUTONOMO, profile: "corretor", status: "active" },
        { entity_id: IMOBILIARIA, profile: "imobiliaria", status: "active" },
      ],
      apolo_relationships: [
        {
          created_at: "2026-09-28T12:00:00.000Z",
          entity_id: AUTONOMO,
          id: "rel-autonomo-37",
          metadata: { enterpriseId: "37", source: FONTE_DA_HABILITACAO_DO_AUTONOMO },
          relationship_type: "empreendimento",
          status: "verified",
        },
        {
          created_at: "2026-09-20T12:00:00.000Z",
          entity_id: IMOBILIARIA,
          id: "rel-imob-37",
          metadata: { enterpriseId: "37", source: "apolo-credenciamento" },
          relationship_type: "empreendimento",
          status: "verified",
        },
      ],
    },
    falhar,
  );
}

describe("a frase da recusa é a da VENDA, não a da CAD", () => {
  it("⚠️ o autônomo NÃO habilitado aqui é recusado sem a palavra CAD na frase", async () => {
    const r = await podemVender(base(), ["39"], { corretorId: AUTONOMO, imobiliariaId: null });

    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe(MENSAGEM_AUTONOMO_NAO_VENDE_AQUI);
    // A prova do defeito: a frase da CAD fala de outra tela, e não pode chegar a quem reserva um lote.
    expect(!r.ok && r.motivo).not.toContain("CAD");
    expect(MENSAGEM_AUTONOMO_SEM_HABILITACAO).toContain("CAD");
    // E o diagnóstico continua sendo o mesmo: o caminho é a coordenação do produto.
    expect(!r.ok && r.motivo).toContain("coordenação do produto");
    expect(!r.ok && r.status).toBe(403);
  });

  it("o autônomo habilitado passa, sem imobiliária nenhuma", async () => {
    expect(await podemVender(base(), ["37"], { corretorId: AUTONOMO, imobiliariaId: null })).toEqual({
      ok: true,
    });
  });
});

describe("falha de leitura não é 'não está habilitado'", () => {
  it("⚠️ no PORTÃO, a falha recusa com a frase da falha e status 503", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const r = await podemVender(base(soADoAutonomo), ["37"], {
      corretorId: AUTONOMO,
      imobiliariaId: null,
    });

    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe(MENSAGEM_FALHA_AO_LER_HABILITACAO);
    // 403 é "você não pode" e a tela trata como decisão do cadastro; 503 é "não sei, tente de novo".
    expect(!r.ok && r.status).toBe(503);
    log.mockRestore();
  });

  it("⚠️ na LISTA, a falha LANÇA — a tela não pode desenhar lista curta como se fosse completa", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(quemPodeVender(base(soADoAutonomo), ["37"])).rejects.toThrow(
      MENSAGEM_FALHA_AO_LER_HABILITACAO,
    );
    log.mockRestore();
  });

  it("a lista sadia traz o autônomo em campo PRÓPRIO, e NUNCA entre as imobiliárias", async () => {
    const lista = await quemPodeVender(base(), ["37"]);

    expect(lista.autonomos.map((a) => a.entityId)).toEqual([AUTONOMO]);
    expect(lista.imobiliarias.map((i) => i.id)).toEqual([IMOBILIARIA]);
    expect(JSON.stringify(lista.imobiliarias)).not.toContain("AUTONOMO");
    expect(JSON.stringify(lista.corretores)).not.toContain("AUTONOMO");
  });
});
