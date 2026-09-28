import { describe, expect, it } from "vitest";

// O CORRETOR AUTÔNOMO NUNCA APARECE COMO IMOBILIÁRIA — a exigência literal do Lucas (27/09/2026):
// *"nao quero ter a informacao que pode ter pessoa fisica como imobiliaria, isso sera bem restrito"*.
//
// A fatia 2 reusa a MESMA estrutura de vínculo da imobiliária para habilitar o autônomo
// (`apolo_relationships` com `relationship_type = 'empreendimento'` e `status = 'verified'`). Isso é
// detalhe INTERNO, e este arquivo é a cerca: nenhuma lista, seletor, coluna, contagem ou relatório de
// imobiliária pode devolvê-lo.
//
// ⚠️ ONDE A REGRA SE SUSTENTA, MEDIDO EM PRODUÇÃO (bxgukywoxgivlrhjkwjx, 28/09/2026):
//   • É O PAPEL, E NÃO A COLUNA. O seletor do wizard sai de
//     `apolo_entity_profiles.profile = 'imobiliaria'` (lib/apolo/server.ts:490), e há 483 linhas com
//     esse papel, TODAS `entity_kind = 'pj'`, contra 132 com papel `corretor`, TODAS `pf`: ZERO
//     entidade `pf` com papel de imobiliária. No dia em que alguém der o papel `imobiliaria` ao
//     autônomo para resolver a habilitação, ele aparece no seletor, na lista e no relatório;
//   • O SLOT DA ESTEIRA SEGUE A MESMA LÓGICA. `imobiliaria_entity_id` aponta para PJ em 100% dos
//     casos e `corretor_entity_id` para PF em 186 de 186. O autônomo vai no do corretor;
//   • A CONTAGEM POR IMOBILIÁRIA DO CRM E DA ABA DO PRODUTO LÊ `imobiliaria_entity_id` e ignora nulo
//     (lib/apolo/incorporador/crm.ts:507, imobiliarias-do-produto.ts:251), então ele não entra nelas
//     nem por acidente.

import { contarCadsPorImobiliaria } from "@/lib/apolo/incorporador/crm";
import { loadApoloImobiliarias } from "@/lib/apolo/server";

import { podemVender } from "@/lib/hercules/quem-pode-vender";

import {
  autonomosHabilitadosNoEmpreendimento,
  listarCorretoresAutonomos,
} from "./habilitacao-do-autonomo";

const AUTONOMO = "aaaaaaaa-1111-4111-8111-111111111111";
const IMOBILIARIA = "dddddddd-4444-4444-8444-444444444444";
const CLIENTE_DO_AUTONOMO = "11111111-1111-4111-8111-111111111111";
const CLIENTE_DA_IMOBILIARIA = "22222222-2222-4222-8222-222222222222";

type Linha = Record<string, unknown>;

function bancoFalso(tabelas: Record<string, Linha[]>) {
  const from = (tabela: string) => {
    let linhas = [...(tabelas[tabela] ?? [])];
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (coluna: string, valor: unknown) => {
      // ⚠️ O BANCO FALSO PRECISA ENTENDER `metadata->>chave` (revisão de 28/09/2026). A consulta dos
      // autônomos passou a filtrar a FONTE no SQL, e um `eq` que só olhasse colunas cruas devolveria
      // ZERO linha aqui: o teste passaria dizendo "não há autônomo habilitado", que é o oposto do que
      // ele prova. Ver `vinculosDaHabilitacaoDoAutonomo`.
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
    q.neq = (coluna: string, valor: unknown) => {
      linhas = linhas.filter((linha) => String(linha[coluna] ?? null) !== String(valor));
      return q;
    };
    q.not = (coluna: string) => {
      linhas = linhas.filter((linha) => linha[coluna] !== null && linha[coluna] !== undefined);
      return q;
    };
    q.ilike = (coluna: string, padrao: string) => {
      const prefixo = String(padrao).replace(/%/g, "").toLowerCase();
      linhas = linhas.filter((linha) =>
        String(linha[coluna] ?? "").toLowerCase().startsWith(prefixo),
      );
      return q;
    };
    for (const metodo of ["limit", "order", "range", "returns"]) q[metodo] = () => q;
    q.maybeSingle = async () => ({ data: linhas[0] ?? null, error: null });
    q.then = (resolver: (r: unknown) => unknown) =>
      Promise.resolve({ data: linhas, error: null }).then(resolver);
    return q;
  };
  return { from } as never;
}

// O autônomo da fatia 1: entidade `pf`, papel `corretor`, código `CA-0001`, SEM imobiliária. E o
// autônomo HABILITADO no 37 pela fatia 2, com o mesmo `relationship_type` da imobiliária.
function base() {
  return bancoFalso({
    apolo_entities: [
      {
        broker_code: "CA-0001",
        display_name: "JOAO AUTONOMO",
        entity_kind: "pf",
        id: AUTONOMO,
        legal_name: null,
        status: "active",
      },
      {
        broker_code: null,
        display_name: "RR SOLUCOES LTDA",
        entity_kind: "pj",
        id: IMOBILIARIA,
        legal_name: "RR SOLUCOES LTDA",
        status: "active",
      },
    ],
    apolo_entity_profiles: [
      { entity_id: AUTONOMO, profile: "corretor", status: "active" },
      { entity_id: IMOBILIARIA, profile: "imobiliaria", status: "active" },
    ],
    apolo_relationships: [
      {
        entity_id: AUTONOMO,
        id: "rel-autonomo-37",
        label: "VALE DO OURO",
        metadata: { enterpriseId: "37", source: "apolo-corretor-autonomo" },
        relationship_type: "empreendimento",
        status: "verified",
      },
      {
        entity_id: IMOBILIARIA,
        id: "rel-imob-37",
        label: "VALE DO OURO",
        metadata: { enterpriseId: "37", source: "apolo-credenciamento" },
        relationship_type: "empreendimento",
        status: "verified",
      },
    ],
  });
}

describe("o autônomo fora de toda lista de imobiliária", () => {
  it("⚠️ o seletor de imobiliária do wizard não o traz, mesmo habilitado num empreendimento", async () => {
    const lista = await loadApoloImobiliarias(base());
    expect(lista.map((item) => item.id)).toEqual([IMOBILIARIA]);
    expect(JSON.stringify(lista)).not.toContain("AUTONOMO");
  });

  it("⚠️ a contagem de CADs por imobiliária do CRM do incorporador não o conta", async () => {
    // Duas CADs no 37: a do cliente do autônomo (sem imobiliária) e a do cliente da imobiliária.
    const contagem = contarCadsPorImobiliaria([
      {
        corretor: "JOAO AUTONOMO",
        corretor_entity_id: AUTONOMO,
        enterprise_id: "37",
        entity_id: CLIENTE_DO_AUTONOMO,
        etapa: "credenciado",
        imobiliaria: null,
        imobiliaria_entity_id: null,
      },
      {
        corretor: "PEDRO DA RR",
        corretor_entity_id: null,
        enterprise_id: "37",
        entity_id: CLIENTE_DA_IMOBILIARIA,
        etapa: "credenciado",
        imobiliaria: "RR SOLUCOES",
        imobiliaria_entity_id: IMOBILIARIA,
      },
    ] as never);

    expect(contagem.has(AUTONOMO)).toBe(false);
    expect(contagem.get(IMOBILIARIA)).toBe(1);
    expect([...contagem.keys()]).toEqual([IMOBILIARIA]);
  });

  it("a lista de autônomos e a de imobiliárias são conjuntos disjuntos", async () => {
    const autonomos = await listarCorretoresAutonomos(base());
    const imobiliarias = await loadApoloImobiliarias(base());
    const ids = new Set(imobiliarias.map((item) => item.id));
    expect(autonomos.map((a) => a.entityId)).toEqual([AUTONOMO]);
    expect(autonomos.some((a) => ids.has(a.entityId))).toBe(false);
  });
});

// ── A TERCEIRA PORTA: O SELETOR DA RESERVA (fatia 3, 28/09/2026) ─────────────
//
// Lucas (28/09/2026): a reserva passa a exigir *"um dos dois"*, imobiliária OU corretor autônomo. O
// autônomo precisa aparecer NESSE seletor e não aparecer em NENHUMA lista de imobiliária.
//
// ⚠️ CONSULTA PRÓPRIA, E NÃO UMA LINHA NOVA EM `lerImobiliariasVinculadas`. Aquela função tem QUATRO
// outros consumidores fora do Hércules (`/api/apolo/imobiliarias`, `/api/incorporador/crm`,
// `/api/incorporador/produto/imobiliarias`, `/api/incorporador/produto/resumo`), e um autônomo ali
// apareceria no CRM, na aba do produto e no resumo. O caminho novo é
// `autonomosHabilitadosNoEmpreendimento`, com as MESMAS duas cercas da fatia 2: a fonte como LISTA
// DE INCLUSÃO e a tripla código + `pf` + papel `corretor`, recusando quem tenha papel `imobiliaria`.
describe("o seletor da reserva oferece o autônomo por porta própria", () => {
  it("⚠️ `autonomosHabilitadosNoEmpreendimento` o devolve no empreendimento habilitado", async () => {
    const lista = await autonomosHabilitadosNoEmpreendimento(base(), ["37"]);
    expect(lista).toEqual({
      autonomos: [{ codigo: "CA-0001", entityId: AUTONOMO, nome: "JOAO AUTONOMO" }],
      ok: true,
    });
  });

  it("⚠️ e NÃO o devolve em empreendimento onde ele não foi habilitado", async () => {
    expect(await autonomosHabilitadosNoEmpreendimento(base(), ["39"])).toEqual({
      autonomos: [],
      ok: true,
    });
  });

  it("⚠️ a imobiliária credenciada NUNCA sai por esta porta, nem com o mesmo relationship_type", async () => {
    // As duas habilitações são o MESMO `relationship_type = 'empreendimento'` `verified`; o que as
    // separa é a fonte (lista de inclusão) e o papel.
    const lista = await autonomosHabilitadosNoEmpreendimento(base(), ["37"]);
    expect(lista.ok && lista.autonomos.some((item) => item.entityId === IMOBILIARIA)).toBe(false);
  });

  it("escopo vazio devolve vazio, sem ir ao banco perguntar por todo mundo", async () => {
    expect(await autonomosHabilitadosNoEmpreendimento(base(), [])).toEqual({
      autonomos: [],
      ok: true,
    });
  });
});

// ⚠️ A LISTA FILTRA, O POST CONFERE. Sem esta segunda porta, um pedido montado à mão reservaria no
// nome de qualquer entidade do Apolo — é a mesma razão pela qual `podemVender` já existe para a
// imobiliária.
describe("podemVender com o corretor autônomo", () => {
  it("⚠️ aceita o autônomo habilitado, sem imobiliária nenhuma", async () => {
    expect(await podemVender(base(), ["37"], { corretorId: AUTONOMO, imobiliariaId: null })).toEqual({
      ok: true,
    });
  });

  it("⚠️ recusa o autônomo NÃO habilitado neste empreendimento", async () => {
    const r = await podemVender(base(), ["39"], { corretorId: AUTONOMO, imobiliariaId: null });
    expect(r.ok).toBe(false);
  });

  it("⚠️ recusa o pedido SEM NENHUM DOS DOIS", async () => {
    const r = await podemVender(base(), ["37"], { corretorId: null, imobiliariaId: null });
    expect(r.ok).toBe(false);
  });

  it("⚠️ recusa a imobiliária mandada no lugar do autônomo: ela não passa pela porta do corretor", async () => {
    // O contrário do vazamento: pôr uma PJ no slot do corretor autônomo.
    const r = await podemVender(base(), ["37"], { corretorId: IMOBILIARIA, imobiliariaId: null });
    expect(r.ok).toBe(false);
  });
});
