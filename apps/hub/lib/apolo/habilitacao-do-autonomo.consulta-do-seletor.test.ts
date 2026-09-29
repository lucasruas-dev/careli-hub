// A CONSULTA QUE DECIDE QUEM É AUTÔNOMO HABILITADO — contra o TETO DE 1.000 LINHAS e contra o SILÊNCIO.
//
// Lucas (28/09/2026), sobre a reserva do corretor autônomo: *"pode fazer, exige um dos dois"*. Quem
// responde "quais autônomos podem vender aqui" é `autonomosHabilitadosNoEmpreendimento`, e ela alimenta
// A LISTA do seletor (`quemPodeVender`) e O PORTÃO do POST (`podemVender`) — as duas pela mesma
// consulta, de propósito, para que a gravação aceite exatamente quem a lista ofereceu.
//
// ⚠️ ERA UMA LEITURA DA TABELA INTEIRA COM `.limit(2000)`, E O TETO DO PROJETO É 1.000 POR PÁGINA. A
// primeira versão lia TODOS os vínculos `empreendimento`/`verified` e separava a fonte em JavaScript
// depois. O `.limit(2000)` não levanta teto nenhum: o PostgREST corta em 1.000 SEM erro e SEM log, e a
// própria casa escreve isso em cinco arquivos (lib/apolo/carteira-da-venda.ts:159,
// lib/apolo/board-do-servidor.ts:918, lib/apolo/incorporador/assinaturas.ts:1378,
// lib/apolo/arquivos-do-produto-servidor.ts:290, lib/apolo/incorporador/imobiliarias-do-produto.ts:436).
//
// ⚠️ E O TETO ESTÁ A UM MÊS E MEIO, MEDIDO em produção (bxgukywoxgivlrhjkwjx, 28/09/2026, só SELECT):
//   • `select count(*) from apolo_relationships where relationship_type='empreendimento'` → 612, das
//     quais 605 `verified` (61% do teto);
//   • por mês de criação: 25 em julho, 325 em agosto, 262 em setembro — cada CAD do formulário público
//     grava uma dessas linhas;
//   • `... and metadata->>'source' = 'apolo-corretor-autonomo'` → 0 hoje (a fatia 1 não foi publicada).
// A habilitação do autônomo é UMA linha nesse mar. Passado o teto, ela simplesmente não vem na página,
// ele sai do seletor E o POST recusa dizendo que a coordenação não o habilitou — sem um erro em lugar
// nenhum. É o erro de diagnóstico do caso DANY CASTRO outra vez, e é o que estes testes fecham.

import { describe, expect, it, vi } from "vitest";

import {
  autonomosHabilitadosNoEmpreendimento,
  FONTE_DA_HABILITACAO_DO_AUTONOMO,
  MENSAGEM_FALHA_AO_LER_HABILITACAO,
} from "./habilitacao-do-autonomo";

const AUTONOMO = "aaaaaaaa-1111-4111-8111-111111111111";

type Linha = Record<string, unknown>;
type Consulta = {
  /** `metadata->>source` incluído: é a prova de que a fonte foi filtrada NO SERVIDOR. */
  filtros: Record<string, unknown>;
  ordens: string[];
  paginou: boolean;
  tabela: string;
};

/**
 * O BANCO FALSO QUE IMITA O TETO DE 1.000 LINHAS, e não um dublê que devolve resposta pronta.
 *
 * ⚠️ É O TETO QUE ESTÁ SOB TESTE: um duplo que devolvesse tudo o que foi semeado provaria só a si
 * mesmo. Aqui `range(de, ate)` nunca entrega mais de 1.000 linhas, e uma consulta sem `range` também
 * para em 1.000 — exatamente como o PostgREST, calado.
 */
function bancoDaCasa(
  tabelas: Record<string, Linha[]>,
  opcoes?: { falharEm?: string; lancarEm?: string },
) {
  const consultas: Consulta[] = [];
  const TETO = 1000;

  const from = (tabela: string) => {
    if (opcoes?.lancarEm === tabela) throw new Error("conexao caiu");
    let linhas = [...(tabelas[tabela] ?? [])];
    const consulta: Consulta = { filtros: {}, ordens: [], paginou: false, tabela };
    consultas.push(consulta);

    const q: Record<string, unknown> = {};
    q.select = () => q;
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
    q.order = (coluna: string) => {
      consulta.ordens.push(coluna);
      return q;
    };
    q.limit = (n: number) => {
      linhas = linhas.slice(0, Math.min(n, TETO));
      return q;
    };
    q.range = (de: number, ate: number) => {
      consulta.paginou = true;
      linhas = linhas.slice(de, de + Math.min(ate - de + 1, TETO));
      return q;
    };
    q.maybeSingle = async () => ({ data: linhas[0] ?? null, error: null });
    q.then = (resolver: (r: unknown) => unknown) => {
      const resposta =
        opcoes?.falharEm === tabela
          ? { data: null, error: { message: "timeout" } }
          : { data: linhas.slice(0, TETO), error: null };
      return Promise.resolve(resposta).then(resolver);
    };
    return q;
  };

  return { cliente: { from } as never, consultas };
}

/** Um vínculo de CAD pública: a linha que cresce sozinha e que empurrava o autônomo para fora. */
const cadPublica = (n: number): Linha => ({
  created_at: `2026-08-${String((n % 28) + 1).padStart(2, "0")}T12:00:00.000Z`,
  entity_id: `cli-${n}`,
  id: `rel-cad-${n}`,
  metadata: { enterpriseId: "37", source: "publico-cad" },
  relationship_type: "empreendimento",
  status: "verified",
});

/** O vínculo da habilitação do autônomo: UMA linha, e a mais nova de todas. */
const habilitacaoDoAutonomo: Linha = {
  created_at: "2026-09-28T12:00:00.000Z",
  entity_id: AUTONOMO,
  id: "rel-autonomo-37",
  metadata: { enterpriseId: "37", source: FONTE_DA_HABILITACAO_DO_AUTONOMO },
  relationship_type: "empreendimento",
  status: "verified",
};

const FICHA_DO_AUTONOMO: Linha = {
  broker_code: "CA-0001",
  display_name: "JOAO AUTONOMO",
  entity_kind: "pf",
  id: AUTONOMO,
  legal_name: null,
};

function base(vinculos: Linha[], opcoes?: { falharEm?: string; lancarEm?: string }) {
  return bancoDaCasa(
    {
      apolo_entities: [FICHA_DO_AUTONOMO],
      apolo_entity_profiles: [{ entity_id: AUTONOMO, profile: "corretor", status: "active" }],
      apolo_relationships: vinculos,
    },
    opcoes,
  );
}

describe("a fonte é filtrada no SERVIDOR, e por isso o teto não alcança o autônomo", () => {
  it("⚠️ a consulta manda `metadata->>source` ao banco, com a fonte da porta do autônomo", async () => {
    const banco = base([habilitacaoDoAutonomo]);
    await autonomosHabilitadosNoEmpreendimento(banco.cliente, ["37"]);

    const dosVinculos = banco.consultas.find((c) => c.tabela === "apolo_relationships");
    expect(dosVinculos?.filtros["metadata->>source"]).toBe(FONTE_DA_HABILITACAO_DO_AUTONOMO);
    // Sem `order` o que sobra de um corte é a ordem física, que não é ordem nenhuma; e sem `range` não
    // existe segunda página. As duas coisas são a rede dupla, no mesmo lugar em que
    // `habilitacoesRecentes` já as tem (lib/apolo/board-do-servidor.ts:938-953).
    expect(dosVinculos?.ordens).toEqual(["created_at", "id"]);
    expect(dosVinculos?.paginou).toBe(true);
  });

  it("⚠️ com 1.200 CADs públicas na frente, o autônomo CONTINUA na lista", async () => {
    // É o cenário de novembro: `apolo_relationships` passa de 1.000 vínculos
    // `empreendimento`/`verified` e a linha do autônomo é a mais nova. Lendo a tabela inteira, ela fica
    // fora da primeira página e ele desaparece do seletor e do portão, calado.
    const banco = base([...Array.from({ length: 1200 }, (_, k) => cadPublica(k)), habilitacaoDoAutonomo]);
    const lista = await autonomosHabilitadosNoEmpreendimento(banco.cliente, ["37"]);

    expect(lista).toEqual({
      autonomos: [{ codigo: "CA-0001", entityId: AUTONOMO, nome: "JOAO AUTONOMO" }],
      ok: true,
    });
  });

  it("⚠️ e a CAD pública NÃO habilita ninguém, nem sendo 1.200 linhas `verified`", async () => {
    // A cerca 1 da fatia 2, de novo: os 169 vínculos `publico-cad` em `pf` medidos em produção não são
    // habilitação, são a marca de qual produto é a CAD daquele cliente.
    const banco = base(Array.from({ length: 1200 }, (_, k) => cadPublica(k)));
    expect(await autonomosHabilitadosNoEmpreendimento(banco.cliente, ["37"])).toEqual({
      autonomos: [],
      ok: true,
    });
  });
});

describe("falha de leitura NÃO é lista vazia", () => {
  it("⚠️ erro do PostgREST nos vínculos devolve `ok: false` com a frase da falha", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const banco = base([habilitacaoDoAutonomo], { falharEm: "apolo_relationships" });
    expect(await autonomosHabilitadosNoEmpreendimento(banco.cliente, ["37"])).toEqual({
      mensagem: MENSAGEM_FALHA_AO_LER_HABILITACAO,
      motivo: "falha",
      ok: false,
    });
    log.mockRestore();
  });

  it("⚠️ erro ao ler os PAPÉIS também é falha, e não 'não há autônomo'", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const banco = base([habilitacaoDoAutonomo], { falharEm: "apolo_entity_profiles" });
    const r = await autonomosHabilitadosNoEmpreendimento(banco.cliente, ["37"]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe("falha");
    log.mockRestore();
  });

  it("⚠️ erro ao ler as FICHAS também é falha", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const banco = base([habilitacaoDoAutonomo], { falharEm: "apolo_entities" });
    const r = await autonomosHabilitadosNoEmpreendimento(banco.cliente, ["37"]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.motivo).toBe("falha");
    log.mockRestore();
  });

  it("⚠️ EXCEÇÃO não sobe: ela rodava dentro de um `Promise.all` e derrubava a modal para TODO MUNDO", async () => {
    // `quemPodeVender` lê imobiliárias e autônomos em paralelo (lib/hercules/quem-pode-vender.ts:142).
    // Uma exceção aqui rejeitava o `Promise.all`, o GET caía no `catch` da rota e virava 503: a modal de
    // reserva deixava de carregar até para quem só vende por imobiliária, por causa de uma consulta que
    // hoje devolve vazio em 100% dos empreendimentos.
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const banco = base([habilitacaoDoAutonomo], { lancarEm: "apolo_relationships" });
    const r = await autonomosHabilitadosNoEmpreendimento(banco.cliente, ["37"]);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.mensagem).toBe(MENSAGEM_FALHA_AO_LER_HABILITACAO);
    log.mockRestore();
  });
});
