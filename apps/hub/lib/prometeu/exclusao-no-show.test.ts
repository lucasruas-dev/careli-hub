import { describe, expect, it } from "vitest";

import { excluirCredenciado, MOTIVO_NO_SHOW_DEFINITIVO } from "./data";

// O NO-SHOW DEFINITIVO (decisão D2 do Lucas, 27/07): "no-show" passa a significar TIRAR DE VEZ.
// A marca escolhida foi `encerrado_em`, a mesma do encerramento do dia — é o único carimbo que já
// é filtrado por toda listagem do Prometeu, então uma escrita só faz a pessoa sumir das filas, da
// aba de retorno e das demais telas.
//
// O que estes testes travam é a DECISÃO, não o SQL: onde o carimbo cai, o que mais precisa ser
// solto junto (chamada em aberto e mesa) e quem NÃO pode ser recarimbado.

type Escrita = { tabela: string; valores: Record<string, unknown> };

function clientFalso(config: {
  escritas?: Escrita[];
  pessoa?: { encerrado_em: string | null; id: string } | null;
}) {
  const construir = (tabela: string) => {
    const encadeavel = {
      eq: () => encadeavel,
      is: () => encadeavel,
      limit: () => encadeavel,
      maybeSingle: async () => ({
        data: config.pessoa === undefined ? null : config.pessoa,
      }),
      order: () => encadeavel,
      select: () => encadeavel,
      update: (valores: Record<string, unknown>) => {
        config.escritas?.push({ tabela, valores });

        // O update do Supabase é "thenable": resolve com { error } no fim de qualquer cadeia de
        // filtros. O dublê reproduz isso para `.eq()`, `.eq().is()` e o await direto.
        const resultado = { error: null };
        const cadeia = {
          eq: () => cadeia,
          is: () => cadeia,
          then: (resolver: (v: { error: null }) => unknown) => resolver(resultado),
        };

        return cadeia;
      },
    };

    return { ...encadeavel, insert: async () => ({ error: null }) };
  };

  return { from: (tabela: string) => construir(tabela) } as never;
}

const NA_OPERACAO = { encerrado_em: null, id: "c1" };

describe("excluirCredenciado", () => {
  it("carimba encerrado_em com o motivo do no-show", async () => {
    const escritas: Escrita[] = [];

    const r = await excluirCredenciado({
      client: clientFalso({ escritas, pessoa: NA_OPERACAO }),
      credenciadoId: "c1",
    });

    expect(r.ok).toBe(true);

    const carimbo = escritas.find((e) => e.tabela === "prometeu_credenciados");
    expect(carimbo?.valores.encerrado_em).toEqual(expect.any(String));
    expect(carimbo?.valores.encerrado_motivo).toBe(MOTIVO_NO_SHOW_DEFINITIVO);
    // A etapa NÃO muda: "cancelado" no Prometeu é desistência da COMPRA, outra coisa.
    expect(carimbo?.valores.etapa).toBeUndefined();
  });

  // O painel de trânsito lê as chamadas, não o encerramento: sem fechar a chamada aberta, o
  // excluído continuaria "a caminho" na tela de quem o chamou, para sempre.
  it("fecha a chamada em aberto para nao deixar a pessoa presa no transito", async () => {
    const escritas: Escrita[] = [];

    await excluirCredenciado({
      client: clientFalso({ escritas, pessoa: NA_OPERACAO }),
      credenciadoId: "c1",
    });

    const chamada = escritas.find((e) => e.tabela === "prometeu_chamadas");
    expect(chamada?.valores.atendido_em).toEqual(expect.any(String));
  });

  // Mesa presa a alguém que sumiu da lista não teria como ser destravada pela tela depois.
  it("solta a mesa que estava reservada para ele", async () => {
    const escritas: Escrita[] = [];

    await excluirCredenciado({
      client: clientFalso({ escritas, pessoa: NA_OPERACAO }),
      credenciadoId: "c1",
    });

    const mesa = escritas.find((e) => e.tabela === "prometeu_mesas");
    expect(mesa?.valores.estado).toBe("livre");
    expect(mesa?.valores.credenciado_id).toBeNull();
  });

  // Quem já saiu no encerramento do dia não pode ter o motivo reescrito por um duplo clique: o
  // motivo é a resposta para "por que essa pessoa não está mais na operação".
  it("nao recarimba quem ja esta fora da operacao", async () => {
    const escritas: Escrita[] = [];

    const r = await excluirCredenciado({
      client: clientFalso({
        escritas,
        pessoa: { encerrado_em: "2026-08-01T20:00:00.000Z", id: "c1" },
      }),
      credenciadoId: "c1",
    });

    expect(r.ok).toBe(true);
    expect(escritas).toHaveLength(0);
  });

  it("recusa credenciado inexistente", async () => {
    const r = await excluirCredenciado({
      client: clientFalso({ pessoa: null }),
      credenciadoId: "nao-existe",
    });

    expect(r.ok).toBe(false);
    expect(r.error).toContain("nao encontrado");
  });

  // Motivo digitado (se um dia a tela pedir) manda; espaço em branco não vira motivo vazio.
  it("aceita motivo proprio e ignora motivo em branco", async () => {
    const comMotivo: Escrita[] = [];
    await excluirCredenciado({
      client: clientFalso({ escritas: comMotivo, pessoa: NA_OPERACAO }),
      credenciadoId: "c1",
      motivo: "Foi embora antes de ser chamado",
    });

    expect(
      comMotivo.find((e) => e.tabela === "prometeu_credenciados")?.valores
        .encerrado_motivo,
    ).toBe("Foi embora antes de ser chamado");

    const emBranco: Escrita[] = [];
    await excluirCredenciado({
      client: clientFalso({ escritas: emBranco, pessoa: NA_OPERACAO }),
      credenciadoId: "c1",
      motivo: "   ",
    });

    expect(
      emBranco.find((e) => e.tabela === "prometeu_credenciados")?.valores
        .encerrado_motivo,
    ).toBe(MOTIVO_NO_SHOW_DEFINITIVO);
  });
});
