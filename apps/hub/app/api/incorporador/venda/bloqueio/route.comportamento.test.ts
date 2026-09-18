import { beforeEach, describe, expect, it, vi } from "vitest";

import { MOTIVOS_DE_BLOQUEIO } from "@/lib/hercules/bloqueio-de-unidade";

// A ROTA DO BLOQUEIO CHAMADA DE VERDADE — "só bloqueia lote livre" pela régua única.
//
// Lucas (18/09/2026): *"esses status tem que morar em um so lugar"*. A rota deixou de fazer a conta
// dela (cadastro + propostas do terreno) e passou a perguntar a `situacao-da-unidade.ts`, a mesma
// régua que pinta a grade. Aqui a régua roda DE VERDADE sobre um banco falso que entende os
// filtros (`eq`, `in`, `not ... is null`): o que se prova é o que a rota decide com o que a régua
// responde, inclusive o caso que a conta antiga deixava passar — o lote reservado no evento.
//
// Porta, escopo e régua de escrita são falsos (têm os testes deles); o resto é o de verdade.

type Linha = Record<string, unknown>;

const estado = vi.hoisted(() => ({
  /** Tabela cuja leitura falha. */
  falha: null as null | string,
  gravacoes: [] as Array<{ ids: unknown[]; tabela: string; valores: Linha }>,
  tabelas: {} as Record<string, Linha[]>,
}));

vi.mock("@/lib/apolo/incorporador/board-do-portal", () => ({
  autorizarOperacaoDeVenda: () => ({ ok: true, sessao: { slug: "gurgel", tipo: "comercial" } }),
}));

vi.mock("@/lib/apolo/incorporador/escopo", () => ({
  idsDaSessao: async () => ["34", "37"],
}));

vi.mock("@/lib/apolo/incorporador/operacao-do-produto-servidor", () => ({
  autorizarEscritaNoProduto: async () => ({
    ok: true,
    sessao: { usuarioId: "usr-1", usuarioNome: "Coordenadora" },
  }),
}));

vi.mock("@/lib/apolo/server", () => {
  const consulta = (tabela: string) => {
    const filtros: Array<(l: Linha) => boolean> = [];
    let atualizacao: Linha | null = null;
    let unica = false;
    const resposta = () => {
      if (estado.falha === tabela) return { data: null, error: { message: `${tabela} fora do ar` } };
      const achadas = (estado.tabelas[tabela] ?? []).filter((l) => filtros.every((f) => f(l)));
      if (atualizacao) {
        estado.gravacoes.push({ ids: achadas.map((l) => l.id), tabela, valores: atualizacao });
        for (const l of achadas) Object.assign(l, atualizacao);
        return { data: achadas.map((l) => ({ id: l.id })), error: null };
      }
      if (unica) return { data: achadas[0] ?? null, error: null };
      return { data: achadas, error: null };
    };
    const cadeia: Linha = {
      eq: (coluna: string, valor: unknown) => {
        filtros.push((l) => String(l[coluna]) === String(valor));
        return cadeia;
      },
      in: (coluna: string, valores: unknown[]) => {
        const aceitos = new Set(valores.map(String));
        filtros.push((l) => aceitos.has(String(l[coluna])));
        return cadeia;
      },
      limit: () => cadeia,
      maybeSingle: () => {
        unica = true;
        return cadeia;
      },
      not: (coluna: string, operador: string, valor: unknown) => {
        if (operador === "is" && valor === null) {
          filtros.push((l) => l[coluna] !== null && l[coluna] !== undefined);
        }
        return cadeia;
      },
      // A trava do lote (desbloqueio) procura a reserva antiga do evento por
      // `unidade_c2x_id.in.(...),codigo.in.("...")`: basta entender o `in` de cada cláusula.
      or: (expressao: string) => {
        const clausulas = [...expressao.matchAll(/(\w+)\.in\.\(([^)]*)\)/g)].map(([, coluna, lista]) => ({
          coluna: String(coluna),
          valores: new Set(String(lista).split(",").map((v) => v.replace(/"/g, "").trim())),
        }));
        filtros.push((l) => clausulas.some((c) => c.valores.has(String(l[c.coluna]))));
        return cadeia;
      },
      order: () => cadeia,
      range: () => cadeia,
      select: () => cadeia,
      then: (ok: (r: unknown) => unknown, falha?: (e: unknown) => unknown) =>
        Promise.resolve(resposta()).then(ok, falha),
      update: (valores: Linha) => {
        atualizacao = valores;
        return cadeia;
      },
    };
    return cadeia;
  };
  return { createApoloAdminClient: () => ({ from: consulta }) };
});

import { DELETE, POST } from "./route";

/** O terreno dividido: a linha viva da gleba (VOC) e a antiga do pai (VLO), que aponta para ela. */
function terreno(viva: Partial<Linha> = {}): Linha[] {
  return [
    {
      bloqueado_em: null,
      codigo: "VOC0305",
      enterprise_id: "37",
      espelho_de: null,
      id: "u-voc",
      lote: "05",
      origem_c2x_id: 7001,
      quadra: "03",
      situacao: "disponivel",
      workspace_id: "careli",
      ...viva,
    },
    {
      bloqueado_em: null,
      codigo: "VLO0305",
      enterprise_id: "34",
      espelho_de: "u-voc",
      id: "u-vlo",
      lote: "05",
      origem_c2x_id: 6001,
      quadra: "03",
      situacao: "reservada",
      workspace_id: "careli",
    },
  ];
}

const proposta = (unidadeId: string, etapa: string): Linha => ({
  criado_em_c2x: null,
  etapa,
  etapa_desde: "2026-09-08T10:00:00Z",
  id: `p-${unidadeId}-${etapa}`,
  unidade_id: unidadeId,
  workspace_id: "careli",
});

async function bloquear(unidadeId = "u-voc") {
  const resposta = await POST(
    new Request("https://c2x.app.br/api/incorporador/venda/bloqueio", {
      body: JSON.stringify({ motivo: MOTIVOS_DE_BLOQUEIO[0], unidadeId }),
      method: "POST",
    }),
  );
  return { corpo: (await resposta.json()) as { error?: string }, status: resposta.status };
}

async function desbloquear(unidadeId = "u-voc") {
  const resposta = await DELETE(
    new Request("https://c2x.app.br/api/incorporador/venda/bloqueio", {
      body: JSON.stringify({ unidadeId }),
      method: "DELETE",
    }),
  );
  return { corpo: (await resposta.json()) as { error?: string }, status: resposta.status };
}

beforeEach(() => {
  estado.falha = null;
  estado.gravacoes = [];
  estado.tabelas = {
    hercules_propostas: [],
    hercules_reservas: [],
    hercules_unidades: terreno(),
    prometeu_reservas: [],
  };
});

describe("bloquear: só lote livre, pela régua única", () => {
  it("lote livre de verdade bloqueia", async () => {
    const { status } = await bloquear();
    expect(status).toBe(200);
    expect(estado.gravacoes).toHaveLength(1);
    expect(estado.gravacoes[0]).toMatchObject({ ids: ["u-voc"], tabela: "hercules_unidades" });
    expect(estado.gravacoes[0]?.valores.situacao).toBe("bloqueada");
  });

  it("⚠️ lote reservado no EVENTO não bloqueia (a conta antiga desta rota deixava passar)", async () => {
    // Cadastro `disponivel`, nenhuma proposta: só a reserva do evento, pelo id do legado da unidade.
    estado.tabelas.prometeu_reservas = [{ id: 1, situacao: "reservada", unidade_c2x_id: 7001 }];
    const { corpo, status } = await bloquear();
    expect(status).toBe(409);
    expect(corpo.error).toContain("processo de venda em andamento (Reservado)");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("⚠️ reserva ativa do Hércules também não bloqueia", async () => {
    estado.tabelas.hercules_reservas = [{ id: "r-1", situacao: "ativa", unidade_id: "u-voc", workspace_id: "careli" }];
    expect((await bloquear()).status).toBe(409);
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("⚠️ a pergunta é pelo TERRENO: proposta viva na linha antiga do pai trava a viva", async () => {
    // O caso medido em 14/09/2026: VOC0305 sem proposta, o gêmeo VLO0305 com proposta viva.
    estado.tabelas.hercules_propostas = [proposta("u-vlo", "proposta")];
    const { corpo, status } = await bloquear();
    expect(status).toBe(409);
    expect(corpo.error).toContain("(Proposta)");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("proposta morta (cancelada, distrato) não trava o lote", async () => {
    estado.tabelas.hercules_propostas = [proposta("u-voc", "cancelado"), proposta("u-vlo", "distrato")];
    expect((await bloquear()).status).toBe(200);
  });

  it("lote já bloqueado responde a situação, sem gravar", async () => {
    estado.tabelas.hercules_unidades = terreno({ situacao: "bloqueada" });
    const { corpo, status } = await bloquear();
    expect(status).toBe(409);
    expect(corpo.error).toContain("Situação da unidade: Bloqueado");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("⚠️ falha na leitura da situação NÃO vira livre: 500 e nada gravado", async () => {
    estado.falha = "prometeu_reservas";
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await bloquear()).status).toBe(500);
    expect(estado.gravacoes).toHaveLength(0);
    erro.mockRestore();
  });

  it("a linha antiga do terreno continua recusada", async () => {
    expect((await bloquear("u-vlo")).status).toBe(409);
    expect(estado.gravacoes).toHaveLength(0);
  });
});

describe("desbloquear: só volta ao estoque o que não tem nada em cima", () => {
  const bloqueadaAqui = { bloqueado_em: "2026-09-15T10:00:00Z", situacao: "bloqueada" };

  it("bloqueio do Panteon sem nada vivo volta ao estoque", async () => {
    estado.tabelas.hercules_unidades = terreno(bloqueadaAqui);
    expect((await desbloquear()).status).toBe(200);
    expect(estado.gravacoes[0]?.valores.situacao).toBe("disponivel");
  });

  it("⚠️ com reserva viva do evento por baixo, não volta", async () => {
    estado.tabelas.hercules_unidades = terreno(bloqueadaAqui);
    estado.tabelas.prometeu_reservas = [{ id: 1, situacao: "reservada", unidade_c2x_id: 7001 }];
    const { corpo, status } = await desbloquear();
    expect(status).toBe(409);
    expect(corpo.error).toContain("processo de venda em andamento");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("com proposta viva na linha antiga do terreno, não volta", async () => {
    estado.tabelas.hercules_unidades = terreno(bloqueadaAqui);
    estado.tabelas.hercules_propostas = [proposta("u-vlo", "contrato")];
    expect((await desbloquear()).status).toBe(409);
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("⚠️ bloqueio herdado do C2X (sem carimbo) não se desfaz aqui", async () => {
    estado.tabelas.hercules_unidades = terreno({ bloqueado_em: null, situacao: "bloqueada" });
    const { corpo, status } = await desbloquear();
    expect(status).toBe(409);
    expect(corpo.error).toContain("veio do C2X");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("⚠️ a trava do lote vê o dono que a régua não conta: reserva do Hércules em `proposta`", async () => {
    // A régua só conta a reserva `ativa`; a reserva que já virou proposta (situação `proposta`) é
    // dona do lote para a trava, e o lote não pode voltar ao estoque por baixo dela.
    estado.tabelas.hercules_unidades = terreno(bloqueadaAqui);
    estado.tabelas.hercules_reservas = [
      { id: "r-9", origem: "coordenador", situacao: "proposta", unidade_id: "u-vlo", workspace_id: "careli" },
    ];
    const { corpo, status } = await desbloquear();
    expect(status).toBe(409);
    expect(corpo.error).toContain("processo de venda em andamento");
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("⚠️ cupom antigo do evento, pelo CÓDIGO da linha antiga do pai, também segura o lote", async () => {
    // Sem id do legado no cupom: só o código da linha antiga do pai. O terreno é um só, e o cupom
    // preso a qualquer uma das linhas dele prende o lote inteiro.
    estado.tabelas.hercules_unidades = terreno(bloqueadaAqui);
    estado.tabelas.prometeu_reservas = [{ codigo: "VLO0305", id: 7, situacao: "reservada", unidade_c2x_id: null }];
    expect((await desbloquear()).status).toBe(409);
    expect(estado.gravacoes).toHaveLength(0);
  });

  it("falha na leitura da situação: 500 e nada gravado", async () => {
    estado.tabelas.hercules_unidades = terreno(bloqueadaAqui);
    estado.falha = "hercules_reservas";
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await desbloquear()).status).toBe(500);
    expect(estado.gravacoes).toHaveLength(0);
    erro.mockRestore();
  });
});
